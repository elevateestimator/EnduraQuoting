import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/send-quote-link
 * Body: { quote_id: string }
 *
 * Sends a polished, centered, QuickBooks-style email (Postmark) with a
 * single strong CTA to view/sign online (no PDF attachment).
 *
 * Dark mode:
 * - Uses prefers-color-scheme to switch theme AND swap to /assets/blacklogo.png.
 * - Clients that don't support the media query will show the light logo.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { quote_id } = req.body || {};
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
    if (!POSTMARK_SERVER_TOKEN || !POSTMARK_FROM_EMAIL) {
      res.status(500).json({ error: "Missing POSTMARK_SERVER_TOKEN or POSTMARK_FROM_EMAIL" });
      return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: quote, error } = await supabase
      .from("quotes")
      .select("id,status,customer_name,customer_email,quote_no,data")
      .eq("id", quote_id)
      .single();

    if (error || !quote) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }

    const toEmail = quote.customer_email;
    if (!toEmail) {
      res.status(400).json({ error: "Quote has no customer email" });
      return;
    }

    // Base URL for links/images in email
    const proto = (req.headers["x-forwarded-proto"] || "https").toString();
    const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
    const origin = (process.env.PUBLIC_BASE_URL || (host ? `${proto}://${host}` : "")).replace(/\/$/, "");
    if (!origin) {
      res.status(500).json({ error: "Unable to determine PUBLIC_BASE_URL" });
      return;
    }

    const viewUrl = `${origin}/customer/quote.html?id=${encodeURIComponent(quote.id)}`;
    const logoLightUrl = `${origin}/assets/logo.jpg`;
    const logoDarkUrl = `${origin}/assets/blacklogo.png`; // you added this

    const meta = quote.data?.meta || {};
    const quoteCode =
      quote.data?.quote_code ||
      `ER-${String(meta?.quote_date || "").slice(0, 4) || "0000"}-${String(quote.quote_no || "").padStart(4, "0")}`;

    const expires = meta?.quote_expires || "";
    const preparedBy = meta?.prepared_by || "Jacob Docherty";

    const customerName = quote.customer_name || "there";
    const companyName = quote.data?.company?.name || "Endura Metal Roofing Ltd.";

    // Subject change makes it obvious you're seeing the new template
    const subject = `Your Endura Quote is Ready — ${quoteCode}`;

    const htmlBody = buildEmailHtml({
      logoLightUrl,
      logoDarkUrl,
      viewUrl,
      customerName,
      quoteCode,
      expires,
      preparedBy,
      companyName,
      phone: quote.data?.company?.phone || "705-903-7663",
      email: quote.data?.company?.email || "jacob@endurametalroofing.ca",
      web: quote.data?.company?.web || "endurametalroofing.ca",
    });

    const textBody =
