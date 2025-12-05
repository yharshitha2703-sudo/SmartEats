// ---------------- GLOBALS ----------------
let allOwnerOrders = [];
let currentRestaurantId = null;
let socket = null;

document.addEventListener("DOMContentLoaded", async () => {
  if (!getToken()) {
    window.location.href = "../login.html";
    return;
  }

  setCurrentDate();
  setupNavTabs();
  await initOwnerDashboard();
  // socket is initialized inside initOwnerDashboard after restaurant selected
});

// ---------------- DATE ----------------
function setCurrentDate() {
  const now = new Date();
  document.getElementById("currentDate").textContent = now.toLocaleString();
}

// ---------------- NAVIGATION ----------------
function setupNavTabs() {
  document.getElementById("nav-orders").onclick = () => switchSection("orders");
  document.getElementById("nav-menu").onclick = () => switchSection("menu");
  document.getElementById("nav-profile").onclick = () => switchSection("profile");
}

function switchSection(section) {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".owner-section").forEach((s) =>
    s.classList.remove("active-section")
  );

  if (section === "orders") {
    document.getElementById("nav-orders").classList.add("active");
    document.getElementById("ordersSection").classList.add("active-section");
  }
  if (section === "menu") {
    document.getElementById("nav-menu").classList.add("active");
    document.getElementById("menuSection").classList.add("active-section");
  }
  if (section === "profile") {
    document.getElementById("nav-profile").classList.add("active");
    document.getElementById("profileSection").classList.add("active-section");
  }
}

// ---------------- INIT DASHBOARD ----------------
async function initOwnerDashboard() {
  try {
    const restaurants = await apiRequest("/api/restaurants/my", "GET", null, true,'restaurant-owner');
    if (!restaurants || !restaurants.length) {
      document.getElementById("restaurantName").textContent =
        "No restaurants linked to this owner";
      return;
    }

    const dropdown = document.getElementById("restaurantDropdown");
    dropdown.innerHTML = "";

    // Fill dropdown with all restaurants owned by logged-in owner
    restaurants.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r._id;
      opt.textContent = r.name;
      dropdown.appendChild(opt);
    });

    // Default select first restaurant
    currentRestaurantId = restaurants[0]._id;
    dropdown.value = currentRestaurantId;
    document.getElementById("restaurantName").textContent = restaurants[0].name;

    // When restaurant changes, reload and rejoin socket room
    dropdown.addEventListener("change", async () => {
      currentRestaurantId = dropdown.value;
      const selected = restaurants.find((r) => r._id === currentRestaurantId);
      document.getElementById("restaurantName").textContent = selected?.name || "";
      await loadOwnerOrders();
      await loadMenuItems();
      joinSocketRoom(); // re-join socket room for new restaurant
    });

    // Initial loads
    await loadOwnerOrders();
    await loadMenuItems();

    // Now setup socket (after currentRestaurantId is set)
    setupSocket();
  } catch (err) {
    console.error("INIT OWNER DASHBOARD ERROR:", err);
  }
}

// ---------------- LOAD ORDERS ----------------
async function loadOwnerOrders() {
  const tbody = document.getElementById("ownerOrdersBody");
  tbody.innerHTML = "<tr><td colspan='6'>Loading...</td></tr>";

  try {
    if (!currentRestaurantId) {
      tbody.innerHTML = "<tr><td colspan='6'>Select a restaurant</td></tr>";
      return;
    }

    const orders = await apiRequest(
      `/api/orders/restaurant/${currentRestaurantId}`,
      "GET",
      null,
      true
    );

    allOwnerOrders = Array.isArray(orders) ? orders : [];
    renderOrdersTable();
    updateOwnerOverview(); // ⭐ IMPORTANT
  } catch (err) {
    console.error("LOAD ORDERS ERROR:", err);
    tbody.innerHTML = "<tr><td colspan='6'>Failed to load</td></tr>";
  }
}

