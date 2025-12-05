// frontend/js/signup.js

let selectedRole = "customer"; // default role

document.addEventListener("DOMContentLoaded", () => {
  const roleButtons = document.querySelectorAll(".role-btn");
  const signupForm = document.getElementById("signupForm");
  const signupMessage = document.getElementById("signupMessage");

  // handle role selection
  roleButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      roleButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedRole = btn.dataset.role;  // "customer" / "restaurant_owner" / "delivery_partner"
    });
  });

  // handle form submit
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    signupMessage.textContent = "Creating account...";
    signupMessage.style.color = "orange";

    const name = document.getElementById("signupName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value.trim();

    try {
      // body we send to backend
      const body = {
        name,
        email,
        password,
        role: selectedRole    // backend can use this to set user.role
      };

      await apiRequest("/api/auth/register", "POST", body, false);

      signupMessage.textContent = "Signup successful! Redirecting to login...";
      signupMessage.style.color = "green";

      setTimeout(() => {
        window.location.href = "login.html";
      }, 1200);

    } catch (err) {
      console.error("SIGNUP ERROR:", err);
      signupMessage.textContent = err.message || "Signup failed";
      signupMessage.style.color = "red";
    }
  });
});
