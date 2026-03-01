import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/public-quote?id=<quote_id>
 * Returns a sanitized payload for the customer quote page.
 *
 * This endpoint is allowed to use the Service Role key because it only returns
 * a single quote by ID, plus the company snapshot needed to render the quote.
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

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

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

    const safeDecode = (s = "") => {
      try {
        return decodeURIComponent(String(s));
      } catch {
        return String(s);
      }
    };

    const stripQuery = (u = "") => String(u).split("?")[0];

    const mimeFromPath = (p = "") => {
      const lower = String(p).toLowerCase();
      if (lower.endsWith(".png")) return "image/png";
      if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
      if (lower.endsWith(".svg")) return "image/svg+xml";
      if (lower.endsWith(".webp")) return "image/webp";
      return "image/png";
    };

    const parseSupabaseStorageUrl = (url) => {
      // public: .../storage/v1/object/public/<bucket>/<path>
      // signed: .../storage/v1/object/sign/<bucket>/<path>?token=...
      const clean = stripQuery(url);
      const m = clean.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/);
      if (!m) return null;
      return { bucket: m[1], path: safeDecode(m[2]) };
    };

    const blobToDataUrl = async (blob, mimeFallback = "image/png") => {
      const ab = await blob.arrayBuffer();
      const b64 = Buffer.from(ab).toString("base64");
      const mime = blob.type || mimeFallback;
      return `data:${mime};base64,${b64}`;
    };

    const tryDownloadFromStorage = async (bucket, path) => {
      if (!bucket || !path) return null;
      const cleanPath = String(path).replace(/^\/+/, "");
      try {
        const { data: b, error: e } = await supabase.storage.from(bucket).download(cleanPath);
        if (e || !b) return null;
        return { blob: b, bucket, path: cleanPath };
      } catch {
        return null;
      }
    };

    const tryFetchHttpImage = async (url) => {
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

      const logoUrl = String(company.logo_url || "").trim();
      const candidates = [];

      if (logoUrl) {
        if (logoUrl.startsWith("http")) {
          const parsed = parseSupabaseStorageUrl(logoUrl);
          if (parsed) candidates.push(parsed);
        }

        // Raw storage path
        if (!logoUrl.startsWith("http") && !logoUrl.startsWith("data:")) {
          candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: safeDecode(logoUrl).replace(/^\/+/, "") });
        }
      }

      // Conventional path used by Settings upload
      if (company.id) {
        candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: `${company.id}/logo.png` });
        candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: `${company.id}/logo.jpg` });
        candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: `${company.id}/logo.jpeg` });
        candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: `${company.id}/logo.svg` });
        candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: `${company.id}/logo.webp` });
      }

      for (const c of candidates) {
        const hit = await tryDownloadFromStorage(c.bucket, c.path);
        if (hit?.blob) return await blobToDataUrl(hit.blob, mimeFromPath(hit.path));
      }

      // If still not found, list the company folder (handles custom filenames)
      if (company.id) {
        try {
          const { data: files } = await supabase.storage.from(LOGO_BUCKET_DEFAULT).list(company.id, {
            limit: 100,
            sortBy: { column: "name", order: "asc" },
          });

          const pick = (files || []).find((f) => {
            const n = String(f?.name || "").toLowerCase();
            return n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".svg") || n.endsWith(".webp");
          });

          if (pick?.name) {
            const p = `${company.id}/${pick.name}`;
            const hit = await tryDownloadFromStorage(LOGO_BUCKET_DEFAULT, p);
            if (hit?.blob) return await blobToDataUrl(hit.blob, mimeFromPath(p));
          }
        } catch {
          // ignore
        }
      }

      // External HTTP logo (non-storage)
      if (logoUrl && logoUrl.startsWith("http")) {
        const fetched = await tryFetchHttpImage(logoUrl);
        if (fetched?.dataUrl) return fetched.dataUrl;
      }

      return null;
    };

    // ========= Merge company defaults (live DB) into quote snapshot =========
    // IMPORTANT: Quotes are rendered from snapshot (quote.data.company) for immutability.
    // But for public viewing we still merge any missing fields from the company record.
    try {
      const companyId =
        quote.company_id ||
        quote?.data?.company_id ||
        quote?.data?.company?.id ||
        null;

      if (companyId) {
        const { data: company } = await supabase
          .from("companies")
          .select("id,name,addr1,addr2,phone,email,web,logo_url,brand_color,currency,tax_name,tax_rate,payment_terms")
          .eq("id", companyId)
          .maybeSingle();

        if (company) {
          try {
            const logoDataUrl = await resolveLogoDataUrl(company);
            if (logoDataUrl) company.logo_data_url = logoDataUrl;
          } catch {
            // ignore
          }

          quote.data = quote.data || {};
          quote.data._supabase_url = SUPABASE_URL;
          quote.data.logo_bucket = LOGO_BUCKET_DEFAULT;

          // company defaults first, then snapshot overrides
          quote.data.company = { ...(company || {}), ...(quote.data.company || {}) };
        }
      }
    } catch {
      // ignore
    }

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
