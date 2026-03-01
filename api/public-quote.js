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

    const LOGO_BUCKET_DEFAULT = "company-logos";

    const stripQuery = (u = "") => String(u).split("?")[0];

    const mimeFromPath = (p = "") => {
      const lower = p.toLowerCase();
      if (lower.endsWith(".png")) return "image/png";
      if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
      if (lower.endsWith(".svg")) return "image/svg+xml";
      return "image/png";
    };

    const parsePublicStorageUrl = (url) => {
      // https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
      const clean = stripQuery(url);
      const m = clean.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
      if (!m) return null;
      return { bucket: m[1], path: m[2] };
    };

    const blobToDataUrl = async (blob, mimeFallback = "image/png") => {
      const ab = await blob.arrayBuffer();
      const b64 = Buffer.from(ab).toString("base64");
      const mime = blob.type || mimeFallback;
      return `data:${mime};base64,${b64}`;
    };

    const tryDownloadFromStorage = async (bucket, path) => {
      if (!bucket || !path) return null;
      try {
        const { data: b, error: e } = await supabase.storage.from(bucket).download(path);
        if (e || !b) return null;
        return { blob: b, bucket, path };
      } catch {
        return null;
      }
    };

    const tryFetchPublicUrl = async (url) => {
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const ab = await r.arrayBuffer();
        const ct = r.headers.get("content-type") || "image/png";
        const b64 = Buffer.from(ab).toString("base64");
        return { dataUrl: `data:${ct};base64,${b64}` };
      } catch {
        return null;
      }
    };

    const resolveLogoDataUrl = async (company) => {
      if (!company) return null;

      // 1) If logo_url is a Supabase public storage URL, parse bucket/path and download server-side.
      const logoUrl = String(company.logo_url || "").trim();
      const candidates = [];

      if (logoUrl) {
        const parsed = logoUrl.startsWith("http") ? parsePublicStorageUrl(logoUrl) : null;
        if (parsed) candidates.push(parsed);

        // If logo_url is a raw storage path (no domain), treat it as a path in the default bucket.
        if (!parsed && !logoUrl.startsWith("http") && !logoUrl.startsWith("data:")) {
          candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: logoUrl.replace(/^\/+/, "") });
        }
      }

      // 2) Default path used by Settings upload.
      if (company.id) {
        candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: `${company.id}/logo.png` });
        candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: `${company.id}/logo.jpg` });
        candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: `${company.id}/logo.jpeg` });
      }

      // Try downloads.
      for (const c of candidates) {
        const hit = await tryDownloadFromStorage(c.bucket, c.path);
        if (hit?.blob) {
          return await blobToDataUrl(hit.blob, mimeFromPath(hit.path));
        }
      }

      // 3) If still not found, try listing the company folder (handles custom filenames).
      if (company.id) {
        try {
          const { data: files } = await supabase.storage.from(LOGO_BUCKET_DEFAULT).list(company.id, {
            limit: 50,
            sortBy: { column: "name", order: "asc" },
          });

          const pick = (files || []).find((f) => {
            const n = String(f?.name || "").toLowerCase();
            return n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".svg");
          });

          if (pick?.name) {
            const p = `${company.id}/${pick.name}`;
            const hit = await tryDownloadFromStorage(LOGO_BUCKET_DEFAULT, p);
            if (hit?.blob) {
              return await blobToDataUrl(hit.blob, mimeFromPath(p));
            }
          }
        } catch {
          // ignore
        }
      }

      // 4) Last resort: if logo_url is an HTTP URL (non-storage), fetch it and embed as data URL.
      if (logoUrl && logoUrl.startsWith("http")) {
        const fetched = await tryFetchPublicUrl(logoUrl);
        if (fetched?.dataUrl) return fetched.dataUrl;
      }

      return null;
    };

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
          // Embed logo as a data URL to make it bulletproof on the public customer page + PDFs.
          try {
            const logoDataUrl = await resolveLogoDataUrl(company);
            if (logoDataUrl) company.logo_data_url = logoDataUrl;
          } catch {
            // ignore
          }

          quote.data = quote.data || {};
          // Helpful for older rows that stored only a storage path.
          quote.data._supabase_url = SUPABASE_URL;
          quote.data.logo_bucket = LOGO_BUCKET_DEFAULT;

          // company defaults first, then snapshot overrides
          quote.data.company = { ...(company || {}), ...(quote.data.company || {}) };
        }
      }
    } catch {
      // ignore
    }

    // Minimal sanitization: customer sees their own details anyway.
    res.status(200).json({
      ok: true,
      quote: {
        id: quote.id,
        company_id: quote.company_id,
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
