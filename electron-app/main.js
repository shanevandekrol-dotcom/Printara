const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const axios = require('axios');
const FormData = require('form-data');

let mainWindow;

// ── Connection state ───────────────────────────────────────────────────────────
let connectionMode = null; // 'usb' | 'octoprint' | 'moonraker'

// USB
let port = null;
let parser = null;
let gcodeLines = [];
let lineIndex = 0;

// WiFi
let wifiBase = '';
let wifiApiKey = '';
let wifiPollInterval = null;

// Shared
let printQueue = [];
let currentPrint = null;
let isPrinting = false;
let isPaused = false;
let tempPollInterval = null;

let ejectGcode = [
  'M104 S0', 'M140 S0', 'G91', 'G1 Z15 F3000', 'G90', 'G28 X Y', 'M84',
];

// ── Window ─────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0d0d0d',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { cleanupAll(); if (process.platform !== 'darwin') app.quit(); });

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

// ── USB helpers ────────────────────────────────────────────────────────────────
function cleanupUsb() {
  if (tempPollInterval) { clearInterval(tempPollInterval); tempPollInterval = null; }
  if (port && port.isOpen) port.close();
  port = null; parser = null;
}

function cleanupWifi() {
  if (wifiPollInterval) { clearInterval(wifiPollInterval); wifiPollInterval = null; }
  wifiBase = ''; wifiApiKey = '';
}

function cleanupAll() {
  cleanupUsb(); cleanupWifi();
  isPrinting = false; isPaused = false; currentPrint = null;
}

// ── IPC: Port list ─────────────────────────────────────────────────────────────
ipcMain.handle('list-ports', async () => {
  const ports = await SerialPort.list();
  return ports.map(p => ({ path: p.path, manufacturer: p.manufacturer || '' }));
});

// ── IPC: USB connect ───────────────────────────────────────────────────────────
ipcMain.handle('connect-usb', async (_e, { portPath, baudRate }) => {
  cleanupUsb();
  return new Promise((resolve) => {
    port = new SerialPort({ path: portPath, baudRate: parseInt(baudRate, 10) });
    parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
    parser.on('data', line => {
      const t = line.trim();
      send('printer-response', t);
      handleUsbResponse(t);
    });
    port.on('open', () => {
      connectionMode = 'usb';
      startUsbTempPoll();
      resolve({ success: true });
    });
    port.on('error', err => resolve({ success: false, error: err.message }));
    port.on('close', () => { send('printer-disconnected'); isPrinting = false; currentPrint = null; });
  });
});

ipcMain.handle('disconnect-usb', async () => {
  cleanupUsb(); connectionMode = null;
  isPrinting = false; isPaused = false; currentPrint = null;
  return { success: true };
});

ipcMain.handle('send-gcode', async (_e, command) => {
  if (!port || !port.isOpen) return { success: false, error: 'Not connected' };
  return new Promise(resolve => port.write(command + '\n', err => resolve({ success: !err })));
});

function writeUsb(cmd) {
  return new Promise(resolve => {
    if (!port || !port.isOpen) return resolve(false);
    port.write(cmd + '\n', err => resolve(!err));
  });
}

function startUsbTempPoll() {
  if (tempPollInterval) clearInterval(tempPollInterval);
  tempPollInterval = setInterval(() => {
    if (port && port.isOpen && !isPrinting) writeUsb('M105');
  }, 4000);
}

function handleUsbResponse(line) {
  if (line.startsWith('ok')) {
    if (isPrinting && !isPaused) sendUsbNextLine();
  } else if (/T:/.test(line) || /T0:/.test(line)) {
    const temps = parseTemperature(line);
    if (temps) send('temperature-update', temps);
  } else if (/error/i.test(line)) {
    send('printer-error', line);
  }
}

