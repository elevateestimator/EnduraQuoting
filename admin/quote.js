import { requireAdminOrRedirect } from "../js/adminGuard.js";
import { getQuote, updateQuote } from "../js/quotesApi.js";
import { DEFAULT_COMPANY, makeDefaultQuoteData, formatQuoteCode } from "../js/quoteDefaults.js";

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

/** Letter size in CSS pixels @ 96dpi */
const PX_PER_IN = 96;
const PAGE_W_CSS = Math.round(8.5 * PX_PER_IN); // 816
const PAGE_H_CSS = Math.round(11 * PX_PER_IN);  // 1056

const backBtn = $("#back-btn");
const saveBtn = $("#save-btn");
const pdfBtn  = $("#pdf-btn");

const msgEl = $("#msg");
const quoteCodeEl = $("#quote-code");
const quoteStatusEl = $("#quote-status");

const itemRowsEl = $("#item-rows");
const addItemBtn = $("#add-item");

const subtotalEl = $("#subtotal");
const taxAmountEl = $("#tax-amount");
const grandTotalEl = $("#grand-total");

const taxRateEl = $("#tax-rate");
const feesEl = $("#fees");
const depositDueEl = $("#deposit-due");

const repDateEl = $("#rep-date");

// Client acceptance (signature captured on customer page)
const clientSigImg = $("#client-signature-img");
const clientSignedNameEl = $("#client-signed-name");
const clientSignedDateEl = $("#client-signed-date");
const quoteDateInput = $('[data-bind="quote_date"]');

const quotePageEl = $("#quote-page");

function showMsg(text) {
  if (!text) {
    msgEl.hidden = true;
    msgEl.textContent = "";
    return;
  }
  msgEl.hidden = false;
  msgEl.textContent = text;
}

