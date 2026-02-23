// js/quotesApi.js
// Tenant-safe Quotes API (uses RLS + company_members)
// Drop-in replacement for your existing quotesApi.js

import { supabase } from "./api.js";

async function getSessionOrThrow() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const session = data?.session;
  if (!session) throw new Error("Not signed in.");
  return session;
}

async function getMembershipOrThrow() {
  const session = await getSessionOrThrow();
  const userId = session.user.id;

  // Fetch the membership row for this user.
  // RLS on company_members should allow a user to read their own membership row.
  const { data: membership, error } = await supabase
    .from("company_members")
    .select("company_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!membership?.company_id) {
    throw new Error(
      "No company membership found for this account. Create a company (owner) or ask an admin to invite you."
    );
  }

  return { session, userId, companyId: membership.company_id, role: membership.role };
}

export async function listQuotes({ limit = 200 } = {}) {
  const { companyId } = await getMembershipOrThrow();

  const { data, error } = await supabase
    .from("quotes")
    .select("id, quote_no, customer_name, customer_email, total_cents, currency, status, created_at")
    .eq("company_id", companyId) // defense-in-depth (even though RLS should already scope this)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function createQuote(payload) {
  const { userId, companyId } = await getMembershipOrThrow();

  const insertRow = {
    ...payload,
    company_id: companyId,
    created_by: userId,
    status: payload?.status ?? "Draft",
  };

  const { data, error } = await supabase
    .from("quotes")
    .insert(insertRow)
    .select("id, quote_no, customer_name, customer_email, total_cents, currency, status, created_at, data")
    .single();

  if (error) throw error;
  return data;
}

export async function cancelQuote(quoteId) {
  if (!quoteId) throw new Error("Missing quote id.");

  const { data, error } = await supabase
    .from("quotes")
    .update({ status: "Cancelled" })
    .eq("id", quoteId)
    .select("id, status")
    .single();

  if (error) throw error;
  return data;
}

export async function duplicateQuoteById(sourceQuoteId) {
  if (!sourceQuoteId) throw new Error("Missing source quote id.");

  const { userId, companyId } = await getMembershipOrThrow();

  // Load the source quote (RLS will ensure it's in your company)
  const { data: src, error: srcErr } = await supabase
    .from("quotes")
    .select("customer_name, customer_email, total_cents, currency, data")
    .eq("id", sourceQuoteId)
    .single();

  if (srcErr) throw srcErr;

  // Clone data but clear any acceptance/signature info so the new version is clean
  const clonedData = structuredClone(src.data || {});
  if (clonedData.acceptance) delete clonedData.acceptance;

  const insertRow = {
    customer_name: src.customer_name,
    customer_email: src.customer_email,
    total_cents: src.total_cents ?? 0,
    currency: src.currency ?? "CAD",
    data: clonedData,
    status: "Draft",
    company_id: companyId,
    created_by: userId,
  };

  const { data: created, error: createErr } = await supabase
    .from("quotes")
    .insert(insertRow)
    .select("id, quote_no")
    .single();

  if (createErr) throw createErr;
  return created;
}
