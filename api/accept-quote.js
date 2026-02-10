import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/accept-quote
 * Body: { quote_id: string, name: string, email?: string|null }
 *
 * Marks quote as Accepted and stores acceptance data inside quote.data.acceptance
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { quote_id, name, email } = req.body || {};
    if (!quote_id) {
      res.status(400).json({ error: "Missing quote_id" });
      return;
    }
    if (!name || !String(name).trim()) {
      res.status(400).json({ error: "Missing name" });
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
      .select("id,status,data")
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

    const accepted_at = new Date().toISOString();
    const updatedData = quote.data || {};
    updatedData.acceptance = {
      accepted_at,
      name: String(name).trim(),
      email: email ? String(email).trim() : null,
      signature_text: String(name).trim(), // typed signature
    };

    await supabase
      .from("quotes")
      .update({ status: "Accepted", data: updatedData })
      .eq("id", quote_id);

    res.status(200).json({ ok: true, accepted_at });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Server error" });
  }
}
