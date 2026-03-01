import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/public-quote?id=<quote_id>
 * Returns a sanitized payload for the customer quote page.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const id = (req.query?.id || "").toString();
    if (!id) {
      res.status(400).json({ error: "Missing id" });
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
      .select("id,company_id,status,customer_name,customer_email,quote_no,total_cents,data")
      .eq("id", id)
      .single();

    if (error || !quote) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }

    // Merge live company fields as fallbacks so older quotes still render properly.
    // Snapshot fields (quote.data.company) take precedence.
    try {
      if (quote?.company_id) {
        const { data: company } = await supabase
          .from("companies")
          .select(
            "id,name,addr1,addr2,phone,email,web,logo_url,brand_color,currency,tax_name,tax_rate,payment_terms"
          )
          .eq("id", quote.company_id)
          .maybeSingle();

        if (company) {
          quote.data = quote.data || {};
          quote.data.company = { ...(company || {}), ...(quote.data.company || {}) };
        }
      }
    } catch {}

    // Minimal sanitization: customer sees their own details anyway.
    res.status(200).json({
      ok: true,
      quote: {
        id: quote.id,
        status: quote.status,
        customer_name: quote.customer_name,
        customer_email: quote.customer_email,
        quote_no: quote.quote_no,
        total_cents: quote.total_cents,
        data: quote.data,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Server error" });
  }
}