`Hi ${customerName},

Your quote (${quoteCode}) is ready.

View and accept/sign online:
${viewUrl}

Expires: ${expires || "—"}
Prepared by: ${preparedBy}

Thank you,
${companyName}`;

    const pmRes = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": POSTMARK_SERVER_TOKEN,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        From: POSTMARK_FROM_EMAIL,
        To: toEmail,
        Subject: subject,
        HtmlBody: htmlBody,
        TextBody: textBody,
        MessageStream: POSTMARK_MESSAGE_STREAM,
      }),
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

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildEmailHtml({
  logoLightUrl,
  logoDarkUrl,
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

  const brand = "#0267b5";
  const brandDark = "#014d89";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />

    <!-- Let clients know we support BOTH. We'll style both explicitly. -->
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />

    <title>${safeCompany} — Quote</title>

    <style>
      :root { color-scheme: light dark; supported-color-schemes: light dark; }

      /* Mobile */
      @media only screen and (max-width: 600px) {
        .container { width: 100% !important; }
        .px { padding-left: 18px !important; padding-right: 18px !important; }
        .cta { width: 100% !important; }
        .cta a { display:block !important; }
        .cols { display:block !important; width:100% !important; }
        .col { display:block !important; width:100% !important; padding:0 !important; }
        .sp-12 { height:12px !important; line-height:12px !important; }
      }

      /* Default: light logo visible */
      .logo-dark { display:none; max-height:0; overflow:hidden; }

      /* Dark mode theme + swap logo */
      @media (prefers-color-scheme: dark) {
        body, .bg { background:#0b1020 !important; }
        .card { background:#0f172a !important; border-color: rgba(255,255,255,0.14) !important; }
        .muted { color: rgba(232,238,252,0.72) !important; }
        .txt { color: #e8eefc !important; }
        .chip { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.14) !important; }
        .footer { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.14) !important; }
        .link { color: #93c5fd !important; }

        .logo-light { display:none !important; max-height:0 !important; overflow:hidden !important; }
        .logo-dark { display:block !important; max-height:none !important; overflow:visible !important; }
      }

      /* Outlook (new) dark mode hooks */
      [data-ogsc] body, [data-ogsc] .bg { background:#0b1020 !important; }
      [data-ogsc] .card { background:#0f172a !important; border-color: rgba(255,255,255,0.14) !important; }
      [data-ogsc] .muted { color: rgba(232,238,252,0.72) !important; }
      [data-ogsc] .txt { color: #e8eefc !important; }
      [data-ogsc] .chip { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.14) !important; }
      [data-ogsc] .footer { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.14) !important; }

      [data-ogsc] .logo-light { display:none !important; }
      [data-ogsc] .logo-dark { display:block !important; max-height:none !important; }
    </style>

    <!--[if mso]>
      <style>
        body, table, td, a { font-family: Arial, sans-serif !important; }
      </style>
    <![endif]-->
  </head>

  <body class="bg" bgcolor="#f5f7fb" style="margin:0;padding:0;background:#f5f7fb;">
    <!-- Preheader -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Your quote is ready — view on any device and sign online.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      class="bg" bgcolor="#f5f7fb" style="width:100%;background:#f5f7fb;padding:28px 12px;">
      <tr>
        <td align="center" style="padding:0;margin:0;">

          <table role="presentation" class="container" width="640" cellpadding="0" cellspacing="0"
            style="width:640px;max-width:640px;">

            <!-- Logo -->
            <tr>
              <td align="center" style="padding:0 6px 16px;">
                <span class="logo-light">
                  <img src="${logoLightUrl}" width="180" alt="${safeCompany}"
                    style="display:block;width:180px;max-width:180px;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;" />
                </span>
                <span class="logo-dark">
                  <img src="${logoDarkUrl}" width="180" alt="${safeCompany}"
                    style="display:block;width:180px;max-width:180px;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;" />
                </span>
              </td>
            </tr>

            <!-- Main card -->
            <tr>
              <td class="card" bgcolor="#ffffff"
                style="background:#ffffff;border:1px solid #e6e9f1;border-radius:22px;overflow:hidden;">

                <!-- Accent bar -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td height="6" style="height:6px;background:linear-gradient(90deg,${brand},${brandDark});line-height:6px;font-size:0;">&nbsp;</td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <!-- Headline -->
                  <tr>
                    <td class="px" align="center" style="padding:22px 26px 10px;text-align:center;">
                      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
                        <div class="muted" style="font-size:12px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;color:#6b7280;">
                          Quote ready
                        </div>
                        <div class="txt" style="margin-top:10px;font-size:26px;font-weight:950;line-height:1.2;color:#0b0f14;">
                          Review &amp; sign online
                        </div>
                        <div class="muted" style="margin-top:10px;font-size:14px;line-height:1.65;color:#4b5563;max-width:520px;">
                          Hi ${safeName}. Your quote is ready to review on desktop or mobile. When you’re ready, accept &amp; sign right on the page.
                        </div>
                      </div>
                    </td>
                  </tr>

                  <!-- CTA (front & center) -->
                  <tr>
                    <td align="center" style="padding:12px 26px 8px;">
                      <!--[if mso]>
                        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${safeViewUrl}"
                          style="height:52px;v-text-anchor:middle;width:360px;" arcsize="16%"
                          strokecolor="${brand}" fillcolor="${brand}">
                          <w:anchorlock/>
                          <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">
                            View quote & sign
                          </center>
                        </v:roundrect>
                      <![endif]-->

                      <!--[if !mso]><!-- -->
                      <table role="presentation" cellpadding="0" cellspacing="0" class="cta" style="margin:0 auto;width:360px;max-width:100%;">
                        <tr>
                          <td align="center"
                            style="border-radius:16px;background:linear-gradient(90deg,${brand},${brandDark});">
                            <a href="${safeViewUrl}"
                              style="display:inline-block;width:100%;padding:16px 18px;border-radius:16px;
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
                        <span class="link" style="color:${brand};word-break:break-all;">${safeViewUrl}</span>
                      </div>
                    </td>
                  </tr>

                  <!-- Small details (no price) -->
                  <tr>
                    <td class="px" align="center" style="padding:0 26px 22px;text-align:center;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                        style="border:1px solid #e6e9f1;border-radius:18px;overflow:hidden;">
                        <tr>
                          <td class="chip cols" style="padding:14px 16px;background:#f8fafc;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                <td class="col" align="center" style="width:33.33%;padding:0 8px;">
                                  <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;">
                                    Quote #
                                  </div>
                                  <div class="txt" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;font-weight:950;color:#0b0f14;margin-top:6px;">
                                    ${safeCode}
                                  </div>
                                </td>

                                <td class="col" align="center" style="width:33.33%;padding:0 8px;">
                                  <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;">
                                    Expires
                                  </div>
                                  <div class="txt" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;font-weight:950;color:#0b0f14;margin-top:6px;">
                                    ${safeExpires}
                                  </div>
                                </td>

                                <td class="col" align="center" style="width:33.33%;padding:0 8px;">
                                  <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;">
                                    Prepared by
                                  </div>
                                  <div class="txt" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;font-weight:950;color:#0b0f14;margin-top:6px;">
                                    ${safePrepared}
                                  </div>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td class="footer" align="center" bgcolor="#f3f4f6"
                      style="background:#f3f4f6;border-top:1px solid #e6e9f1;padding:14px 24px;text-align:center;">
                      <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;line-height:1.55;color:#6b7280;">
                        Questions? Reply to this email or call <span class="txt" style="color:#0b0f14;font-weight:950;">${safePhone}</span>
                        <br />
                        <span style="color:#9ca3af;">${safeCompany} • ${safeEmail} • ${safeWeb}</span>
                      </div>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>

            <!-- Small footer -->
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
