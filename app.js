// ===== DATA LAYER =====
function getProducts() {
  return JSON.parse(localStorage.getItem('profab_products') || '[]');
}
function saveProducts(products) {
  localStorage.setItem('profab_products', JSON.stringify(products));
}
function getOrders() {
  return JSON.parse(localStorage.getItem('profab_orders') || '[]');
}
function saveOrders(orders) {
  localStorage.setItem('profab_orders', JSON.stringify(orders));
}
function getCart() {
  return JSON.parse(localStorage.getItem('profab_cart') || '[]');
}
function saveCart(cart) {
  localStorage.setItem('profab_cart', JSON.stringify(cart));
}

// ===== SEED DEMO PRODUCTS =====
(function seedDemo() {
  if (getProducts().length === 0) {
    const demo = [
      {
        id: 'demo1',
        name: 'Cable Management Clip',
        category: 'Organization',
        price: 4.99,
        description: 'Snap-on cable clips that keep your desk tidy. Works with cables up to 8mm diameter. Designed to mount under desks or on walls.',
        material: 'PLA',
        printTime: '~45 min',
        dimensions: '25 × 15 × 10 mm',
        image: '',
        emoji: '🖇️',
        inStock: true
      },
      {
        id: 'demo2',
        name: 'Parametric Phone Stand',
        category: 'Desk Accessories',
        price: 12.99,
        description: 'Adjustable phone stand that holds any smartphone at the perfect viewing angle. Non-slip base included.',
        material: 'PETG',
        printTime: '~2.5 hrs',
        dimensions: '90 × 75 × 50 mm',
        image: '',
        emoji: '📱',
        inStock: true
      },
      {
        id: 'demo3',
        name: 'Modular Wall Hook',
        category: 'Home',
        price: 7.50,
        description: 'Minimalist wall hook that mounts flush to the wall. Holds up to 5 lbs. Available in sets of 3.',
        material: 'PLA',
        printTime: '~1.5 hrs',
        dimensions: '60 × 30 × 20 mm',
        image: '',
        emoji: '🪝',
        inStock: true
      }
    ];
    saveProducts(demo);
  }
})();

// ===== CART =====
function addToCart(productId, qty = 1) {
  const cart = getCart();
  const existing = cart.find(i => i.productId === productId);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({ productId, qty });
  }
  saveCart(cart);
  updateCartUI();
  showToast('Added to cart ✓');
}

function removeFromCart(productId) {
  const cart = getCart().filter(i => i.productId !== productId);
  saveCart(cart);
  updateCartUI();
  renderCartDrawer();
}

function setCartQty(productId, qty) {
  const cart = getCart();
  const item = cart.find(i => i.productId === productId);
  if (item) {
    item.qty = Math.max(1, qty);
    saveCart(cart);
    updateCartUI();
    renderCartDrawer();
  }
}

function cartTotal() {
  const cart = getCart();
  const products = getProducts();
  return cart.reduce((sum, item) => {
    const p = products.find(p => p.id === item.productId);
    return sum + (p ? p.price * item.qty : 0);
  }, 0);
}

function cartCount() {
  return getCart().reduce((s, i) => s + i.qty, 0);
}

function updateCartUI() {
  const el = document.getElementById('cartCount');
  if (el) el.textContent = cartCount();
}

function renderCartDrawer() {
  const el = document.getElementById('cartItems');
  if (!el) return;
  const cart = getCart();
  const products = getProducts();

  if (cart.length === 0) {
    el.innerHTML = '<div class="cart-empty-msg">Your cart is empty</div>';
    document.getElementById('cartTotal').textContent = '$0.00';
    return;
  }

  el.innerHTML = cart.map(item => {
    const p = products.find(p => p.id === item.productId);
    if (!p) return '';
    const imgHtml = p.image
      ? `<img src="${p.image}" class="cart-item-img" alt="${p.name}" />`
      : `<div class="cart-item-img">${p.emoji || '📦'}</div>`;
    return `
      <div class="cart-item">
        ${imgHtml}
        <div class="cart-item-info">
          <div class="cart-item-name">${p.name}</div>
          <div class="cart-item-price">$${(p.price * item.qty).toFixed(2)}</div>
        </div>
        <div class="cart-item-controls">
          <button class="qty-btn" onclick="setCartQty('${p.id}', ${item.qty - 1})">−</button>
          <span class="qty-display">${item.qty}</span>
          <button class="qty-btn" onclick="setCartQty('${p.id}', ${item.qty + 1})">+</button>
          <button class="remove-btn" onclick="removeFromCart('${p.id}')" title="Remove">✕</button>
        </div>
      </div>`;
  }).join('');

  document.getElementById('cartTotal').textContent = `$${cartTotal().toFixed(2)}`;
}

// ===== CART DRAWER TOGGLE =====
function toggleCart() {
  document.getElementById('cartDrawer').classList.toggle('open');
  document.getElementById('cartOverlay').classList.toggle('open');
  renderCartDrawer();
}

