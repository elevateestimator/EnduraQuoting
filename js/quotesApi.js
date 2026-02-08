import { supabase } from "./api.js";

export async function listQuotes({ limit = 200 } = {}) {
  const { data, error } = await supabase
    .from("quotes")
    .select("id, quote_no, customer_name, customer_email, status, total_cents, currency, created_at, version_of, cancelled_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function getQuote(quoteId) {
  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", quoteId)
    .single();

  if (error) throw error;
  return data;
}

export async function createQuote({ customer_name, customer_email = null, total_cents = 0, currency = "CAD", data = {} } = {}) {
  const payload = {
    customer_name,
    customer_email,
    total_cents,
    currency,
    status: "Draft",
    data,
  };

  const { data: row, error } = await supabase
    .from("quotes")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return row;
}

export async function updateQuote(quoteId, patch) {
  const { data, error } = await supabase
    .from("quotes")
    .update(patch)
    .eq("id", quoteId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function duplicateQuoteById(quoteId) {
  const original = await getQuote(quoteId);
  const rootId = original.version_of || original.id;

  const payload = {
    customer_name: original.customer_name,
    customer_email: original.customer_email,
    total_cents: original.total_cents ?? 0,
    currency: original.currency ?? "CAD",
    status: "Draft",
    data: original.data ?? {},
    version_of: rootId,
  };

  const { data: row, error } = await supabase
    .from("quotes")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return row;
}

export async function cancelQuote(quoteId) {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("quotes")
    .update({ status: "Cancelled", cancelled_at: nowIso })
    .eq("id", quoteId)
    .select()
    .single();

  if (error) throw error;
  return data;
}