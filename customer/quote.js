const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

/* =========================================================
   Elements
   ========================================================= */
const loadingEl = $("#loading");
const bannerEl = $("#banner");
const quotePageEl = $("#quote-page");
const acceptSectionEl = $("#accept-section");

const downloadBtn = $("#download-btn");
const acceptJumpBtn = $("#accept-jump-btn");
const signNowBtn = $("#sign-now-btn");

const vQuoteCode = $("#v-quote-code");
const vQuoteStatus = $("#v-quote-status");
const vDocQuoteCode = $("#v-doc-quote-code");

const siteCompanyNameEl = $("#site-company-name");
const siteLogoEl = $("#site-logo");
const siteLogoFallbackEl = $("#site-logo-fallback");
const docLogoEl = $("#doc-logo");
const docLogoInitialsEl = $("#doc-logo-initials");

// Signature modal
const sigModal = $("#sig-modal");
const sigCanvas = $("#sig-canvas");
const sigCloseBtn = $("#sig-close");
const sigClearBtn = $("#sig-clear");
const sigSubmitBtn = $("#sig-submit");
const sigNameEl = $("#sig-name");

// Signature output
const clientSigImg = $("#v-client-signature-img");

// Items table parts
const itemsColgroupEl = $("#items-colgroup");
const itemsHeadRowEl = $("#items-head-row");
const itemsBodyEl = $("#v-item-rows");
const itemsCardsEl = $("#v-item-cards");

/* =========================================================
   State
   ========================================================= */
let _quoteRow = null;
let _quoteData = null;
let _currency = "CAD";

/* =========================================================
   Helpers
   ========================================================= */
function showBanner(text) {
  if (!text) {
    bannerEl.hidden = true;
    bannerEl.textContent = "";
    return;
  }
  bannerEl.hidden = false;
  bannerEl.textContent = text;
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function ymdTodayLocal() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtDate(isoYmd) {
  if (!isoYmd) return "—";
  try {
    return new Date(`${isoYmd}T00:00:00`).toLocaleDateString("en-CA", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return isoYmd;
  }
}

function isHexColor(s) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(s || ""));
}

function normalizeHex(hex) {
  const h = String(hex || "").trim();
  if (!isHexColor(h)) return "#000000";
  if (h.length === 4) {
    return "#" + h.slice(1).split("").map((c) => c + c).join("");
  }
  return h.toLowerCase();
}

