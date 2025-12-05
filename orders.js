// frontend/js/orders.js
// Full copy-paste replacement for your orders page

// open socket to backend
const socket = io('http://localhost:5000');

// small helpers for modal live map
let liveMap = null;
let liveMarker = null;
let liveMapOrderId = null;

// open a modal with a leaflet map for the order; reuse if already open
function openTrackingModal(orderId, lat = 17.3850, lng = 78.4867) {
  let modal = document.getElementById('trackingModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'trackingModal';
    modal.style = "position:fixed;left:5%;top:5%;width:90%;height:80%;background:#fff;z-index:9999;padding:10px;border-radius:6px;box-shadow:0 8px 30px rgba(0,0,0,0.4);";
    modal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <strong id="trackingTitle">Live Tracking</strong>
        <button id="trackingClose" style="padding:6px 10px;">Close</button>
      </div>
      <div id="trackingMap" style="width:100%;height:calc(100% - 40px);border-radius:6px;overflow:hidden;"></div>
    `;
    document.body.appendChild(modal);
    document.getElementById('trackingClose').onclick = () => {
      try { if (liveMap) { liveMap.remove(); liveMap = null; liveMarker = null; } } catch(e){}
      modal.remove();
      liveMapOrderId = null;
    };
  }

  document.getElementById('trackingTitle').textContent = `Live Tracking - Order ${String(orderId).slice(-5)}`;

  // init leaflet map if not present
  if (!liveMap) {
    liveMap = L.map('trackingMap').setView([lat, lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(liveMap);
  }

  if (!liveMarker) {
    liveMarker = L.marker([lat, lng]).addTo(liveMap);
  } else {
    liveMarker.setLatLng([lat, lng]);
  }

  liveMap.setView([lat, lng], 14);
  liveMapOrderId = orderId;
}

// handle incoming tracking updates from server
socket.on('tracking:update', (payload) => {
  try {
    if (!payload || !payload.orderId) return;
    console.log('socket order:tracking', payload);
    // If modal open for same order, update, else open
    if (liveMapOrderId === payload.orderId && liveMap) {
      liveMarker.setLatLng([payload.lat, payload.lng]);
      // keep map centered
      liveMap.setView([payload.lat, payload.lng], liveMap.getZoom());
    } else {
      openTrackingModal(payload.orderId, payload.lat, payload.lng);
    }
  } catch (e) {
    console.error('tracking:update handler error', e);
  }
});

socket.on('connect', () => console.log('socket connected', socket.id));
socket.on('disconnect', () => console.log('socket disconnected'));

// ===================================================================
// Page logic: load orders, render, wire track buttons and cancel, etc.
// ===================================================================

document.addEventListener("DOMContentLoaded", () => {
  if (!getToken()) {
    // not logged in as customer - go to login
    window.location.href = "login.html";
    return;
  }
  loadMyOrders();
});

async function loadMyOrders() {
  const container = document.getElementById("ordersList");
  if (!container) return;
  container.innerHTML = "<p>Loading your orders...</p>";

  try {
    // call role-aware apiRequest; customer role token expected
    const result = await apiRequest("/api/orders/my", "GET", null, true, 'customer');
    console.log("DEBUG /api/orders/my result:", result);

    const orders = Array.isArray(result) ? result : [];
    if (!orders.length) {
      container.innerHTML = "<p>You have not placed any orders yet.</p>";
      return;
    }

    container.innerHTML = "";
    orders.forEach((order) => {
      const card = document.createElement("div");
      card.classList.add("order-card");
      card.setAttribute('data-order-id', order._id || order.id);

      const restaurantName = (order.restaurant && order.restaurant.name) || "Unknown Restaurant";
      const created = order.createdAt ? new Date(order.createdAt).toLocaleString() : "";
      const status = order.status || "pending";

      const itemsSummary = (order.items || []).map(it => {
        const name = (it.name) || ((it.menuItem && it.menuItem.name) || "Item");
        const qty = it.qty || it.quantity || 1;
        return `${name} x${qty}`;
      }).join("<br>");

      card.innerHTML = `
        <div class="order-card-header" style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div class="order-restaurant">${restaurantName}</div>
            <div class="order-meta">${created}</div>
          </div>
          <div class="order-status" style="font-weight:600;">${status}</div>
        </div>
        <div class="order-items" style="margin:8px 0;">${itemsSummary || "No items"}</div>
        <div class="order-footer" style="display:flex;align-items:center;justify-content:space-between;">
          <span class="order-total">Total: ₹${order.totalPrice || 0}</span>
          <div class="order-actions">
            <button class="btn-track" data-id="${order._id}">Track Live</button>
            ${status === "pending" ? `<button class="btn-cancel" data-id="${order._id}">Cancel</button>` : ''}
          </div>
        </div>
      `;

      container.appendChild(card);

      // auto-join room so we receive updates as soon as page loads
      try { socket.emit('joinOrder', order._id); } catch (e) { console.warn('joinOrder emit failed', e); }
    });

    // wire track buttons (delegation)
    container.querySelectorAll('.btn-track').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        try {
          socket.emit('joinOrder', id);
          console.log('Joined order room for tracking', id);
        } catch (e) { console.warn('joinOrder error', e); }
        // show modal, will fill when server emits 'tracking:update' or we can open immediately
        openTrackingModal(id); // open modal immediately with default coords
        btn.textContent = 'Tracking...';
        btn.disabled = true;
      });
    });

    // wire cancel buttons
    container.querySelectorAll('.btn-cancel').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!confirm("Are you sure you want to cancel this order?")) return;
        try {
          await apiRequest(`/api/orders/${id}/cancel`, "PUT", null, true, 'customer');
          updateOrderStatusInDOM(id, 'cancelled');
          btn.disabled = true;
          btn.textContent = 'Cancelled';
          alert('Order cancelled successfully');
        } catch (err) {
          console.error('Cancel order error', err);
          alert(err.message || 'Could not cancel order');
        }
      });
    });

  } catch (err) {
    console.error("LOAD MY ORDERS ERROR:", err);
    container.innerHTML = `<p style="color:red;">Failed to load your orders: ${err.message || err}</p>`;
  }
}

// small UI helper to update status in DOM
function updateOrderStatusInDOM(orderId, newStatus) {
  const el = document.querySelector(`[data-order-id="${orderId}"]`);
  if (!el) return;
  const statusEl = el.querySelector('.order-status');
  if (statusEl) statusEl.textContent = newStatus;
  el.classList.remove('status-pending','status-cancelled','status-delivered','status-out_for_delivery');
  el.classList.add(`status-${newStatus.replace(/ /g,'_')}`);
}

// navigation helpers
function goHome() { window.location.href = "index.html"; }
function logout() {
  // remove customer-specific token (keeps other role tokens)
  try { localStorage.removeItem('authToken_customer'); } catch(e){}
  try { localStorage.removeItem('authToken'); } catch(e){}
  window.location.href = "login.html";
}