/* ===== Money helpers ===== */
function parseMoneyToCents(value) {
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}
function centsToMoney(cents) {
  const dollars = (Number(cents) || 0) / 100;
  return dollars.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function parseNum(value) {
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function getDepositMode() {
  return $$('input[name="deposit_mode"]').find((r) => r.checked)?.value || "auto";
}

/* ===== Autosize textareas ===== */
function autosizeTextarea(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 2}px`;
}
function wireAutosize(selector) {
  const el = $(selector);
  if (!el) return;
  const run = () => autosizeTextarea(el);
  el.addEventListener("input", run);
  run();
  requestAnimationFrame(run);
}
function autosizeAll() {
  wireAutosize('[data-bind="scope"]');
  wireAutosize('[data-bind="terms"]');
  wireAutosize('[data-bind="notes"]');
}

/* ===== Rep signature date ===== */
function formatDateDisplay(iso) {
  if (!iso) return "";
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
function syncRepDateFromQuoteDate() {
  if (!repDateEl) return;
  const iso = quoteDateInput?.value || "";
  repDateEl.textContent = formatDateDisplay(iso);
}


/* ===== Client acceptance (if signed) ===== */
function renderClientAcceptance(data, qRow) {
  const acc = data?.acceptance || null;
  if (!clientSigImg || !clientSignedNameEl || !clientSignedDateEl) return;

  if (acc?.accepted_at) {
    const name = (acc.name || data?.bill_to?.client_name || qRow?.customer_name || "Client").trim();
    const dateIso = String(acc.accepted_at).slice(0, 10);
    const src = acc.signature_image_data_url || acc.signature_data_url || "";
    if (src) {
      clientSigImg.src = src;
      clientSigImg.hidden = false;
    } else {
      clientSigImg.src = "";
      clientSigImg.hidden = true;
    }
    clientSignedNameEl.textContent = name;
    clientSignedDateEl.textContent = formatDateDisplay(dateIso);
  } else {
    clientSigImg.src = "";
    clientSigImg.hidden = true;
    clientSignedNameEl.textContent = "";
    clientSignedDateEl.textContent = "";
  }
}

/* ===== Company text ===== */
function setCompanyText() {
  $('[data-company="name"]').textContent = DEFAULT_COMPANY.name;
  $('[data-company="addr1"]').textContent = DEFAULT_COMPANY.addr1;
  $('[data-company="addr2"]').textContent = DEFAULT_COMPANY.addr2;
  $('[data-company="phone"]').textContent = DEFAULT_COMPANY.phone;
  $('[data-company="email"]').textContent = DEFAULT_COMPANY.email;
  $('[data-company="web"]').textContent = DEFAULT_COMPANY.web;
}

function setBoundValue(key, val) {
  const el = document.querySelector(`[data-bind="${key}"]`);
  if (!el) return;
  el.value = val ?? "";
}
function getBoundValue(key) {
  const el = document.querySelector(`[data-bind="${key}"]`);
  if (!el) return "";
  return (el.value ?? "").trim();
}

/* ===== Items (NO "Item" column) ===== */
function buildItemRow(item = {}) {
  const tr = document.createElement("tr");
  tr.className = "item-row avoid-break";
  tr.innerHTML = `
    <td><textarea rows="2" class="i-desc" placeholder="Description">${item.description ?? ""}</textarea></td>
    <td class="num"><input type="text" class="i-qty" inputmode="decimal" value="${item.qty ?? 1}"></td>
    <td class="num"><input type="text" class="i-price" inputmode="decimal" value="${centsToMoney(item.unit_price_cents ?? 0)}"></td>
    <td class="center"><input type="checkbox" class="i-tax" ${item.taxable ? "checked" : ""}></td>
    <td class="line-total"><span>$0.00</span></td>
    <td class="no-print slim"><button class="btn small" type="button" data-action="remove">✕</button></td>
  `;

  tr.querySelectorAll("input, textarea").forEach((el) => {
    el.addEventListener("input", () => recalcTotals());
    el.addEventListener("change", () => recalcTotals());
  });

  tr.querySelector('[data-action="remove"]').addEventListener("click", () => {
    tr.remove();
    if (!itemRowsEl.children.length) itemRowsEl.appendChild(buildItemRow());
    recalcTotals();
  });

  return tr;
}

function getItemsFromUI() {
  const rows = $$(".item-row", itemRowsEl);
  return rows.map((row) => {
    const description = $(".i-desc", row).value.trim();
    const qty = Math.max(0, parseNum($(".i-qty", row).value));
    const unit_price_cents = Math.max(0, parseMoneyToCents($(".i-price", row).value));
    const taxable = $(".i-tax", row).checked;
    return { description, qty, unit_price_cents, taxable };
  });
}

function writeLineTotals(items) {
  const rows = $$(".item-row", itemRowsEl);
  items.forEach((it, idx) => {
    const line = Math.round((it.qty || 0) * (it.unit_price_cents || 0));
    const cell = rows[idx]?.querySelector(".line-total span");
    if (cell) cell.textContent = `$${centsToMoney(line)}`;
  });
}

function recalcTotals() {
  const items = getItemsFromUI();

  let subtotal = 0;
  let taxableBase = 0;

  for (const it of items) {
    const line = Math.round((it.qty || 0) * (it.unit_price_cents || 0));
    subtotal += line;
    if (it.taxable) taxableBase += line;
  }

  writeLineTotals(items);

  const taxRate = parseNum(taxRateEl.value);
  const tax = Math.round(taxableBase * (taxRate / 100));

  const fees = parseMoneyToCents(feesEl.value);
  const grand = Math.max(0, subtotal + tax + fees);

  subtotalEl.textContent = centsToMoney(subtotal);
  taxAmountEl.textContent = centsToMoney(tax);
  grandTotalEl.textContent = centsToMoney(grand);

  const mode = getDepositMode();
  if (mode === "auto") {
    const dep = Math.round(grand * 0.4);
    depositDueEl.value = `$${centsToMoney(dep)}`;
    depositDueEl.setAttribute("readonly", "readonly");
  } else {
    depositDueEl.removeAttribute("readonly");
  }

  return { subtotal_cents: subtotal, tax_cents: tax, fees_cents: fees, total_cents: grand };
}

/* ===== Merge defaults ===== */
function mergeDefaults(existing, fallback) {
  const out = (typeof structuredClone === "function")
    ? structuredClone(fallback)
    : JSON.parse(JSON.stringify(fallback));

  const e = existing || {};
  for (const k of Object.keys(e)) out[k] = e[k];

  out.company = { ...fallback.company, ...(e.company || {}) };
  out.meta = { ...fallback.meta, ...(e.meta || {}) };
  out.bill_to = { ...fallback.bill_to, ...(e.bill_to || {}) };
  out.project = { ...fallback.project, ...(e.project || {}) };

  // normalize legacy item structure
  if (Array.isArray(out.items)) {
    out.items = out.items.map((it) => ({
      description: it.description ?? it.desc ?? it.item ?? "",
      qty: it.qty ?? 1,
      unit_price_cents: it.unit_price_cents ?? 0,
      taxable: typeof it.taxable === "boolean" ? it.taxable : true,
    }));
  }

  return out;
}

function fillUIFromData(qRow, data) {
  setCompanyText();

  const quoteCode = formatQuoteCode(qRow.quote_no, data.meta.quote_date);
  quoteCodeEl.textContent = quoteCode;
  quoteStatusEl.textContent = qRow.status || "Draft";

  setBoundValue("quote_no", quoteCode);
  setBoundValue("quote_date", data.meta.quote_date);
  setBoundValue("quote_expires", data.meta.quote_expires);
  setBoundValue("prepared_by", data.meta.prepared_by);

  setBoundValue("client_name", data.bill_to.client_name);
  setBoundValue("client_phone", data.bill_to.client_phone);
  setBoundValue("client_email", data.bill_to.client_email);
  setBoundValue("client_addr", data.bill_to.client_addr);

  setBoundValue("project_location", data.project.project_location);

  setBoundValue("scope", data.scope);
  setBoundValue("terms", data.terms);
  setBoundValue("notes", data.notes);

  taxRateEl.value = String(data.tax_rate ?? 13);
  feesEl.value = centsToMoney(data.fees_cents ?? 0);

  const mode = data.deposit_mode || "auto";
  $$('input[name="deposit_mode"]').forEach((r) => (r.checked = r.value === mode));
  if (mode === "custom") {
    depositDueEl.value = `$${centsToMoney(data.deposit_cents ?? 0)}`;
    depositDueEl.removeAttribute("readonly");
  }

  itemRowsEl.innerHTML = "";
  const items = Array.isArray(data.items) && data.items.length
    ? data.items
    : [{ description: "", qty: 1, unit_price_cents: 0, taxable: true }];

  for (const it of items) itemRowsEl.appendChild(buildItemRow(it));

  recalcTotals();
  autosizeAll();
  syncRepDateFromQuoteDate();
  renderClientAcceptance(data, qRow);
}

function collectDataFromUI(qRow, existingAcceptance = null) {
  const totals = recalcTotals();

  const meta = {
    quote_date: getBoundValue("quote_date"),
    quote_expires: getBoundValue("quote_expires"),
    prepared_by: getBoundValue("prepared_by"),
  };

  const bill_to = {
    client_name: getBoundValue("client_name"),
    client_phone: getBoundValue("client_phone"),
    client_email: getBoundValue("client_email"),
    client_addr: getBoundValue("client_addr"),
  };

  const project = {
    project_location: getBoundValue("project_location"),
  };

  const items = getItemsFromUI();

  const mode = getDepositMode();
  let deposit_cents = 0;
  if (mode === "custom") deposit_cents = parseMoneyToCents(depositDueEl.value);

  return {
    company: { ...DEFAULT_COMPANY },
    meta,
    bill_to,
    project,
    scope: getBoundValue("scope"),
    items,
    tax_rate: parseNum(taxRateEl.value) || 13,
    fees_cents: totals.fees_cents,
    deposit_mode: mode,
    deposit_cents,
    terms: getBoundValue("terms"),
    notes: getBoundValue("notes"),
    acceptance: existingAcceptance || undefined,
    computed: totals,
    quote_code: formatQuoteCode(qRow.quote_no, meta.quote_date),
  };
}

/* =========================================================
   PDF EXPORT (manual, no sideways drift)
   - html2canvas -> jsPDF
   - on-screen sandbox at (0,0) but opacity 0 (no negative-left)
   - slice pages between cards
   ========================================================= */

/* Load libs only if missing */
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

  // Remove screen-only controls (add/remove buttons etc.)
  clone.querySelectorAll(".no-print").forEach((n) => n.remove());

  // Hard-pin dimensions to avoid any “layout drift”
  clone.style.width = `${PAGE_W_CSS}px`;
  clone.style.minHeight = `${PAGE_H_CSS}px`;
  clone.style.margin = "0";
  clone.style.boxShadow = "none";
  clone.style.border = "0";
  clone.style.borderRadius = "0";
  clone.style.background = "#ffffff";
  clone.style.boxSizing = "border-box";
  clone.style.padding = getComputedStyle(quotePageEl).padding;

  // Replace inputs/textareas with plain blocks (clean PDF)
  clone.querySelectorAll("input, textarea, select").forEach((el) => {
    if (el.type === "checkbox") {
      const mark = document.createElement("span");
      mark.textContent = el.checked ? "✓" : "—";
      mark.style.display = "inline-block";
      mark.style.width = "100%";
      mark.style.textAlign = "center";
      el.parentNode.replaceChild(mark, el);
      return;
    }

    const inItems = !!el.closest(".items-table");
    const isArea = el.tagName === "TEXTAREA";

    const out = document.createElement("div");
    out.textContent = el.value ?? "";
    out.style.whiteSpace = "pre-wrap";
    out.style.display = "block";

    if (inItems) {
      out.style.padding = "10px";
    } else {
      out.style.border = "1px solid #d9dee8";
      out.style.borderRadius = "10px";
      out.style.padding = "10px 12px";
      out.style.background = "#ffffff";
      out.style.fontSize = "13px";
      out.style.color = "#0b0f14";
      if (!isArea) out.style.textAlign = "center";
    }

    el.parentNode.replaceChild(out, el);
  });

  // Fix items table colgroup after removing delete column
  const table = clone.querySelector(".items-table");
  if (table) {
    const cg = table.querySelector("colgroup");
    const thCount = table.tHead?.rows?.[0]?.children?.length ?? 0;
    if (cg && thCount > 0) {
      while (cg.children.length > thCount && cg.lastElementChild) {
        cg.removeChild(cg.lastElementChild);
      }
    }
    const wrap = table.closest(".table-wrap");
    if (wrap) wrap.style.overflow = "visible";
  }

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

  const pdfW = pdf.internal.pageSize.getWidth();  // 612
  const pdfH = pdf.internal.pageSize.getHeight(); // 792

  const marginPt = 26; // ~0.36"
  const contentW = pdfW - marginPt * 2;
  const contentH = pdfH - marginPt * 2;

  const canvasW = canvas.width;
  const canvasH = canvas.height;

  const scaleFactor = canvasW / clone.offsetWidth;
  const idealPageHeightPxCanvas = Math.floor(canvasW * (contentH / contentW));
  const cuts = computeCutPositionsPx(clone, scaleFactor, idealPageHeightPxCanvas);

  const boundaries = [0, ...cuts.filter((c) => c > 0 && c < canvasH), canvasH];

  const pageCanvas = document.createElement("canvas");
  pageCanvas.width = canvasW;

  let pageIndex = 0;

  for (let i = 1; i < boundaries.length; i++) {
    const prev = boundaries[i - 1];
    const next = boundaries[i];
    const sliceH = next - prev;

    pageCanvas.height = sliceH;
    const ctx = pageCanvas.getContext("2d", { alpha: false });

    // white background (prevents odd transparency)
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

/* ===== Main ===== */
async function main() {
  await requireAdminOrRedirect({ redirectTo: "../index.html" });

  const quoteId = new URLSearchParams(window.location.search).get("id");
  if (!quoteId) {
    window.location.href = "./dashboard.html";
    return;
  }

  showMsg("");

  let qRow;
  try {
    qRow = await getQuote(quoteId);
  } catch (e) {
    showMsg(e?.message || "Failed to load quote.");
    return;
  }

  const defaults = makeDefaultQuoteData({
    customer_name: qRow.customer_name,
    customer_email: qRow.customer_email,
  });

  const data = mergeDefaults(qRow.data, defaults);
  fillUIFromData(qRow, data);

  backBtn.addEventListener("click", () => {
    window.location.href = "./dashboard.html";
  });

  addItemBtn.addEventListener("click", () => {
    itemRowsEl.appendChild(buildItemRow({ description: "", qty: 1, unit_price_cents: 0, taxable: true }));
    recalcTotals();
  });

  taxRateEl.addEventListener("input", recalcTotals);
  feesEl.addEventListener("input", recalcTotals);
  $$('input[name="deposit_mode"]').forEach((r) => r.addEventListener("change", recalcTotals));

  quoteDateInput?.addEventListener("change", () => {
    syncRepDateFromQuoteDate();
  });

  async function saveNow() {
    // Preserve any customer acceptance signature so admin saves don't wipe it
    let existingAcceptance = qRow?.data?.acceptance || null;
    try {
      const latest = await getQuote(quoteId);
      existingAcceptance = latest?.data?.acceptance || existingAcceptance;
    } catch {}

    const payload = collectDataFromUI(qRow, existingAcceptance);

    if (!payload.bill_to.client_name) {
      showMsg("Customer name is required (Bill To).");
      return null;
    }

    showMsg("Saving…");

    const updated = await updateQuote(quoteId, {
      customer_name: payload.bill_to.client_name,
      customer_email: payload.bill_to.client_email || null,
      total_cents: payload.computed.total_cents,
      data: payload,
    });

    qRow = updated;
    quoteStatusEl.textContent = qRow.status || "Draft";
    quoteCodeEl.textContent = payload.quote_code;

    showMsg("Saved.");
    setTimeout(() => showMsg(""), 800);

    return { qRow, payload };
  }

  saveBtn.addEventListener("click", async () => {
    try {
      saveBtn.disabled = true;
      await saveNow();
    } catch (e) {
      showMsg(e?.message || "Save failed.");
    } finally {
      saveBtn.disabled = false;
    }
  });

  pdfBtn.addEventListener("click", async () => {
    try {
      pdfBtn.disabled = true;

      const saved = await saveNow();
      if (!saved) return;

      const { payload } = saved;

      const client = (payload.bill_to.client_name || "Client").replace(/[^\w\-]+/g, "_");
      const filename = `${client}_${payload.quote_code}.pdf`;

      await exportPdfManual({ filename });
    } catch (e) {
      console.error(e);
      showMsg("PDF export failed. Check console.");
    } finally {
      pdfBtn.disabled = false;
    }
  });
}

main();