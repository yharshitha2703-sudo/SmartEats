// frontend/js/main.js

document.addEventListener("DOMContentLoaded", () => {
  // If not logged in, go to login page
  if (!getToken()) {
    window.location.href = "login.html";
    return;
  }

  loadRestaurants();
});

const CATEGORY_IMAGES = {
  "Indian": "assets/images/indian.jpg",
  "North Indian": "assets/images/tandoori.jpg",
  "Italian": "assets/images/pizza.jpg",
  "Chinese": "assets/images/chinese.jpg",
  "Healthy": "assets/images/healthy.jpg",
  "Desserts": "assets/images/desserts.jpg"
};

async function loadRestaurants() {
  const container = document.getElementById("restaurantList");
  container.innerHTML = "<p>Loading...</p>";

  try {
    // If your /api/restaurants needs auth, change 4th param to true
    const data = await apiRequest("/api/restaurants", "GET", null, true);

    if (!data || data.length === 0) {
      container.innerHTML = "<p>No restaurants found.</p>";
      return;
    }

    container.innerHTML = "";

    data.forEach((r) => {
      const card = document.createElement("div");
      card.className = "restaurant-card";

      // 👇 imgSrc is defined here BEFORE we use it
      const imgSrc =
        CATEGORY_IMAGES[r.category] || "assets/images/indian.jpg"; // fallback

      card.innerHTML = `
        <img src="${imgSrc}" class="restaurant-image" alt="${r.name}">
        <h3>${r.name}</h3>
        <p>Rating: ⭐ N/A</p>
        <button class="view-menu-btn" onclick="openRestaurant('${r._id}')">
          View Menu
        </button>
      `;

      container.appendChild(card);
    });
  } catch (err) {
    console.error("LOAD RESTAURANTS ERROR:", err);
    container.innerHTML = `<p style="color:red">Failed to load restaurants: ${err.message}</p>`;
  }
}


function openRestaurant(id) {
  window.location.href = `restaurant.html?id=${id}`;
}
function goToOrders() {
  window.location.href = "orders.html";
}


function logout() {
  localStorage.removeItem("authToken");
  window.location.href = "login.html";
}
