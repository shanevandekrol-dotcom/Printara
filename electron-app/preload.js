const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const fn = (_, d) => cb(d);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('printer', {
  // ── USB ──────────────────────────────────────────────────────────────────
  listPorts:     ()       => ipcRenderer.invoke('list-ports'),
  connectUsb:    (cfg)    => ipcRenderer.invoke('connect-usb', cfg),
  disconnectUsb: ()       => ipcRenderer.invoke('disconnect-usb'),
  sendGcode:     (cmd)    => ipcRenderer.invoke('send-gcode', cmd),

  // ── WiFi ─────────────────────────────────────────────────────────────────
  connectOctoPrint:  (cfg) => ipcRenderer.invoke('connect-octoprint', cfg),
  connectMoonraker:  (cfg) => ipcRenderer.invoke('connect-moonraker', cfg),
  disconnectWifi:    ()    => ipcRenderer.invoke('disconnect-wifi'),
  sendGcodeWifi:     (cmd) => ipcRenderer.invoke('send-gcode-wifi', cmd),
  wifiPause:         ()    => ipcRenderer.invoke('wifi-pause'),
  wifiResume:        ()    => ipcRenderer.invoke('wifi-resume'),
  wifiCancel:        ()    => ipcRenderer.invoke('wifi-cancel'),

  // ── Queue / files ─────────────────────────────────────────────────────────
  browseFiles:      ()       => ipcRenderer.invoke('browse-files'),
  addFilesToQueue:  (paths)  => ipcRenderer.invoke('add-files-to-queue', paths),
  getQueue:         ()       => ipcRenderer.invoke('get-queue'),
  removeFromQueue:  (id)     => ipcRenderer.invoke('remove-from-queue', id),
  clearQueue:       ()       => ipcRenderer.invoke('clear-queue'),
  moveQueueItem:    (data)   => ipcRenderer.invoke('move-queue-item', data),

  // ── Print control (mode-agnostic) ─────────────────────────────────────────
  startQueue:   () => ipcRenderer.invoke('start-queue'),
  pausePrint:   () => ipcRenderer.invoke('pause-print'),
  resumePrint:  () => ipcRenderer.invoke('resume-print'),
  cancelPrint:  () => ipcRenderer.invoke('cancel-print'),

  // ── Config ───────────────────────────────────────────────────────────────
  getEjectGcode:      ()     => ipcRenderer.invoke('get-eject-gcode'),
  setEjectGcode:      (lines)=> ipcRenderer.invoke('set-eject-gcode', lines),
  getConnectionMode:  ()     => ipcRenderer.invoke('get-connection-mode'),

  // ── Events ────────────────────────────────────────────────────────────────
  onResponse:       (cb) => on('printer-response',  cb),
  onDisconnected:   (cb) => on('printer-disconnected', cb),
  onTemperature:    (cb) => on('temperature-update', cb),
  onPrintStarted:   (cb) => on('print-started',     cb),
  onPrintProgress:  (cb) => on('print-progress',    cb),
  onPrintComplete:  (cb) => on('print-complete',    cb),
  onPrintPaused:    (cb) => on('print-paused',      cb),
  onPrintResumed:   (cb) => on('print-resumed',     cb),
  onPrintCancelled: (cb) => on('print-cancelled',   cb),
  onQueueComplete:  (cb) => on('queue-complete',    cb),
  onEjecting:       (cb) => on('ejecting',          cb),
  onEjectComplete:  (cb) => on('eject-complete',    cb),
  onError:          (cb) => on('printer-error',     cb),
  onQueueError:     (cb) => on('queue-error',       cb),
});