// ---------------- ORDER STATS (FIXED) ----------------
function updateOwnerOverview() {
  if (!allOwnerOrders.length) {
    document.getElementById("todayOrders").textContent = 0;
    document.getElementById("pendingOrders").textContent = 0;
    document.getElementById("completedOrders").textContent = 0;
    document.getElementById("todayRevenue").textContent = "₹0";
    document.getElementById("ownerRevenueBar").style.width = "5%";
    return;
  }

  const today = new Date().toDateString();

  let todayCount = 0;
  let pending = 0;
  let completed = 0;
  let todayRevenue = 0;

  allOwnerOrders.forEach((order) => {
    const orderDate = new Date(order.createdAt).toDateString();

    if (orderDate === today) {
      todayCount++;
      todayRevenue += order.totalPrice || 0;
    }

    // pending states (owner actionable)
    if (
      order.status === "pending" ||
      order.status === "accepted" ||
      order.status === "preparing"
    ) {
      pending++;
    }

    // completed states
    if (order.status === "completed") {
      completed++;
    }
  });

  document.getElementById("todayOrders").textContent = todayCount;
  document.getElementById("pendingOrders").textContent = pending;
  document.getElementById("completedOrders").textContent = completed;
  document.getElementById("todayRevenue").textContent = "₹" + todayRevenue;

  const percent = Math.min(100, Math.max(5, Math.round((todayRevenue / 5000) * 100)));
  document.getElementById("ownerRevenueBar").style.width = percent + "%";
}

// ---------------- RENDER ORDERS TABLE ----------------
function renderOrdersTable() {
  const tbody = document.getElementById("ownerOrdersBody");
  tbody.innerHTML = "";

  if (!allOwnerOrders.length) {
    tbody.innerHTML = "<tr><td colspan='6'>No orders.</td></tr>";
    return;
  }

  allOwnerOrders.forEach((o) => {
    const row = document.createElement("tr");

    const customer = o.customer?.name || "Customer";
    const items = (o.items || [])
      .map((i) => `${i.menuItem?.name || "Item"} x${i.qty || i.quantity || 1}`)
      .join(", ");

    // friendly status label
    const statusLabel = humanStatusLabel(o.status);

    row.innerHTML = `
      <td>${String(o._id).slice(-5)}</td>
      <td>${escapeHtml(customer)}</td>
      <td>${escapeHtml(items)}</td>
      <td>₹${o.totalPrice || 0}</td>
      <td>${statusLabel}</td>
      <td>${renderActionButtons(o)}</td>
    `;

    tbody.appendChild(row);
  });
}