// ===== PRODUCT GRID =====
function renderProducts() {
  const grid = document.getElementById('productGrid');
  const empty = document.getElementById('emptyState');
  if (!grid) return;
  const products = getProducts().filter(p => p.inStock);

  if (products.length === 0) {
    grid.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return;
  }
  grid.style.display = 'grid';
  if (empty) empty.style.display = 'none';

  grid.innerHTML = products.map(p => {
    const imgHtml = p.image
      ? `<img src="${p.image}" class="product-img" alt="${p.name}" />`
      : `<div class="product-img-placeholder">${p.emoji || '📦'}</div>`;
    return `
      <div class="product-card" onclick="openModal('${p.id}')">
        ${imgHtml}
        <div class="product-body">
          <div class="product-category">${p.category}</div>
          <div class="product-name">${p.name}</div>
          <div class="product-desc">${p.description}</div>
          <div class="product-footer">
            <div class="product-price">$${Number(p.price).toFixed(2)}</div>
            <button class="add-btn" onclick="event.stopPropagation(); addToCart('${p.id}')">+ Add</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ===== PRODUCT MODAL =====
function openModal(productId) {
  const p = getProducts().find(p => p.id === productId);
  if (!p) return;

  const imgHtml = p.image
    ? `<img src="${p.image}" class="modal-product-img" alt="${p.name}" />`
    : `<div class="modal-product-placeholder">${p.emoji || '📦'}</div>`;

  document.getElementById('modalContent').innerHTML = `
    ${imgHtml}
    <div class="modal-category">${p.category}</div>
    <div class="modal-name">${p.name}</div>
    <div class="modal-desc">${p.description}</div>
    <div class="modal-price">$${Number(p.price).toFixed(2)}</div>
    <div class="modal-meta">
      ${p.material ? `<span class="meta-tag">🧱 ${p.material}</span>` : ''}
      ${p.printTime ? `<span class="meta-tag">⏱️ ${p.printTime}</span>` : ''}
      ${p.dimensions ? `<span class="meta-tag">📐 ${p.dimensions}</span>` : ''}
    </div>
    <div class="modal-qty">
      <label>Qty:</label>
      <input type="number" class="modal-qty-input" id="modalQty" value="1" min="1" max="99" />
    </div>
    <button class="btn-primary btn-full" onclick="addToCart('${p.id}', parseInt(document.getElementById('modalQty').value) || 1); closeModal();">
      Add to Cart
    </button>`;

  document.getElementById('productModal').classList.add('open');
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
  document.getElementById('productModal').classList.remove('open');
  document.getElementById('modalOverlay').classList.remove('open');
}

// ===== CHECKOUT =====
function checkout() {
  if (getCart().length === 0) return;
  toggleCart(); // close cart
  buildOrderSummary();
  document.getElementById('orderModal').classList.add('open');
  document.getElementById('orderOverlay').classList.add('open');
}

function buildOrderSummary() {
  const cart = getCart();
  const products = getProducts();
  const el = document.getElementById('orderSummary');
  if (!el) return;

  const lines = cart.map(item => {
    const p = products.find(p => p.id === item.productId);
    if (!p) return '';
    return `<div class="order-line"><span>${p.name} × ${item.qty}</span><span>$${(p.price * item.qty).toFixed(2)}</span></div>`;
  }).join('');

  el.innerHTML = `
    <div class="order-summary-title">Order Summary</div>
    ${lines}
    <div class="order-line order-line-total"><span>Total</span><span>$${cartTotal().toFixed(2)}</span></div>`;
}

function closeOrder() {
  document.getElementById('orderModal').classList.remove('open');
  document.getElementById('orderOverlay').classList.remove('open');
}

function submitOrder(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  const cart = getCart();
  const products = getProducts();

  const order = {
    id: 'ORD-' + Date.now().toString(36).toUpperCase(),
    date: new Date().toISOString(),
    status: 'New',
    customer: {
      name: `${data.firstName} ${data.lastName}`,
      email: data.email,
      phone: data.phone || '',
      address: `${data.address}, ${data.city}, ${data.state} ${data.zip}`
    },
    notes: data.notes || '',
    items: cart.map(item => {
      const p = products.find(p => p.id === item.productId);
      return { name: p ? p.name : item.productId, qty: item.qty, price: p ? p.price : 0 };
    }),
    total: cartTotal()
  };

  const orders = getOrders();
  orders.unshift(order);
  saveOrders(orders);
  saveCart([]);
  updateCartUI();

  closeOrder();
  document.getElementById('successMsg').textContent =
    `Thanks, ${data.firstName}! Order ${order.id} has been placed. We'll reach out to ${data.email} to confirm and arrange payment.`;
  document.getElementById('successModal').classList.add('open');
  document.getElementById('successOverlay').classList.add('open');
  form.reset();
}

function closeSuccess() {
  document.getElementById('successModal').classList.remove('open');
  document.getElementById('successOverlay').classList.remove('open');
}

// ===== TOAST =====
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = `
      position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(80px);
      background:#4caf82; color:#fff; padding:10px 20px; border-radius:10px;
      font-weight:600; font-size:14px; z-index:9999; transition:transform .3s;
      box-shadow:0 4px 20px rgba(0,0,0,0.4);`;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.transform = 'translateX(-50%) translateY(80px)'; }, 2200);
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  renderProducts();
  updateCartUI();
});
