import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/company-logo
 *
 * Returns the company logo image for a given company or quote.
 *
 * Why this exists:
 * - Customer quote pages are PUBLIC (no Supabase auth session).
 * - Company logos often live in Supabase Storage (sometimes PRIVATE).
 * - Returning the logo via same-origin avoids CORS/canvas issues (PDF export).
 *
 * Query params:
 * - company_id (best)           -> fetch logo by company id (no quote lookup)
 * - quote_id / id / quote       -> fallback: resolve company id from quote
 * - bucket / logo_bucket        -> optional override for the storage bucket name
 * - debug=1                     -> returns JSON debug instead of an image
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

// If you ever rename the bucket, you can set COMPANY_LOGO_BUCKET in Vercel.
const DEFAULT_BUCKET =
  process.env.COMPANY_LOGO_BUCKET ||
  process.env.LOGO_BUCKET ||
  "company-logos";

function svgPlaceholder(text = "LOGO") {
  const safe = String(text || "LOGO")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 4)
    .toUpperCase();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200">
  <rect x="0" y="0" width="300" height="200" rx="24" fill="#f8fafc" stroke="#d9dee8"/>
  <text x="150" y="112" text-anchor="middle"
        font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
        font-size="48" font-weight="800" fill="#1d4ed8">${safe || "LOGO"}</text>
