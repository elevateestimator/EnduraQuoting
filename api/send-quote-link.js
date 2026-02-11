import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/send-quote-link
 * Body: { quote_id: string }
 *
 * Sends a modern, QuickBooks-style email with a "View Quote" CTA.
 * - Optimized for mobile + Apple Mail dark mode (keeps email LIGHT).
 * - No PDF attachment (hosted quote page).
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

    const POSTMARK_SERVER_TOKEN = process.env.POSTMARK_SERVER_TOKEN;
    const POSTMARK_FROM_EMAIL = process.env.POSTMARK_FROM_EMAIL;
    const POSTMARK_MESSAGE_STREAM = process.env.POSTMARK_MESSAGE_STREAM || "outbound";

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
      return;
    }
    if (!POSTMARK_SERVER_TOKEN || !POSTMARK_FROM_EMAIL) {
      res.status(500).json({ error: "Missing POSTMARK_SERVER_TOKEN or POSTMARK_FROM_EMAIL" });
      return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: quote, error } = await supabase
      .from("quotes")
      .select("id,status,customer_name,customer_email,quote_no,total_cents,data")
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
    const logoUrl = `${origin}/assets/logo.jpg`;

    const meta = quote.data?.meta || {};
    const quoteCode =
      quote.data?.quote_code ||
      `ER-${String(meta?.quote_date || "").slice(0, 4) || "0000"}-${String(quote.quote_no || "").padStart(4, "0")}`;

    const expires = meta?.quote_expires || "";
    const preparedBy = meta?.prepared_by || "Jacob Docherty";

    const totalCad = ((Number(quote.total_cents) || 0) / 100).toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 2,
    });

    const customerName = quote.customer_name || "there";
    const companyName = quote.data?.company?.name || "Endura Metal Roofing Ltd.";
    const phone = quote.data?.company?.phone || "705-903-7663";
    const email = quote.data?.company?.email || "jacob@endurametalroofing.ca";
    const web = quote.data?.company?.web || "endurametalroofing.ca";

    // Subject includes a suffix so you can confirm you’re seeing the NEW template.
    const subject = `Your Endura Quote is Ready — ${quoteCode} (View & Sign)`;

    const htmlBody = buildEmailHtml({
      logoUrl,
      viewUrl,
      customerName,
      quoteCode,
      totalCad,
      expires,
      preparedBy,
      companyName,
      phone,
      email,
      web,
    });

    const textBody =
