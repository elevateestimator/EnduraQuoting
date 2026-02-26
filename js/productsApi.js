import { supabase } from "./api.js";

/**
 * productsApi.js
 * - Multi-tenant safe
 * - Reads the current user's company_id from company_members (cached)
 */

let cachedCompanyId = null;

async function getCompanyId() {
  if (cachedCompanyId) return cachedCompanyId;

  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) throw new Error(sessionErr.message);
  const userId = sessionData?.session?.user?.id;
  if (!userId) throw new Error("Not authenticated.");

  const { data, error } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", userId)
    .limit(1);

  if (error) throw new Error(error.message);
  const companyId = data?.[0]?.company_id;

  if (!companyId) {
    throw new Error(
      "No company membership found for this account. Create a company (owner) or ask an admin to invite you."
    );
  }

  cachedCompanyId = companyId;
  return companyId;
}

export async function listProducts({ search = "", limit = 500 } = {}) {
  const companyId = await getCompanyId();

  let q = supabase
    .from("products")
    .select("*")
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  const s = String(search || "").trim();
  if (s) {
    // Note: RLS still applies; this is just a convenience filter.
    const esc = s.replace(/%/g, "\\%").replace(/_/g, "\\_");
    q = q.or(`name.ilike.%${esc}%,description.ilike.%${esc}%,unit_type.ilike.%${esc}%`);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createProduct(payload) {
  const companyId = await getCompanyId();

  const insertPayload = {
    company_id: companyId,
    ...payload,
  };

  const { data, error } = await supabase
    .from("products")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateProduct(id, payload) {
  const companyId = await getCompanyId();

  const { data, error } = await supabase
    .from("products")
    .update(payload)
    .eq("id", id)
    .eq("company_id", companyId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}
