import { requireAdminOrRedirect } from "../js/adminGuard.js";
import { getQuote, updateQuote } from "../js/quotesApi.js";
import { DEFAULT_COMPANY, makeDefaultQuoteData, formatQuoteCode } from "../js/quoteDefaults.js";

const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

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

function parseMoneyToCents(value) {
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function centsToMoney(cents) {
  const dollars = (Number(cents) || 0) / 100;
  return dollars.toLocaleString("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

/* ===== Signature date ===== */
function formatDateDisplay(iso) {
  if (!iso) return "";
  try {
    // Keep it “signature normal”, not ISO
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
  const out = structuredClone ? structuredClone(fallback) : JSON.parse(JSON.stringify(fallback));
  const e = existing || {};

  for (const k of Object.keys(e)) out[k] = e[k];

  out.company = { ...fallback.company, ...(e.company || {}) };
  out.meta = { ...fallback.meta, ...(e.meta || {}) };
  out.bill_to = { ...fallback.bill_to, ...(e.bill_to || {}) };
  out.project = { ...fallback.project, ...(e.project || {}) };

  // If old quotes had "item" field, ignore it gracefully
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
}

function collectDataFromUI(qRow) {
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
    computed: totals,
    quote_code: formatQuoteCode(qRow.quote_no, meta.quote_date),
  };
}

/* ===== PDF helpers ===== */
function createPdfSandbox() {
  const sandbox = document.createElement("div");
  sandbox.id = "pdf-sandbox";
  sandbox.style.position = "fixed";
  sandbox.style.left = "-10000px";
  sandbox.style.top = "0";
  sandbox.style.opacity = "0";
  sandbox.style.pointerEvents = "none";
  sandbox.style.background = "#ffffff";
  sandbox.style.width = "816px";  // Letter @ 96dpi
  document.body.appendChild(sandbox);
  return sandbox;
}

function buildPdfClone() {
  const clone = quotePageEl.cloneNode(true);

  clone.querySelectorAll(".no-print").forEach((n) => n.remove());

  clone.style.margin = "0";
  clone.style.boxShadow = "none";
  clone.style.border = "none";
  clone.style.borderRadius = "0";

  // Replace controls with styled blocks so PDF looks “real”, not like a screenshot of inputs
  const replaceControl = (el) => {
    if (el.type === "checkbox") {
      const mark = document.createElement("span");
      mark.textContent = el.checked ? "✓" : "—";
      mark.style.display = "inline-block";
      mark.style.textAlign = "center";
      mark.style.width = "100%";
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
  };

  clone.querySelectorAll("input, textarea, select").forEach(replaceControl);

  // Fix colgroup after removing the last action column in PDF clone
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
    itemRowsEl.appendChild(
      buildItemRow({ description: "", qty: 1, unit_price_cents: 0, taxable: true })
    );
    recalcTotals();
  });

  taxRateEl.addEventListener("input", recalcTotals);
  feesEl.addEventListener("input", recalcTotals);
  $$('input[name="deposit_mode"]').forEach((r) => r.addEventListener("change", recalcTotals));

  // Keep rep signature date synced
  quoteDateInput?.addEventListener("change", () => {
    syncRepDateFromQuoteDate();
  });

  async function saveNow() {
    const payload = collectDataFromUI(qRow);

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
    if (!window.html2pdf) {
      showMsg("PDF library not loaded.");
      return;
    }

    try {
      pdfBtn.disabled = true;

      const saved = await saveNow();
      if (!saved) return;

      const { payload } = saved;

      const sandbox = createPdfSandbox();
      sandbox.innerHTML = "";
      const clone = buildPdfClone();
      sandbox.appendChild(clone);

      const client = (payload.bill_to.client_name || "Client").replace(/[^\w\-]+/g, "_");
      const filename = `${client}_${payload.quote_code}.pdf`;

      const opt = {
        // FIX: adds space at top of every PDF page so bubbles never touch the top
        margin: [0.35, 0.35, 0.35, 0.35], // inches (jsPDF unit is "in")
        filename,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: {
          scale: 2,
          backgroundColor: "#ffffff",
          useCORS: true,
          scrollX: 0,
          scrollY: 0,
        },
        jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"], avoid: [".avoid-break", ".card", ".signatures", ".doc-header"] },
      };

      await window.html2pdf().set(opt).from(clone).save();

      sandbox.remove();
    } catch (e) {
      console.error(e);
      showMsg("PDF export failed. Check console.");
    } finally {
      pdfBtn.disabled = false;
    }
  });
}

main();