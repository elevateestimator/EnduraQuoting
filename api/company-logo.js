import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/company-logo?quote_id=<quote_id>
 * (or) /api/company-logo?company_id=<company_id>
 *
 * Returns the company's logo image as a SAME-ORIGIN response.
 *
 * This is the most reliable way to show logos on public pages:
 * - no customer auth session required
 * - avoids Storage public/private differences
 * - avoids CORS/canvas taint issues during PDF export
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

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
    // public: https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
    // signed: https://<project>.supabase.co/storage/v1/object/sign/<bucket>/<path>?token=...
    const clean = stripQuery(url);
    const m = clean.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/);
    if (!m) return null;

    // IMPORTANT:
    // Supabase public URLs may contain encoded slashes (%2F). Storage.download expects real slashes.
    const bucket = m[1];
    const path = safeDecode(m[2]);
    return { bucket, path };
  };

  const tryDownload = async (bucket, path) => {
    if (!bucket || !path) return null;
    const cleanPath = String(path).replace(/^\/+/, "");
    try {
      const { data: blob, error } = await supabase.storage.from(bucket).download(cleanPath);
      if (error || !blob) return null;
      const ab = await blob.arrayBuffer();
      return { buf: Buffer.from(ab), mime: blob.type || mimeFromPath(cleanPath) };
    } catch {
      return null;
    }
  };

  const tryFetchHttpImage = async (url) => {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const ab = await r.arrayBuffer();
      const mime = r.headers.get("content-type") || "image/png";
      return { buf: Buffer.from(ab), mime };
    } catch {
      return null;
    }
  };

  // 1) Resolve company_id + snapshot logo_url from the quote if needed
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

    companyId =
      q.company_id ||
      q?.data?.company_id ||
      q?.data?.company?.id ||
      null;

    snapLogoUrl =
      q?.data?.company?.logo_data_url ||
      q?.data?.company?.logoDataUrl ||
      q?.data?.company?.logo_url ||
      q?.data?.company?.logoUrl ||
      null;
  }

  if (!companyId) {
    res.status(404).json({ error: "Company not found" });
    return;
  }

  // 2) Prefer DB logo_url (source of truth), but keep snapshot fallback
  let companyLogoUrl = null;
  try {
    const { data: c } = await supabase
      .from("companies")
      .select("id,logo_url")
      .eq("id", companyId)
      .maybeSingle();
    companyLogoUrl = c?.logo_url || null;
  } catch {
    // ignore
  }

  const logoUrl = String(companyLogoUrl || snapLogoUrl || "").trim();

  // 3) Build candidate (bucket, path) list
  const candidates = [];

  if (logoUrl) {
    // If snapshot already embedded a data URL, we can't stream it as an image file reliably without
    // re-encoding, so just skip it here (the client will use it directly).
    if (logoUrl.startsWith("data:")) {
      // no-op
    } else if (logoUrl.startsWith("http")) {
      const parsed = parseSupabaseStorageUrl(logoUrl);
      if (parsed) candidates.push(parsed);
      else {
        // External HTTP logo. We'll fetch it as a last resort.
      }
    } else {
      // Raw storage path
      candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: safeDecode(logoUrl).replace(/^\/+/, "") });
    }
  }

  // Conventional paths used by Settings upload
  candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: `${companyId}/logo.png` });
  candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: `${companyId}/logo.jpg` });
  candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: `${companyId}/logo.jpeg` });
  candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: `${companyId}/logo.svg` });
  candidates.push({ bucket: LOGO_BUCKET_DEFAULT, path: `${companyId}/logo.webp` });

  // 4) Try to download candidates
  for (const c of candidates) {
    const hit = await tryDownload(c.bucket, c.path);
    if (hit?.buf?.length) {
      res.setHeader("Content-Type", hit.mime);
      // Cache is OK because the client uses ?v=<timestamp> when setting <img src>.
      res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
      res.status(200).send(hit.buf);
      return;
    }
  }

  // 5) If still not found, list the company folder and download first image (handles custom filenames)
  try {
    const { data: files } = await supabase.storage.from(LOGO_BUCKET_DEFAULT).list(companyId, {
      limit: 100,
      sortBy: { column: "name", order: "asc" },
    });

    const pick = (files || []).find((f) => {
      const n = String(f?.name || "").toLowerCase();
      return n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".svg") || n.endsWith(".webp");
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

  // 6) Last resort: if logo_url was an external HTTP URL, proxy it
  if (logoUrl && logoUrl.startsWith("http")) {
    const hit = await tryFetchHttpImage(logoUrl);
    if (hit?.buf?.length) {
      res.setHeader("Content-Type", hit.mime);
      res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
      res.status(200).send(hit.buf);
      return;
    }
  }

  res.status(404).json({ error: "Logo not found" });
}
