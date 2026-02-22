import { supabase } from "./js/api.js";

const form = document.getElementById("signup-form");
const companyEl = document.getElementById("company");
const emailEl = document.getElementById("email");
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
  submitBtn.textContent = isLoading ? "Creating…" : "Create account";
}

toggleBtn.addEventListener("click", () => {
  const isPassword = passEl.type === "password";
  passEl.type = isPassword ? "text" : "password";
  pass2El.type = isPassword ? "text" : "password";
  toggleBtn.textContent = isPassword ? "Hide" : "Show";
});

async function redirectIfAlreadyLoggedIn() {
  const { data } = await supabase.auth.getSession();
  const session = data?.session;
  if (session) {
    window.location.href = "./admin/dashboard.html";
  }
}

(async () => {
  await redirectIfAlreadyLoggedIn();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMessage("");

    const companyName = companyEl.value.trim();
    const email = emailEl.value.trim();
    const password = passEl.value;
    const password2 = pass2El.value;

    if (!companyName) {
      setMessage("Enter your company name.", "error");
      companyEl.focus();
      return;
    }

    if (!email || !password) {
      setMessage("Enter your email + password.", "error");
      return;
    }

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
      const emailRedirectTo = `${window.location.origin}/index.html`;

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo,
          data: { company_name: companyName },
        },
      });

      if (error) {
        setMessage(error.message, "error");
        return;
      }

      // If email confirmations are ON, session may be null.
      if (!data?.session) {
        setMessage("Account created. Check your email to confirm, then sign in.", "ok");
        return;
      }

      setMessage("Account created. Redirecting…", "ok");
      window.location.href = "./admin/dashboard.html";
    } catch (err) {
      console.error(err);
      setMessage("Unexpected error. Check console.", "error");
    } finally {
      setLoading(false);
    }
  });
})();
