import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/send-quote-link
 * Body: { quote_id: string }
 *
 * Sends a branded email (Postmark) with a "View Quote" button that links
 * to the customer quote page (mobile-friendly).
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
    const quoteCode = quote.data?.quote_code || `ER-${String(meta?.quote_date || "").slice(0,4) || "0000"}-${String(quote.quote_no || "").padStart(4,"0")}`;
    const expires = meta?.quote_expires || "";
    const preparedBy = meta?.prepared_by || "Jacob Docherty";

    const totalCad = ((Number(quote.total_cents) || 0) / 100).toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 2,
    });

    const customerName = quote.customer_name || "there";

    const subject = `Your Quote is Ready — ${quoteCode}`;

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
`Hi ${customerName},

Your quote (${quoteCode}) is ready.

View and accept your quote here:
${viewUrl}

Total: ${totalCad}
Expires: ${expires || "—"}
Prepared by: ${preparedBy}

Thank you,
Endura Metal Roofing Ltd.`;

    const pmRes = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": POSTMARK_SERVER_TOKEN,
        "Content-Type": "application/json",
        "Accept": "application/json",
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

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>${companyName} — Quote</title>
  </head>
  <body style="margin:0;padding:0;background:#f2f5f9;">
    <!-- Preheader -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Your quote is ready — view, download PDF, and accept online.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5f9;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e9f1;">
            <tr>
              <td style="padding:18px 18px 10px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <img src="${logoUrl}" alt="${companyName}" width="140" style="display:block;height:auto;border:0;outline:none;text-decoration:none;" />
                    </td>
                    <td style="vertical-align:middle;text-align:right;">
                      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-weight:900;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#ffffff;background:linear-gradient(90deg,#0267b5,#014d89);display:inline-block;padding:8px 12px;border-radius:999px;">
                        QUOTE
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:0 18px 10px;">
                <div style="height:4px;border-radius:4px;background:linear-gradient(90deg,#0267b5,rgba(2,103,181,.25));"></div>
              </td>
            </tr>

            <tr>
              <td style="padding: 6px 18px 0;">
                <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0b0f14;">
                  <div style="font-weight:950;font-size:18px;line-height:1.25;margin:0 0 6px;">
                    Hi ${safeName},
                  </div>
                  <div style="font-size:14px;line-height:1.55;color:#374151;">
                    Your quote is ready. You can review it on desktop or mobile, download a PDF copy, and accept/sign online.
                  </div>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding: 14px 18px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e9f1;border-radius:14px;background:#f8fafc;">
                  <tr>
                    <td style="padding:12px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;color:#6b7280;letter-spacing:.12em;text-transform:uppercase;font-weight:900;">
                            Quote #
                          </td>
                          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;color:#6b7280;letter-spacing:.12em;text-transform:uppercase;font-weight:900;text-align:right;">
                            Total
                          </td>
                        </tr>
                        <tr>
                          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:16px;font-weight:950;color:#0b0f14;padding-top:6px;">
                            ${safeCode}
                          </td>
                          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:16px;font-weight:950;color:#0267b5;text-align:right;padding-top:6px;">
                            ${safeTotal}
                          </td>
                        </tr>

                        <tr><td colspan="2" style="height:10px;"></td></tr>

                        <tr>
                          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;color:#6b7280;letter-spacing:.12em;text-transform:uppercase;font-weight:900;">
                            Expires
                          </td>
                          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;color:#6b7280;letter-spacing:.12em;text-transform:uppercase;font-weight:900;text-align:right;">
                            Prepared by
                          </td>
                        </tr>
                        <tr>
                          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:13px;font-weight:900;color:#0b0f14;padding-top:6px;">
                            ${safeExpires}
                          </td>
                          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:13px;font-weight:900;color:#0b0f14;text-align:right;padding-top:6px;">
                            ${safePrepared}
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding: 16px 18px 10px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td align="center">
                      <a href="${viewUrl}"
                         style="display:inline-block;background:linear-gradient(90deg,#0267b5,#014d89);color:#ffffff;text-decoration:none;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-weight:950;padding:12px 18px;border-radius:12px;">
                        View Quote
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding: 0 18px 18px;">
                <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;line-height:1.5;color:#6b7280;">
                  If the button doesn’t work, copy and paste this link:<br />
                  <span style="color:#111827;word-break:break-all;">${viewUrl}</span>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding: 14px 18px 18px;background:#0b1020;">
                <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;line-height:1.5;color:rgba(255,255,255,.78);">
                  ${escapeHtml(companyName)} • ${escapeHtml(phone)} • ${escapeHtml(email)} • ${escapeHtml(web)}
                </div>
              </td>
            </tr>
          </table>

          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#9ca3af;font-size:12px;margin-top:10px;">
            © ${new Date().getFullYear()} ${escapeHtml(companyName)}
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
