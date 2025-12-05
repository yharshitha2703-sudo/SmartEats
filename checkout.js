// checkout.js

let cart = [];
let restaurantId = null;

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  restaurantId = params.get("restaurantId");

  loadCartFromStorage();
  renderCheckoutTable();

  document
    .getElementById("confirmOrderBtn")
    .addEventListener("click", confirmOrder);
});

function loadCartFromStorage() {
  const stored = localStorage.getItem("smarteats_cart");
  cart = stored ? JSON.parse(stored) : [];
}

function renderCheckoutTable() {
  const tbody = document.getElementById("checkoutTableBody");
  const totalEl = document.getElementById("checkoutTotal");

  tbody.innerHTML = "";
  if (!cart.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align:center; padding: 12px;">
          Cart is empty.
        </td>
      </tr>
    `;
    totalEl.textContent = "₹0";
    return;
  }

  let total = 0;
  cart.forEach(({ item, qty }) => {
    const subtotal = item.price * qty;
    total += subtotal;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.name}</td>
      <td>${qty}</td>
      <td>₹${item.price}</td>
      <td>₹${subtotal}</td>
    `;
    tbody.appendChild(tr);
  });

  totalEl.textContent = `₹${total}`;
}

async function confirmOrder() {
  const msgEl = document.getElementById("checkoutMessage");
  const address = document.getElementById("addressInput").value.trim();

  if (!cart.length) {
    msgEl.textContent = "Cart is empty.";
    msgEl.style.color = "red";
    return;
  }
  if (!address) {
    msgEl.textContent = "Please enter delivery address.";
    msgEl.style.color = "red";
    return;
  }

  try {
    // Shape this according to your backend's order API
    const body = {
      restaurantId,
      items: cart.map(({ item, qty }) => ({
        menuItemId: item._id,
        quantity: qty
      })),
      deliveryAddress: address
    };

    // 👇 change URL if your orders endpoint is different
    await apiRequest("/api/orders", "POST", body, true);

    msgEl.textContent = "Order placed successfully!";
    msgEl.style.color = "green";

    // Clear cart
    localStorage.removeItem("smarteats_cart");

    // Optionally redirect to delivery dashboard after a delay:
    // setTimeout(() => {
    //   window.location.href = "delivery/dashboard.html";
    // }, 1500);
  } catch (err) {
    console.error(err);
    msgEl.textContent = "Failed to place order.";
    msgEl.style.color = "red";
  }
}

function goBackToRestaurant() {
  if (!restaurantId) {
    window.location.href = "index.html";
    return;
  }
  window.location.href = `restaurant.html?id=${restaurantId}`;
}

// simple logout helper (optional)
function logout() {
  localStorage.removeItem("authToken");
  window.location.href = "login.html";
}
