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
const acceptBtn = $("#accept-jump-btn"); // header CTA
const signNowBtn = $("#sign-now-btn");   // in-page CTA (optional)

const vQuoteCode = $("#v-quote-code");
const vQuoteStatus = $("#v-quote-status");
const vDocQuoteCode = $("#v-doc-quote-code");

// Signature modal
const sigModal = $("#sig-modal");
const sigCanvas = $("#sig-canvas");
const sigCloseBtn = $("#sig-close");
const sigClearBtn = $("#sig-clear");
const sigSubmitBtn = $("#sig-submit");
const sigNameEl = $("#sig-name");

// Signature output on document
const clientSigImg = $("#v-client-signature-img");

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

function money(cents) {
  const n = (Number(cents) || 0) / 100;
  return n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function moneyWithSymbol(cents) {
  const n = (Number(cents) || 0) / 100;
  return n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}
function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("en-CA", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return iso;
  }
}

async function getJSON(url) {
  const res = await fetch(url, { method: "GET" });
  let data = null;
  try { data = await res.json(); } catch {}
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
  try { data = await res.json(); } catch {}
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

/* =========================================================
   Render quote (read-only)
   ========================================================= */
function buildItemsRows(items = []) {
  const tbody = $("#v-item-rows");
  tbody.innerHTML = "";

  if (!items.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" style="padding:12px;color:#6b7280;">No line items</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const it of items) {
    const qty = Number(it.qty || 0);
    const rateC = Number(it.unit_price_cents || 0);
    const taxable = !!it.taxable;
    const lineTotal = Math.round(qty * rateC);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><div style="padding:10px;white-space:pre-wrap;">${escapeHtml(it.description || "")}</div></td>
      <td class="num"><div style="padding:10px;">${qty || ""}</div></td>
      <td class="num"><div style="padding:10px;">$${money(rateC)}</div></td>
      <td class="center"><div style="padding:10px;">${taxable ? "✓" : "—"}</div></td>
      <td class="num"><div style="padding:10px;font-weight:950;">$${money(lineTotal)}</div></td>
    `;
    tbody.appendChild(tr);
  }
}

function fillQuote(quote) {
  const data = quote.data || {};
  const company = data.company || {};
  const meta = data.meta || {};
  const bill = data.bill_to || {};
  const project = data.project || {};
  const computed = data.computed || {};

  const quoteCode = data.quote_code || quote.quote_code || meta.quote_no || quote.quote_no || quote.code || "—";

  // Header / status
  vQuoteCode.textContent = quoteCode;
  vDocQuoteCode.textContent = quoteCode;
  vQuoteStatus.textContent = quote.status || "Quote";

  // Company
  $("#v-company-name").textContent = company.name || "Endura Metal Roofing Ltd.";
  const addr = [company.addr1, company.addr2].filter(Boolean).join(", ");
  $("#v-company-addr").textContent = addr || "";
  $("#v-company-phone").textContent = company.phone || "";
  $("#v-company-email").textContent = company.email || "";
  $("#v-company-web").textContent = company.web || "";

  // Meta
  $("#v-meta-quote").textContent = quoteCode;
  $("#v-meta-date").textContent = fmtDate(meta.quote_date);
  $("#v-meta-expires").textContent = fmtDate(meta.quote_expires);
  $("#v-meta-prepared").textContent = meta.prepared_by || "Jacob Docherty";

  // Bill / Job
  $("#v-bill-name").textContent = bill.client_name || quote.customer_name || "—";
  $("#v-bill-phone").textContent = bill.client_phone || "";
  $("#v-bill-email").textContent = bill.client_email || quote.customer_email || "";
  $("#v-bill-addr").textContent = bill.client_addr || "";
  $("#v-jobsite").textContent = project.project_location || "—";

  // Scope / Terms / Notes
  $("#v-scope").textContent = data.scope || "—";
  $("#v-terms").textContent = data.terms || "—";
  $("#v-notes").textContent = data.notes || "—";

  // Items
  buildItemsRows(Array.isArray(data.items) ? data.items : []);

  // Totals
  const subtotal = computed.subtotal_cents ?? quote.subtotal_cents ?? 0;
  const tax = computed.tax_cents ?? quote.tax_cents ?? 0;
  const fees = computed.fees_cents ?? data.fees_cents ?? quote.fees_cents ?? 0;
  const total = computed.total_cents ?? quote.total_cents ?? 0;

  $("#v-subtotal").textContent = money(subtotal);
  $("#v-tax").textContent = money(tax);
  $("#v-fees").textContent = money(fees);
  $("#v-total").textContent = money(total);

  // Deposit
  let depositCents = 0;
  if (data.deposit_mode === "custom") {
    depositCents = data.deposit_cents || 0;
  } else {
    depositCents = Math.round(total * 0.4);
  }
  $("#v-deposit").textContent = moneyWithSymbol(depositCents);

  // Rep date (use quote date)
  $("#v-rep-date").textContent = fmtDate(meta.quote_date);

  // Acceptance fields (if already accepted)
  const acceptance = data.acceptance || null;
  const sigImg = $("#v-client-signature-img");

  if (acceptance?.accepted_at) {
    const name = acceptance.name || bill.client_name || quote.customer_name || "Client";
    const dateIso = (acceptance.accepted_at || "").slice(0, 10);

    const src = acceptance.signature_image_data_url || acceptance.signature_data_url || "";
    if (sigImg && src) {
      sigImg.src = src;
      sigImg.hidden = false;
    }

    $("#v-client-name").textContent = name;
    $("#v-client-date").textContent = fmtDate(dateIso);

    $("#accept-pill").textContent = "Accepted";
  } else {
    if (sigImg) {
      sigImg.src = "";
      sigImg.hidden = true;
    }
    $("#v-client-name").textContent = "";
    $("#v-client-date").textContent = "";
  }
}

/* =========================================================
   PDF Export (manual, clean, no extra blank pages)
   ========================================================= */
const PX_PER_IN = 96;
const PAGE_W_CSS = Math.round(8.5 * PX_PER_IN); // 816
const PAGE_H_CSS = Math.round(11  * PX_PER_IN); // 1056

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
  sandbox.style.position = "absolute";
  sandbox.style.left = "0";
  sandbox.style.top = "0";
  sandbox.style.opacity = "0";
  sandbox.style.pointerEvents = "none";
  sandbox.style.background = "#ffffff";
  sandbox.style.width = `${PAGE_W_CSS}px`;
  sandbox.style.minHeight = `${PAGE_H_CSS}px`;
  document.body.appendChild(sandbox);
  return sandbox;
}

function computeCutPositionsPx(clone, scaleFactor, idealPageHeightPxCanvas) {
  const selectors = [".doc-header", ".grid-2", ".card", ".signatures", ".table-wrap", ".items-table", ".avoid-break"];
  const rect = clone.getBoundingClientRect();

  const bottomsCss = new Set([0]);
  selectors.forEach((sel) => {
    clone.querySelectorAll(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      const bottomCss = r.bottom - rect.top;
      if (bottomCss > 0) bottomsCss.add(Math.round(bottomCss));
    });
  });

  const bottomsCanvas = Array.from(bottomsCss)
    .map((css) => Math.round(css * scaleFactor))
    .sort((a, b) => a - b);

  const maxBottom = bottomsCanvas[bottomsCanvas.length - 1] || Math.round(clone.offsetHeight * scaleFactor);

  const cuts = [];
  let y = 0;
  const minStep = Math.round(220 * scaleFactor);

  while (y + 1 < maxBottom) {
    const target = y + idealPageHeightPxCanvas;
    let candidate = Math.min(target, maxBottom);

    for (let i = bottomsCanvas.length - 1; i >= 0; i--) {
      const b = bottomsCanvas[i];
      if (b <= target && b > y + minStep) {
        candidate = b;
        break;
      }
    }

    if (candidate <= y) candidate = Math.min(y + idealPageHeightPxCanvas, maxBottom);
    cuts.push(candidate);
    y = candidate;

    if (maxBottom - y <= 5) break;
  }

  return cuts;
}

function buildPdfClone() {
  const clone = quotePageEl.cloneNode(true);

  // Remove screen-only controls
  clone.querySelectorAll(".no-print").forEach((n) => n.remove());

  // Hard-pin dimensions to avoid layout drift
  clone.style.width = `${PAGE_W_CSS}px`;
  clone.style.minHeight = `${PAGE_H_CSS}px`;
  clone.style.margin = "0";
  clone.style.boxShadow = "none";
  clone.style.border = "0";
  clone.style.borderRadius = "0";
  clone.style.background = "#ffffff";
  clone.style.boxSizing = "border-box";
  // Consistent padding for PDF regardless of screen size
  clone.style.padding = "0.62in";

  // Force “desktop” layout even though width is 816 (prevents mobile stacking)
  const style = document.createElement("style");
  style.textContent = `
    .letterhead{ grid-template-columns: 150px 1fr !important; }
    .company-row{ flex-direction: row !important; }
    .doc-block{ align-items: flex-end !important; }
    .meta-strip{ grid-template-columns: 1.4fr 1fr 1fr 1.2fr !important; }
    .grid-2{ grid-template-columns: 1.25fr 0.75fr !important; }
    .signatures{ grid-template-columns: 1fr 1fr !important; }
  `;
  clone.prepend(style);

  return clone;
}

async function exportPdfManual({ filename }) {
  await ensurePdfLibs();

  const sandbox = createPdfSandbox();
  sandbox.innerHTML = "";

  const clone = buildPdfClone();
  sandbox.appendChild(clone);

  await waitForAssets(clone);

  const scale = 2;
  const canvas = await window.html2canvas(clone, {
    scale,
    useCORS: true,
    allowTaint: true,
    backgroundColor: "#ffffff",
    scrollX: 0,
    scrollY: 0,
    windowWidth: PAGE_W_CSS,
  });

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });

  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();

  const marginPt = 22;
  const contentW = pdfW - marginPt * 2;
  const contentH = pdfH - marginPt * 2;

  const canvasW = canvas.width;
  const canvasH = canvas.height;

  const scaleFactor = canvasW / clone.offsetWidth;
  const idealPageHeightPxCanvas = Math.floor(canvasW * (contentH / contentW));
  const cuts = computeCutPositionsPx(clone, scaleFactor, idealPageHeightPxCanvas);

  const contentEnd = cuts.length ? cuts[cuts.length - 1] : canvasH;
  const midCuts = cuts.length > 1 ? cuts.slice(0, -1) : [];

  const boundaries = [0, ...midCuts, contentEnd]
    .map((v) => Math.max(0, Math.min(v, canvasH)))
    .filter((v, i, arr) => i === 0 || v > arr[i - 1] + 2);

  const pageCanvas = document.createElement("canvas");
  pageCanvas.width = canvasW;

  let pageIndex = 0;

  for (let i = 1; i < boundaries.length; i++) {
    const prev = boundaries[i - 1];
    const next = boundaries[i];
    const sliceH = next - prev;

    if (sliceH < Math.round(24 * scale)) continue;

    pageCanvas.height = sliceH;
    const ctx = pageCanvas.getContext("2d", { alpha: false });

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasW, sliceH);

    ctx.drawImage(canvas, 0, prev, canvasW, sliceH, 0, 0, canvasW, sliceH);

    const imgData = pageCanvas.toDataURL("image/jpeg", 0.98);
    const imgHpt = (sliceH / canvasW) * contentW;

    if (pageIndex > 0) pdf.addPage();

    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, pdfW, pdfH, "F");

    pdf.addImage(imgData, "JPEG", marginPt, marginPt, contentW, imgHpt);

    pageIndex++;
  }

  pdf.save(filename);
  sandbox.remove();
}

/* =========================================================
   Signature modal (drawpad)
   ========================================================= */
let sigCtx = null;
let sigDrawing = false;
let sigHasInk = false;

function openSigModal({ customerName }) {
  if (!sigModal) return;
  if (sigNameEl) sigNameEl.textContent = customerName || "Client";
  sigModal.hidden = false;
  document.body.style.overflow = "hidden";

  // Wait one frame so layout is updated before measuring canvas size
  requestAnimationFrame(() => {
    setupSignaturePad();
  });
}

function closeSigModal() {
  if (!sigModal) return;
  sigModal.hidden = true;
  document.body.style.overflow = "";
}

function setupSignaturePad() {
  if (!sigCanvas) return;

  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const rect = sigCanvas.getBoundingClientRect();

  sigCanvas.width = Math.round(rect.width * ratio);
  sigCanvas.height = Math.round(rect.height * ratio);

  sigCtx = sigCanvas.getContext("2d");
  sigCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  sigCtx.lineWidth = 2.2;
  sigCtx.lineCap = "round";
  sigCtx.lineJoin = "round";
  sigCtx.strokeStyle = "#111827";

  clearSignature();
}

function clearSignature() {
  if (!sigCtx || !sigCanvas) return;
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  sigHasInk = false;
}

function sigPoint(e) {
  const rect = sigCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onSigPointerDown(e) {
  if (!sigCtx) return;
  sigDrawing = true;
  sigHasInk = true;
  sigCanvas.setPointerCapture?.(e.pointerId);
  const p = sigPoint(e);
  sigCtx.beginPath();
  sigCtx.moveTo(p.x, p.y);
}
function onSigPointerMove(e) {
  if (!sigDrawing || !sigCtx) return;
  const p = sigPoint(e);
  sigCtx.lineTo(p.x, p.y);
  sigCtx.stroke();
}
function onSigPointerUp(e) {
  sigDrawing = false;
  try { sigCanvas.releasePointerCapture?.(e.pointerId); } catch {}
}

/* =========================================================
   Boot
   ========================================================= */
async function main() {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) {
    showBanner("Missing quote id.");
    loadingEl.textContent = "Missing quote id.";
    return;
  }

  try {
    const result = await getJSON(`/api/public-quote?id=${encodeURIComponent(id)}`);
    const quote = result.quote;

    fillQuote(quote);

    // Determine customer name (for modal + printed name)
    const customerName =
      (quote.data?.bill_to?.client_name || quote.customer_name || "Client").trim();

    // Show UI
    loadingEl.hidden = true;
    quotePageEl.hidden = false;

    const isCancelled = (quote.status || "").toLowerCase() === "cancelled";
    const isAccepted =
      (quote.status || "").toLowerCase() === "accepted" ||
      !!quote.data?.acceptance?.accepted_at;

    if (isCancelled) {
      acceptSectionEl.hidden = true;
      showBanner("This quote has been cancelled.");
    } else {
      acceptSectionEl.hidden = false;
    }

    // Buttons
    downloadBtn.addEventListener("click", async () => {
      downloadBtn.disabled = true;
      try {
        const code = (quote.data?.quote_code || "Quote").replace(/[^\w\-]+/g, "_");
        const filename = `Endura_${code}.pdf`;
        await exportPdfManual({ filename });
      } finally {
        downloadBtn.disabled = false;
      }
    });

    function openIfAllowed() {
      if (isCancelled || isAccepted) return;
      openSigModal({ customerName });
    }

    acceptBtn.addEventListener("click", openIfAllowed);
    signNowBtn?.addEventListener("click", openIfAllowed);

    // Modal close handlers
    sigCloseBtn?.addEventListener("click", closeSigModal);
    sigModal?.addEventListener("click", (e) => {
      if (e.target === sigModal) closeSigModal();
    });

    // Signature pad handlers
    if (sigCanvas) {
      sigCanvas.onpointerdown = onSigPointerDown;
      sigCanvas.onpointermove = onSigPointerMove;
      sigCanvas.onpointerup = onSigPointerUp;
      sigCanvas.onpointercancel = onSigPointerUp;
      sigCanvas.onpointerleave = onSigPointerUp;
    }

    sigClearBtn?.addEventListener("click", clearSignature);

    sigSubmitBtn?.addEventListener("click", async () => {
      if (isCancelled || isAccepted) return;

      if (!sigHasInk) {
        showBanner("Please draw your signature to continue.");
        return;
      }

      sigSubmitBtn.disabled = true;
      sigClearBtn.disabled = true;
      sigCloseBtn.disabled = true;
      $("#accept-pill").textContent = "Sending…";
      showBanner("");

      try {
        const signature_data_url = sigCanvas.toDataURL("image/png");

        const out = await postJSON("/api/accept-quote", {
          quote_id: id,
          signature_data_url,
        });

        // Update doc signature fields
        if (clientSigImg) {
          clientSigImg.src = signature_data_url;
          clientSigImg.hidden = false;
        }

        $("#v-client-name").textContent = customerName || "Client";
        $("#v-client-date").textContent = fmtDate(out.accepted_at.slice(0, 10));

        vQuoteStatus.textContent = "Accepted";
        $("#accept-pill").textContent = "Accepted";

        // lock CTAs
        acceptBtn.disabled = true;
        if (signNowBtn) signNowBtn.disabled = true;

        closeSigModal();
        showBanner("Accepted. Thank you — we’ll be in touch to schedule the next steps.");
      } catch (e) {
        $("#accept-pill").textContent = "Ready";
        showBanner(e?.message || "Acceptance failed.");
      } finally {
        sigSubmitBtn.disabled = false;
        sigClearBtn.disabled = false;
        sigCloseBtn.disabled = false;
      }
    });

    // If already accepted, lock CTAs
    if (isAccepted) {
      $("#accept-pill").textContent = "Accepted";
      acceptBtn.disabled = true;
      if (signNowBtn) signNowBtn.disabled = true;
    }

    // Ensure modal canvas scales properly when device rotates
    window.addEventListener("resize", () => {
      if (sigModal && !sigModal.hidden) setupSignaturePad();
    });
  } catch (e) {
    console.error(e);
    showBanner(e?.message || "Failed to load quote.");
    loadingEl.textContent = "Failed to load quote.";
  }
}

main();