function hexToRgb(hex) {
  const h = normalizeHex(hex).slice(1);
  const n = parseInt(h, 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

function darkenHex(hex, amt = 0.18) {
  const { r, g, b } = hexToRgb(hex);
  const f = (x) => Math.max(0, Math.min(255, Math.round(x * (1 - amt))));
  return `#${[f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function applyBrandColor(hex) {
  const brand = normalizeHex(hex);
  const { r, g, b } = hexToRgb(brand);
  const brandDark = darkenHex(brand, 0.18);

  // Apply globally so header CTA matches company brand.
  const root = document.documentElement;
  root.style.setProperty("--brand", brand);
  root.style.setProperty("--brand-dark", brandDark);
  root.style.setProperty("--brand-rgb", `${r},${g},${b}`);

  // Also apply on the doc itself to ensure PDF clone inherits correctly.
  quotePageEl?.style.setProperty("--brand", brand);
  quotePageEl?.style.setProperty("--brand-dark", brandDark);
  quotePageEl?.style.setProperty("--brand-rgb", `${r},${g},${b}`);
}

function currencySymbol(currency) {
  try {
    const parts = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).formatToParts(0);
    const cur = parts.find((p) => p.type === "currency");
    return cur?.value || "$";
  } catch {
    return "$";
  }
}

function formatMoneyNoSymbol(cents, currency) {
  const amount = (Number(cents) || 0) / 100;
  try {
    // Keep it consistent with your current customer base (Canada)
    return new Intl.NumberFormat("en-CA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

function formatMoney(cents, currency) {
  const amount = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(amount);
  } catch {
    return `$${formatMoneyNoSymbol(cents, currency)}`;
  }
}

async function getJSON(url) {
  const res = await fetch(url, { method: "GET" });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new Error((data && (data.error || data.message)) || `Request failed (${res.status})`);
  return data;
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new Error((data && (data.error || data.message)) || `Request failed (${res.status})`);
  return data;
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initialsFromName(name) {
  const parts = safeStr(name).split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] || "");
  return (a + b).toUpperCase();
}

function setLogoWithFallback(imgEl, fallbackEl, initials, primaryUrl, proxyUrl) {
  if (!imgEl) return;

  // Reset handlers so we don't stack multiple listeners.
  imgEl.onerror = null;
  imgEl.onload = null;

  const showFallback = () => {
    try {
      imgEl.hidden = true;
    } catch {}
    if (fallbackEl) {
      fallbackEl.textContent = initials;
      fallbackEl.hidden = false;
    }
  };

  const tryLoad = (src, onFail) => {
    const s = safeStr(src);
    if (!s) return onFail?.();

    // Hide fallback while attempting.
    if (fallbackEl) fallbackEl.hidden = true;
    try {
      imgEl.hidden = false;
    } catch {}

    // Helps PDF canvas capture when src is cross-origin, and doesn't hurt for same-origin.
    try {
      imgEl.crossOrigin = "anonymous";
    } catch {}

    imgEl.onload = () => {
      if (fallbackEl) fallbackEl.hidden = true;
      try {
        imgEl.hidden = false;
      } catch {}
    };

    imgEl.onerror = () => {
      onFail?.();
    };

    imgEl.src = s;
  };

  const p = safeStr(primaryUrl);
  const proxy = safeStr(proxyUrl);

  // Strategy:
  // 1) Try whatever URL we have (data URL / public URL)
  // 2) If it errors, fall back to a same-origin proxy endpoint (/api/company-logo)
  // 3) If that errors too, fall back to initials.
  if (p) {
    let usedProxy = false;
    return tryLoad(p, () => {
      if (!usedProxy && proxy) {
        usedProxy = true;
        return tryLoad(proxy, showFallback);
      }
      showFallback();
    });
  }

  if (proxy) return tryLoad(proxy, showFallback);
  showFallback();
}

function pickLogoUrl(company = {}, data = {}) {
  // Back-compat across iterations / field names
  const url =
    safeStr(company.logo_data_url) ||
    safeStr(company.logoDataUrl) ||
    safeStr(company.logo_url) ||
    safeStr(company.logoUrl) ||
    safeStr(company.logo) ||
    safeStr(company.logo_public_url) ||
    safeStr(company.logoPublicUrl) ||
    safeStr(data.company_logo_data_url) ||
    safeStr(data.company_logo_url) ||
    safeStr(data.logo_data_url) ||
    safeStr(data.logo_url) ||
    safeStr(data.logoUrl) ||
    "";

  // If the DB stored only a storage path (not a full URL), try to build a public URL.
  if (
    url &&
    !url.startsWith("http") &&
    !url.startsWith("data:") &&
    !url.startsWith("blob:") &&
    !url.startsWith("/")
  ) {
    const supa = safeStr(data._supabase_url || data.supabase_url);
    const bucket = safeStr(data.logo_bucket) || "company-logos";
    if (supa) {
      return `${supa.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${url}`;
    }
  }

  return url;
}

/* =========================================================
   Items rendering
   ========================================================= */
function computeTotals(items, taxRate, feesCents) {
  let subtotal = 0;
  let taxableBase = 0;

  for (const it of items) {
    const qty = Number(it.qty || 0);
    const unit = Number(it.unit_price_cents || 0);
    const line = Math.round(qty * unit);
    subtotal += line;
    if (it.taxable !== false) taxableBase += line;
  }

  const rate = Number(taxRate || 0);
  const tax = Math.round(taxableBase * (rate / 100));
  const fees = Number(feesCents || 0);
  const total = Math.max(0, subtotal + tax + fees);

  return { subtotal, tax, fees, total };
}

function buildItemsTable(items, currency) {
  itemsColgroupEl.innerHTML = "";
  itemsHeadRowEl.innerHTML = "";
  itemsBodyEl.innerHTML = "";
  itemsCardsEl.innerHTML = "";

  const anyBreakdown = items.some((it) => it.show_qty_unit_price !== false);

  // Columns
  const cols = anyBreakdown
    ? [
        { key: "item", label: "Item", width: "auto", align: "left" },
        { key: "qty", label: "Qty", width: "10%", align: "num" },
        { key: "unit", label: "Unit", width: "12%", align: "num" },
        { key: "unit_price", label: "Unit Price", width: "16%", align: "num" },
        { key: "tax", label: "Tax", width: "10%", align: "center" },
        { key: "line_total", label: "Line Total", width: "18%", align: "num" },
      ]
    : [
        { key: "item", label: "Item", width: "auto", align: "left" },
        { key: "tax", label: "Tax", width: "12%", align: "center" },
        { key: "line_total", label: "Line Total", width: "22%", align: "num" },
      ];

  // Colgroup
  for (const c of cols) {
    const col = document.createElement("col");
    col.style.width = c.width;
    itemsColgroupEl.appendChild(col);
  }

  // Head
  for (const c of cols) {
    const th = document.createElement("th");
    th.textContent = c.label;
    if (c.align === "num") th.classList.add("num");
    if (c.align === "center") th.classList.add("center");
    itemsHeadRowEl.appendChild(th);
  }

  if (!items.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = cols.length;
    td.style.padding = "12px";
    td.style.color = "#6b7280";
    td.textContent = "No line items";
    tr.appendChild(td);
    itemsBodyEl.appendChild(tr);
    return;
  }

  // Rows
  for (const it of items) {
    const qty = Number(it.qty || 0);
    const unitType = safeStr(it.unit_type) || "Each";
    const unitC = Number(it.unit_price_cents || 0);
    const taxable = it.taxable !== false;
    const line = Math.round(qty * unitC);
    const showBreakdown = it.show_qty_unit_price !== false;

    const name = safeStr(it.name) || safeStr(it.item) || "Item";
    const desc = safeStr(it.description);

    const tr = document.createElement("tr");

    const addCell = (html, cls = "") => {
      const td = document.createElement("td");
      if (cls) td.className = cls;
      td.innerHTML = html;
      tr.appendChild(td);
    };

    // Item cell
    addCell(
      `<div class="item-title">${escapeHtml(name)}</div>` +
        (desc ? `<div class="item-desc">${escapeHtml(desc)}</div>` : ""),
      ""
    );

    if (anyBreakdown) {
      addCell(showBreakdown ? escapeHtml(qty ? String(qty) : "") : "", "num");
      addCell(showBreakdown ? escapeHtml(unitType) : "", "num");
      addCell(showBreakdown ? escapeHtml(formatMoneyNoSymbol(unitC, currency)) : "", "num");
    }

    addCell(taxable ? "✓" : "—", "center");

    addCell(`<span class="line-total">${escapeHtml(formatMoney(line, currency))}</span>`, "num");

    itemsBodyEl.appendChild(tr);

    // Mobile card
    const card = document.createElement("div");
    card.className = "item-card";
    card.innerHTML = `
      <div class="item-card-head">
        <div>
          <div class="item-card-name">${escapeHtml(name)}</div>
          ${desc ? `<div class="item-card-desc">${escapeHtml(desc)}</div>` : ""}
        </div>
        <div class="item-card-total">${escapeHtml(formatMoney(line, currency))}</div>
      </div>
      <div class="item-card-grid">
        ${showBreakdown ? `
          <div>
            <div class="item-k">Qty</div>
            <div class="item-v">${escapeHtml(qty ? String(qty) : "—")}</div>
          </div>
          <div>
            <div class="item-k">Unit</div>
            <div class="item-v">${escapeHtml(unitType)}</div>
          </div>
          <div>
            <div class="item-k">Unit Price</div>
            <div class="item-v">${escapeHtml(formatMoney(unitC, currency))}</div>
          </div>
        ` : ""}
        <div>
          <div class="item-k">Tax</div>
          <div class="item-v">${taxable ? "Yes" : "No"}</div>
        </div>
      </div>
    `;
    itemsCardsEl.appendChild(card);
  }
}

/* =========================================================
   Render quote (read-only)
   ========================================================= */
function fillQuote(quote) {
  const data = quote.data || {};
  const company = data.company || {};
  const meta = data.meta || {};
  const bill = data.bill_to || {};
  const project = data.project || {};

  _currency = safeStr(company.currency) || safeStr(data.currency) || "CAD";

  const quoteCode =
    safeStr(data.quote_code) ||
    safeStr(quote.quote_code) ||
    safeStr(meta.quote_no) ||
    (quote.quote_no ? `Q-${quote.quote_no}` : "") ||
    (quote.id ? `Q-${String(quote.id).slice(0, 8)}` : "—");

  // Status
  vQuoteCode.textContent = quoteCode;
  vDocQuoteCode.textContent = quoteCode;
  vQuoteStatus.textContent = safeStr(quote.status) || "Quote";

  // Company
  const companyName = safeStr(company.name) || "Company";
  $("#v-company-name").textContent = companyName;

  if (siteCompanyNameEl) siteCompanyNameEl.textContent = companyName;
  try {
    document.title = `${companyName} — Quote ${quoteCode}`;
  } catch {}

  // Brand color
  applyBrandColor(company.brand_color || company.brandColour || company.brand || "#000000");

  // Logo
const logoUrl = pickLogoUrl(company, data);
// Same-origin proxy (best default for public pages + PDFs)
const proxyLogoUrl = quote?.id
  ? `/api/company-logo?quote_id=${encodeURIComponent(quote.id)}&v=${Date.now()}`
  : "";

// Always show a mark (logo or initials). Prefer embedded data URL if present (best for PDF),
// otherwise prefer proxy (same-origin, avoids CORS/canvas issues), then fall back to any URL we have.
const initials = initialsFromName(companyName || "Company");
const hasDataLogo = !!logoUrl && logoUrl.startsWith("data:");
const primaryLogo = hasDataLogo ? logoUrl : (proxyLogoUrl || logoUrl);
const secondaryLogo = hasDataLogo ? "" : (logoUrl && logoUrl !== primaryLogo ? logoUrl : "");

setLogoWithFallback(siteLogoEl, siteLogoFallbackEl, initials, primaryLogo, secondaryLogo);
setLogoWithFallback(docLogoEl, docLogoInitialsEl, initials, primaryLogo, secondaryLogo);

  // Contact
  const addr1 = safeStr(company.addr1 || company.address1 || company.address || "");
  const addr2 = safeStr(company.addr2 || company.address2 || "");

  $("#v-company-addr1").textContent = addr1;
  $("#v-company-addr2").textContent = addr2;
  $("#v-company-phone").textContent = safeStr(company.phone);
  $("#v-company-email").textContent = safeStr(company.email);
  $("#v-company-web").textContent = safeStr(company.web);

  // Remove empty contact spans (avoids stray bullets)
  $$("#v-company-contact span").forEach((el) => {
    if (!safeStr(el.textContent)) el.remove();
  });

  // Meta
  $("#v-meta-quote").textContent = quoteCode;
  $("#v-meta-date").textContent = fmtDate(meta.quote_date);
  $("#v-meta-expires").textContent = fmtDate(meta.quote_expires);
  $("#v-meta-prepared").textContent = safeStr(meta.prepared_by) || "—";

  // Bill To
  const clientName = safeStr(bill.client_name || quote.customer_name) || "—";
  const clientPhone = safeStr(bill.client_phone);
  const clientEmail = safeStr(bill.client_email || quote.customer_email);
  const clientAddr = safeStr(bill.client_addr);

  $("#v-bill-name").textContent = clientName;
  const subParts = [];
  if (clientPhone) subParts.push(clientPhone);
  if (clientEmail) subParts.push(clientEmail);
  $("#v-bill-sub").textContent = subParts.join(" • ");
  $("#v-bill-addr").textContent = clientAddr;

  // Job site
  const job = safeStr(project.project_location);
  $("#v-jobsite").textContent = job || "Same as billing address";
  $("#v-jobsite-sub").textContent = job ? "Installation address" : "";

  // Rep signature/date
  const preparedBy = safeStr(meta.prepared_by) || "Representative";
  $("#v-rep-signature").textContent = preparedBy;
  $("#v-rep-printed-name").textContent = preparedBy;
  $("#v-rep-date").textContent = fmtDate(meta.quote_date);

  // Items
  const items = Array.isArray(data.items) ? data.items : [];
  buildItemsTable(items, _currency);

  // Tax label / totals
  const taxName = safeStr(data.tax_name) || "Tax";
  const taxRate = Number(data.tax_rate ?? 0);
  const feesCents = Number(data.fees_cents || 0);

  const totals = computeTotals(items, taxRate, feesCents);

  const currSymbol = currencySymbol(_currency);
  $("#v-curr").textContent = currSymbol;

  $("#v-subtotal").textContent = formatMoneyNoSymbol(totals.subtotal, _currency);
  $("#v-tax").textContent = formatMoneyNoSymbol(totals.tax, _currency);
  $("#v-fees").textContent = formatMoneyNoSymbol(totals.fees, _currency);
  $("#v-total").textContent = formatMoneyNoSymbol(totals.total, _currency);

  // Fees row (hide if 0)
  const feesRow = $("#fees-row");
  if (feesRow) feesRow.hidden = totals.fees <= 0;

  const rateLabel = Number.isFinite(taxRate) && taxRate > 0 ? `${taxName} (${taxRate}%)` : taxName;
  $("#v-tax-label").textContent = rateLabel;

  // Deposit
  let depositCents = 0;
  if (data.deposit_mode === "custom") depositCents = Number(data.deposit_cents || 0);
  else depositCents = Math.round(totals.total * 0.4);

  $("#v-deposit").textContent = formatMoney(depositCents, _currency);

  // Terms / Notes
  const terms = safeStr(data.terms);
  const notes = safeStr(data.notes);

  const termsCard = $("#terms-card");
  const notesCard = $("#notes-card");

  $("#v-terms").textContent = terms;
  $("#v-notes").textContent = notes;

  if (termsCard) termsCard.hidden = !terms;
  if (notesCard) notesCard.hidden = !notes;

  // Acceptance
  const acceptance = data.acceptance || null;
  const status = safeStr(quote.status).toLowerCase();

  if (acceptance?.accepted_at) {
    const name = safeStr(acceptance.name) || clientName || "Client";
    const dateIso = safeStr(acceptance.accepted_date) || safeStr(acceptance.accepted_at).slice(0, 10);

    const src = acceptance.signature_image_data_url || acceptance.signature_data_url || "";
    if (clientSigImg && src) {
      clientSigImg.src = src;
      clientSigImg.hidden = false;
    }

    $("#v-client-name").textContent = name;
    $("#v-client-date").textContent = fmtDate(dateIso);

    // Hide accept UI
    if (acceptSectionEl) acceptSectionEl.hidden = true;
    if (acceptJumpBtn) {
      acceptJumpBtn.disabled = true;
      acceptJumpBtn.textContent = "Signed";
    }
  } else {
    // Not accepted yet
    if (clientSigImg) {
      clientSigImg.src = "";
      clientSigImg.hidden = true;
    }
    $("#v-client-name").textContent = "";
    $("#v-client-date").textContent = "";

    if (status === "cancelled") {
      if (acceptSectionEl) acceptSectionEl.hidden = true;
      if (acceptJumpBtn) {
        acceptJumpBtn.disabled = true;
        acceptJumpBtn.textContent = "Cancelled";
      }
    } else {
      if (acceptSectionEl) acceptSectionEl.hidden = false;
      if (acceptJumpBtn) {
        acceptJumpBtn.disabled = false;
        acceptJumpBtn.textContent = "Accept & Sign";
      }
    }
  }

  // Keep header quote code in doc pill
  $("#v-doc-quote-code").textContent = quoteCode;
}

/* =========================================================
   Signature pad
   ========================================================= */
let _sigCtx = null;
let _drawing = false;
let _hasStroke = false;

function openSigModal() {
  if (!sigModal) return;
  sigModal.hidden = false;
  document.body.style.overflow = "hidden";
  _hasStroke = false;

  const billName = safeStr($("#v-bill-name")?.textContent) || "Client";
  if (sigNameEl) sigNameEl.textContent = billName;

  setupCanvas();
}

function closeSigModal() {
  if (!sigModal) return;
  sigModal.hidden = true;
  document.body.style.overflow = "";
}

function setupCanvas() {
  if (!sigCanvas) return;

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = sigCanvas.getBoundingClientRect();

  sigCanvas.width = Math.round(rect.width * dpr);
  sigCanvas.height = Math.round(rect.height * dpr);

  _sigCtx = sigCanvas.getContext("2d");
  _sigCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  _sigCtx.lineWidth = 2.6;
  _sigCtx.lineCap = "round";
  _sigCtx.lineJoin = "round";
  _sigCtx.strokeStyle = "#0b0f14";

  _sigCtx.clearRect(0, 0, rect.width, rect.height);
}

function canvasPos(e) {
  const rect = sigCanvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function onPointerDown(e) {
  if (!_sigCtx) return;
  _drawing = true;
  _hasStroke = true;
  sigCanvas.setPointerCapture?.(e.pointerId);
  const p = canvasPos(e);
  _sigCtx.beginPath();
  _sigCtx.moveTo(p.x, p.y);
}

function onPointerMove(e) {
  if (!_drawing || !_sigCtx) return;
  const p = canvasPos(e);
  _sigCtx.lineTo(p.x, p.y);
  _sigCtx.stroke();
}

function onPointerUp(e) {
  _drawing = false;
  try { sigCanvas.releasePointerCapture?.(e.pointerId); } catch {}
}

function clearSignature() {
  if (!_sigCtx || !sigCanvas) return;
  const rect = sigCanvas.getBoundingClientRect();
  _sigCtx.clearRect(0, 0, rect.width, rect.height);
  _hasStroke = false;
}

async function submitSignature() {
  if (!_quoteRow) return;
  if (!_hasStroke) {
    showBanner("Please draw your signature first.");
    return;
  }

  sigSubmitBtn.disabled = true;
  sigSubmitBtn.textContent = "Submitting…";
  showBanner("");

  try {
    // Use the canvas pixels (hi-res) as a PNG data URL
    const dataUrl = sigCanvas.toDataURL("image/png");

    const accepted_date = ymdTodayLocal();

    await postJSON("/api/accept-quote", {
      quote_id: _quoteRow.id,
      signature_data_url: dataUrl,
      accepted_date,
    });

    // Optimistic UI (instant feedback) — we'll re-fetch right after.
    try {
      if (!_quoteData) _quoteData = {};
      _quoteData.acceptance = {
        accepted_at: new Date().toISOString(),
        accepted_date,
        signature_data_url: dataUrl,
        name:
          safeStr(_quoteData?.bill_to?.client_name) ||
          safeStr(_quoteRow?.customer_name) ||
          "Client",
      };
      _quoteRow = { ..._quoteRow, status: "signed", data: _quoteData };
      fillQuote(_quoteRow);
    } catch {}

    // Re-fetch (ensures we render server truth)
    const refreshed = await getJSON(`/api/public-quote?id=${encodeURIComponent(_quoteRow.id)}`);
    _quoteRow = refreshed.quote;
    _quoteData = _quoteRow.data || {};

    fillQuote(_quoteRow);

    closeSigModal();

    showBanner("Signed. Thank you — you can download a PDF copy any time.");

    // Scroll back to top for clarity
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    showBanner(e?.message || "Failed to submit signature.");
  } finally {
    sigSubmitBtn.disabled = false;
    sigSubmitBtn.textContent = "Sign & Accept";
  }
}

/* =========================================================
   PDF Export (manual, clean, no extra blank pages)
   ========================================================= */
const PX_PER_IN = 96;
const PAGE_W_CSS = Math.round(8.5 * PX_PER_IN); // 816
const PAGE_H_CSS = Math.round(11 * PX_PER_IN);  // 1056

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src;
    s.defer = true;
    s.onload = res;
    s.onerror = () => rej(new Error("Failed to load " + src));
    document.head.appendChild(s);
  });
}

async function ensurePdfLibs() {
  if (!window.html2canvas) {
    await loadScript("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js");
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    await loadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
  }
}

async function waitForAssets(root, timeoutMs = 8000) {
  const waitFonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  const imgs = Array.from(root.querySelectorAll("img"));
  const imgPromises = imgs.map(
    (img) =>
      new Promise((resolve) => {
        if (img.complete && img.naturalWidth > 0) return resolve();
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      })
  );
  const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  await Promise.race([Promise.all([waitFonts, Promise.all(imgPromises)]), timeout]);
}

function createPdfSandbox() {
  const sandbox = document.createElement("div");
  sandbox.id = "pdf-sandbox";
  // Keep it rendered (so html2canvas can measure/layout) but far off-screen.
  sandbox.style.position = "fixed";
  sandbox.style.left = "-12000px";
  sandbox.style.top = "0";
  sandbox.style.opacity = "1";
  sandbox.style.pointerEvents = "none";
  sandbox.style.background = "#ffffff";
  sandbox.style.width = `${PAGE_W_CSS}px`;
  sandbox.style.minHeight = `${PAGE_H_CSS}px`;
  sandbox.style.zIndex = "-1";
  document.body.appendChild(sandbox);
  return sandbox;
}

function computeCutPositionsCss(clone, idealPageHeightCss) {
  // Cut only at bottoms of major blocks (cards/header/signatures) and table-row boundaries.
  // This keeps sections intact (no mid-card splits) and mirrors the admin PDF behavior.

  const rootRect = clone.getBoundingClientRect();
  const selectors = [
    ".doc-header",
    ".grid-2",
    ".card",
    ".signatures",
    ".table-wrap",
    ".items-table",
    ".avoid-break",
  ];

  const bottoms = new Set([0]);
  selectors.forEach((sel) => {
    clone.querySelectorAll(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      const bottom = Math.round(r.bottom - rootRect.top);
      if (bottom > 0) bottoms.add(bottom);
    });
  });

  // Prefer splitting big line-item tables by row.
  clone.querySelectorAll(".items-table tbody tr").forEach((tr) => {
    const r = tr.getBoundingClientRect();
    const bottom = Math.round(r.bottom - rootRect.top);
    if (bottom > 0) bottoms.add(bottom);
  });

  const sorted = Array.from(bottoms).sort((a, b) => a - b);
  const docHeight = Math.max(sorted[sorted.length - 1] || 0, Math.round(clone.scrollHeight || 0));

  const cuts = [];
  let y = 0;
  const minStep = 140; // avoid tiny pages, but allow tight pagination
  const maxPages = 80;

  while (y + 5 < docHeight && cuts.length < maxPages) {
    const target = y + idealPageHeightCss;
    if (target >= docHeight) {
      cuts.push(docHeight);
      break;
    }

    let candidate = null;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const b = sorted[i];
      if (b <= y + minStep) continue;
      if (b <= target) {
        candidate = b;
        break;
      }
    }
    if (!candidate || candidate <= y) candidate = target;

    cuts.push(candidate);
    y = candidate;
  }

  if (!cuts.length) cuts.push(docHeight);
  if (cuts[cuts.length - 1] !== docHeight) cuts.push(docHeight);

  return cuts;
}

async function fetchAsDataUrl(url) {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`Failed to fetch asset (${res.status})`);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function inlineImagesForPdf(root) {
  // Helps html2canvas reliably include remote logos/signatures across browsers.
  const imgs = Array.from(root.querySelectorAll("img"));
  for (const img of imgs) {
    try {
      if (img.hidden) continue;
      const src = img.getAttribute("src") || "";
      if (!src) continue;
      if (src.startsWith("data:")) continue;
      // Skip blob URLs (already local)
      if (src.startsWith("blob:")) continue;

      const dataUrl = await fetchAsDataUrl(src);
      img.setAttribute("src", dataUrl);
    } catch {
      // If it fails, keep the original src and let html2canvas attempt it.
      // If the logo still can't be embedded, show initials so the PDF isn't blank.
      if (img.id === "doc-logo") {
        const fallback = root.querySelector("#doc-logo-initials");
        if (fallback) {
          try { img.hidden = true; } catch {}
          fallback.hidden = false;
        }
      }
    }
  }
}

function buildPdfClone() {
  const clone = quotePageEl.cloneNode(true);
  clone.classList.add("pdf-export");

  // Hard-pin dimensions to avoid drift
  clone.style.width = `${PAGE_W_CSS}px`;
  clone.style.minHeight = `${PAGE_H_CSS}px`;
  clone.style.margin = "0";
  clone.style.boxShadow = "none";
  clone.style.border = "0";
  clone.style.borderRadius = "0";
  clone.style.background = "#ffffff";
  clone.style.boxSizing = "border-box";

  return clone;
}

async function exportPdfManual() {
  if (!quotePageEl || quotePageEl.hidden) return;

  downloadBtn.disabled = true;
  downloadBtn.textContent = "Preparing…";

  try {
    await ensurePdfLibs();

    const sandbox = createPdfSandbox();

    // Wrap in a clipping frame so we can render one page slice at a time.
    // This avoids giant canvases that can truncate on mobile (iOS/Android).
    const frame = document.createElement("div");
    frame.style.width = `${PAGE_W_CSS}px`;
    frame.style.background = "#ffffff";
    frame.style.overflow = "hidden";
    frame.style.boxSizing = "border-box";
    sandbox.appendChild(frame);

    const clone = buildPdfClone();
    frame.appendChild(clone);

    await waitForAssets(clone);

    // Inline remote images (logos/signatures) to avoid missing assets in PDFs.
    await inlineImagesForPdf(clone);
    await waitForAssets(clone);

    const scale = 2;

    // Use a real Letter PDF (pt units) to match the admin output and avoid cropping issues.
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "letter" });

    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();
    const marginPt = 22;
    const contentW = pdfW - marginPt * 2;
    const contentH = pdfH - marginPt * 2;

    // How tall (in CSS px) a page can be when we scale it to `contentW`.
    const idealPageHeightCss = Math.floor(PAGE_W_CSS * (contentH / contentW));

    // Compute cut points in CSS pixels.
    const cuts = computeCutPositionsCss(clone, idealPageHeightCss);
    const pages = [0, ...cuts];

    for (let i = 0; i < pages.length - 1; i++) {
      const y0 = pages[i];
      const y1 = pages[i + 1];
      const sliceH = y1 - y0;
      if (sliceH < 18) continue;

      frame.style.height = `${sliceH}px`;
      clone.style.transform = `translateY(-${y0}px)`;
      clone.style.transformOrigin = "top left";

      // Let layout settle for a frame (important for some mobile browsers).
      await new Promise((r) => requestAnimationFrame(() => r()));

      const canvas = await window.html2canvas(frame, {
        scale,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        windowWidth: 1200, // force desktop layout for PDF (prevents mobile-stacked header)
        windowHeight: sliceH,
        scrollX: 0,
        scrollY: 0,
      });

      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      const imgHpt = (canvas.height / canvas.width) * contentW;

      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", marginPt, marginPt, contentW, imgHpt);
    }

    // Cleanup
    clone.style.transform = "";
    try { sandbox.remove(); } catch {}

    const code = safeStr($("#v-doc-quote-code")?.textContent) || "quote";
    pdf.save(`${code}.pdf`);
  } catch (e) {
    console.error(e);
    showBanner(e?.message || "Failed to export PDF.");
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.textContent = "Download PDF";
  }
}

/* =========================================================
   Boot
   ========================================================= */
async function init() {
  try {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) {
      showBanner("Missing quote link. Please open the link from your email.");
      loadingEl.hidden = true;
      return;
    }

    // Wire buttons
    downloadBtn?.addEventListener("click", exportPdfManual);

    acceptJumpBtn?.addEventListener("click", () => {
      if (acceptSectionEl && !acceptSectionEl.hidden) {
        acceptSectionEl.scrollIntoView({ behavior: "smooth", block: "start" });
        // Give a small hint (focus)
        setTimeout(() => signNowBtn?.focus?.(), 250);
      }
    });

    signNowBtn?.addEventListener("click", openSigModal);

    sigCloseBtn?.addEventListener("click", closeSigModal);
    sigModal?.addEventListener("click", (e) => {
      if (e.target === sigModal) closeSigModal();
    });

    sigClearBtn?.addEventListener("click", clearSignature);
    sigSubmitBtn?.addEventListener("click", submitSignature);

    window.addEventListener("resize", () => {
      if (!sigModal?.hidden) setupCanvas();
    });

    // Canvas drawing events
    sigCanvas?.addEventListener("pointerdown", onPointerDown);
    sigCanvas?.addEventListener("pointermove", onPointerMove);
    sigCanvas?.addEventListener("pointerup", onPointerUp);
    sigCanvas?.addEventListener("pointercancel", onPointerUp);

    // Fetch quote (PUBLIC endpoint — no auth required)
    const out = await getJSON(`/api/public-quote?id=${encodeURIComponent(id)}`);
    _quoteRow = out.quote;
    _quoteData = _quoteRow.data || {};

    loadingEl.hidden = true;
    quotePageEl.hidden = false;

    fillQuote(_quoteRow);

    // Show acceptance section if needed
    const acceptance = _quoteData?.acceptance;
    const status = safeStr(_quoteRow.status).toLowerCase();
    if (!acceptance?.accepted_at && status !== "cancelled") {
      acceptSectionEl.hidden = false;
      $("#accept-pill").textContent = "Ready";
    } else if (acceptance?.accepted_at) {
      acceptSectionEl.hidden = true;
    }

    // If accepted, ensure header CTA reflects it
    if (acceptance?.accepted_at && acceptJumpBtn) {
      acceptJumpBtn.disabled = true;
      acceptJumpBtn.textContent = "Signed";
    }

  } catch (e) {
    console.error(e);
    loadingEl.hidden = true;
    showBanner(e?.message || "Failed to load quote.");
  }
}

init();
