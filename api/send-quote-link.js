import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/send-quote-link
 * Body: { quote_id: string }
 *
 * Polished, customer-first email (Postmark):
 * - Centered layout on mobile + desktop
 * - Single strong CTA ("View quote & sign")
 * - NO pricing in the email
 * - Reply-To: jacob@endurametalroofing.ca
 * - Dark mode: swaps logo to /assets/blacklogo.png and blends logo background
 *
 * Note: Not all email clients fully support prefers-color-scheme.
 * Apple Mail and Outlook support it well; Gmail may ignore the swap.
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
    const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || "jacob@endurametalroofing.ca";
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

    // Subject makes it obvious you're seeing this new template
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
        Bcc: ADMIN_NOTIFY_EMAIL,
        ReplyTo: "jacob@endurametalroofing.ca",
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
        .h1 { font-size: 22px !important; }
        .sub { font-size: 14px !important; }
      }

      /* ===== Logo swapping =====
         Default: show light logo.
         Dark mode: show dark logo.
      */
      .logo-dark { display:none; max-height:0; overflow:hidden; mso-hide:all; }
      .logo-light { display:block; }
      @media (prefers-color-scheme: dark) {
        .logo-light { display:none !important; max-height:0 !important; overflow:hidden !important; }
        .logo-dark  { display:block !important; max-height:none !important; overflow:visible !important; }

        body, .bg { background:#0b1020 !important; }
        .card { background:#0f172a !important; border-color: rgba(255,255,255,0.14) !important; }
        .txt { color:#e8eefc !important; }
        .muted { color: rgba(232,238,252,0.72) !important; }
        .detail { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.14) !important; }
        .divider { border-color: rgba(255,255,255,0.14) !important; }
        .link { color:#93c5fd !important; }

        /* Make logo background BLEND with dark mode */
        .logo-wrap { background:#000000 !important; }
        .logo-shell { background:#000000 !important; border-color: rgba(255,255,255,0.18) !important; }
      }

      /* Outlook (new) dark mode hooks */
      [data-ogsc] body, [data-ogsc] .bg { background:#0b1020 !important; }
      [data-ogsc] .card { background:#0f172a !important; border-color: rgba(255,255,255,0.14) !important; }
      [data-ogsc] .txt { color:#e8eefc !important; }
      [data-ogsc] .muted { color: rgba(232,238,252,0.72) !important; }
      [data-ogsc] .detail { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.14) !important; }
      [data-ogsc] .divider { border-color: rgba(255,255,255,0.14) !important; }
      [data-ogsc] .link { color:#93c5fd !important; }
      [data-ogsc] .logo-wrap { background:#000000 !important; }
      [data-ogsc] .logo-shell { background:#000000 !important; border-color: rgba(255,255,255,0.18) !important; }
      [data-ogsc] .logo-light { display:none !important; }
      [data-ogsc] .logo-dark  { display:block !important; max-height:none !important; }
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
      class="bg" bgcolor="#f5f7fb" style="width:100%;background:#f5f7fb;padding:26px 12px;">
      <tr>
        <td align="center" style="padding:0;margin:0;">

          <table role="presentation" class="container" width="640" cellpadding="0" cellspacing="0"
            style="width:640px;max-width:640px;">

            <tr>
              <td class="card" bgcolor="#ffffff"
                style="background:#ffffff;border:1px solid #e6e9f1;border-radius:22px;overflow:hidden;">

                <!-- Accent bar -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td height="6" style="height:6px;background:linear-gradient(90deg,${brand},${brandDark});line-height:6px;font-size:0;">&nbsp;</td>
                  </tr>
                </table>

                <!-- Logo header (BLENDS with logo background) -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td class="logo-wrap" align="center" bgcolor="#ffffff"
                      style="background:#ffffff;padding:18px 22px 14px;text-align:center;">
                      <table role="presentation" align="center" cellpadding="0" cellspacing="0" class="logo-shell" bgcolor="#ffffff"
                        style="margin:0 auto;background:#ffffff;border:1px solid #e6e9f1;border-radius:18px;overflow:hidden;">
                        <tr>
                          <td align="center" style="padding:12px 14px;">
                            <!-- Light logo -->
                            <img class="logo-light" src="${logoLightUrl}" width="200" alt="${safeCompany}"
                              style="display:block;width:200px;max-width:200px;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;" />
                            <!-- Dark logo -->
                            <img class="logo-dark" src="${logoDarkUrl}" width="200" alt="${safeCompany}"
                              style="display:none;width:200px;max-width:200px;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;" />
                          </td>
                        </tr>
                      </table>

                      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin-top:12px;">
                        <div class="muted" style="font-size:12px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;color:#6b7280;">
                          Quote
                        </div>
                        <div class="txt" style="margin-top:6px;font-size:14px;font-weight:950;letter-spacing:.10em;color:#0b0f14;word-break:break-word;">
                          ${safeCode}
                        </div>
                      </div>
                    </td>
                  </tr>
                </table>

                <!-- Copy -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td class="px" align="center" style="padding:18px 26px 10px;text-align:center;">
                      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
                        <div class="txt h1" style="font-size:26px;font-weight:950;line-height:1.2;color:#0b0f14;">
                          Review &amp; sign online
                        </div>
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
                        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${safeViewUrl}"
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
                          <td align="center"
                            style="border-radius:16px;background:linear-gradient(90deg,${brand},${brandDark});">
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
                        <span class="link" style="color:${brand};word-break:break-all;">${safeViewUrl}</span>
                      </div>
                    </td>
                  </tr>

                  <!-- Details (CENTERED, mobile-safe) -->
                  <tr>
                    <td class="px" align="center" style="padding:0 26px 22px;text-align:center;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                        class="detail" bgcolor="#f8fafc"
                        style="background:#f8fafc;border:1px solid #e6e9f1;border-radius:18px;overflow:hidden;max-width:520px;">
                        <tr>
                          <td align="center" style="padding:14px 16px;text-align:center;">
                            <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;">
                              Expires
                            </div>
                            <div class="txt" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;font-weight:950;color:#0b0f14;margin-top:6px;">
                              ${safeExpires}
                            </div>
                          </td>
                        </tr>

                        <tr>
                          <td class="divider" style="border-top:1px solid #e6e9f1;"></td>
                        </tr>

                        <tr>
                          <td align="center" style="padding:14px 16px;text-align:center;">
                            <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;">
                              Prepared by
                            </div>
                            <div class="txt" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;font-weight:950;color:#0b0f14;margin-top:6px;">
                              ${safePrepared}
                            </div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td class="divider" style="border-top:1px solid #e6e9f1;"></td>
                  </tr>

                  <tr>
                    <td align="center" style="padding:14px 24px 18px;text-align:center;">
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
