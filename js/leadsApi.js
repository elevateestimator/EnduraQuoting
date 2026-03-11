import { supabase } from "./api.js";

let _ctx = null;

async function getSessionOrThrow() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const session = data?.session;
  if (!session) throw new Error("Not authenticated.");
  return session;
}

export async function getCompanyContext() {
  if (_ctx) return _ctx;

  const session = await getSessionOrThrow();
  const userId = session.user.id;

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
  return String(s || "").trim().replace(/[,]/g, " ").slice(0, 120);
}

function normalizeStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  return ["new", "contacted", "qualified", "won", "lost"].includes(s) ? s : "new";
}

function normalizeSource(source) {
  const s = String(source || "").trim().toLowerCase();
  return s || "manual";
}

function mapCustomer(row) {
  if (!row) return row;
  return {
    ...row,
    address: row.billing_address ?? null,
    status: row.pipeline_status ?? "new",
    source: row.lead_source ?? "manual",
    notes: row.lead_notes ?? null,
  };
}

export async function listLeads({ search = "", status = "", limit = 200 } = {}) {
  const { companyId } = await getCompanyContext();

  let q = supabase
    .from("customers")
    .select("id, company_id, first_name, last_name, company_name, email, phone, billing_address, pipeline_status, lead_source, lead_notes, created_at, updated_at")
    .eq("company_id", companyId)
    .not("pipeline_status", "is", null)
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
        `lead_notes.ilike.${like}`,
        `lead_source.ilike.${like}`,
      ].join(",")
    );
  }

  if (String(status || "").trim()) {
    q = q.eq("pipeline_status", normalizeStatus(status));
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(mapCustomer);
}

export async function createLead(payload) {
  const { companyId } = await getCompanyContext();

  const row = {
    company_id: companyId,
    first_name: payload.first_name ?? null,
    last_name: payload.last_name ?? null,
    company_name: payload.company_name ?? null,
    email: payload.email ?? null,
    phone: payload.phone ?? null,
    billing_address: payload.address ?? null,
    lead_notes: payload.notes ?? null,
    pipeline_status: normalizeStatus(payload.status),
    lead_source: normalizeSource(payload.source),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("customers")
    .insert(row)
    .select("id, company_id, first_name, last_name, company_name, email, phone, billing_address, pipeline_status, lead_source, lead_notes, created_at, updated_at")
    .single();

  if (error) throw new Error(error.message);
  return mapCustomer(data);
}

export async function updateLead(leadId, payload) {
  const updates = {
    first_name: payload.first_name ?? null,
    last_name: payload.last_name ?? null,
    company_name: payload.company_name ?? null,
    email: payload.email ?? null,
    phone: payload.phone ?? null,
    billing_address: payload.address ?? null,
    lead_notes: payload.notes ?? null,
    pipeline_status: normalizeStatus(payload.status),
    lead_source: normalizeSource(payload.source),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("customers")
    .update(updates)
    .eq("id", leadId)
    .select("id, company_id, first_name, last_name, company_name, email, phone, billing_address, pipeline_status, lead_source, lead_notes, created_at, updated_at")
    .single();

  if (error) throw new Error(error.message);
  return mapCustomer(data);
}

export async function deleteLead(leadId) {
  const { error } = await supabase.from("customers").delete().eq("id", leadId);
  if (error) throw new Error(error.message);
}
