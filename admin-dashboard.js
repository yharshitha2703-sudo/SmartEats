// js/admin-dashboard.js (defensive, robust)
// This version is defensive about missing helpers and bad data shapes.
// It logs clear messages to the browser console so you can see what failed.

document.addEventListener("DOMContentLoaded", () => {
  try {
    // if getToken helper exists, require login; otherwise continue
    if (typeof getToken === "function") {
      const t = getToken();
      if (!t) {
        console.warn("No token found — redirecting to login.");
        window.location.href = "../login.html";
        return;
      }
    } else {
      // if no getToken, try localStorage 'authToken' - but do not force redirect
      if (!localStorage.getItem("authToken")) {
        console.info("getToken() missing and no authToken in localStorage. Admin features may be limited.");
      }
    }
  } catch (e) {
    console.error("Startup check error:", e);
  }

  // load in sequence safely
  loadAdminRestaurants()
    .then(() => {
      loadAdminOrders();
      loadAdminStats();
    })
    .catch((err) => {
      console.error("Failed to initialize admin dashboard:", err);
    });
});

// Helper wrapper around your existing apiRequest helper.
// If apiRequest isn't available, tries fetch as fallback.
// --- API CALL (backend-aware) ---
const BACKEND_ORIGIN = "http://localhost:5000"; // change if your backend runs on a different host/port

