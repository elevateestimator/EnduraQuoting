import { supabase, isAdminEmail } from "./js/api.js";

const form = document.getElementById("login-form");
const emailEl = document.getElementById("email");
const passEl = document.getElementById("password");
const submitBtn = document.getElementById("submit");
const msgEl = document.getElementById("msg");
const toggleBtn = document.getElementById("toggle-password");

function setMessage(text, type = "") {
  msgEl.textContent = text || "";
  msgEl.className = "msg" + (type ? ` ${type}` : "");
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.textContent = isLoading ? "Signing in…" : "Sign in";
}

toggleBtn.addEventListener("click", () => {
  const isPassword = passEl.type === "password";
  passEl.type = isPassword ? "text" : "password";
  toggleBtn.textContent = isPassword ? "Hide" : "Show";
});

async function redirectIfAlreadyLoggedIn() {
  const { data } = await supabase.auth.getSession();
  const session = data?.session;
  const email = session?.user?.email;

  if (session && isAdminEmail(email)) {
    // You’ll create this later. For now you can change it to any page.
    window.location.href = "./admin/dashboard.html";
  }
}

(async () => {
  await redirectIfAlreadyLoggedIn();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMessage("");

    const email = emailEl.value.trim();
    const password = passEl.value;

    if (!email || !password) {
      setMessage("Enter your email + password.", "error");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setMessage(error.message, "error");
        return;
      }

      const sessionEmail = data?.session?.user?.email;

      if (!isAdminEmail(sessionEmail)) {
        await supabase.auth.signOut();
        setMessage(
          "This account is not allowed to access the admin dashboard.",
          "error"
        );
        return;
      }

      setMessage("Signed in. Redirecting…", "ok");
      window.location.href = "./admin/dashboard.html";
    } catch (err) {
      console.error(err);
      setMessage("Unexpected error. Check console.", "error");
    } finally {
      setLoading(false);
    }
  });
})();