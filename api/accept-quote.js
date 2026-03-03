import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

/**
 * POST /api/accept-quote
 * Body: { quote_id: string, signature_data_url: string, accepted_date?: 'YYYY-MM-DD', client_context?: {...} }
 *
 * - Stores acceptance in quote.data.acceptance (includes an audit trail)
 * - Marks quote status as "Accepted"
 * - Sends:
 *    1) Notification email to the *quote creator/company* (not a hard-coded address)
 *    2) Acceptance confirmation email to the customer (if customer_email exists)
 *
 * Email branding:
 * - Uses company logo + brand color from Settings (falls back to snapshot in quote.data.company)
 * - Embeds logo as a Postmark inline attachment (CID) when possible
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { quote_id, signature_data_url } = body;

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

    const POSTMARK_SERVER_TOKEN = process.env.POSTMARK_SERVER_TOKEN;
    const POSTMARK_FROM_EMAIL = process.env.POSTMARK_FROM_EMAIL;
    const POSTMARK_MESSAGE_STREAM = process.env.POSTMARK_MESSAGE_STREAM || "outbound";
    // Fallback only (used only if we can't determine company/user notify address)
    const ADMIN_NOTIFY_EMAIL = safeEmail(process.env.ADMIN_NOTIFY_EMAIL || "");

    // Base URL for links/images in emails
    const proto = (req.headers["x-forwarded-proto"] || "https").toString();
    const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
    const origin = (process.env.PUBLIC_BASE_URL || (host ? `${proto}://${host}` : "")).replace(/\/$/, "");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Load quote (column-safe fallback)
    let quoteRes = await supabase
      .from("quotes")
      .select("id,status,customer_name,customer_email,quote_no,total_cents,company_id,created_by,data")
      .eq("id", quote_id)
      .single();

    if (quoteRes.error) {
      quoteRes = await supabase
        .from("quotes")
        .select("id,status,customer_name,customer_email,quote_no,total_cents,data")
        .eq("id", quote_id)
        .single();
    }

    const quote = quoteRes.data;
    if (quoteRes.error || !quote) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }

    const status = (quote.status || "").toLowerCase();
    if (status === "cancelled") {
      res.status(400).json({ error: "This quote has been cancelled." });
      return;
    }

    const existingAcc = quote.data?.acceptance;
    if (existingAcc?.accepted_at) {
      // Don't spam emails if they refresh / double-tap
      res.status(200).json({
        ok: true,
        accepted_at: existingAcc.accepted_at,
        accepted_date: existingAcc.accepted_date || null,
        already_accepted: true,
      });
      return;
    }

    const accepted_at = new Date().toISOString();

    // Prefer a client-provided local date (prevents UTC rollover issues).
    // Expected format: YYYY-MM-DD
    const bodyAcceptedDate = body?.accepted_date ? String(body.accepted_date) : "";
    const accepted_date = isYmd(bodyAcceptedDate)
      ? bodyAcceptedDate
      : formatYmdInTimeZone(new Date(), process.env.DEFAULT_TIMEZONE || "America/Toronto");

    const data = quote.data || {};
    const billName = data?.bill_to?.client_name;
    const signerName = safeStr(billName || quote.customer_name || "Client").trim();

    // =========================================================
    // Acceptance audit trail (IP, UA, timestamp, document hash)
    // =========================================================
    const client_context = sanitizeClientContext(body?.client_context);
    const auditBase = buildAcceptanceAudit(req);

    // Snapshot the quote "document" at signing time so later edits don't destroy evidence.
    const document_snapshot = buildDocumentSnapshot(data);

    // Deterministic hashes (helps prove integrity later)
    const document_sha256 = sha256Hex(
      stableStringify({
        quote_id: quote.id,
        quote_no: quote.quote_no ?? null,
        total_cents: quote.total_cents ?? null,
        data: document_snapshot,
      })
    );
    const signature_sha256 = sha256Hex(signature_data_url);

    data.acceptance = {
      version: 2,
      accepted_at,
      accepted_date,
      name: signerName,
      email: data?.bill_to?.client_email || quote.customer_email || null,
      signature_image_data_url: signature_data_url,

      // Internal-only evidence (we strip this from the public customer API response)
      audit: {
        ...auditBase,
        client_context: client_context || null,
        signature_sha256,
        document_sha256,
      },

      // Immutable snapshot of what was accepted (no signature, no runtime fields)
      document_snapshot,
    };

    await supabase.from("quotes").update({ status: "Accepted", data }).eq("id", quote_id);

    // ===== Email notifications (best-effort) =====
    const emailResults = {
      admin: { attempted: false, ok: false },
      customer: { attempted: false, ok: false },
    };

    const canEmail = Boolean(POSTMARK_SERVER_TOKEN && POSTMARK_FROM_EMAIL && origin);

    if (canEmail) {
      const meta = data?.meta || {};
      const quoteCode =
        safeStr(data?.quote_code) ||
        `Q-${String(meta?.quote_date || "").slice(0, 4) || "0000"}-${String(quote.quote_no || "").padStart(4, "0")}`;

      const viewUrl = `${origin}/customer/quote.html?id=${encodeURIComponent(quote.id)}`;
      const adminUrl = `${origin}/admin/quote.html?id=${encodeURIComponent(quote.id)}`;

      // Pull live company settings (guarantees latest logo/brand in emails)
      const snapCompany = (data.company && typeof data.company === "object") ? data.company : {};
      const companyId = safeStr(quote.company_id) || safeStr(snapCompany.company_id);
      let companyRow = null;
      if (companyId) {
        const cRes = await supabase.from("companies").select("*").eq("id", companyId).maybeSingle();
        if (!cRes.error) companyRow = cRes.data;
      }

      const companyName =
        safeStr(companyRow?.name) ||
        safeStr(snapCompany?.name) ||
        "Your Company";

      const brand =
        normalizeHexColor(companyRow?.brand_color) ||
        normalizeHexColor(snapCompany?.brand_color) ||
        "#000000";

      const brandDark = darkenHex(brand, 0.22);

      const phone = safeStr(companyRow?.phone) || safeStr(snapCompany?.phone) || "";
      const companyEmail =
        safeEmail(companyRow?.billing_email) ||
        safeEmail(companyRow?.owner_email) ||
        safeEmail(snapCompany?.email) ||
        "";
      const web = safeStr(companyRow?.website) || safeStr(snapCompany?.web) || "";

      // Try to email the quote creator (user who sent/created the quote)
      let createdByEmail = "";
      try {
        const createdBy = safeStr(quote.created_by);
        if (createdBy && supabase.auth?.admin?.getUserById) {
          const uRes = await supabase.auth.admin.getUserById(createdBy);
          createdByEmail = safeEmail(uRes?.data?.user?.email) || "";
        }
      } catch {
        // ignore
      }

      const notifyList = uniqueEmails([createdByEmail, companyEmail]);
      if (!notifyList.length && ADMIN_NOTIFY_EMAIL) notifyList.push(ADMIN_NOTIFY_EMAIL);
      const notifyTo = notifyList.join(", ");

      const replyTo = createdByEmail || companyEmail || undefined;

      // Logo: inline CID attachment if possible
      const logoUrl = safeStr(companyRow?.logo_url) || safeStr(snapCompany?.logo_url) || "";
      const { logoSrc, attachments } = buildInlineLogoAttachment(logoUrl);

      const acceptedDatePretty = formatYmdPretty(accepted_date);

      // 1) Notify the user/company when signed
      if (notifyTo) {
        emailResults.admin.attempted = true;

        const adminSubject = `SIGNED — ${quoteCode} — ${signerName}`;
        const adminHtml = buildAdminSignedHtml({
          brand,
          brandDark,
          logoSrc,
          quoteCode,
          signerName,
          customerEmail: quote.customer_email || "",
          acceptedDatePretty,
          adminUrl,
          viewUrl,
          companyName,
          phone,
          companyEmail,
          web,
        });

        const adminText =
`SIGNED: ${quoteCode}

Customer: ${signerName}
Email: ${quote.customer_email || "—"}
Signed: ${acceptedDatePretty}

Admin: ${adminUrl}
Customer link: ${viewUrl}`;

        const adminSend = sendPostmark({
          token: POSTMARK_SERVER_TOKEN,
          payload: {
            From: formatFrom(companyName, POSTMARK_FROM_EMAIL),
            To: notifyTo,
            ReplyTo: replyTo,
            Subject: adminSubject,
            HtmlBody: adminHtml,
            TextBody: adminText,
            MessageStream: POSTMARK_MESSAGE_STREAM,
            ...(attachments.length ? { Attachments: attachments } : {}),
          },
        });

        const adminRes = await adminSend;
        if (adminRes?.ok) emailResults.admin.ok = true;
      }

      // 2) Email CUSTOMER confirmation
      if (quote.customer_email) {
        emailResults.customer.attempted = true;

        const custSubject = `${companyName} — Acceptance confirmed — ${quoteCode}`;
        const custHtml = buildCustomerAcceptedHtml({
          brand,
          brandDark,
          logoSrc,
          customerName: signerName,
          quoteCode,
          acceptedDatePretty,
          viewUrl,
          companyName,
          phone,
          companyEmail,
          web,
        });

        const custText =
`Hi ${signerName},

Your acceptance has been received for quote ${quoteCode}.
Signed: ${acceptedDatePretty}

View your signed quote:
${viewUrl}

Questions? Reply to this email${phone ? ` or call ${phone}` : ""}

${companyName}`;

        const custSend = sendPostmark({
          token: POSTMARK_SERVER_TOKEN,
          payload: {
            From: formatFrom(companyName, POSTMARK_FROM_EMAIL),
            To: quote.customer_email,
            ReplyTo: replyTo,
            Subject: custSubject,
            HtmlBody: custHtml,
            TextBody: custText,
            MessageStream: POSTMARK_MESSAGE_STREAM,
            ...(attachments.length ? { Attachments: attachments } : {}),
          },
        });

        const custRes = await custSend;
        if (custRes?.ok) emailResults.customer.ok = true;
      }
    }

    res.status(200).json({ ok: true, accepted_at, emails: emailResults });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Server error" });
  }
}

async function sendPostmark({ token, payload }) {
  const r = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "X-Postmark-Server-Token": token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const t = await r.text();
    return { ok: false, error: t };
  }
  return { ok: true };
}

/* =========================================================
   Acceptance audit helpers (server-side)
   ========================================================= */

