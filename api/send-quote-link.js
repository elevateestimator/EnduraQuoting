import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/send-quote-link
 * Body: { quote_id: string }
 *
 * Multi-tenant branded email:
 * - Uses the quote's company snapshot (and falls back to live company settings)
 * - Uses company brand color for CTA + accents
 * - Embeds the company logo as an INLINE Postmark attachment (CID) when possible
 *   so it works even when email clients block external images.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const quote_id = body?.quote_id;
    if (!quote_id) {
      res.status(400).json({ error: "Missing quote_id" });
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
    // Fallback only (used only if we cannot determine any company/user notify address)
    const ADMIN_NOTIFY_EMAIL = safeEmail(process.env.ADMIN_NOTIFY_EMAIL || "");

    if (!POSTMARK_SERVER_TOKEN || !POSTMARK_FROM_EMAIL) {
      res.status(500).json({ error: "Missing POSTMARK_SERVER_TOKEN or POSTMARK_FROM_EMAIL" });
      return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Load quote (use a column-safe fallback in case your schema is older)
    let quoteRes = await supabase
      .from("quotes")
      .select("id,status,customer_name,customer_email,quote_no,company_id,created_by,data")
      .eq("id", quote_id)
      .single();

    if (quoteRes.error) {
      quoteRes = await supabase
        .from("quotes")
        .select("id,status,customer_name,customer_email,quote_no,data")
        .eq("id", quote_id)
        .single();
    }

    const quote = quoteRes.data;
    if (quoteRes.error || !quote) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }

    const toEmail = String(quote.customer_email || "").trim();
    if (!toEmail) {
      res.status(400).json({ error: "Quote has no customer email" });
      return;
    }

    // Base URL for links in email
    const proto = (req.headers["x-forwarded-proto"] || "https").toString();
    const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
    const origin = (process.env.PUBLIC_BASE_URL || (host ? `${proto}://${host}` : "")).replace(/\/$/, "");
    if (!origin) {
      res.status(500).json({ error: "Unable to determine PUBLIC_BASE_URL" });
      return;
    }

    const viewUrl = `${origin}/customer/quote.html?id=${encodeURIComponent(quote.id)}`;

    const data = (quote.data && typeof quote.data === "object") ? quote.data : {};
    const meta = (data.meta && typeof data.meta === "object") ? data.meta : {};
    const snapCompany = (data.company && typeof data.company === "object") ? data.company : {};

    // Quote code (what you display inside the app)
    const quoteCode =
      safeStr(data.quote_code) ||
      `Q-${String(meta.quote_date || "").slice(0, 4) || "0000"}-${String(quote.quote_no || "").padStart(4, "0")}`;

    const customerName = safeStr(quote.customer_name) || "there";

    // Pull live company settings if possible (guarantees latest logo/brand in emails)
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

    const expires = safeStr(meta.quote_expires) || "";
    const preparedBy = safeStr(meta.prepared_by) || "";

    // Determine who should receive an internal copy when a quote is sent
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

    const bcc = notifyList
      .filter((e) => e && e.toLowerCase() !== toEmail.toLowerCase())
      .join(", ");

    // Logo: inline CID attachment if possible
    const logoUrl = safeStr(companyRow?.logo_url) || safeStr(snapCompany?.logo_url) || "";
    const { logoSrc, attachments } = buildInlineLogoAttachment(logoUrl);

    const subject = `${companyName} — Quote ready — ${quoteCode}`;

    const htmlBody = buildQuoteReadyHtml({
      brand,
      brandDark,
      logoSrc,
      viewUrl,
      customerName,
      quoteCode,
      expires,
      preparedBy,
      companyName,
      phone,
      email: companyEmail,
      web,
    });

    const textBody =
`Hi ${customerName},

Your quote (${quoteCode}) is ready.

View and accept/sign online:
${viewUrl}

${expires ? `Expires: ${expires}\n` : ""}${preparedBy ? `Prepared by: ${preparedBy}\n` : ""}
Thank you,
${companyName}`;

    const payload = {
      From: formatFrom(companyName, POSTMARK_FROM_EMAIL),
      To: toEmail,
      Subject: subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
      MessageStream: POSTMARK_MESSAGE_STREAM,
      // Keep replies going to the company/user (not your platform address)
      ReplyTo: createdByEmail || companyEmail || undefined,
      // Send internal copy to the right company/user (instead of a hard-coded email)
      ...(bcc ? { Bcc: bcc } : {}),
      ...(attachments.length ? { Attachments: attachments } : {}),
    };

    const pmRes = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": POSTMARK_SERVER_TOKEN,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!pmRes.ok) {
      const errText = await pmRes.text();
      res.status(502).json({ error: "Postmark send failed", detail: errText });
      return;
    }

    // Mark as Sent
    await supabase.from("quotes").update({ status: "Sent" }).eq("id", quote.id);

    res.status(200).json({ ok: true, status: "Sent", view_url: viewUrl });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Server error" });
  }
}