// ── IPC: OctoPrint WiFi connect ────────────────────────────────────────────────
ipcMain.handle('connect-octoprint', async (_e, { ip, apiKey }) => {
  cleanupWifi();
  const base = ip.startsWith('http') ? ip.replace(/\/$/, '') : `http://${ip}`;
  try {
    const res = await axios.get(`${base}/api/version`, {
      headers: { 'X-Api-Key': apiKey },
      timeout: 6000,
    });
    if (res.data && res.data.api) {
      wifiBase = base; wifiApiKey = apiKey; connectionMode = 'octoprint';
      startOctoPrintPoll();
      return { success: true, version: res.data.server };
    }
    return { success: false, error: 'Not an OctoPrint server' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── IPC: Moonraker WiFi connect ────────────────────────────────────────────────
ipcMain.handle('connect-moonraker', async (_e, { ip }) => {
  cleanupWifi();
  const base = ip.startsWith('http') ? ip.replace(/\/$/, '') : `http://${ip}`;
  try {
    const res = await axios.get(`${base}/printer/info`, { timeout: 6000 });
    if (res.data && res.data.result) {
      wifiBase = base; connectionMode = 'moonraker';
      startMoonrakerPoll();
      return { success: true, state: res.data.result.state };
    }
    return { success: false, error: 'Not a Moonraker server' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('disconnect-wifi', async () => {
  cleanupWifi(); connectionMode = null;
  isPrinting = false; isPaused = false; currentPrint = null;
  return { success: true };
});

// ── OctoPrint polling ──────────────────────────────────────────────────────────
function octoprintHeaders() {
  return { 'X-Api-Key': wifiApiKey, 'Content-Type': 'application/json' };
}

function startOctoPrintPoll() {
  if (wifiPollInterval) clearInterval(wifiPollInterval);
  wifiPollInterval = setInterval(async () => {
    if (!wifiBase || connectionMode !== 'octoprint') return;
    try {
      const [jobRes, printerRes] = await Promise.all([
        axios.get(`${wifiBase}/api/job`,     { headers: octoprintHeaders(), timeout: 4000 }),
        axios.get(`${wifiBase}/api/printer`, { headers: octoprintHeaders(), timeout: 4000 }),
      ]);

      const job = jobRes.data;
      const printer = printerRes.data;

      // Temperatures
      if (printer.temperature) {
        const t = printer.temperature;
        send('temperature-update', {
          extruder: t.tool0 ? { actual: t.tool0.actual, target: t.tool0.target } : null,
          bed:      t.bed    ? { actual: t.bed.actual,   target: t.bed.target   } : null,
        });
      }

      // Progress
      if (job.progress && job.state === 'Printing') {
        const pct = Math.round(job.progress.completion || 0);
        send('print-progress', {
          progress: pct,
          currentLine: pct,
          totalLines: 100,
          gcode: '',
          item: currentPrint,
        });
        isPrinting = true;
      }

      // Completion
      if (isPrinting && (job.state === 'Operational' || job.state === 'Finishing')) {
        onWifiPrintComplete();
      }
    } catch (_) {}
  }, 3000);
}

// ── Moonraker polling ──────────────────────────────────────────────────────────
function startMoonrakerPoll() {
  if (wifiPollInterval) clearInterval(wifiPollInterval);
  wifiPollInterval = setInterval(async () => {
    if (!wifiBase || connectionMode !== 'moonraker') return;
    try {
      const res = await axios.get(
        `${wifiBase}/printer/objects/query?print_stats&extruder&heater_bed`,
        { timeout: 4000 }
      );
      const obj = res.data.result.status;

      // Temperatures
      if (obj.extruder || obj.heater_bed) {
        send('temperature-update', {
          extruder: obj.extruder  ? { actual: obj.extruder.temperature,  target: obj.extruder.target  } : null,
          bed:      obj.heater_bed ? { actual: obj.heater_bed.temperature, target: obj.heater_bed.target } : null,
        });
      }

      // Progress + completion
      if (obj.print_stats) {
        const ps = obj.print_stats;
        const total = ps.total_duration || 1;
        const pct = ps.state === 'printing'
          ? Math.min(99, Math.round((ps.print_duration / total) * 100))
          : ps.state === 'complete' ? 100 : 0;

        if (ps.state === 'printing') {
          isPrinting = true;
          send('print-progress', { progress: pct, currentLine: pct, totalLines: 100, gcode: '', item: currentPrint });
        } else if (isPrinting && ps.state === 'complete') {
          onWifiPrintComplete();
        }
      }
    } catch (_) {}
  }, 3000);
}

// ── WiFi: upload + print ───────────────────────────────────────────────────────
async function wifiUploadAndPrint(item) {
  currentPrint = item;
  currentPrint.status = 'printing';
  isPrinting = true;
  send('print-started', currentPrint);

  try {
    const fileContent = fs.readFileSync(item.filePath);
    const form = new FormData();

    if (connectionMode === 'octoprint') {
      form.append('file', fileContent, { filename: item.name, contentType: 'text/plain' });
      form.append('print', 'true');
      await axios.post(`${wifiBase}/api/files/local`, form, {
        headers: { ...form.getHeaders(), 'X-Api-Key': wifiApiKey },
        timeout: 60000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
    } else if (connectionMode === 'moonraker') {
      form.append('file', fileContent, { filename: item.name, contentType: 'text/plain' });
      await axios.post(`${wifiBase}/server/files/upload`, form, {
        headers: form.getHeaders(),
        timeout: 60000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      await axios.post(`${wifiBase}/printer/print/start`, { filename: item.name }, { timeout: 6000 });
    }
  } catch (e) {
    currentPrint.status = 'error';
    send('queue-error', 'Upload failed: ' + e.message);
    isPrinting = false;
    currentPrint = null;
  }
}

function onWifiPrintComplete() {
  if (!currentPrint) return;
  currentPrint.status = 'done';
  currentPrint.completedAt = new Date().toISOString();
  const done = currentPrint;
  currentPrint = null;
  isPrinting = false;
  send('print-complete', done);

  if (connectionMode === 'usb') {
    runUsbEjectSequence(() => setTimeout(() => startNextPrint(), 2000));
  } else {
    setTimeout(() => startNextPrint(), 3000);
  }
}

// ── IPC: WiFi gcode (Moonraker / OctoPrint) ───────────────────────────────────
ipcMain.handle('send-gcode-wifi', async (_e, cmd) => {
  try {
    if (connectionMode === 'octoprint') {
      await axios.post(`${wifiBase}/api/printer/command`,
        { command: cmd }, { headers: octoprintHeaders(), timeout: 5000 });
    } else if (connectionMode === 'moonraker') {
      await axios.post(`${wifiBase}/printer/gcode/script`,
        { script: cmd }, { timeout: 5000 });
    }
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── IPC: WiFi print control ────────────────────────────────────────────────────
ipcMain.handle('wifi-pause', async () => {
  try {
    if (connectionMode === 'octoprint')
      await axios.post(`${wifiBase}/api/job`, { command: 'pause', action: 'pause' }, { headers: octoprintHeaders() });
    else if (connectionMode === 'moonraker')
      await axios.post(`${wifiBase}/printer/print/pause`, {});
    isPaused = true; send('print-paused');
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('wifi-resume', async () => {
  try {
    if (connectionMode === 'octoprint')
      await axios.post(`${wifiBase}/api/job`, { command: 'pause', action: 'resume' }, { headers: octoprintHeaders() });
    else if (connectionMode === 'moonraker')
      await axios.post(`${wifiBase}/printer/print/resume`, {});
    isPaused = false; send('print-resumed');
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('wifi-cancel', async () => {
  try {
    if (connectionMode === 'octoprint')
      await axios.post(`${wifiBase}/api/job`, { command: 'cancel' }, { headers: octoprintHeaders() });
    else if (connectionMode === 'moonraker')
      await axios.post(`${wifiBase}/printer/print/cancel`, {});
    if (currentPrint) { currentPrint.status = 'cancelled'; send('print-cancelled', currentPrint); currentPrint = null; }
    isPrinting = false; isPaused = false;
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── IPC: Files & Queue ─────────────────────────────────────────────────────────
ipcMain.handle('browse-files', async () =>
  dialog.showOpenDialog(mainWindow, {
    title: 'Add G-code files to queue',
    filters: [{ name: 'G-code', extensions: ['gcode', 'g', 'gc', 'gco', 'ngc'] }],
    properties: ['openFile', 'multiSelections'],
  })
);

ipcMain.handle('add-files-to-queue', async (_e, filePaths) => {
  const added = [];
  for (const filePath of filePaths) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.split(';')[0].trim().length > 0);
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: path.basename(filePath), filePath,
      totalLines: lines.length, status: 'queued',
      addedAt: new Date().toISOString(),
    };
    printQueue.push(item); added.push(item);
  }
  return { success: true, items: added };
});

ipcMain.handle('get-queue', () => printQueue);

ipcMain.handle('remove-from-queue', (_e, id) => {
  if (currentPrint && currentPrint.id === id)
    return { success: false, error: 'Cannot remove currently printing item' };
  printQueue = printQueue.filter(i => i.id !== id);
  return { success: true };
});

ipcMain.handle('clear-queue', () => {
  printQueue = printQueue.filter(i => i.status === 'printing');
  return { success: true };
});

ipcMain.handle('move-queue-item', (_e, { id, direction }) => {
  const idx = printQueue.findIndex(i => i.id === id);
  if (idx === -1) return { success: false };
  if (direction === 'up'   && idx > 0)                    [printQueue[idx-1], printQueue[idx]] = [printQueue[idx], printQueue[idx-1]];
  if (direction === 'down' && idx < printQueue.length - 1)[printQueue[idx+1], printQueue[idx]] = [printQueue[idx], printQueue[idx+1]];
  return { success: true };
});

ipcMain.handle('get-eject-gcode',       ()      => ejectGcode);
ipcMain.handle('set-eject-gcode',       (_e, l) => { ejectGcode = l; return { success: true }; });
ipcMain.handle('get-connection-mode',   ()      => connectionMode);

// ── IPC: Queue start / pause / resume / cancel ─────────────────────────────────
ipcMain.handle('start-queue', async () => {
  if (!isPrinting && printQueue.some(i => i.status === 'queued')) await startNextPrint();
  return { success: true };
});

ipcMain.handle('pause-print', async () => {
  if (connectionMode === 'usb') {
    isPaused = true; writeUsb('M25'); send('print-paused');
  } else {
    return ipcMain.emit('wifi-pause');
  }
  return { success: true };
});

ipcMain.handle('resume-print', async () => {
  if (connectionMode === 'usb') {
    isPaused = false; writeUsb('M24'); send('print-resumed'); sendUsbNextLine();
  } else {
    return ipcMain.emit('wifi-resume');
  }
  return { success: true };
});

ipcMain.handle('cancel-print', async () => {
  if (connectionMode === 'usb') {
    isPrinting = false; isPaused = false;
    if (currentPrint) { currentPrint.status = 'cancelled'; send('print-cancelled', currentPrint); currentPrint = null; }
    writeUsb('M112');
  } else {
    await ipcMain.emit('wifi-cancel');
  }
  return { success: true };
});

// ── Queue runner ───────────────────────────────────────────────────────────────
async function startNextPrint() {
  const next = printQueue.find(i => i.status === 'queued');
  if (!next) { isPrinting = false; send('queue-complete'); return; }
  if (!connectionMode) { send('queue-error', 'Not connected to a printer'); return; }

  if (connectionMode === 'usb') {
    startUsbPrint(next);
  } else {
    await wifiUploadAndPrint(next);
  }
}

// ── USB print ──────────────────────────────────────────────────────────────────
function startUsbPrint(item) {
  currentPrint = item;
  currentPrint.status = 'printing';
  isPrinting = true; isPaused = false;
  try {
    const content = fs.readFileSync(currentPrint.filePath, 'utf8');
    gcodeLines = content.split('\n').map(l => l.split(';')[0].trim()).filter(l => l.length > 0);
    lineIndex = 0;
    currentPrint.totalLines = gcodeLines.length;
    send('print-started', currentPrint);
    sendUsbNextLine();
  } catch (e) {
    currentPrint.status = 'error'; send('queue-error', e.message);
    isPrinting = false; currentPrint = null;
  }
}

function sendUsbNextLine() {
  if (!isPrinting || isPaused || !port || !port.isOpen) return;
  if (lineIndex >= gcodeLines.length) { onUsbPrintComplete(); return; }
  const line = gcodeLines[lineIndex++];
  const progress = Math.round((lineIndex / gcodeLines.length) * 100);
  send('print-progress', { progress, currentLine: lineIndex, totalLines: gcodeLines.length, gcode: line, item: currentPrint });
  writeUsb(line);
}

function onUsbPrintComplete() {
  if (!currentPrint) return;
  currentPrint.status = 'done';
  currentPrint.completedAt = new Date().toISOString();
  const done = currentPrint;
  currentPrint = null; isPrinting = false;
  send('print-complete', done);
  runUsbEjectSequence(() => setTimeout(() => startNextPrint(), 2000));
}

function runUsbEjectSequence(onDone) {
  if (!port || !port.isOpen || ejectGcode.length === 0) { if (onDone) onDone(); return; }
  send('ejecting');
  let i = 0;
  const step = () => {
    if (i >= ejectGcode.length) { send('eject-complete'); if (onDone) onDone(); return; }
    writeUsb(ejectGcode[i++]);
    setTimeout(step, 400);
  };
  step();
}

// ── Temperature parser ─────────────────────────────────────────────────────────
function parseTemperature(line) {
  const extruder = line.match(/T(?:0)?:([0-9.]+)\s*\/([0-9.]+)/);
  const bed      = line.match(/B:([0-9.]+)\s*\/([0-9.]+)/);
  return {
    extruder: extruder ? { actual: parseFloat(extruder[1]), target: parseFloat(extruder[2]) } : null,
    bed:      bed      ? { actual: parseFloat(bed[1]),      target: parseFloat(bed[2])      } : null,
  };
}
