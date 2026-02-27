import { supabase } from "./api.js";

/**
 * Tenant-safe Quotes API
 *
 * Exposes the helpers your pages expect:
 * - listQuotes
 * - getQuote
 * - createQuote
 * - updateQuote
 * - cancelQuote
 * - duplicateQuoteById
 *
 * Notes:
 * - All reads/writes are scoped to the signed-in user's company_id.
 * - If a brand new signup has no membership yet, we'll attempt to bootstrap
 *   an owner company using user_metadata.company_name (set at signup).
 */

let _ctxCache = null;
let _ctxPromise = null;

function safeStr(v) {
  return String(v ?? "").trim();
}

function todayIsoLocal() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDaysIso(iso, days) {
  const base = iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date();
  base.setDate(base.getDate() + (Number(days) || 0));
  const local = new Date(base.getTime() - base.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

async function getSessionUser() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const user = data?.session?.user;
  if (!user) throw new Error("Not authenticated.");
  return user;
}

async function fetchMembership(userId) {
  const { data, error } = await supabase
    .from("company_members")
    .select("company_id, role")
    .eq("user_id", userId)
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] || null;
}

async function bootstrapCompanyForUser(user, desiredName) {
  const name = safeStr(desiredName) || "My Company";
  const userId = user.id;

  // Try with owner_user_id first (recommended schema). If that column doesn't exist yet,
  // fall back to inserting without it.
  let insertRow = { name, owner_user_id: userId };

  let res = await supabase.from("companies").insert(insertRow).select("id, name").single();

  if (res.error) {
    const msg = String(res.error.message || "").toLowerCase();
    if (msg.includes("owner_user_id") && (msg.includes("column") || msg.includes("schema"))) {
      res = await supabase.from("companies").insert({ name }).select("id, name").single();
    }
  }

  if (res.error) throw new Error(res.error.message);

  const company = res.data;
  if (!company?.id) throw new Error("Failed to create company.");

  // Create membership (owner)
  const { error: memErr } = await supabase.from("company_members").insert({
    user_id: userId,
    company_id: company.id,
    role: "owner",
  });

  // If it already exists, ignore.
  if (memErr) {
    const msg = String(memErr.message || "").toLowerCase();
    const ignorable = msg.includes("duplicate") || msg.includes("already") || msg.includes("unique");
    if (!ignorable) throw new Error(memErr.message);
  }

  return company.id;
}

async function getTenantContext() {
  if (_ctxCache) return _ctxCache;
  if (_ctxPromise) return _ctxPromise;

  _ctxPromise = (async () => {
    const user = await getSessionUser();
    const userId = user.id;

    let membership = await fetchMembership(userId);

    if (!membership?.company_id) {
      // Attempt to bootstrap a first company for brand new signups
      const companyName =
        safeStr(user.user_metadata?.company_name) ||
        safeStr(user.user_metadata?.company) ||
        safeStr(user.user_metadata?.workspace);

      if (!companyName) {
        throw new Error(
          "No company membership found for this account. Create a company (owner) or ask an admin to invite you."
        );
      }

      const companyId = await bootstrapCompanyForUser(user, companyName);
      membership = (await fetchMembership(userId)) || { company_id: companyId, role: "owner" };
    }

    const ctx = {
      user,
      userId,
      companyId: membership.company_id,
      role: membership.role || "member",
    };

    _ctxCache = ctx;
    _ctxPromise = null;
    return ctx;
  })();

  return _ctxPromise;
}

function scrubAcceptance(data) {
  const d = data && typeof data === "object" ? JSON.parse(JSON.stringify(data)) : {};
  if (d.acceptance) {
    d.acceptance = null;
  }
  // Keep meta but strip accepted flags if you added them there
  if (d.meta && typeof d.meta === "object") {
    delete d.meta.accepted_date;
    delete d.meta.accepted_at;
  }
  return d;
}

