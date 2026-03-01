import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/company-logo?quote_id=<quote_id>
 * (or) /api/company-logo?company_id=<company_id>
 *
 * Returns the company's logo image as a SAME-ORIGIN response.
 *
 * Why this exists:
 * - Customer quote page is public (no auth session)
 * - Logos live in Supabase Storage and sometimes fail to render due to:
 *   - bad snapshot URLs
 *   - private buckets / missing public access
 *   - CORS + canvas restrictions during PDF export
 *
 * This endpoint uses the Service Role key server-side to fetch the logo and
 * streams it back to the browser, so the <img> loads reliably.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
      return;
    }

    const quoteId = (req.query?.quote_id || req.query?.id || "").toString();
    const companyIdQuery = (req.query?.company_id || "").toString();

    if (!quoteId && !companyIdQuery) {
      res.status(400).json({ error: "Missing quote_id or company_id" });
      return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Resolve company_id
    let companyId = companyIdQuery || null;
    let snapLogoUrl = null;

    if (!companyId && quoteId) {
      const { data: q, error: qErr } = await supabase
        .from("quotes")
        .select("company_id,data")
        .eq("id", quoteId)
        .maybeSingle();

      if (qErr || !q) {
        res.status(404).json({ error: "Quote not found" });
        return;
      }

      companyId = q.company_id || q?.data?.company?.id || null;
      snapLogoUrl = q?.data?.company?.logo_url || q?.data?.company?.logoUrl || null;
    }

    if (!companyId) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    // Load company logo_url if present (best source of truth)
    let company = null;
    try {
      const { data: c } = await supabase
        .from("companies")
        .select("id,logo_url")
        .eq("id", companyId)
        .maybeSingle();
      company = c || null;
    } catch {
      // ignore
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

    const tryDownload = async (bucket, path) => {
      if (!bucket || !path) return null;
      try {
        const { data: blob, error } = await supabase.storage.from(bucket).download(path);
        if (error || !blob) return null;
        const ab = await blob.arrayBuffer();
        return { buf: Buffer.from(ab), mime: blob.type || mimeFromPath(path) };
      } catch {
        return null;
      }
    };

    const candidates = [];

    // 1) Prefer DB logo_url (or snapshot logo_url as fallback)
    const logoUrl = String(company?.logo_url || snapLogoUrl || "").trim();
    if (logoUrl) {
      if (logoUrl.startsWith("http")) {
        const parsed = parsePublicStorageUrl(logoUrl);
        if (parsed) candidates.push(parsed);
      }

      // If the DB stored only a raw storage path
      if (!logoUrl.startsWith("http") && !logoUrl.startsWith("data:")) {
        candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: logoUrl.replace(/^\/+/, "") });
      }
    }

    // 2) Conventional paths used by Settings upload
    candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: `${companyId}/logo.png` });
    candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: `${companyId}/logo.jpg` });
    candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: `${companyId}/logo.jpeg` });
    candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: `${companyId}/logo.svg` });

    // 3) Try to download candidates
    for (const c of candidates) {
      const hit = await tryDownload(c.bucket, c.path);
      if (hit?.buf?.length) {
        res.setHeader("Content-Type", hit.mime);
        // Cache is fine because we add ?v=timestamp on the client.
        res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
        res.status(200).send(hit.buf);
        return;
      }
    }

    // 4) As a last resort: list the folder and download the first image
    try {
      const { data: files } = await supabase.storage.from(LOGO_BUCKET_DEFAULT).list(companyId, {
        limit: 50,
        sortBy: { column: "name", order: "asc" },
      });

      const pick = (files || []).find((f) => {
        const n = String(f?.name || "").toLowerCase();
        return n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".svg");
      });

      if (pick?.name) {
        const p = `${companyId}/${pick.name}`;
        const hit = await tryDownload(LOGO_BUCKET_DEFAULT, p);
        if (hit?.buf?.length) {
          res.setHeader("Content-Type", hit.mime);
          res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
          res.status(200).send(hit.buf);
          return;
        }
      }
    } catch {
      // ignore
    }

    // Not found
    res.status(404).json({ error: "Logo not found" });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Server error" });
  }
}
