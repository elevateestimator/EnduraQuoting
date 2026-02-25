import { supabase } from "./api.js";

/**
 * Customers API (tenant-safe)
 *
 * Assumes:
 * - public.customers table exists
 * - customers.company_id scopes rows to a workspace/company
 * - RLS policies enforce membership/roles
 */

let _ctx = null;

async function getSessionOrThrow() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const session = data?.session;
  if (!session) throw new Error("Not authenticated.");
  return session;
}

/**
 * Returns { companyId, role } for current user.
 * We cache it per page load.
 */
export async function getCompanyContext() {
  if (_ctx) return _ctx;

  const session = await getSessionOrThrow();
  const userId = session.user.id;

  // We expect a single “active” membership for now.
  // (Later you can add switching between companies if needed.)
  const { data, error } = await supabase
    .from("company_members")
    .select("company_id, role")
    .eq("user_id", userId)
    .limit(1);

  if (error) throw new Error(error.message);

  const row = data?.[0];
  if (!row?.company_id) {
    throw new Error(
      "No company membership found for this account. Create a company (owner) or ask an admin to invite you."
    );
  }

  _ctx = { companyId: row.company_id, role: row.role || "member" };
  return _ctx;
}

function safeSearch(s) {
  // Prevent commas breaking PostgREST `or()` syntax.
  return String(s || "").trim().replace(/[,]/g, " ").slice(0, 80);
}

export async function listCustomers({ search = "", limit = 200 } = {}) {
  const { companyId } = await getCompanyContext();

  let q = supabase
    .from("customers")
    .select("id, company_id, company_name, first_name, last_name, billing_address, email, phone, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const s = safeSearch(search);
  if (s) {
    const like = `%${s}%`;
    q = q.or(
      [
        `first_name.ilike.${like}`,
        `last_name.ilike.${like}`,
        `company_name.ilike.${like}`,
        `email.ilike.${like}`,
        `phone.ilike.${like}`,
        `billing_address.ilike.${like}`,
      ].join(",")
    );
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createCustomer(payload) {
  const { companyId } = await getCompanyContext();

  const row = {
    company_id: companyId,
    company_name: payload.company_name ?? null,
    first_name: payload.first_name,
    last_name: payload.last_name,
    billing_address: payload.billing_address ?? null,
    email: payload.email ?? null,
    phone: payload.phone ?? null,
  };

  const { data, error } = await supabase
    .from("customers")
    .insert(row)
    .select("id, company_id, company_name, first_name, last_name, billing_address, email, phone, created_at")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function deleteCustomer(customerId) {
  const { error } = await supabase.from("customers").delete().eq("id", customerId);
  if (error) throw new Error(error.message);
}
