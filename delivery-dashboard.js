// frontend/js/delivery-dashboard.js
// Patched: adds socket.io + live geolocation emission for tracking

let assignedOrders = [];
let historyOrders = [];
let socket = null;
let geoWatchers = {}; // map orderId -> watchId
// add at top of file
const AUTO_COMPLETE_METERS = 60; // threshold (meters) to auto mark delivered

// helper haversine
function haversineMeters(lat1, lon1, lat2, lon2) {
  function toRad(n){ return n * Math.PI / 180; }
  const R = 6371000; // meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/* -------------------------
   Token helpers + apiRequest
   ------------------------- */
function saveToken(token) {
  localStorage.setItem('authToken', token);
  localStorage.setItem('token', token);
}

function getToken() {
  return localStorage.getItem('authToken') || localStorage.getItem('token') || null;
}

async function apiRequest(path, method = 'GET', body = null, requireAuth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (requireAuth) {
    const token = getToken();
    if (!token) throw new Error('No auth token');
    headers['Authorization'] = 'Bearer ' + token;
  }

  const res = await fetch(`http://localhost:5000${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    const err = new Error(data?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = data;
    throw err;
  }

  return data;
}

/* -------------------------
   DOM ready
   ------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  if (!getToken()) {
    window.location.href = "../login.html";
    return;
  }

  setDate();
  setupTabs();

  // init socket after auth
  setupSocket();

  loadAssignedOrders();
  loadHistory();
});

/* -------------------------
   Date
   ------------------------- */
function setDate() {
  const el = document.getElementById('deliveryDate');
  if (el) el.textContent = new Date().toLocaleString();
}

/* -------------------------
   Tabs
   ------------------------- */
function setupTabs() {
  const navAssigned = document.getElementById('nav-assigned');
  const navHistory = document.getElementById('nav-history');

  if (navAssigned) navAssigned.onclick = () => switchTab('assigned');
  if (navHistory) navHistory.onclick = () => switchTab('history');
}

function switchTab(tab) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.delivery-section').forEach(s => s.classList.remove('active-section'));

  if (tab === 'assigned') {
    document.getElementById('nav-assigned')?.classList.add('active');
    document.getElementById('assignedSection')?.classList.add('active-section');
  } else {
    document.getElementById('nav-history')?.classList.add('active');
    document.getElementById('historySection')?.classList.add('active-section');
  }
}

/* -------------------------
   Load Assigned Orders
   ------------------------- */
async function loadAssignedOrders() {
  const container = document.getElementById('assignedOrdersList');
  if (!container) return;
  container.innerHTML = 'Loading...';

  try {
    const data = await apiRequest('/api/delivery/orders', 'GET', null, true, 'delivery_partner');
    assignedOrders = Array.isArray(data) ? data : [];
    renderAssignedOrders();
  } catch (err) {
    container.innerHTML = `<p>Failed to load assigned orders. ${err.message}</p>`;
  }
}

/* -------------------------
   Render Assigned Orders
   ------------------------- */
function renderAssignedOrders() {
  const container = document.getElementById('assignedOrdersList');
  if (!container) return;
  container.innerHTML = '';

  if (!assignedOrders.length) {
    container.innerHTML = '<p>No assigned orders.</p>';
    return;
  }

  const pretty = {
    placed: 'Placed',
    accepted: 'Accepted',
    assigned: 'Assigned',
    out_for_delivery: 'Out for delivery',
    in_transit: 'In transit',
    delivered: 'Delivered',
    completed: 'Completed',
    cancelled: 'Cancelled'
  };

  assignedOrders.forEach(order => {
    const statusRaw = (order.status || 'assigned').toString();
    const cssStatus = statusRaw.replace(/_/g, '-').toLowerCase();
    const label = pretty[statusRaw] || statusRaw;

    const div = document.createElement('div');
    div.className = 'order-card';
    div.innerHTML = `
      <div class="order-row"><strong>Order:</strong> ${shortId(order._id)}</div>
      <div class="order-row"><strong>Restaurant:</strong> ${order.restaurant?.name || ''}</div>
      <div class="order-row"><strong>Address:</strong> ${order.deliveryAddress || ''}</div>
      <div class="order-row"><span class="status-pill status-${cssStatus}">${label}</span></div>
      <div class="order-row"><span class="tracking-info" id="tracking_${order._id}"></span></div>
      <button class="update-btn">Update Status</button>
    `;

    const btn = div.querySelector('.update-btn');
    btn.onclick = () => updateDeliveryStatus(order._id, statusRaw);

    container.appendChild(div);
  });
}

function shortId(id) {
  return id ? String(id).slice(-5) : '';
}

/* -------------------------
   SOCKET SETUP
   ------------------------- */
function setupSocket() {
  try {
    // prefer role-specific token (if you used saveTokenForRole)
    const token = (typeof getTokenForRole === 'function') ? getTokenForRole('delivery_partner') : (typeof getToken === 'function' ? getToken() : null);

    // Pass token in handshake auth so server can verify it
    socket = io("http://localhost:5000", { auth: { token } });

    socket.on('connect', () => {
      console.log('[Delivery] socket connected', socket.id, 'auth=', !!token);
    });

    socket.on('connect_error', (err) => {
      console.error('[Delivery] socket connect_error', err && err.message);
      if (err && err.message === 'Authentication error') {
        alert('Socket authentication failed. Check token / login.');
      }
    });

    socket.on('disconnect', (r) => console.log('[Delivery] socket disconnected', r));

    // Echo / confirmation events (optional)
    socket.on('tracking:update', (data) => {
      // this may be an echo if you joined the room
      console.log('[Delivery] tracking:update (server broadcast)', data);
    });

  } catch (err) {
    console.error('Socket init failed', err);
  }
}

/* -------------------------
   Start/Stop geolocation watcher
   ------------------------- */
function startGeolocationEmit(orderId) {
  if (!navigator.geolocation) {
    alert('Geolocation not supported in this browser');
    return;
  }
  if (!socket || !socket.connected) {
    console.warn('Socket not connected, will still attempt geolocation but emits may fail');
  }

  // join the order room to receive any room events (optional)
  try { socket.emit('joinOrder', orderId); } catch (e) {}

  const options = { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 };

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const timestamp = pos.timestamp || Date.now();

      // emit to server
      try {
        socket.emit('location:update', { orderId, lat, lng, timestamp });
      } catch (e) {
        console.warn('Socket emit failed', e);
      }

      // update small UI on driver page
      const infoEl = document.getElementById(`tracking_${orderId}`);
      if (infoEl) infoEl.textContent = `You: ${lat.toFixed(5)}, ${lng.toFixed(5)} (sent ${new Date(timestamp).toLocaleTimeString()})`;
    },
    (err) => {
      console.error('geolocation error', err);
      alert('Geolocation error: ' + err.message);
    },
    options
  );

  geoWatchers[orderId] = watchId;
  console.log('[Delivery] started geolocation watch for', orderId, watchId);
}

function stopGeolocationEmit(orderId) {
  const id = geoWatchers[orderId];
  if (id != null) {
    navigator.geolocation.clearWatch(id);
    delete geoWatchers[orderId];
    console.log('[Delivery] stopped geolocation watch for', orderId);
  }
}

/* -------------------------
   CORRECT UPDATE STATUS FUNCTION (start/stop tracking)
   ------------------------- */
async function updateDeliveryStatus(id, status) {
  // decide next status — driver toggles assigned -> out_for_delivery -> completed
  let nextStatus;
  if (status === 'assigned' || status === 'accepted') nextStatus = 'out_for_delivery';
  else if (status === 'out_for_delivery' || status === 'in_transit') nextStatus = 'completed';
  else nextStatus = 'completed';

  try {
    console.log('[Delivery] updating order', id, 'from', status, 'to', nextStatus);

    // call backend status endpoint
    const data = await apiRequest(`/api/orders/${id}/status`, 'PUT', { status: nextStatus }, true, 'delivery_partner');

    console.log('[Delivery] status updated:', data);

    // if we moved to out_for_delivery => start emitting geolocation
    if (nextStatus === 'out_for_delivery') {
      startGeolocationEmit(id);
    }

    // if we moved to completed => stop emitting geolocation
    if (nextStatus === 'completed') {
      stopGeolocationEmit(id);
    }

    // refresh lists
    await loadAssignedOrders();
    await loadHistory();
    alert('Status updated successfully');
  } catch (err) {
    console.error('updateDeliveryStatus failed:', err);
    alert('Failed to update status: ' + (err.body?.message || err.message));
  }
}

/* -------------------------
   History
   ------------------------- */
async function loadHistory() {
  const container = document.getElementById('historyList');
  if (!container) return;
  container.innerHTML = 'Loading...';

  try {
    const data = await apiRequest('/api/delivery/history', 'GET', null, true);
    historyOrders = Array.isArray(data) ? data : [];
    renderHistory();
  } catch (err) {
    container.innerHTML = `<p>Failed to load history. ${err.message}</p>`;
  }
}

function renderHistory() {
  const container = document.getElementById('historyList');
  if (!container) return;
  container.innerHTML = '';

  if (!historyOrders.length) {
    container.innerHTML = '<p>No delivery history.</p>';
    return;
  }

  historyOrders.forEach(order => {
    const div = document.createElement('div');
    div.className = 'order-card';
    div.innerHTML = `
      <div class="order-row"><strong>ID:</strong> ${shortId(order._id)}</div>
      <div class="order-row"><strong>Restaurant:</strong> ${order.restaurant?.name || ''}</div>
      <div class="order-row"><strong>Status:</strong> Delivered</div>
    `;
    container.appendChild(div);
  });
}

/* -------------------------
   Logout
   ------------------------- */
function logoutDelivery() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('token');
  window.location.href = "../login.html";
}

window.updateDeliveryStatus = updateDeliveryStatus;
window.logoutDelivery = logoutDelivery;
window.loadAssignedOrders = loadAssignedOrders;
window.loadHistory = loadHistory;
