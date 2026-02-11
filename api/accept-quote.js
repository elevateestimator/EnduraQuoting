import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/accept-quote
 * Body: { quote_id: string, signature_data_url: string }
 *
 * - Stores acceptance inside quote.data.acceptance
 * - Marks quote status as Accepted
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { quote_id, signature_data_url } = req.body || {};
    if (!quote_id) {
      res.status(400).json({ error: "Missing quote_id" });
      return;
    }
    if (!signature_data_url || typeof signature_data_url !== "string") {
      res.status(400).json({ error: "Missing signature_data_url" });
      return;
    }

    // Basic validation (keeps payload sane)
    if (!signature_data_url.startsWith("data:image/")) {
      res.status(400).json({ error: "Invalid signature format" });
      return;
    }
    // Keep under ~1.5MB to avoid serverless limits
    if (signature_data_url.length > 1_500_000) {
      res.status(400).json({ error: "Signature is too large. Please try again." });
      return;
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
      return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: quote, error } = await supabase
      .from("quotes")
      .select("id,status,customer_name,data")
      .eq("id", quote_id)
      .single();

    if (error || !quote) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }

    const status = (quote.status || "").toLowerCase();
    if (status === "cancelled") {
      res.status(400).json({ error: "This quote has been cancelled." });
      return;
    }

    // If already accepted, return existing accepted_at (idempotent-ish)
    const existingAcc = quote.data?.acceptance;
    if (existingAcc?.accepted_at) {
      res.status(200).json({ ok: true, accepted_at: existingAcc.accepted_at });
      return;
    }

    const accepted_at = new Date().toISOString();

    const data = quote.data || {};
    const billName = data?.bill_to?.client_name;
    const signerName = (billName || quote.customer_name || "Client").trim();

    data.acceptance = {
      accepted_at,
      name: signerName,
      signature_image_data_url: signature_data_url,
    };

    await supabase
      .from("quotes")
      .update({ status: "Accepted", data })
      .eq("id", quote_id);

    res.status(200).json({ ok: true, accepted_at });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Server error" });
  }
}
