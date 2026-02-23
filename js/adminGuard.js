import { supabase } from "./api.js";

/**
 * SaaS-friendly auth guard:
 * - Requires ANY authenticated user (no email allowlist).
 * - If not logged in, redirect to `redirectTo`.
 *
 * Keep the exported function name the same so existing admin pages
 * that import `requireAdminOrRedirect` will keep working.
 */
export async function requireAdminOrRedirect({ redirectTo = "../index.html" } = {}) {
  const { data } = await supabase.auth.getSession();
  const session = data?.session;

  if (!session) {
    window.location.href = redirectTo;
    return null;
  }

  return session;
}
