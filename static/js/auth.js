/**
 * auth.js
 * Handles show/hide password toggle and client-side form validation
 * for University of Ruhuna Smart Energy System login page.
 */

document.addEventListener("DOMContentLoaded", () => {
  const toggleBtn = document.getElementById("togglePasswordBtn");
  const passwordInput = document.getElementById("password");
  const eyeIcon = document.getElementById("eyeIcon");
  const eyeOffIcon = document.getElementById("eyeOffIcon");
  const loginForm = document.getElementById("loginForm");
  const loginSubmitBtn = document.getElementById("loginSubmitBtn");
  const emailInput = document.getElementById("email");
  const clientAlert = document.getElementById("clientAlert");

  // Show/Hide Password Toggle
  if (toggleBtn && passwordInput) {
    toggleBtn.addEventListener("click", () => {
      const isPassword = passwordInput.type === "password";
      passwordInput.type = isPassword ? "text" : "password";

      // Toggle SVG visibility
      if (eyeIcon && eyeOffIcon) {
        if (isPassword) {
          eyeIcon.style.display = "none";
          eyeOffIcon.style.display = "block";
          toggleBtn.setAttribute("aria-label", "Hide password");
        } else {
          eyeIcon.style.display = "block";
          eyeOffIcon.style.display = "none";
          toggleBtn.setAttribute("aria-label", "Show password");
        }
      }
    });
  }

  // Client-side Validation on Submit
  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      const email = emailInput ? emailInput.value.trim() : "";
      const password = passwordInput ? passwordInput.value : "";

      if (!email || !password) {
        e.preventDefault();
        showClientError("Please enter both email and password.");
        return;
      }

      // Email basic format check
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        e.preventDefault();
        showClientError("Please enter a valid university email address.");
        return;
      }

      // Visual feedback on submit button
      if (loginSubmitBtn) {
        loginSubmitBtn.disabled = true;
        loginSubmitBtn.innerHTML = `
          <svg class="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
            <line x1="12" y1="2" x2="12" y2="6"></line>
            <line x1="12" y1="18" x2="12" y2="22"></line>
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
            <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
            <line x1="2" y1="12" x2="6" y2="12"></line>
            <line x1="18" y1="12" x2="22" y2="12"></line>
            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
            <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
          </svg>
          Signing in...
        `;
      }
    });
  }

  function showClientError(message) {
    if (clientAlert) {
      clientAlert.textContent = message;
      clientAlert.style.display = "flex";
    } else {
      alert(message);
    }
  }
});
