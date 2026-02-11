import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/send-quote-link
 * Body: { quote_id: string }
 *
 * Sends a polished, "QuickBooks-style" light-mode email (Postmark) with a View Quote button.
 * Note: Some clients (notably Gmail iOS) use a "full invert" dark-mode algorithm that can't be
 * fully disabled, but we use multiple defensive techniques (bgcolor + inline + linear-gradient)
 * to strongly bias toward a white/light render.
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

    // Make it obvious you've deployed the new template (you can later simplify this subject if desired).
    const subject = `Endura Quote Ready — ${quoteCode}`;

    const htmlBody = buildEmailHtml({
      logoUrl,
      viewUrl,
      customerName,
      quoteCode,
      totalCad,
      expires,
      preparedBy,
      companyName: quote.data?.company?.name || "Endura Metal Roofing Ltd.",
      phone: quote.data?.company?.phone || "705-903-7663",
      email: quote.data?.company?.email || "jacob@endurametalroofing.ca",
      web: quote.data?.company?.web || "endurametalroofing.ca",
    });

    const textBody =
      `Hi ${customerName},\n\n` +
      `Your quote (${quoteCode}) is ready.\n\n` +
      `View, download a PDF, and accept/sign online:\n${viewUrl}\n\n` +
      `Total: ${totalCad}\n` +
      `Expires: ${expires || "—"}\n` +
      `Prepared by: ${preparedBy}\n\n` +
      `Thank you,\nEndura Metal Roofing Ltd.`;

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

    // Mark as Sent (minimal; avoids needing extra columns)
    await supabase.from("quotes").update({ status: "Sent" }).eq("id", quote.id);

    res.status(200).json({
      ok: true,
      status: "Sent",
      view_url: viewUrl,
    });
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

