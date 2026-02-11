import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/send-quote-link
 * Body: { quote_id: string }
 *
 * Sends a HIGH-END, QuickBooks-inspired branded email (Postmark)
 * that links to the customer quote page (no PDF attachment).
 *
 * Dark-mode note:
 * - Some clients (notably Gmail iOS) apply forced color inversion.
 * - This template aggressively biases toward a white email by using:
 *   bgcolor + inline background-color + a repeating white background IMAGE.
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

    // IMPORTANT: add this file to /assets/email-bg.png (a tiny repeating white PNG)
    const bgUrl = `${origin}/assets/email-bg.png`;

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

    // Change subject so you can immediately confirm you’re seeing the NEW email
    const subject = `Endura Quote Ready — ${quoteCode} (View & Sign Online)`;

    const htmlBody = buildEmailHtml({
      logoUrl,
      bgUrl,
      viewUrl,
      customerName,
      quoteCode,
      totalCad,
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
  logoUrl,
  bgUrl,
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
  const safeName = escapeHtml(customerName);
  const safeCompany = escapeHtml(companyName);
  const safeCode = escapeHtml(quoteCode);
  const safeTotal = escapeHtml(totalCad);
  const safeExpires = escapeHtml(expires || "—");
  const safePrepared = escapeHtml(preparedBy || "—");
  const safePhone = escapeHtml(phone || "");
  const safeEmail = escapeHtml(email || "");
  const safeWeb = escapeHtml(web || "");
  const safeViewUrl = escapeHtml(viewUrl);

  const brand = "#0267b5";
  const brandDark = "#014d89";
  const ink = "#0b0f14";
  const muted = "#374151";
  const soft = "#f8fafc";
  const border = "#e6e9f1";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />

    <!-- Strong hint: LIGHT email -->
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />

    <title>${safeCompany} — Quote</title>

    <style>
      :root { color-scheme: light; supported-color-schemes: light; }
      body { margin:0 !important; padding:0 !important; background:#ffffff !important; }
      table { border-collapse: collapse; }
      img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }

      /* Mobile */
      @media only screen and (max-width: 600px) {
        .container { width: 100% !important; }
        .px { padding-left: 18px !important; padding-right: 18px !important; }
        .stack { display:block !important; width:100% !important; }
        .right { text-align:left !important; padding-top: 10px !important; }
        .h1 { font-size: 22px !important; }
        .amount { font-size: 28px !important; }
        .cta { width: 100% !important; }
        .cta a { display:block !important; }
      }

      /* Outlook dark-mode selector hooks */
      [data-ogsc] .bg { background:#ffffff !important; }
      [data-ogsc] .card { background:#ffffff !important; }
      [data-ogsc] .txt { color:${ink} !important; }
    </style>

    <!--[if mso]>
      <style>
        body, table, td, a { font-family: Arial, sans-serif !important; }
      </style>
    <![endif]-->
  </head>

  <body class="bg" bgcolor="#ffffff" style="margin:0;padding:0;background:#ffffff;background-image:url('${bgUrl}');background-repeat:repeat;">
    <!-- Preheader -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Your Endura quote is ready — view on any device and sign online.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      class="bg" bgcolor="#ffffff" background="${bgUrl}"
      style="width:100%;background:#ffffff;background-image:url('${bgUrl}');background-repeat:repeat;padding:28px 12px;">
      <tr>
        <td align="center" style="padding:0;margin:0;">

          <!-- ===== Top strip (outside the card) ===== -->
          <table role="presentation" class="container" width="640" cellpadding="0" cellspacing="0"
            style="width:640px;max-width:640px;">
            <tr>
              <td class="px" style="padding:0 6px 14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td class="stack" valign="middle" style="padding:0;">
                      <!-- Logo in a white capsule so it stays clean in dark mode -->
                      <table role="presentation" cellpadding="0" cellspacing="0" bgcolor="#ffffff" background="${bgUrl}"
                        style="background:#ffffff;background-image:url('${bgUrl}');background-repeat:repeat;border:1px solid ${border};border-radius:16px;">
                        <tr>
                          <td style="padding:10px 12px;">
                            <img src="${logoUrl}" alt="${safeCompany}" width="150"
                              style="display:block;width:150px;max-width:150px;height:auto;" />
                          </td>
                        </tr>
                      </table>
                    </td>

                    <td class="stack right" align="right" valign="middle" style="padding:0;">
                      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                  font-size:12px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;
                                  color:#6b7280;">
                        Quote
                      </div>
                      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                  font-size:14px;font-weight:950;color:${ink};margin-top:4px;">
                        ${safeCode}
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- ===== Main card ===== -->
            <tr>
              <td class="card" bgcolor="#ffffff" background="${bgUrl}"
                style="background:#ffffff;background-image:url('${bgUrl}');background-repeat:repeat;border:1px solid ${border};
                       border-radius:22px;overflow:hidden;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">

                  <!-- Brand bar -->
                  <tr>
                    <td height="8" bgcolor="${brand}" style="height:8px;background:${brand};line-height:8px;font-size:0;">&nbsp;</td>
                  </tr>

                  <!-- Heading -->
                  <tr>
                    <td class="px" style="padding:22px 24px 14px;">
                      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${ink};">
                        <div style="font-size:12px;font-weight:950;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;">
                          Endura Metal Roofing
                        </div>

                        <div class="h1" style="font-size:26px;font-weight:950;line-height:1.2;margin:8px 0 0;">
                          Review &amp; sign your quote
                        </div>

                        <div class="txt" style="font-size:14px;line-height:1.65;color:${muted};margin-top:10px;">
                          Hi ${safeName}, your quote is ready. Open it on any device, download a PDF, and accept/sign online when you're ready.
                        </div>
                      </div>
                    </td>
                  </tr>

                  <!-- Summary block -->
                  <tr>
                    <td class="px" style="padding:0 24px 18px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${soft}" background="${bgUrl}"
                        style="background:${soft};background-image:url('${bgUrl}');background-repeat:repeat;border:1px solid ${border};border-radius:18px;overflow:hidden;">
                        <tr>
                          <td style="padding:16px 16px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                <td valign="top" style="padding:0;">
                                  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                              font-size:12px;font-weight:950;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;">
                                    Total
                                  </div>
                                  <div class="amount" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                              font-size:34px;font-weight:950;color:${brand};margin-top:8px;line-height:1.05;">
                                    ${safeTotal}
                                  </div>
                                </td>

                                <td valign="top" align="right" style="padding:0;">
                                  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                              font-size:12px;font-weight:950;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;">
                                    Expires
                                  </div>
                                  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                              font-size:14px;font-weight:950;color:${ink};margin-top:10px;">
                                    ${safeExpires}
                                  </div>
                                </td>
                              </tr>

                              <tr><td colspan="2" style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>

                              <tr>
                                <td style="padding:0;">
                                  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                              font-size:12px;font-weight:950;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;">
                                    Quote #
                                  </div>
                                  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                              font-size:14px;font-weight:950;color:${ink};margin-top:6px;">
                                    ${safeCode}
                                  </div>
                                </td>

                                <td align="right" style="padding:0;">
                                  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                              font-size:12px;font-weight:950;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;">
                                    Prepared by
                                  </div>
                                  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                              font-size:14px;font-weight:950;color:${ink};margin-top:6px;">
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
                    <td class="px" align="center" style="padding:0 24px 14px;">

                      <!--[if mso]>
                        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${safeViewUrl}"
                          style="height:48px;v-text-anchor:middle;width:320px;" arcsize="18%" strokecolor="${brand}" fillcolor="${brand}">
                          <w:anchorlock/>
                          <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">
                            View quote & sign
                          </center>
                        </v:roundrect>
                      <![endif]-->

                      <!--[if !mso]><!-- -->
                      <table role="presentation" cellpadding="0" cellspacing="0" class="cta" style="margin:0 auto;">
                        <tr>
                          <td align="center" bgcolor="${brand}" style="border-radius:14px;background:${brand};background-image:linear-gradient(90deg,${brand},${brandDark});">
                            <a href="${safeViewUrl}"
                              style="display:inline-block;padding:14px 22px;border-radius:14px;
                                     font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                     font-weight:950;font-size:16px;text-decoration:none;color:#ffffff;">
                              View quote &amp; sign
                            </a>
                          </td>
                        </tr>
                      </table>
                      <!--<![endif]-->

                      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                  font-size:12px;line-height:1.6;color:#6b7280;margin-top:10px;text-align:center;">
                        Or copy &amp; paste this link:<br/>
                        <span style="color:${ink};word-break:break-all;">${safeViewUrl}</span>
                      </div>
                    </td>
                  </tr>

                  <!-- Next steps -->
                  <tr>
                    <td class="px" style="padding:0 24px 22px;">
                      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                  font-size:13px;font-weight:950;color:${ink};margin:0 0 10px;">
                        Next steps
                      </div>

                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="padding:0;">
                            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                              <tr>
                                <td valign="top" width="20" style="padding:2px 10px 0 0;color:${brand};font-weight:950;">1.</td>
                                <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:13px;line-height:1.6;color:${muted};">
                                  Open the quote and review scope &amp; pricing.
                                </td>
                              </tr>
                              <tr><td colspan="2" style="height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>
                              <tr>
                                <td valign="top" width="20" style="padding:2px 10px 0 0;color:${brand};font-weight:950;">2.</td>
                                <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:13px;line-height:1.6;color:${muted};">
                                  Tap <b style="color:${ink};">Accept &amp; Sign</b> to sign digitally.
                                </td>
                              </tr>
                              <tr><td colspan="2" style="height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>
                              <tr>
                                <td valign="top" width="20" style="padding:2px 10px 0 0;color:${brand};font-weight:950;">3.</td>
                                <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:13px;line-height:1.6;color:${muted};">
                                  We’ll reach out to confirm scheduling and next steps.
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Footer inside card -->
                  <tr>
                    <td bgcolor="#f3f4f6" background="${bgUrl}"
                      style="background:#f3f4f6;background-image:url('${bgUrl}');background-repeat:repeat;padding:14px 24px;">
                      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                  font-size:12px;line-height:1.55;color:#6b7280;text-align:center;">
                        Questions? Reply to this email or call <span style="color:${ink};font-weight:950;">${safePhone}</span>
                        <br/>
                        <span style="color:#9ca3af;">${safeCompany} • ${safeEmail} • ${safeWeb}</span>
                      </div>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>

            <!-- Tiny footer -->
            <tr>
              <td style="padding:12px 6px 0;">
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