</svg>`;
}

function initialsFromName(name = "") {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  return initials || "LOGO";
}

function safeDecode(s = "") {
  try {
    return decodeURIComponent(String(s));
  } catch {
    return String(s);
  }
}

function stripQuery(u = "") {
  return String(u).split("?")[0];
}

function mimeFromPath(p = "") {
  const lower = String(p).toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function parseSupabaseStorageUrl(url) {
  // public: .../storage/v1/object/public/<bucket>/<path>
  // signed: .../storage/v1/object/sign/<bucket>/<path>?token=...
  const clean = stripQuery(url);
  const m = clean.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { bucket: m[1], path: safeDecode(m[2]) };
}

function sendSvg(res, text, cacheControl = "public, max-age=600, s-maxage=600") {
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.end(svgPlaceholder(text));
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function blobToBuffer(blob) {
  const ab = await blob.arrayBuffer();
  return Buffer.from(ab);
}

async function tryDownloadFromStorage(supabase, bucket, path) {
  if (!bucket || !path) return null;
  const cleanPath = String(path).replace(/^\/+/, "");

  try {
    const { data: blob, error } = await supabase.storage.from(bucket).download(cleanPath);
    if (error || !blob) return null;

    const buf = await blobToBuffer(blob);
    const ct = blob.type || mimeFromPath(cleanPath);

    return { buf, contentType: ct, bucket, path: cleanPath };
  } catch {
    return null;
  }
}

async function tryFetchHttpImage(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    const ct = r.headers.get("content-type") || "image/png";
    return { buf: Buffer.from(ab), contentType: ct };
  } catch {
    return null;
  }
}

async function resolveLogoBuffer({ supabase, company, bucket }) {
  const logoUrl = String(company?.logo_url || "").trim();
  const companyId = String(company?.id || "").trim();

  // 1) If logo_url is a data URL, decode it directly.
  if (logoUrl.startsWith("data:")) {
    const m = logoUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/i);
    if (m) {
      const ct = m[1] || "image/png";
      const isB64 = !!m[2];
      const payload = m[3] || "";
      try {
        const buf = isB64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf-8");
        return { buf, contentType: ct };
      } catch {
        // continue
      }
    }
  }

  const candidates = [];

  // 2) If logo_url is a Supabase Storage URL, parse bucket/path.
  if (logoUrl.startsWith("http")) {
    const parsed = parseSupabaseStorageUrl(logoUrl);
    if (parsed?.bucket && parsed?.path) candidates.push(parsed);
  }

  // 3) If logo_url looks like a raw storage path (no http/data), try default bucket.
  if (
    logoUrl &&
    !logoUrl.startsWith("http") &&
    !logoUrl.startsWith("data:") &&
    !logoUrl.startsWith("blob:") &&
    !logoUrl.startsWith("/")
  ) {
    candidates.push({ bucket, path: safeDecode(logoUrl) });
  }

  // 4) Conventional paths used by common upload patterns.
  if (companyId) {
    candidates.push({ bucket, path: `${companyId}/logo.png` });
    candidates.push({ bucket, path: `${companyId}/logo.jpg` });
    candidates.push({ bucket, path: `${companyId}/logo.jpeg` });
    candidates.push({ bucket, path: `${companyId}/logo.svg` });
    candidates.push({ bucket, path: `${companyId}/logo.webp` });
  }

  // Try candidate downloads.
  for (const c of candidates) {
    const hit = await tryDownloadFromStorage(supabase, c.bucket, c.path);
    if (hit?.buf) return { buf: hit.buf, contentType: hit.contentType };
  }

  // 5) If still not found: list the company folder and pick the first image.
  if (companyId) {
    try {
      const { data: files, error } = await supabase.storage.from(bucket).list(companyId, {
        limit: 100,
        sortBy: { column: "name", order: "asc" },
      });

      if (!error && Array.isArray(files)) {
        const pick = files.find((f) => {
          const n = String(f?.name || "").toLowerCase();
          return n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".svg") || n.endsWith(".webp");
        });

        if (pick?.name) {
          const p = `${companyId}/${pick.name}`;
          const hit = await tryDownloadFromStorage(supabase, bucket, p);
          if (hit?.buf) return { buf: hit.buf, contentType: hit.contentType };
        }
      }
    } catch {
      // ignore
    }
  }

  // 6) External HTTP logo (non-storage)
  if (logoUrl.startsWith("http")) {
    const fetched = await tryFetchHttpImage(logoUrl);
    if (fetched?.buf) return fetched;
  }

  return null;
}

async function findQuoteRow(supabase, token) {
  const t = String(token || "").trim();
  if (!t) return null;

  // We try a few common columns. Missing columns or type mismatches are ignored.
  const colsToTry = ["id", "public_id", "public_token", "publicId", "publicToken"];

  for (const col of colsToTry) {
    try {
      const { data, error } = await supabase
        .from("quotes")
        .select("id,company_id,data")
        .eq(col, t)
        .maybeSingle();

      if (data && !error) return data;
    } catch {
      // ignore
    }
  }

  return null;
}

export default async function handler(req, res) {
  // Only GET/HEAD (images)
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    return res.end("Method not allowed");
  }

  const base = `https://${req.headers.host || "localhost"}`;
  const u = new URL(req.url || "/api/company-logo", base);

  const debug = u.searchParams.get("debug") === "1";

  // Grab params
  let quoteId =
    u.searchParams.get("quote_id") ||
    u.searchParams.get("quote") ||
    u.searchParams.get("id") ||
    "";

  let companyId = u.searchParams.get("company_id") || "";

  const bucketOverride =
    u.searchParams.get("bucket") ||
    u.searchParams.get("logo_bucket") ||
    "";

  // Referer inference (helps when <img src="/api/company-logo">)
  if (!quoteId && !companyId) {
    const ref = req.headers.referer || req.headers.referrer;
    if (ref) {
      try {
        const ru = new URL(String(ref));
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

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    if (debug) {
      return sendJson(res, 500, {
        ok: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      });
    }
    return sendSvg(res, "ERR", "no-store");
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  let quoteRow = null;
  const debugTrace = {
    quote_id: quoteId || null,
    company_id_param: companyId || null,
    bucket: bucketOverride || DEFAULT_BUCKET,
    steps: [],
  };

  try {
    // Resolve company id if not provided
    if (!companyId && quoteId) {
      debugTrace.steps.push("lookup_quote");
      quoteRow = await findQuoteRow(supabase, quoteId);
      const qCompanyId =
        quoteRow?.company_id ||
        quoteRow?.data?.company_id ||
        quoteRow?.data?.company?.id ||
        "";
      if (qCompanyId) companyId = qCompanyId;
    }

    if (!companyId) {
      if (debug) {
        return sendJson(res, 200, {
          ok: false,
          error: "Could not resolve company_id (pass ?company_id=...)",
          trace: debugTrace,
        });
      }
      return sendSvg(res, "LOGO", "no-store");
    }

    // Fetch company
    debugTrace.steps.push("lookup_company");
    const { data: company, error: cErr } = await supabase
      .from("companies")
      .select("id,name,logo_url")
      .eq("id", companyId)
      .maybeSingle();

    if (cErr || !company) {
      if (debug) {
        return sendJson(res, 200, {
          ok: false,
          error: "Company not found",
          company_id: companyId,
          supabase_error: cErr?.message || null,
          trace: debugTrace,
        });
      }
      return sendSvg(res, "LOGO", "no-store");
    }

    const bucket = bucketOverride || quoteRow?.data?.logo_bucket || DEFAULT_BUCKET;
    debugTrace.bucket = bucket;

    // Resolve logo bytes
    debugTrace.steps.push("resolve_logo");
    const hit = await resolveLogoBuffer({ supabase, company, bucket });

    if (!hit?.buf) {
      const initials = initialsFromName(company.name || "Company");
      if (debug) {
        return sendJson(res, 200, {
          ok: false,
          error: "Logo not found (returning placeholder)",
          company: { id: company.id, name: company.name, logo_url: company.logo_url || null },
          trace: debugTrace,
        });
      }
      return sendSvg(res, initials, "public, max-age=300, s-maxage=300");
    }

    // Success
    res.statusCode = 200;
    res.setHeader("Content-Type", hit.contentType || "image/png");
    res.setHeader(
      "Cache-Control",
      "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400"
    );

    // If HEAD, no body
    if (req.method === "HEAD") return res.end();

    return res.end(hit.buf);
  } catch (e) {
    if (debug) {
      return sendJson(res, 200, {
        ok: false,
        error: e?.message || "Unhandled error",
        trace: debugTrace,
      });
    }
    return sendSvg(res, "ERR", "no-store");
  }
}