function getHeader(req, name) {
  try {
    const key = String(name || "").toLowerCase();
    const v = (req?.headers && (req.headers[key] ?? req.headers[name])) ?? null;
    if (Array.isArray(v)) return String(v[0] ?? "");
    return v ? String(v) : "";
  } catch {
    return "";
  }
}

function truncate(s, max = 500) {
  const str = String(s || "");
  if (!max || max <= 0) return str;
  return str.length > max ? str.slice(0, max) : str;
}

function getClientIp(req) {
  const xff = getHeader(req, "x-forwarded-for");
  if (xff) {
    // "client, proxy1, proxy2"
    return xff.split(",")[0].trim();
  }

  const realIp = getHeader(req, "x-real-ip");
  if (realIp) return realIp.trim();

  const cfIp = getHeader(req, "cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  return "";
}

function sanitizeClientContext(ctx) {
  if (!ctx || typeof ctx !== "object") return null;

  const out = {};

  const s = (v, max = 200) => {
    const str = String(v || "").trim();
    if (!str) return null;
    return truncate(str, max);
  };

  const n = (v) => {
    const num = Number(v);
    return Number.isFinite(num) ? num : null;
  };

  const timezone = s(ctx.timezone, 80);
  const locale = s(ctx.locale, 40);
  const platform = s(ctx.platform, 80);
  const page_url = s(ctx.page_url, 600);
  const referrer = s(ctx.referrer, 600);

  const tz_offset_min = n(ctx.tz_offset_min);

  if (timezone) out.timezone = timezone;
  if (Number.isFinite(tz_offset_min)) out.tz_offset_min = tz_offset_min;
  if (locale) out.locale = locale;
  if (platform) out.platform = platform;
  if (page_url) out.page_url = page_url;
  if (referrer) out.referrer = referrer;

  if (ctx.screen && typeof ctx.screen === "object") {
    const sw = n(ctx.screen.w);
    const sh = n(ctx.screen.h);
    const dpr = n(ctx.screen.dpr);

    const screen = {};
    if (Number.isFinite(sw) && sw > 0 && sw < 30000) screen.w = sw;
    if (Number.isFinite(sh) && sh > 0 && sh < 30000) screen.h = sh;
    if (Number.isFinite(dpr) && dpr > 0 && dpr < 20) screen.dpr = dpr;

    if (Object.keys(screen).length) out.screen = screen;
  }

  return Object.keys(out).length ? out : null;
}

function deepCloneJson(obj) {
  try {
    return obj ? JSON.parse(JSON.stringify(obj)) : {};
  } catch {
    return {};
  }
}

/**
 * Store a snapshot of the quote contents at the moment of signing.
 * This protects you if the quote is edited later.
 *
 * We intentionally remove:
 * - acceptance (signature + audit)
 * - runtime fields used for rendering
 * - embedded logo binaries (not important for contract terms)
 */
function buildDocumentSnapshot(data) {
  const snap = deepCloneJson(data || {});

  // Remove acceptance (we store it separately)
  try {
    delete snap.acceptance;
  } catch {}

  // Remove render/runtime-only fields (non-contract evidence)
  try {
    delete snap._supabase_url;
  } catch {}
  try {
    delete snap.supabase_url;
  } catch {}
  try {
    delete snap.logo_bucket;
  } catch {}
  try {
    delete snap.logoBucket;
  } catch {}

  // Remove embedded logo payloads to keep snapshot lean
  if (snap.company && typeof snap.company === "object") {
    const lu = String(snap.company.logo_url || "");
    if (lu.startsWith("data:image/")) snap.company.logo_url = "[embedded image omitted]";
    const ldu = String(snap.company.logo_data_url || "");
    if (ldu.startsWith("data:image/")) snap.company.logo_data_url = "[embedded image omitted]";
  }

  return snap;
}

function buildAcceptanceAudit(req) {
  const ip = getClientIp(req);

  const audit = {
    ip: ip || null,
    x_forwarded_for: truncate(getHeader(req, "x-forwarded-for"), 400) || null,
    user_agent: truncate(getHeader(req, "user-agent"), 400) || null,
    accept_language: truncate(getHeader(req, "accept-language"), 200) || null,
    referrer: truncate(getHeader(req, "referer") || getHeader(req, "referrer"), 600) || null,

    // Helpful when investigating edge cases / fraud
    vercel_id: truncate(getHeader(req, "x-vercel-id"), 120) || null,
    sec_ch_ua: truncate(getHeader(req, "sec-ch-ua"), 300) || null,
    sec_ch_ua_platform: truncate(getHeader(req, "sec-ch-ua-platform"), 80) || null,
    sec_ch_ua_mobile: truncate(getHeader(req, "sec-ch-ua-mobile"), 40) || null,
  };

  const geo = {};
  const country = truncate(getHeader(req, "x-vercel-ip-country"), 8);
  const region = truncate(getHeader(req, "x-vercel-ip-country-region"), 80);
  const city = truncate(getHeader(req, "x-vercel-ip-city"), 120);

  if (country) geo.country = country;
  if (region) geo.region = region;
  if (city) geo.city = city;

  const lat = Number(getHeader(req, "x-vercel-ip-latitude"));
  const lon = Number(getHeader(req, "x-vercel-ip-longitude"));
  if (Number.isFinite(lat)) geo.latitude = lat;
  if (Number.isFinite(lon)) geo.longitude = lon;

  if (Object.keys(geo).length) audit.geo = geo;

  return audit;
}

/**
 * Stable stringify (sorted keys) so hashes are deterministic.
 */
function stableStringify(value) {
  if (value === null || value === undefined) return "null";

  const t = typeof value;
  if (t === "number" || t === "boolean") return String(value);
  if (t === "string") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  }

  if (t === "object") {
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k]));
    return "{" + parts.join(",") + "}";
  }

  // functions / symbols shouldn't exist in our input; fall back to JSON encoding
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sha256Hex(input) {
  try {
    return crypto.createHash("sha256").update(String(input || ""), "utf8").digest("hex");
  } catch {
    return "";
  }
}

