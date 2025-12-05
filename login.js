// frontend/js/login.js (replace your existing file with this)
let selectedRole = "customer";

document.addEventListener("DOMContentLoaded", () => {
  const roleButtons = document.querySelectorAll(".role-btn");
  const loginForm = document.getElementById("loginForm");
  const loginMessage = document.getElementById("loginMessage");

  // Role selection UI
  roleButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      roleButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedRole = btn.dataset.role;
    });
  });

  // Login submit
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showMessage("Logging in...", "orange");

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value.trim();

    try {
      // Call existing apiRequest helper (api.js)
      const data = await apiRequest("/api/auth/login", "POST", {
        email,
        password
      });

      console.log("LOGIN RESPONSE:", data);

      // Try multiple token keys (some backends name it differently)
      const token = data.token || data.accessToken || data.authToken || null;

      if (!token) {
        showMessage("Login succeeded but token not found in response.", "red");
        return;
      }

      // --- NEW: Save token per-role using auth.js helper ---
      // selectedRole values in your UI should match these expected keys:
      // "customer", "delivery_partner", "restaurant_owner", "admin"
      // If your selectedRole values are different, map them accordingly before saving.
      if (typeof saveTokenForRole === "function") {
        // normalize some common role names (optional)
        let roleKey = selectedRole;
        // Example mapping if your UI uses different names:
        if (selectedRole === "restaurant_owner") roleKey = "restaurant_owner";
        if (selectedRole === "delivery_partner") roleKey = "delivery_partner";
        if (selectedRole === "admin") roleKey = "admin";
        if (selectedRole === "customer") roleKey = "customer";

        saveTokenForRole(roleKey, token);
      } else if (typeof saveToken === "function") {
        // fallback to old function if present
        saveToken(token);
      } else {
        // direct fallback
        localStorage.setItem("authToken", token);
      }
      // -----------------------------------------------------

      // Decode payload and verify role (same as before)
      let payload = null;
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          payload = JSON.parse(atob(parts[1]));
        }
      } catch (err) {
        console.warn("Failed to decode token payload:", err);
      }

      if (!payload || !payload.role) {
        // We couldn't read role from token — be conservative and block redirect
        showMessage("Cannot verify account role from token. Login blocked for safety.", "red");
        // remove token to avoid confusion
        removeTokenForRole(selectedRole);
        return;
      }

      // Map UI-selected role to token role names (if needed)
      const roleMap = {
        "customer": "customer",
        "restaurant_owner": "restaurant_owner",
        "delivery_partner": "delivery_partner",
        "admin": "admin"
      };

      const expectedRole = roleMap[selectedRole] || selectedRole;

      if (payload.role !== expectedRole) {
        // Role mismatch — show helpful message and remove token
        showMessage(
          `You selected "${selectedRole}" but this account is "${payload.role}". Please select the correct role or use a ${expectedRole} account.`,
          "red"
        );
        removeTokenForRole(selectedRole);
        return;
      }

      // All good — redirect to the right dashboard
      showMessage("Login successful! Redirecting...", "green");
      setTimeout(() => redirectByRole(expectedRole), 700);

    } catch (err) {
      console.error("LOGIN ERROR:", err);
      showMessage(err.message || "Login failed", "red");
    }
  });
});

/* Helper to display messages */
function showMessage(text, color = "black") {
  const loginMessage = document.getElementById("loginMessage");
  if (!loginMessage) return console.log(text);
  loginMessage.textContent = text;
  loginMessage.style.color = color;
}

/* Redirect based on verified role */
function redirectByRole(role) {
  switch (role) {
    case "restaurant_owner":
      window.location.href = "owner/dashboard.html";
      break;
    case "delivery_partner":
      window.location.href = "delivery/dashboard.html";
      break;
    case "admin":
      window.location.href = "admin/dashboard.html";
      break;
    case "customer":
    default:
      window.location.href = "index.html";
      break;
  }
}