export async function listQuotes({ limit = 500 } = {}) {
  const { companyId } = await getTenantContext();

  const { data, error } = await supabase
    .from("quotes")
    .select(
      "id, quote_no, customer_name, customer_email, customer_id, total_cents, currency, status, created_at"
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data || [];
}

export async function getQuote(quoteId) {
  const { companyId } = await getTenantContext();

  const { data, error } = await supabase
    .from("quotes")
    .select(
      "id, quote_no, customer_name, customer_email, customer_id, total_cents, currency, status, created_at, updated_at, created_by, data"
    )
    .eq("id", quoteId)
    .eq("company_id", companyId)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function createQuote(payload = {}) {
  const { userId, companyId } = await getTenantContext();

  const row = {
    ...payload,
    company_id: companyId,
    created_by: userId,
    status: payload.status ?? "draft",
    total_cents: Number(payload.total_cents ?? 0) || 0,
    currency: safeStr(payload.currency) || "CAD",
    data: payload.data && typeof payload.data === "object" ? payload.data : {},
  };

  // Never allow callers to override tenancy
  delete row.id;
  delete row.companyId;

  // Insert (with a graceful fallback if your quotes table doesn't have customer_id yet)
  let res = await supabase
    .from("quotes")
    .insert(row)
    .select(
      "id, quote_no, customer_name, customer_email, customer_id, total_cents, currency, status, created_at, data"
    )
    .single();

  if (res.error) {
    const msg = String(res.error.message || "").toLowerCase();
    if (msg.includes("customer_id") && (msg.includes("column") || msg.includes("schema"))) {
      const retry = { ...row };
      delete retry.customer_id;
      res = await supabase
        .from("quotes")
        .insert(retry)
        .select(
          "id, quote_no, customer_name, customer_email, total_cents, currency, status, created_at, data"
        )
        .single();
    }
  }

  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function updateQuote(quoteId, patch = {}) {
  const { companyId } = await getTenantContext();

  const row = { ...patch };
  delete row.id;
  delete row.company_id;
  delete row.created_by;

  const { data, error } = await supabase
    .from("quotes")
    .update(row)
    .eq("id", quoteId)
    .eq("company_id", companyId)
    .select(
      "id, quote_no, customer_name, customer_email, customer_id, total_cents, currency, status, created_at, updated_at, created_by, data"
    )
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function cancelQuote(quoteId) {
  return updateQuote(quoteId, { status: "cancelled" });
}

export async function duplicateQuoteById(sourceQuoteId) {
  const { userId, companyId } = await getTenantContext();

  const src = await getQuote(sourceQuoteId);
  if (!src?.id) throw new Error("Source quote not found.");

  const srcData = src.data && typeof src.data === "object" ? src.data : {};
  const newData = scrubAcceptance(srcData);

  // Mark versioning in meta and refresh dates
  const meta = (newData.meta && typeof newData.meta === "object") ? { ...newData.meta } : {};
  meta.version_of_quote_id = src.id;
  meta.version_of_quote_no = src.quote_no;
  meta.quote_date = todayIsoLocal();
  meta.quote_expires = addDaysIso(meta.quote_date, 30);
  newData.meta = meta;

  // Keep customer linkage in json too
  if (safeStr(src.customer_id) && !safeStr(newData.customer_id)) newData.customer_id = src.customer_id;

  const row = {
    company_id: companyId,
    created_by: userId,
    status: "draft",
    customer_name: src.customer_name,
    customer_email: src.customer_email,
    customer_id: src.customer_id,
    currency: src.currency || "CAD",
    total_cents: Number(src.total_cents ?? 0) || 0,
    data: newData,
  };

  let res = await supabase
    .from("quotes")
    .insert(row)
    .select(
      "id, quote_no, customer_name, customer_email, customer_id, total_cents, currency, status, created_at, data"
    )
    .single();

  if (res.error) {
    const msg = String(res.error.message || "").toLowerCase();
    if (msg.includes("customer_id") && (msg.includes("column") || msg.includes("schema"))) {
      const retry = { ...row };
      delete retry.customer_id;
      res = await supabase
        .from("quotes")
        .insert(retry)
        .select(
          "id, quote_no, customer_name, customer_email, total_cents, currency, status, created_at, data"
        )
        .single();
    }
  }

  if (res.error) throw new Error(res.error.message);
  return res.data;
}