function humanStatusLabel(s) {
  switch (s) {
    case "pending": return "pending";
    case "accepted": return "accepted";
    case "preparing": return "preparing";
    case "assigned": return "assigned";
    case "out_for_delivery": return "out for delivery";
    case "completed": return "completed";
    case "cancelled": return "cancelled";
    default: return s;
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderActionButtons(order) {
  const s = order.status;

  // Do not allow any action on cancelled orders
  if (s === "cancelled") {
    return `<span class="cancelled-label">Cancelled ❌</span>`;
  }

  // Assign button visible ONLY if not assigned yet and not cancelled/completed
  const canAssign = !order.assignedTo && s !== "completed" && s !== "out_for_delivery" && s !== "assigned";
  const assignBtn = canAssign
    ? `<button onclick="assignOrder('${order._id}','${s}')">Assign</button>`
    : `<span class="assigned-label">${order.assignedTo ? "Assigned ✓" : ""}</span>`;

  // Owner actions: only for pending/accepted/preparing
  if (s === "pending") {
    return `
      ${assignBtn}
      <button onclick="updateOrderStatus('${order._id}','accepted')">Accept</button>
      <button onclick="updateOrderStatus('${order._id}','cancelled')">Cancel</button>
    `;
  }

  if (s === "accepted") {
    return `
      ${assignBtn}
      <button onclick="updateOrderStatus('${order._id}','preparing')">Preparing</button>
    `;
  }

  if (s === "preparing") {
    return `
      ${assignBtn}
      <button onclick="updateOrderStatus('${order._id}','preparing')">Preparing</button>
    `;
  }

  // Assigned / out_for_delivery / completed: show labels only (partners handle transitions)
  if (s === "assigned") {
    return `<span class="assigned-label">Assigned ✓</span>`;
  }

  if (s === "out_for_delivery") {
    return `<span>Out for delivery</span>`;
  }

  if (s === "completed") {
    return `<span>Delivered ✓</span>`;
  }

  // fallback
  return assignBtn;
}

async function assignOrder(orderId, orderStatus) {
  try {
    // Prevent assigning cancelled or completed orders (defensive)
    if (orderStatus === "cancelled" || orderStatus === "completed") {
      alert("Order cannot be assigned (cancelled or completed).");
      return;
    }

    // Step 1 — Get all delivery partners
    const partners = await apiRequest(
      "/api/delivery/partners",
      "GET",
      null,
      true
    );

    if (!partners || !partners.length) {
      alert("No delivery partners available!");
      return;
    }

    // Step 2 — Ask owner which partner to assign
    const names = partners
      .map((p, i) => `${i + 1}. ${p.name} (${p.vehicle || "No vehicle"})`)
      .join("\n");

    const choice = prompt(
      "Select delivery partner:\n\n" + names + "\n\nEnter number:"
    );
    if (!choice) return;

    const index = parseInt(choice) - 1;
    if (isNaN(index) || index < 0 || index >= partners.length) {
      alert("Invalid selection");
      return;
    }

    const selected = partners[index];

    // Step 3 — Assign the order (try assign endpoint)
    const res = await apiRequest(
      `/api/orders/${orderId}/assign`,
      "PUT",
      { assignedTo: selected._id },
      true
    );

    // Some backends may not update status on assign; force 'assigned' status in UI
    await apiRequest(`/api/orders/${orderId}/status`, "PUT", { status: "assigned" }, true);

    alert(`Order assigned to ${selected.name}`);
    await loadOwnerOrders(); // refresh
  } catch (err) {
    console.error("ASSIGN ERROR:", err);
    alert("Failed to assign order");
  }
}

// ---------------- UPDATE STATUS ----------------
async function updateOrderStatus(orderId, status) {
  try {
    // Owner should not be able to set partner-only statuses from here
    if (status === "out_for_delivery" || status === "completed") {
      alert("This action can only be performed by the delivery partner.");
      return;
    }

    await apiRequest(`/api/orders/${orderId}/status`, "PUT", { status }, true);
    await loadOwnerOrders();
  } catch (err) {
    console.error("UPDATE STATUS ERROR:", err);
    alert("Error updating status");
  }
}

// ---------------- MENU SECTION ----------------
async function loadMenuItems() {
  const container = document.getElementById("menuList");
  container.innerHTML = "<p>Loading...</p>";

  try {
    if (!currentRestaurantId) {
      container.innerHTML = "<p>Select a restaurant</p>";
      return;
    }

    const items = await apiRequest(
      `/api/menu/restaurant/${currentRestaurantId}`,
      "GET",
      null,
      false
    );

    if (!items || !items.length) {
      container.innerHTML = "<p>No items yet.</p>";
      return;
    }

    container.innerHTML = "";

    items.forEach((item) => {
      const div = document.createElement("div");
      div.className = "menu-item-card";

      div.innerHTML = `
        <h3>${escapeHtml(item.name)}</h3>
        <p>₹${item.price || 0}</p>
        <button onclick="editMenuItem('${item._id}')">Edit</button>
        <button onclick="deleteMenuItem('${item._id}')">Delete</button>
      `;

      container.appendChild(div);
    });
  } catch (err) {
    console.error("LOAD MENU ERROR:", err);
    container.innerHTML = "<p>Failed to load.</p>";
  }
}

function openAddMenuForm() {
  const name = prompt("Enter item name:");
  if (!name) return;

  const price = prompt("Enter price:");
  if (!price) return;

  apiRequest(
    "/api/menu",
    "POST",
    { restaurant: currentRestaurantId, name, price },
    true
  ).then(() => {
    loadMenuItems();
  });
}

function editMenuItem(id) {
  const newName = prompt("New name:");
  if (!newName) return;

  apiRequest(`/api/menu/${id}`, "PUT", { name: newName }, true).then(() => {
    loadMenuItems();
  });
}

function deleteMenuItem(id) {
  if (!confirm("Delete item?")) return;

  apiRequest(`/api/menu/${id}`, "DELETE", null, true).then(() => {
    loadMenuItems();
  });
}

// ---------------- SOCKET ----------------
function setupSocket() {
  // initialize socket once
  socket = io("http://localhost:5000");

  socket.on("connect", () => {
    console.log("Socket connected:", socket.id);
    joinSocketRoom();
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected");
  });

  socket.on("menu:updated", () => loadMenuItems());
  socket.on("menu:created", () => loadMenuItems());
  socket.on("menu:deleted", () => loadMenuItems());
  socket.on("order:update", () => loadOwnerOrders());
}

function joinSocketRoom() {
  if (!socket || !socket.connected) return;
  if (!currentRestaurantId) return;
  // safe room name
  const room = `restaurant_${currentRestaurantId}`;
  socket.emit("joinRoom", room);
  console.log("Joined socket room:", room);
}

// ---------------- LOGOUT ----------------
function logoutOwner() {
  localStorage.removeItem("authToken");
  window.location.href = "../login.html";
}