/* =========================================================
   Shared helpers
   ========================================================= */

function safeStr(v) {
  return String(v ?? "").trim();
}

function safeEmail(v) {
  const s = safeStr(v).toLowerCase();
  if (!s || !s.includes("@") || s.includes(" ")) return "";
  return s;
}

function uniqueEmails(list) {
  const out = [];
  const seen = new Set();
  for (const v of list || []) {
    const e = safeEmail(v);
    if (!e) continue;
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function formatYmdInTimeZone(dateObj, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(dateObj);

    const map = {};
    for (const p of parts) map[p.type] = p.value;
    const y = map.year || "0000";
    const m = map.month || "01";
    const d = map.day || "01";
    return `${y}-${m}-${d}`;
  } catch {
    return new Date(dateObj).toISOString().slice(0, 10);
  }
}

function formatYmdPretty(ymd) {
  if (!ymd) return "—";
  try {
    return new Date(`${ymd}T00:00:00`).toLocaleDateString("en-CA", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return ymd;
  }
}

function normalizeHexColor(input) {
  let v = safeStr(input);
  if (!v) return "";
  if (!v.startsWith("#")) v = `#${v}`;

  // Expand #RGB -> #RRGGBB
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const h = v.slice(1);
    v = "#" + h.split("").map((c) => c + c).join("");
  }

  if (!/^#[0-9a-fA-F]{6}$/.test(v)) return "";
  return v.toUpperCase();
}

function hexToRgb(hex) {
  const h = normalizeHexColor(hex);
  if (!h) return null;
  const n = parseInt(h.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  const clamp = (x) => Math.max(0, Math.min(255, Math.round(Number(x) || 0)));
  const rr = clamp(r).toString(16).padStart(2, "0");
  const gg = clamp(g).toString(16).padStart(2, "0");
  const bb = clamp(b).toString(16).padStart(2, "0");
  return `#${rr}${gg}${bb}`.toUpperCase();
}

function darkenHex(hex, amount = 0.2) {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#000000";
  const factor = 1 - Math.max(0, Math.min(0.9, Number(amount) || 0));
  return rgbToHex({ r: rgb.r * factor, g: rgb.g * factor, b: rgb.b * factor });
}

function extractEmail(fromField) {
  const s = safeStr(fromField);
  if (!s) return "";
  const m = /<([^>]+)>/.exec(s);
  if (m) return safeStr(m[1]);
  if (s.includes("@")) return s;
  return "";
}

function formatFrom(companyName, postmarkFrom) {
  const email = extractEmail(postmarkFrom);
  if (!email) return postmarkFrom;

  const name = safeStr(companyName).replaceAll('"', "'");
  if (!name) return email;

  // Quote the name so punctuation is safe
  return `"${name}" <${email}>`;
}

function parseDataUrl(dataUrl) {
  const s = safeStr(dataUrl);
  if (!s.startsWith("data:")) return null;
  const m = /^data:([^;]+);base64,(.+)$/i.exec(s);
  if (!m) return null;
  const contentType = safeStr(m[1]) || "application/octet-stream";
  const base64 = String(m[2] || "").trim();
  if (!base64) return null;
  return { contentType, base64 };
}

function buildInlineLogoAttachment(logoUrl) {
  const parsed = parseDataUrl(logoUrl);
  if (parsed && parsed.base64.length < 8_000_000) {
    const cid = "cid:company-logo";
    return {
      logoSrc: cid,
      attachments: [
        {
          Name: "company-logo",
          Content: parsed.base64,
          ContentType: parsed.contentType || "image/png",
          ContentID: cid,
        },
      ],
    };
  }

  if (/^https?:\/\//i.test(safeStr(logoUrl))) {
    return { logoSrc: safeStr(logoUrl), attachments: [] };
  }

  return { logoSrc: "", attachments: [] };
}

/* =========================================================
   Branded templates
   ========================================================= */

function baseStyles() {
  return `
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    @media only screen and (max-width: 600px) {
      .container { width: 100% !important; }
      .px { padding-left: 18px !important; padding-right: 18px !important; }
      .cta { width: 100% !important; }
      .cta a { display:block !important; }
      .h1 { font-size: 22px !important; }
      .sub { font-size: 14px !important; }
    }
    @media (prefers-color-scheme: dark) {
      body, .bg { background:#0b1020 !important; }
      .card { background:#0f172a !important; border-color: rgba(255,255,255,0.14) !important; }
      .txt { color:#e8eefc !important; }
      .muted { color: rgba(232,238,252,0.72) !important; }
      .detail { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.14) !important; }
      .divider { border-color: rgba(255,255,255,0.14) !important; }
      /* Keep logo container WHITE so any logo works */
      .logo-wrap, .logo-shell { background:#ffffff !important; }
    }
    [data-ogsc] body, [data-ogsc] .bg { background:#0b1020 !important; }
    [data-ogsc] .card { background:#0f172a !important; border-color: rgba(255,255,255,0.14) !important; }
    [data-ogsc] .txt { color:#e8eefc !important; }
    [data-ogsc] .muted { color: rgba(232,238,252,0.72) !important; }
    [data-ogsc] .detail { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.14) !important; }
    [data-ogsc] .divider { border-color: rgba(255,255,255,0.14) !important; }
    [data-ogsc] .logo-wrap, [data-ogsc] .logo-shell { background:#ffffff !important; }
  `;
}

function logoBlockHtml({ logoSrc, companyName }) {
  const safeCompany = escapeHtml(companyName);
  if (logoSrc) {
    return `<img src="${escapeHtml(logoSrc)}" width="200" alt="${safeCompany}"
      style="display:block;width:200px;max-width:200px;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;" />`;
  }
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-weight:950;font-size:18px;color:#0b0f14;">${safeCompany}</div>`;
}

function buildCustomerAcceptedHtml({
  brand,
  brandDark,
  logoSrc,
  customerName,
  quoteCode,
  acceptedDatePretty,
  viewUrl,
  companyName,
  phone,
  companyEmail,
  web,
}) {
  const safeName = escapeHtml(customerName);
  const safeCode = escapeHtml(quoteCode);
  const safeDate = escapeHtml(acceptedDatePretty);
  const safeCompany = escapeHtml(companyName);
  const safePhone = escapeHtml(phone || "");
  const safeEmail = escapeHtml(companyEmail || "");
  const safeWeb = escapeHtml(web || "");
  const safeViewUrl = escapeHtml(viewUrl);

  const success = "#16a34a";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>Acceptance confirmed — ${safeCode}</title>
  <style>${baseStyles()}</style>
</head>
<body class="bg" bgcolor="#f5f7fb" style="margin:0;padding:0;background:#f5f7fb;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Acceptance confirmed for ${safeCode}.</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" bgcolor="#f5f7fb"
    style="width:100%;background:#f5f7fb;padding:26px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" class="container" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px;">
          <tr>
            <td class="card" bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e6e9f1;border-radius:22px;overflow:hidden;">

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td height="6" style="height:6px;background:linear-gradient(90deg,${brand},${brandDark});line-height:6px;font-size:0;">&nbsp;</td>
                </tr>
              </table>

              <!-- Logo -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="logo-wrap" align="center" bgcolor="#ffffff" style="background:#ffffff;padding:18px 22px 10px;text-align:center;">
                    <table role="presentation" align="center" cellpadding="0" cellspacing="0" class="logo-shell" bgcolor="#ffffff"
                      style="margin:0 auto;background:#ffffff;border:1px solid #e6e9f1;border-radius:18px;overflow:hidden;">
                      <tr>
                        <td align="center" style="padding:12px 14px;">
                          ${logoBlockHtml({ logoSrc, companyName })}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Copy -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="px" align="center" style="padding:8px 26px 6px;text-align:center;">
                    <div class="txt h1" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:26px;font-weight:950;line-height:1.2;color:#0b0f14;">
                      Acceptance confirmed
                    </div>
                    <div class="muted sub" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin-top:10px;font-size:14px;line-height:1.65;color:#4b5563;max-width:520px;">
                      Thanks ${safeName}. We received your signature for quote <b style="color:#0b0f14;">${safeCode}</b>.
                    </div>
                  </td>
                </tr>

                <!-- Badge -->
                <tr>
                  <td align="center" style="padding:10px 26px 0;">
                    <div style="display:inline-block;padding:10px 14px;border-radius:999px;background:${success};color:#ffffff;
                                font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-weight:950;letter-spacing:.12em;text-transform:uppercase;font-size:11px;">
                      Signed • ${safeDate}
                    </div>
                  </td>
                </tr>

                <!-- CTA -->
                <tr>
                  <td align="center" style="padding:16px 26px 8px;">
                    <!--[if mso]>
                      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                        href="${safeViewUrl}" style="height:54px;v-text-anchor:middle;width:420px;" arcsize="16%"
                        strokecolor="${brand}" fillcolor="${brand}">
                        <w:anchorlock/>
                        <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">
                          View signed quote
                        </center>
                      </v:roundrect>
                    <![endif]-->

                    <!--[if !mso]><!-- -->
                    <table role="presentation" cellpadding="0" cellspacing="0" class="cta" style="margin:0 auto;width:420px;max-width:100%;">
                      <tr>
                        <td align="center" bgcolor="${brand}" style="border-radius:16px;background-color:${brand};background:${brand};background-image:linear-gradient(90deg,${brand},${brandDark});">
                          <a href="${safeViewUrl}"
                            style="display:block;padding:18px 18px;border-radius:16px;text-align:center;
                                   font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                   font-weight:950;font-size:16px;letter-spacing:.2px;text-decoration:none;
                                   color:#ffffff;-webkit-text-fill-color:#ffffff;">
                            View signed quote
                          </a>
                        </td>
                      </tr>
                    </table>
                    <!--<![endif]-->
                  </td>
                </tr>

                <tr><td class="divider" style="border-top:1px solid #e6e9f1;"></td></tr>

                <tr>
                  <td align="center" style="padding:14px 24px 18px;text-align:center;">
                    <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;line-height:1.55;color:#6b7280;">
                      ${safePhone ? `Questions? Reply to this email or call <span class="txt" style="color:#0b0f14;font-weight:950;">${safePhone}</span><br />` : ""}
                      <span style="color:#9ca3af;">${safeCompany}${safeEmail ? ` • ${safeEmail}` : ""}${safeWeb ? ` • ${safeWeb}` : ""}</span>
                    </div>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:14px 6px 0;">
              <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:11px;line-height:1.5;color:#9ca3af;text-align:center;">
                © ${new Date().getFullYear()} ${safeCompany}
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildAdminSignedHtml({
  brand,
  brandDark,
  logoSrc,
  quoteCode,
  signerName,
  customerEmail,
  acceptedDatePretty,
  adminUrl,
  viewUrl,
  companyName,
  phone,
  companyEmail,
  web,
}) {
  const safeCompany = escapeHtml(companyName);
  const safeCode = escapeHtml(quoteCode);
  const safeName = escapeHtml(signerName);
  const safeEmail = escapeHtml(customerEmail || "—");
  const safeDate = escapeHtml(acceptedDatePretty);
  const safeAdminUrl = escapeHtml(adminUrl);
  const safeViewUrl = escapeHtml(viewUrl);
  const safePhone = escapeHtml(phone || "");
  const safeCompanyEmail = escapeHtml(companyEmail || "");
  const safeWeb = escapeHtml(web || "");

  const success = "#16a34a";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>SIGNED — ${safeCode}</title>
  <style>${baseStyles()}</style>
</head>
<body class="bg" bgcolor="#f5f7fb" style="margin:0;padding:0;background:#f5f7fb;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safeCode} was signed.</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" bgcolor="#f5f7fb"
    style="width:100%;background:#f5f7fb;padding:22px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" class="container" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px;">
          <tr>
            <td class="card" bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e6e9f1;border-radius:22px;overflow:hidden;">

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td height="6" style="height:6px;background:linear-gradient(90deg,${brand},${brandDark});line-height:6px;font-size:0;">&nbsp;</td>
                </tr>
              </table>

              <!-- Logo -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="logo-wrap" align="center" bgcolor="#ffffff" style="background:#ffffff;padding:16px 22px 10px;text-align:center;">
                    <table role="presentation" align="center" cellpadding="0" cellspacing="0" class="logo-shell" bgcolor="#ffffff"
                      style="margin:0 auto;background:#ffffff;border:1px solid #e6e9f1;border-radius:18px;overflow:hidden;">
                      <tr>
                        <td align="center" style="padding:10px 12px;">
                          ${logoBlockHtml({ logoSrc, companyName })}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Copy -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="px" align="center" style="padding:8px 26px 6px;text-align:center;">
                    <div class="txt h1" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:24px;font-weight:950;line-height:1.2;color:#0b0f14;">
                      Quote signed 🎉
                    </div>
                    <div class="muted sub" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin-top:8px;font-size:14px;line-height:1.65;color:#4b5563;max-width:520px;">
                      <b style="color:#0b0f14;">${safeCode}</b> was accepted by <b style="color:#0b0f14;">${safeName}</b>.
                    </div>
                  </td>
                </tr>

                <tr>
                  <td align="center" style="padding:10px 26px 0;">
                    <div style="display:inline-block;padding:10px 14px;border-radius:999px;background:${success};color:#ffffff;
                                font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-weight:950;letter-spacing:.12em;text-transform:uppercase;font-size:11px;">
                      Signed • ${safeDate}
                    </div>
                  </td>
                </tr>

                <tr>
                  <td class="px" align="center" style="padding:16px 26px 8px;text-align:center;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="detail" bgcolor="#f8fafc"
                      style="background:#f8fafc;border:1px solid #e6e9f1;border-radius:18px;overflow:hidden;max-width:520px;">
                      <tr>
                        <td style="padding:14px 16px;text-align:center;">
                          <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;">
                            Customer email
                          </div>
                          <div class="txt" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;font-weight:950;color:#0b0f14;margin-top:6px;word-break:break-word;">
                            ${safeEmail}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- CTA row (Admin) -->
                <tr>
                  <td align="center" style="padding:12px 26px 8px;">
                    <!--[if mso]>
                      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                        href="${safeAdminUrl}" style="height:54px;v-text-anchor:middle;width:420px;" arcsize="16%"
                        strokecolor="${brand}" fillcolor="${brand}">
                        <w:anchorlock/>
                        <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">
                          Open in Admin
                        </center>
                      </v:roundrect>
                    <![endif]-->

                    <!--[if !mso]><!-- -->
                    <table role="presentation" cellpadding="0" cellspacing="0" class="cta" style="margin:0 auto;width:420px;max-width:100%;">
                      <tr>
                        <td align="center" bgcolor="${brand}" style="border-radius:16px;background-color:${brand};background:${brand};background-image:linear-gradient(90deg,${brand},${brandDark});">
                          <a href="${safeAdminUrl}"
                            style="display:block;padding:18px 18px;border-radius:16px;text-align:center;
                                   font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                   font-weight:950;font-size:16px;letter-spacing:.2px;text-decoration:none;
                                   color:#ffffff;-webkit-text-fill-color:#ffffff;">
                            Open in Admin
                          </a>
                        </td>
                      </tr>
                    </table>
                    <!--<![endif]-->
                  </td>
                </tr>

                <tr>
                  <td align="center" style="padding:0 26px 14px;text-align:center;">
                    <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b7280;">
                      Customer link: <span style="color:${brand};word-break:break-all;">${safeViewUrl}</span>
                    </div>
                  </td>
                </tr>

                <tr><td class="divider" style="border-top:1px solid #e6e9f1;"></td></tr>

                <tr>
                  <td align="center" style="padding:14px 24px 18px;text-align:center;">
                    <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;line-height:1.55;color:#6b7280;">
                      ${safePhone ? `Questions? Reply to this email or call <span class="txt" style="color:#0b0f14;font-weight:950;">${safePhone}</span><br />` : ""}
                      <span style="color:#9ca3af;">${safeCompany}${safeCompanyEmail ? ` • ${safeCompanyEmail}` : ""}${safeWeb ? ` • ${safeWeb}` : ""}</span>
                    </div>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:14px 6px 0;">
              <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:11px;line-height:1.5;color:#9ca3af;text-align:center;">
                © ${new Date().getFullYear()} ${safeCompany}
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
