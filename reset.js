import { supabase } from "./js/api.js";

const form = document.getElementById("reset-form");
const passEl = document.getElementById("password");
const pass2El = document.getElementById("password2");
const submitBtn = document.getElementById("submit");
const msgEl = document.getElementById("msg");
const toggleBtn = document.getElementById("toggle-password");

function setMessage(text, type = "") {
  msgEl.textContent = text || "";
  msgEl.className = "msg" + (type ? ` ${type}` : "");
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.textContent = isLoading ? "Updating…" : "Update password";
}

toggleBtn.addEventListener("click", () => {
  const isPassword = passEl.type === "password";
  passEl.type = isPassword ? "text" : "password";
  pass2El.type = isPassword ? "text" : "password";
  toggleBtn.textContent = isPassword ? "Hide" : "Show";
});

// Supabase sets the recovery session from the URL.
// In some clients, this can take a tick; we wait briefly before deciding it failed.
async function waitForRecoverySession() {
  setMessage("Loading reset link…");

  for (let i = 0; i < 6; i++) {
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      setMessage("");
      return true;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  setMessage(
    "This reset link is invalid or expired. Go back and request a new one.",
    "error"
  );
  submitBtn.disabled = true;
  return false;
}

(async () => {
  await waitForRecoverySession();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMessage("");

    const password = passEl.value;
    const password2 = pass2El.value;

    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.", "error");
      return;
    }
    if (password !== password2) {
      setMessage("Passwords do not match.", "error");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setMessage(error.message, "error");
        return;
      }

      setMessage("Password updated. Redirecting to sign in…", "ok");

      // Clean up the recovery session so the next visit is clean.
      await supabase.auth.signOut();

      setTimeout(() => {
        window.location.href = "./index.html";
      }, 900);
    } catch (err) {
      console.error(err);
      setMessage("Unexpected error. Check console.", "error");
    } finally {
      setLoading(false);
    }
  });
})();
