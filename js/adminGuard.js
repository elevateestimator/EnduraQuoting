import { supabase, isAdminEmail } from "./api.js";

export async function requireAdminOrRedirect({
  redirectTo = "../index.html",
} = {}) {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    window.location.href = redirectTo;
    return null;
  }

  const session = data?.session;
  const email = session?.user?.email;

  if (!session || !isAdminEmail(email)) {
    await supabase.auth.signOut();
    window.location.href = redirectTo;
    return null;
  }

  return session;
}