async function apiCall(path, method = "GET", body = null, auth = false) {
  // if apiRequest helper exists, prefer to use it (keeps project conventions)
  if (typeof apiRequest === "function") {
    try { return await apiRequest(path, method, body, auth); } 
    catch (e) { console.warn("apiRequest failed, falling back to fetch:", e); }
  }

  // Build full URL: if path starts with /api use BACKEND_ORIGIN, otherwise use provided path (helps static files)
  let url = path;
  if (typeof path === "string" && path.startsWith("/api")) url = BACKEND_ORIGIN + path;

  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = (typeof getToken === "function" && getToken()) || localStorage.getItem("authToken");
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Request ${method} ${url} failed: ${res.status} ${res.statusText} ${txt}`);
  }

  const json = await res.json().catch(() => null);
  // some endpoints return { value: [...] }
  if (json && Object.prototype.hasOwnProperty.call(json, "value") && Array.isArray(json.value)) return json.value;
  return json;
}


// small safe wrapper used in previous code
async function safeApi(path, method = "GET", body = null, auth = false) {
  try {
    const r = await apiCall(path, method, body, auth);
    return r;
  } catch (e) {
    console.warn(`API error for ${path}:`, e && e.message ? e.message : e);
    return null;
  }
}

// STATS (tries admin stats endpoint then falls back)
// ADMIN STATS (replace existing)
// ADMIN STATS (safe, with debug)
async function loadAdminStats() {
  try {
    console.log('loadAdminStats: calling /api/admin/stats');

    // call admin stats endpoint (apiCall is your helper that attaches token)
    const result = await apiCall("/api/admin/stats", "GET", null, true);

    // debug: show the raw returned object
    console.log("loadAdminStats: raw result ->", result);

    // choose keys from whatever shape backend returned
    const users = result?.users ?? result?.totalUsers ?? result?.usersCount ?? 0;
    const orders = result?.orders ?? result?.totalOrders ?? result?.orderCount ?? 0;
    const restaurants = result?.restaurants ?? result?.totalRestaurants ?? result?.restaurantCount ?? 0;
    const revenue = result?.revenue ?? result?.totalRevenue ?? result?.total ?? 0;

    // DOM elements (guard them)
    const elUsers = document.getElementById("totalUsers");
    const elOrders = document.getElementById("totalOrders");
    const elRests = document.getElementById("totalRestaurants");
    const elRevenue = document.getElementById("totalRevenue");
    const bar = document.getElementById("revenueBarFill");

    // Write safe values into DOM
    if (elUsers) elUsers.textContent = typeof users === "number" ? String(users) : (users ?? "—");
    if (elOrders) elOrders.textContent = typeof orders === "number" ? String(orders) : (orders ?? "0");
    if (elRests) elRests.textContent = typeof restaurants === "number" ? String(restaurants) : (restaurants ?? "0");

    if (elRevenue) {
      const revNum = Number(revenue) || 0;
      elRevenue.textContent = "₹" + revNum.toFixed(2);
    }

    if (bar) {
      const percent = Math.min(100, Math.max(0, (result?.revenuePercent ?? (revenue ? 50 : 10))));
      bar.style.width = `${percent}%`;
    }

    console.log("loadAdminStats: UI updated with computed values", { users, orders, restaurants, revenue });

  } catch (err) {
    console.error("loadAdminStats error:", err);
    // fallback UI updates so page remains readable
    const elUsers = document.getElementById("totalUsers");
    if (elUsers) elUsers.textContent = "-";
  }
}

// ORDERS (uses totalPrice safely)
// ORDERS (admin-aware)
// ORDERS (admin-aware, strict: admin -> admin endpoint only)
async function loadAdminOrders() {
  const tbody = document.getElementById("ordersBody");
  if (!tbody) return;
  tbody.innerHTML = "<tr><td colspan='5'>Loading orders...</td></tr>";

  try {
    // Detect admin by decoding token (UI-only check)
    let isAdmin = false;
    try {
      const token = (typeof getToken === "function" && getToken()) || localStorage.getItem("authToken");
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]));
        isAdmin = payload && payload.role === 'admin';
      }
    } catch (e) {
      console.warn('Could not decode token to detect admin role', e);
    }

    let allOrders = [];

    if (isAdmin) {
      // ADMIN branch: call the admin endpoint (single call)
      const adminOrders = await apiCall("/api/admin/orders", "GET", null, true);
      if (Array.isArray(adminOrders)) {
        allOrders = adminOrders.map(o => ({ ...o, restaurantName: o.restaurant?.name || (typeof o.restaurant === 'string' ? o.restaurant : '') }));
      }
    } else {
      // OWNER branch: fetch per-restaurant (keeps previous functionality)
      const restaurants = await apiCall("/api/restaurants/my", "GET", null, true);
      if (Array.isArray(restaurants)) {
        for (const r of restaurants) {
          if (!r._id) continue;
          const res = await apiCall(`/api/orders/restaurant/${r._id}`, "GET", null, true);
          if (Array.isArray(res)) {
            allOrders = allOrders.concat(res.map(o => ({ ...o, restaurantName: r.name })));
          }
        }
      }
    }

    if (!allOrders.length) {
      tbody.innerHTML = "<tr><td colspan='5'>No orders found.</td></tr>";
      return;
    }

    allOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    tbody.innerHTML = "";

    allOrders.forEach(o => {
      const tr = document.createElement("tr");
      const amountRaw = Number(o.totalPrice ?? o.total ?? o.totalAmount ?? 0);
      const amountText = isFinite(amountRaw) ? `₹${(amountRaw).toFixed ? amountRaw.toFixed(2) : amountRaw}` : "₹0.00";
      const customerName = o.customer?.name ?? o.customerName ?? "Customer";
      const displayRestaurant = o.restaurantName || (typeof o.restaurant === "object" ? o.restaurant?.name : o.restaurant) || "Restaurant";
      const statusText = o.status || "Pending";
      const statusClass = (statusText || "pending").toLowerCase().replace(/\s+/g, "-");

      tr.innerHTML = `
        <td>${o._id ? String(o._id).slice(-6) : ""}</td>
        <td>${escapeHtml(customerName)}</td>
        <td>${escapeHtml(displayRestaurant)}</td>
        <td>${escapeHtml(amountText)}</td>
        <td class="status ${escapeHtml(statusClass)}">${escapeHtml(statusText)}</td>
      `;

      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("loadAdminOrders error:", err);
    tbody.innerHTML = "<tr><td colspan='5'>Failed to load orders.</td></tr>";
  }
}


// RESTAURANTS
async function loadAdminRestaurants() {
  const list = document.getElementById("restaurantsList");
  if (!list) return;
  list.innerHTML = "<li>Loading restaurants...</li>";

  try {
    const restaurants = (await safeApi("/api/restaurants", "GET", null, false)) || [];
    if (!restaurants || restaurants.length === 0) {
      list.innerHTML = "<li>No restaurants found.</li>";
      return;
    }

    list.innerHTML = "";
    restaurants.forEach(r => {
      const li = document.createElement("li");
      li.className = "restaurant-item";
      const name = r.name || "Restaurant";
      const owner = (r.owner && (r.owner.name || r.owner.email)) || r.ownerName || "Owner";
      const initials = name.split(" ").map(w => (w ? w[0] : "")).join("").slice(0,2).toUpperCase();
      li.innerHTML = `
        <div class="avatar">${escapeHtml(initials)}</div>
        <div>
          <p class="restaurant-name">${escapeHtml(name)}</p>
          <p class="restaurant-owner">${escapeHtml(owner)}</p>
        </div>
      `;
      list.appendChild(li);
    });

    return restaurants;
  } catch (err) {
    console.error("loadAdminRestaurants error:", err);
    list.innerHTML = "<li>Failed to load restaurants.</li>";
    return [];
  }
}

function logout() {
  try { localStorage.removeItem("authToken"); } catch {}
  window.location.href = "../login.html";
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