`Hi ${customerName},

Your quote (${quoteCode}) is ready.

View and accept your quote here:
${viewUrl}

Total: ${totalCad}
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

    await supabase.from("quotes").update({ status: "Sent" }).eq("id", quote.id);

    res.status(200).json({ ok: true, status: "Sent", view_url: viewUrl });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Server error" });
  }
}

function esc(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildEmailHtml({
  logoUrl,
  viewUrl,
  customerName,
  quoteCode,
  totalCad,
  expires,
  preparedBy,
  companyName,
  phone,
  email,
  web,
}) {
  const safeName = esc(customerName);
  const safeCompany = esc(companyName);
  const safeCode = esc(quoteCode);
  const safeTotal = esc(totalCad);
  const safeExpires = esc(expires || "—");
  const safePrepared = esc(preparedBy || "—");
  const safePhone = esc(phone || "");
  const safeEmail = esc(email || "");
  const safeWeb = esc(web || "");
  const safeViewUrl = esc(viewUrl);

  const brand = "#0267b5";
  const brandDark = "#014d89";
  const ink = "#0b0f14";
  const text = "#111827";
  const muted = "#4b5563";
  const soft = "#f7fafc";
  const border = "#e6e9f1";

  // NOTE: table-based layout + mostly inline styles = best cross-client results.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />

    <!-- Prefer LIGHT. Apple Mail respects these. -->
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />

    <title>${safeCompany} — Quote</title>

    <style>
      :root { color-scheme: light; supported-color-schemes: light; }

      /* Fix iOS text scaling */
      body, table, td, a { -webkit-text-size-adjust: 100%; }

      /* Mobile stacking */
      @media only screen and (max-width: 600px) {
        .container { width: 100% !important; }
        .px { padding-left: 18px !important; padding-right: 18px !important; }
        .h1 { font-size: 22px !important; }
        .amount { font-size: 30px !important; }
        .cta { width: 100% !important; }
        .cta a { display: block !important; width: 100% !important; }
        .grid2 { display:block !important; width:100% !important; }
        .grid2 td { display:block !important; width:100% !important; padding-right:0 !important; }
      }

      /* Apple Mail dark mode: keep it LIGHT + readable */
      @media (prefers-color-scheme: dark) {
        body, table, td { background:#ffffff !important; }
        .bg { background:#ffffff !important; }
        .card { background:#ffffff !important; }
        .soft { background:${soft} !important; }
        .ink { color:${ink} !important; }
        .muted { color:${muted} !important; }
        .btn a { color:#ffffff !important; -webkit-text-fill-color:#ffffff !important; }
      }
    </style>

    <!--[if mso]>
      <style>
        body, table, td, a { font-family: Arial, sans-serif !important; }
      </style>
    <![endif]-->
  </head>

  <body class="bg" bgcolor="#ffffff" style="margin:0;padding:0;background:#ffffff;">
    <!-- Preheader -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Your quote is ready — view on any device and sign online.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      class="bg" bgcolor="#ffffff" style="width:100%;background:#ffffff;padding:26px 12px;">
      <tr>
        <td align="center" style="padding:0;margin:0;">

          <table role="presentation" width="640" cellpadding="0" cellspacing="0" class="container"
            style="width:640px;max-width:640px;margin:0 auto;">

            <!-- Card -->
            <tr>
              <td class="card" bgcolor="#ffffff"
                style="background:#ffffff;border:1px solid ${border};border-radius:20px;overflow:hidden;">

                <!-- Brand bar -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td height="8" bgcolor="${brand}" style="height:8px;background:${brand};line-height:8px;font-size:0;">&nbsp;</td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td class="px" style="padding:22px 26px 6px;">
                      <!-- Centered logo (no split columns = no weird empty right side) -->
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td align="center" style="padding:0 0 10px;">
                            <img src="${logoUrl}" alt="${safeCompany}" width="160"
                              style="display:block;width:160px;max-width:160px;height:auto;border:0;outline:none;text-decoration:none;" />
                          </td>
                        </tr>
                        <tr>
                          <td align="center" style="padding:0 0 4px;">
                            <span class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                  font-size:12px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;color:#6b7280;">
                              Quote
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td align="center" style="padding:0 0 14px;">
                            <span class="ink" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                  font-size:14px;font-weight:950;letter-spacing:.14em;color:${ink};">
                              ${safeCode}
                            </span>
                          </td>
                        </tr>
                      </table>

                      <div class="h1 ink" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                          font-size:26px;font-weight:950;line-height:1.2;color:${ink};margin:0;text-align:left;">
                        Review &amp; sign your quote
                      </div>

                      <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                          font-size:14px;line-height:1.65;color:${muted};margin-top:10px;">
                        Hi ${safeName}, your quote is ready. Open it on any device, download a PDF, and accept/sign online when you're ready.
                      </div>
                    </td>
                  </tr>

                  <!-- Summary -->
                  <tr>
                    <td class="px" style="padding:12px 26px 16px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="soft"
                        bgcolor="${soft}"
                        style="background:${soft};border:1px solid ${border};border-radius:16px;">
                        <tr>
                          <td style="padding:16px 16px 14px;">
                            <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                font-size:12px;font-weight:950;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;">
                              Total
                            </div>
                            <div class="amount" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                font-size:36px;font-weight:950;line-height:1.05;color:${brand};margin-top:8px;">
                              ${safeTotal}
                            </div>

                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid2" style="margin-top:12px;">
                              <tr>
                                <td style="padding-right:10px;">
                                  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                      font-size:12px;font-weight:950;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;">
                                    Expires
                                  </div>
                                  <div class="ink" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                      font-size:14px;font-weight:950;color:${text};margin-top:6px;">
                                    ${safeExpires}
                                  </div>
                                </td>
                                <td style="padding-left:10px;">
                                  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                      font-size:12px;font-weight:950;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;">
                                    Prepared by
                                  </div>
                                  <div class="ink" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                      font-size:14px;font-weight:950;color:${text};margin-top:6px;">
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

                  <!-- CTA -->
                  <tr>
                    <td class="px" align="center" style="padding:0 26px 18px;">
                      <!--[if mso]>
                        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${safeViewUrl}"
                          style="height:50px;v-text-anchor:middle;width:360px;" arcsize="18%" strokecolor="${brand}" fillcolor="${brand}">
                          <w:anchorlock/>
                          <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">
                            View quote
                          </center>
                        </v:roundrect>
                      <![endif]-->

                      <!--[if !mso]><!-- -->
                      <table role="presentation" cellpadding="0" cellspacing="0" class="cta" style="margin:0 auto;width:360px;max-width:100%;">
                        <tr>
                          <td class="btn" align="center"
                            style="border-radius:14px;background:${brand};background-image:linear-gradient(90deg,${brand},${brandDark});">
                            <a href="${safeViewUrl}"
                               style="display:inline-block;padding:15px 22px;border-radius:14px;
                                      font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                      font-weight:950;font-size:16px;letter-spacing:.2px;
                                      text-decoration:none;color:#ffffff;-webkit-text-fill-color:#ffffff;">
                              View quote &amp; sign
                            </a>
                          </td>
                        </tr>
                      </table>
                      <!--<![endif]-->

                      <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                          font-size:12px;line-height:1.6;color:#6b7280;margin-top:12px;text-align:center;">
                        If the button doesn't work, copy this link:<br/>
                        <span style="color:${brand};word-break:break-all;">${safeViewUrl}</span>
                      </div>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td bgcolor="#ffffff" style="padding:14px 26px 22px;border-top:1px solid ${border};">
                      <div class="muted" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                          font-size:12px;line-height:1.6;color:#6b7280;">
                        Questions? Reply to this email or call <span class="ink" style="color:${ink};font-weight:950;">${safePhone}</span>.
                        <br/>
                        <span style="color:#9ca3af;">${safeCompany} • ${safeEmail} • ${safeWeb}</span>
                      </div>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>

            <!-- Tiny footer outside card -->
            <tr>
              <td align="center" style="padding:12px 6px 0;">
                <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                    font-size:11px;line-height:1.5;color:#9ca3af;text-align:center;">
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