/* =========================
   Helpers
   ========================= */

function safeStr(v) {
  return String(v ?? "").trim();
}

function safeEmail(v) {
  const s = safeStr(v).toLowerCase();
  // Very light validation
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
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
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
  return rgbToHex({
    r: rgb.r * factor,
    g: rgb.g * factor,
    b: rgb.b * factor,
  });
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

  // Quote the name so punctuation is safe (Postmark recommends this)
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
  // Prefer CID inline attachments (reliable even when external images are blocked)
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

  // If it's already a remote URL, use it (some clients may still block until user loads images)
  if (/^https?:\/\//i.test(safeStr(logoUrl))) {
    return { logoSrc: safeStr(logoUrl), attachments: [] };
  }

  return { logoSrc: "", attachments: [] };
}

function buildQuoteReadyHtml({
  brand,
  brandDark,
  logoSrc,
  viewUrl,
  customerName,
  quoteCode,
  expires,
  preparedBy,
  companyName,
  phone,
  email,
  web,
}) {
  const safeName = escapeHtml(customerName);
  const safeCompany = escapeHtml(companyName);
  const safeCode = escapeHtml(quoteCode);
  const safeExpires = escapeHtml(expires || "—");
  const safePrepared = escapeHtml(preparedBy || "—");
  const safePhone = escapeHtml(phone || "");
  const safeEmail = escapeHtml(email || "");
  const safeWeb = escapeHtml(web || "");
  const safeViewUrl = escapeHtml(viewUrl);

  const logoBlock = logoSrc
    ? `<img src="${escapeHtml(logoSrc)}" width="200" alt="${safeCompany}"
         style="display:block;width:200px;max-width:200px;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;" />`
    : `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-weight:950;font-size:18px;color:#0b0f14;">${safeCompany}</div>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${safeCompany} — Quote</title>

    <style>
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
    </style>
  </head>

  <body class="bg" bgcolor="#f5f7fb" style="margin:0;padding:0;background:#f5f7fb;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Your quote is ready — view on any device and sign online.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" bgcolor="#f5f7fb"
      style="width:100%;background:#f5f7fb;padding:26px 12px;">
      <tr>
        <td align="center" style="padding:0;margin:0;">

          <table role="presentation" class="container" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px;">
            <tr>
              <td class="card" bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e6e9f1;border-radius:22px;overflow:hidden;">

                <!-- Accent bar -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td height="6" style="height:6px;background:linear-gradient(90deg,${brand},${brandDark});line-height:6px;font-size:0;">&nbsp;</td>
                  </tr>
                </table>

                <!-- Logo header -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td class="logo-wrap" align="center" bgcolor="#ffffff" style="background:#ffffff;padding:18px 22px 14px;text-align:center;">
                      <table role="presentation" align="center" cellpadding="0" cellspacing="0" class="logo-shell" bgcolor="#ffffff"
                        style="margin:0 auto;background:#ffffff;border:1px solid #e6e9f1;border-radius:18px;overflow:hidden;">
                        <tr>
                          <td align="center" style="padding:12px 14px;">
                            ${logoBlock}
                          </td>
                        </tr>
                      </table>

                      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin-top:12px;">
                        <div class="muted" style="font-size:12px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;color:#6b7280;">Quote</div>
                        <div class="txt" style="margin-top:6px;font-size:14px;font-weight:950;letter-spacing:.10em;color:#0b0f14;word-break:break-word;">${safeCode}</div>
                      </div>
                    </td>
                  </tr>
                </table>

                <!-- Copy -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td class="px" align="center" style="padding:18px 26px 10px;text-align:center;">
                      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
                        <div class="txt h1" style="font-size:26px;font-weight:950;line-height:1.2;color:#0b0f14;">Review &amp; sign online</div>
                        <div class="muted sub" style="margin-top:10px;font-size:14px;line-height:1.65;color:#4b5563;max-width:520px;">
                          Hi ${safeName}. Tap the button below to view your quote on mobile or desktop — then accept &amp; sign right on the page.
                        </div>
                      </div>
                    </td>
                  </tr>

                  <!-- CTA -->
                  <tr>
                    <td align="center" style="padding:12px 26px 8px;">
                      <!--[if mso]>
                        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeViewUrl}"
                          style="height:54px;v-text-anchor:middle;width:420px;" arcsize="16%"
                          strokecolor="${brand}" fillcolor="${brand}">
                          <w:anchorlock/>
                          <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">
                            View quote & sign
                          </center>
                        </v:roundrect>
                      <![endif]-->

                      <!--[if !mso]><!-- -->
                      <table role="presentation" cellpadding="0" cellspacing="0" class="cta" style="margin:0 auto;width:420px;max-width:100%;">
                        <tr>
                          <td align="center" bgcolor="${brand}"
                            style="border-radius:16px;background-color:${brand};background:${brand};background-image:linear-gradient(90deg,${brand},${brandDark});">
                            <a href="${safeViewUrl}"
                              style="display:block;padding:18px 18px;border-radius:16px;text-align:center;
                                     font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                     font-weight:950;font-size:16px;letter-spacing:.2px;text-decoration:none;
                                     color:#ffffff;-webkit-text-fill-color:#ffffff;">
                              View quote &amp; sign
                            </a>
                          </td>
                        </tr>
                      </table>
                      <!--<![endif]-->
                    </td>
                  </tr>

                  <!-- Link -->
                  <tr>
                    <td align="center" style="padding:0 26px 18px;text-align:center;">
                      <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b7280;">
                        If the button doesn’t work, copy &amp; paste this link:
                        <br />
                        <span style="color:${brand};word-break:break-all;">${safeViewUrl}</span>
                      </div>
                    </td>
                  </tr>

                  <!-- Details -->
                  <tr>
                    <td class="px" align="center" style="padding:0 26px 22px;text-align:center;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="detail" bgcolor="#f8fafc"
                        style="background:#f8fafc;border:1px solid #e6e9f1;border-radius:18px;overflow:hidden;max-width:520px;">
                        <tr>
                          <td align="center" style="padding:14px 16px;text-align:center;">
                            <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;">Expires</div>
                            <div class="txt" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;font-weight:950;color:#0b0f14;margin-top:6px;">${safeExpires}</div>
                          </td>
                        </tr>
                        <tr><td class="divider" style="border-top:1px solid #e6e9f1;"></td></tr>
                        <tr>
                          <td align="center" style="padding:14px 16px;text-align:center;">
                            <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;">Prepared by</div>
                            <div class="txt" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;font-weight:950;color:#0b0f14;margin-top:6px;">${safePrepared}</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Footer -->
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
