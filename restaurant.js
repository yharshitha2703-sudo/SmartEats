// frontend/js/restaurant.js

let restaurantId = null;
let cart = []; // { menuItemId, name, price, qty }

document.addEventListener("DOMContentLoaded", () => {
  if (!getToken()) {
    window.location.href = "login.html";
    return;
  }

  const params = new URLSearchParams(window.location.search);
  restaurantId = params.get("id");
  if (!restaurantId) {
    alert("No restaurant selected");
    window.location.href = "index.html";
    return;
  }

  loadRestaurantDetails();
  loadMenu();
  loadCartFromStorage();
});

async function loadRestaurantDetails() {
  try {
    const res = await apiRequest(`/api/restaurants/${restaurantId}`, "GET", null, true);
    document.getElementById("resName").textContent = res.name;
    document.getElementById("resDetails").textContent =
      `${res.cuisine || ''} • ${res.address || ''}`;
  } catch (err) {
    console.error(err);
  }
}

async function loadMenu() {
  const menuContainer = document.getElementById("menuList");
  menuContainer.innerHTML = "<p>Loading menu...</p>";

  try {
    const items = await apiRequest(`/api/menu/restaurant/${restaurantId}`, "GET", null, true);

    if (!items || items.length === 0) {
      menuContainer.innerHTML = "<p>No menu items found.</p>";
      return;
    }

    menuContainer.innerHTML = "";

    items.forEach(item => {
      const div = document.createElement("div");
      div.classList.add("menu-item");

      div.innerHTML = `
        <div class="menu-item-info">
          <div class="menu-item-title">${item.name}</div>
          <div class="menu-item-price">₹${item.price}</div>
          <div class="menu-item-category">${item.category || ''}</div>
        </div>
        <button onclick="addToCart('${item._id}', '${item.name}', ${item.price})">Add</button>
      `;

      menuContainer.appendChild(div);
    });

  } catch (err) {
    console.error(err);
    menuContainer.innerHTML = `<p style="color:red;">Failed to load menu: ${err.message}</p>`;
  }
}

function addToCart(id, name, price) {
  const existing = cart.find(i => i.menuItemId === id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ menuItemId: id, name, price, qty: 1 });
  }
  saveCartToStorage();
  renderCart();
}

function renderCart() {
  const cartContainer = document.getElementById("cartItems");
  const totalEl = document.getElementById("cartTotal");

  if (cart.length === 0) {
    cartContainer.innerHTML = "<p>No items in cart.</p>";
    totalEl.textContent = "0";
    return;
  }

  cartContainer.innerHTML = "";
  let total = 0;

  cart.forEach(item => {
    const lineTotal = item.price * item.qty;
    total += lineTotal;

    const div = document.createElement("div");
    div.classList.add("cart-item");
    div.innerHTML = `
      <span>${item.name} x ${item.qty}</span>
      <span>₹${lineTotal}</span>
    `;
    cartContainer.appendChild(div);
  });

  totalEl.textContent = total;
}

function saveCartToStorage() {
  const toSave = {
    restaurantId,
    items: cart
  };
  localStorage.setItem("smarteats_cart", JSON.stringify(toSave));
}

function loadCartFromStorage() {
  const raw = localStorage.getItem("smarteats_cart");
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    if (parsed.restaurantId === restaurantId) {
      cart = parsed.items || [];
      renderCart();
    } else {
      // different restaurant: clear
      localStorage.removeItem("smarteats_cart");
    }
  } catch {
    // ignore
  }
}
function calculateTotalPrice() {
  if (!Array.isArray(cart)) return 0;

  return cart.reduce((sum, item) => {
    const price = item.price || 0;
    const qty = item.qty || 0;
    return sum + price * qty;
  }, 0);
}

async function placeOrder() {
  const msg = document.getElementById("orderMessage");
  if (msg) {
    msg.textContent = "";
    msg.style.color = "";
  }

  if (!Array.isArray(cart) || cart.length === 0) {
    if (msg) {
      msg.textContent = "Cart is empty.";
      msg.style.color = "red";
    } else {
      alert("Cart is empty.");
    }
    return;
  }

  const addressEl = document.getElementById("address");
  const address = addressEl ? addressEl.value.trim() : "";

  if (!address) {
    if (msg) {
      msg.textContent = "Please enter delivery address.";
      msg.style.color = "red";
    } else {
      alert("Please enter delivery address.");
    }
    return;
  }

  const orderItems = cart.map((item) => ({
    menuItem: item.menuItemId,
    qty: item.qty
  }));

  const totalPrice = calculateTotalPrice();

  try {
    const payload = {
      restaurant: restaurantId,
      items: orderItems,
      deliveryAddress: address,
      totalPrice: totalPrice   // 🔴 NEW: matches your model
    };

    await apiRequest("/api/orders", "POST", payload, true);

    if (msg) {
      msg.textContent = "Order placed successfully!";
      msg.style.color = "green";
    } else {
      alert("Order placed successfully!");
    }

    // clear cart
    cart = [];
    saveCartToStorage();
    renderCart();
    if (addressEl) addressEl.value = "";

  } catch (err) {
    console.error("PLACE ORDER ERROR:", err);
    if (msg) {
      msg.textContent = err.message || "Failed to place order.";
      msg.style.color = "red";
    } else {
      alert("Failed to place order.");
    }
  }
}


function goHome() {
  window.location.href = "index.html";
}

function logout() {
  localStorage.removeItem("authToken");
  window.location.href = "login.html";
}