/**
 * "QuickBooks-style" light email
 * - Pure tables + inline styles for high compatibility
 * - Forces white/light backgrounds using:
 *    1) bgcolor attributes
 *    2) inline background-color
 *    3) inline background-image: linear-gradient(#fff,#fff) (helps with some forced-invert clients)
 */
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
  const safeName = escapeHtml(customerName);
  const safeCode = escapeHtml(quoteCode);
  const safeTotal = escapeHtml(totalCad);
  const safeExpires = escapeHtml(expires || "—");
  const safePrepared = escapeHtml(preparedBy || "—");
  const safeCompany = escapeHtml(companyName);
  const safePhone = escapeHtml(phone || "");
  const safeEmail = escapeHtml(email || "");
  const safeWeb = escapeHtml(web || "");

  const footerLine = [safeCompany, safePhone, safeEmail, safeWeb].filter(Boolean).join(" • ");

  // Colors
  const brand = "#0267b5";
  const ink = "#111827";
  const muted = "#6b7280";
  const border = "#e5e7eb";
  const soft = "#f8fafc";

  // NOTE: Keep CSS small + safe. Rely on inline styles for critical stuff.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />

    <!-- Strong nudge toward LIGHT rendering in clients that support it -->
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />

    <title>${safeCompany} — Quote</title>

    <style>
      :root { color-scheme: light; supported-color-schemes: light; }
      body { margin:0 !important; padding:0 !important; background:${"#ffffff"} !important; }
      /* Outlook.com / Outlook app hooks */
      [data-ogsc] .bg { background:${"#ffffff"} !important; }
      [data-ogsc] .card { background:${"#ffffff"} !important; }
      [data-ogsc] .text { color:${ink} !important; }
    </style>

    <!--[if mso]>
      <style>
        body, table, td, a { font-family: Arial, sans-serif !important; }
      </style>
    <![endif]-->
  </head>

  <body class="bg" bgcolor="#ffffff" style="margin:0;padding:0;background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);">
    <!-- Preheader (hidden) -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Your quote is ready — review online, download a PDF, and accept/sign digitally.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      class="bg" bgcolor="#ffffff"
      style="width:100%;background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);padding:28px 12px;">
      <tr>
        <td align="center" style="padding:0;margin:0;">
          <!-- Container -->
          <table role="presentation" cellpadding="0" cellspacing="0" width="640"
            class="card" bgcolor="#ffffff"
            style="width:640px;max-width:640px;background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);border:1px solid ${border};border-radius:20px;overflow:hidden;">
            <!-- Top brand rule -->
            <tr>
              <td height="6" bgcolor="${brand}" style="height:6px;background:${brand};background-image:linear-gradient(${brand},${brand});line-height:6px;font-size:0;">&nbsp;</td>
            </tr>

            <!-- Header: logo + pill -->
            <tr>
              <td style="padding:22px 24px 10px;background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td valign="middle" style="padding:0;margin:0;">
                      <!-- Logo: keep it on white no matter what -->
                      <table role="presentation" cellpadding="0" cellspacing="0" bgcolor="#ffffff"
                        style="background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);border:1px solid ${border};border-radius:14px;">
                        <tr>
                          <td style="padding:10px 12px;">
                            <img src="${logoUrl}" alt="${safeCompany}" width="160"
                              style="display:block;width:160px;max-width:160px;height:auto;border:0;outline:none;text-decoration:none;" />
                          </td>
                        </tr>
                      </table>
                    </td>

                    <td valign="middle" align="right" style="padding:0;margin:0;">
                      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                  font-weight:900;font-size:12px;letter-spacing:.18em;text-transform:uppercase;
                                  color:${ink};border:1px solid ${border};background:${soft};
                                  padding:8px 12px;border-radius:999px;display:inline-block;">
                        QUOTE
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Heading + intro -->
            <tr>
              <td style="padding:0 24px 18px;background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);">
                <div class="text" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${ink};">
                  <div style="font-size:24px;font-weight:950;line-height:1.2;margin:0 0 6px;">
                    Your quote is ready
                  </div>
                  <div style="font-size:14px;line-height:1.6;color:${muted};">
                    Hi ${safeName} — you can review the quote on desktop or mobile, download a PDF copy,
                    and accept/sign online in one step.
                  </div>
                </div>
              </td>
            </tr>

            <!-- Summary card -->
            <tr>
              <td style="padding:0 24px 18px;background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${soft}"
                  style="border:1px solid ${border};border-radius:16px;overflow:hidden;background:${soft};background-image:linear-gradient(${soft},${soft});">
                  <tr>
                    <td style="padding:16px 16px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                     font-size:12px;color:${muted};letter-spacing:.12em;text-transform:uppercase;font-weight:900;">
                            Quote #
                          </td>
                          <td align="right" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                     font-size:12px;color:${muted};letter-spacing:.12em;text-transform:uppercase;font-weight:900;">
                            Total
                          </td>
                        </tr>
                        <tr>
                          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                     font-size:16px;font-weight:950;color:${ink};padding-top:6px;">
                            ${safeCode}
                          </td>
                          <td align="right" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                     font-size:20px;font-weight:950;color:${brand};padding-top:4px;">
                            ${safeTotal}
                          </td>
                        </tr>

                        <tr><td colspan="2" height="14" style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>

                        <tr>
                          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                     font-size:12px;color:${muted};letter-spacing:.12em;text-transform:uppercase;font-weight:900;">
                            Expires
                          </td>
                          <td align="right" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                     font-size:12px;color:${muted};letter-spacing:.12em;text-transform:uppercase;font-weight:900;">
                            Prepared by
                          </td>
                        </tr>
                        <tr>
                          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                     font-size:13px;font-weight:900;color:${ink};padding-top:6px;">
                            ${safeExpires}
                          </td>
                          <td align="right" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                                     font-size:13px;font-weight:900;color:${ink};padding-top:6px;">
                            ${safePrepared}
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
              <td style="padding:0 24px 10px;background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);" align="center">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" bgcolor="${brand}"
                      style="background:${brand};background-image:linear-gradient(${brand},${brand});border-radius:12px;">
                      <a href="${viewUrl}"
                        style="display:inline-block;padding:14px 22px;
                               font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                               font-size:15px;font-weight:950;letter-spacing:.01em;
                               color:#ffffff;text-decoration:none;border-radius:12px;">
                        View quote &amp; sign
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Fallback link -->
            <tr>
              <td style="padding:0 24px 18px;background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);">
                <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                            font-size:12px;line-height:1.6;color:${muted};text-align:center;">
                  If the button doesn’t work, copy and paste this link:<br />
                  <span style="color:${ink};word-break:break-all;">${viewUrl}</span>
                </div>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:16px 24px 20px;border-top:1px solid ${border};
                         background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);">
                <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                            font-size:12px;line-height:1.7;color:${muted};">
                  Questions? Reply to this email.<br />
                  ${footerLine}
                </div>
              </td>
            </tr>
          </table>

          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
                      font-size:11px;line-height:1.6;color:#9ca3af;margin-top:12px;">
            © ${new Date().getFullYear()} ${safeCompany}
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
