import { supabase } from "./api.js";

export const QUOTE_STATUSES = ["Draft", "Sent", "Viewed", "Signed", "Cancelled"];

export async function listQuotes({ limit = 100 } = {}) {
  const { data, error } = await supabase
    .from("quotes")
    .select(
      "id, quote_no, customer_name, customer_email, status, total_cents, currency, created_at, version_of, cancelled_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function createQuote({
  customer_name,
  customer_email = null,
  total_cents = 0,
  currency = "CAD",
  data = {},
} = {}) {
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

export async function duplicateQuote(quoteRow) {
  if (!quoteRow?.id) throw new Error("Missing quote to duplicate.");

  // Keep a simple lineage: version_of points to the original/root quote
  const rootId = quoteRow.version_of || quoteRow.id;

  const payload = {
    customer_name: quoteRow.customer_name,
    customer_email: quoteRow.customer_email,
    total_cents: quoteRow.total_cents ?? 0,
    currency: quoteRow.currency ?? "CAD",
    status: "Draft",
    data: quoteRow.data ?? {},
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

  const { data: row, error } = await supabase
    .from("quotes")
    .update({ status: "Cancelled", cancelled_at: nowIso })
    .eq("id", quoteId)
    .select()
    .single();

  if (error) throw error;
  return row;
}