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
 * - quote_id (preferred) OR id  -> the quote UUID used in your public quote link (?id=...)
 * - company_id                 -> alternatively fetch logo by company id
 *
 * Bonus:
 * - If neither param is present, we attempt to infer quote id from the Referer header.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
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

async function supaSelectOne(table, columns, whereObj) {
  // Uses Supabase REST API directly (no deps).
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set("select", columns);
  url.searchParams.set("limit", "1");
  for (const [k, v] of Object.entries(whereObj || {})) {
    url.searchParams.set(k, `eq.${v}`);
  }

  const r = await fetch(url.toString(), {
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      Accept: "application/json",
    },
  });

  const text = await r.text();
  if (!r.ok) {
    // helpful debugging without leaking secrets
    throw new Error(`Supabase ${table} query failed (${r.status}): ${text}`);
  }
  const arr = text ? JSON.parse(text) : [];
  return arr?.[0] || null;
}

module.exports = async (req, res) => {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json(res, 500, {
        error:
          "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables.",
      });
    }

    // Parse query
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

    // Need either companyId or quoteId
    if (!companyId) {
      if (!quoteId) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
        return res.end(svgPlaceholder("NOID"));
      }

      let q = null;
      try {
        q = await supaSelectOne("quotes", "company_id", { id: quoteId });
      } catch (e) {
        // ignore (might not be primary key in your public links)
      }
      if (!q) {
        try {
          // Optional fallback if you use a separate public_id on quotes
          q = await supaSelectOne("quotes", "company_id", { public_id: quoteId });
        } catch (e) {
          // ignore
        }
      }
      companyId = q?.company_id || "";

      if (!companyId) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
        return res.end(svgPlaceholder("404"));
      }
    }

    const c = await supaSelectOne("companies", "logo_url,name", { id: companyId });
    const logoUrl = c?.logo_url || "";

    if (!logoUrl) {
      // No logo set yet => return placeholder
      const initials = String(c?.name || "LOGO")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((s) => s[0])
        .join("")
        .toUpperCase();
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600");
      return res.end(svgPlaceholder(initials || "LOGO"));
    }

    // Fetch the actual image and stream it back (same-origin => no CORS headaches)
    const imgRes = await fetch(logoUrl);
    if (!imgRes.ok) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=120, s-maxage=120");
      return res.end(svgPlaceholder("LOGO"));
    }

    const buf = Buffer.from(await imgRes.arrayBuffer());
    const ct = imgRes.headers.get("content-type") || "image/png";

    res.statusCode = 200;
    res.setHeader("Content-Type", ct);
    res.setHeader(
      "Cache-Control",
      "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400"
    );
    return res.end(buf);
  } catch (err) {
    // Return an SVG so the <img> doesn't "break" the layout.
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.end(svgPlaceholder("ERR"));
  }
};
