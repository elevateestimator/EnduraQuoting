/**
 * /api/company-logo
 * Returns the company logo image (PNG/JPG/etc) for a given quote or company.
 *
 * Why this exists:
 * - Customer quote pages are PUBLIC (no Supabase auth session).
 * - Company logos live in Supabase Storage + companies.logo_url.
 * - Fetching the logo via same-origin (/api/...) avoids CORS issues and ensures PDF capture works.
 *
 * Inputs:
 * - quote_id (preferred) OR quote OR id  -> the quote UUID used in your public quote link (?id=...)
 * - company_id                           -> alternatively fetch logo by company id
 *
 * Notes:
 * - This handler is intentionally resilient:
 *   - If companies.logo_url is a full URL, we can fetch it.
 *   - If companies.logo_url is only a Storage path, we can download it using the Service Role key.
 *   - If the bucket is PRIVATE, downloading via Supabase Storage still works (service role bypasses RLS).
 * - On any failure, we return an SVG placeholder so the <img> never breaks the layout.
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY /* back-compat typo */ ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SERVICE_ROLE_KEY;

const LOGO_BUCKET_DEFAULT = process.env.COMPANY_LOGO_BUCKET || "company-logos";

function safeStr(v) {
  return String(v ?? "").trim();
}

function setCommonHeaders(res) {
  // Helpful when the page is embedded or when html2canvas fetches with CORS.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function svgPlaceholder(text = "LOGO") {
  const safe = String(text || "LOGO").slice(0, 4).toUpperCase();
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200">
  <rect x="0" y="0" width="300" height="200" rx="24" fill="#f8fafc" stroke="#d9dee8"/>
  <text x="150" y="112" text-anchor="middle"
        font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
        font-size="48" font-weight="800" fill="#1d4ed8">${safe}</text>
</svg>`;
}

function mimeFromPath(p = "") {
  const lower = String(p).toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function stripQuery(u = "") {
  return String(u).split("?")[0];
}

function safeDecode(s = "") {
  try {
    return decodeURIComponent(String(s));
  } catch {
    return String(s);
  }
}

function parseSupabaseStorageUrl(url) {
  // public: .../storage/v1/object/public/<bucket>/<path>
  // signed: .../storage/v1/object/sign/<bucket>/<path>?token=...
  const clean = stripQuery(url);
  const m = clean.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { bucket: m[1], path: safeDecode(m[2]) };
}

async function downloadFromStorage(supabase, bucket, path) {
  if (!bucket || !path) return null;
  const cleanPath = String(path).replace(/^\/+/, "");
  try {
    const { data: blob, error } = await supabase.storage.from(bucket).download(cleanPath);
    if (error || !blob) return null;
    const ab = await blob.arrayBuffer();
    const buf = Buffer.from(ab);
    const ct = blob.type || mimeFromPath(cleanPath);
    return { buf, ct, bucket, path: cleanPath };
  } catch {
    return null;
  }
}

async function fetchRemoteImage(url) {
  const u = safeStr(url);
  if (!u) return null;
  try {
    const r = await fetch(u, { method: "GET" });
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    const buf = Buffer.from(ab);
    const ct = r.headers.get("content-type") || "image/png";
    return { buf, ct };
  } catch {
    return null;
  }
}

function initialsFromName(name = "") {
  const parts = safeStr(name).split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] || "");
  return (a + b).toUpperCase() || "LOGO";
}

module.exports = async (req, res) => {
  try {
    setCommonHeaders(res);

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      return res.end(svgPlaceholder("ENV"));
    }

    // Parse query from URL (works on Vercel serverless & node http servers)
    const base = `https://${req.headers.host || "localhost"}`;
    const u = new URL(req.url, base);

    let quoteId =
      u.searchParams.get("quote_id") ||
      u.searchParams.get("quote") ||
      u.searchParams.get("id") ||
      "";
    let companyId = u.searchParams.get("company_id") || "";

    // If nothing passed, try infer from referer (helps when <img src="/api/company-logo">)
    if (!quoteId && !companyId) {
      const ref = req.headers.referer || req.headers.referrer;
      if (ref) {
        try {
          const ru = new URL(ref);
          quoteId =
            ru.searchParams.get("id") ||
            ru.searchParams.get("quote_id") ||
            ru.searchParams.get("quote") ||
            "";
          companyId = ru.searchParams.get("company_id") || "";
        } catch {
          // ignore
        }
      }
    }

    // Create admin client (service role)
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // Resolve companyId from quote
    if (!companyId) {
      if (!quoteId) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600");
        return res.end(svgPlaceholder("NOID"));
      }

      // Try quotes.id (uuid)
      let q = null;
      try {
        const { data } = await supabase
          .from("quotes")
          .select("company_id")
          .eq("id", quoteId)
          .maybeSingle();
        q = data || null;
      } catch {
        // ignore
      }

      // Optional fallback if you use a separate public_id on quotes
      if (!q) {
        try {
          const { data } = await supabase
            .from("quotes")
            .select("company_id")
            .eq("public_id", quoteId)
            .maybeSingle();
          q = data || null;
        } catch {
          // ignore
        }
      }

      companyId = q?.company_id || "";
      if (!companyId) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600");
        return res.end(svgPlaceholder("404"));
      }
    }

    // Pull company info
    const { data: company } = await supabase
      .from("companies")
      .select("id,name,logo_url")
      .eq("id", companyId)
      .maybeSingle();

    const companyName = safeStr(company?.name) || "Company";
    const initials = initialsFromName(companyName);

    const logoUrl = safeStr(company?.logo_url);

    // ===== Resolve logo bytes (prefer Storage download; it works for public + private buckets) =====
    let hit = null;

    // 1) If logo_url is a Supabase Storage URL, download it via Storage (service role).
    if (!hit && logoUrl && logoUrl.startsWith("http")) {
      const parsed = parseSupabaseStorageUrl(logoUrl);
      if (parsed?.bucket && parsed?.path) {
        hit = await downloadFromStorage(supabase, parsed.bucket, parsed.path);
      }
    }

    // 2) If logo_url is a raw Storage path (common during migrations), download from default bucket.
    if (!hit && logoUrl && !logoUrl.startsWith("http") && !logoUrl.startsWith("data:")) {
      hit = await downloadFromStorage(supabase, LOGO_BUCKET_DEFAULT, logoUrl);
    }

    // 3) Conventional path used by Settings upload
    if (!hit && companyId) {
      const candidates = [
        `${companyId}/logo.png`,
        `${companyId}/logo.jpg`,
        `${companyId}/logo.jpeg`,
        `${companyId}/logo.svg`,
        `${companyId}/logo.webp`,
      ];
      for (const p of candidates) {
        hit = await downloadFromStorage(supabase, LOGO_BUCKET_DEFAULT, p);
        if (hit) break;
      }
    }

    // 4) If still not found, list the company folder (handles custom filenames)
    if (!hit && companyId) {
      try {
        const { data: files } = await supabase.storage
          .from(LOGO_BUCKET_DEFAULT)
          .list(companyId, { limit: 100, sortBy: { column: "name", order: "asc" } });

        const pick = (files || []).find((f) => {
          const n = String(f?.name || "").toLowerCase();
          return n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".svg") || n.endsWith(".webp");
        });

        if (pick?.name) {
          hit = await downloadFromStorage(supabase, LOGO_BUCKET_DEFAULT, `${companyId}/${pick.name}`);
        }
      } catch {
        // ignore
      }
    }

    // 5) External URL (non-storage) fallback: try fetching it directly.
    if (!hit && logoUrl && logoUrl.startsWith("http")) {
      hit = await fetchRemoteImage(logoUrl);
    }

    if (hit?.buf) {
      res.statusCode = 200;
      res.setHeader("Content-Type", hit.ct || "image/png");
      res.setHeader(
        "Cache-Control",
        "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400"
      );
      return res.end(hit.buf);
    }

    // No logo set / couldn't fetch => placeholder with initials
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600");
    return res.end(svgPlaceholder(initials || "LOGO"));
  } catch (err) {
    setCommonHeaders(res);
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.end(svgPlaceholder("ERR"));
  }
};
