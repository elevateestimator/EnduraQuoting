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

const pdfSandbox = $("#pdf-sandbox");
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

function buildItemRow(item = {}) {
  const tr = document.createElement("tr");
  tr.className = "item-row avoid-break";
  tr.innerHTML = `
    <td><input type="text" class="i-item" placeholder="Item" value="${item.item ?? ""}"></td>
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
    const item = $(".i-item", row).value.trim();
    const description = $(".i-desc", row).value.trim();
    const qty = Math.max(0, parseNum($(".i-qty", row).value));
    const unit_price_cents = Math.max(0, parseMoneyToCents($(".i-price", row).value));
    const taxable = $(".i-tax", row).checked;

    return { item, description, qty, unit_price_cents, taxable };
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

  // Deposit auto 40%
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

function mergeDefaults(existing, fallback) {
  const out = structuredClone(fallback);

  const e = existing || {};
  // Shallow merge primitives
  for (const k of Object.keys(e)) out[k] = e[k];

  // Merge nested objects
  out.company = { ...fallback.company, ...(e.company || {}) };
  out.meta = { ...fallback.meta, ...(e.meta || {}) };
  out.bill_to = { ...fallback.bill_to, ...(e.bill_to || {}) };
  out.project = { ...fallback.project, ...(e.project || {}) };

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
  setBoundValue("client_contact", data.bill_to.client_contact);
  setBoundValue("client_phone", data.bill_to.client_phone);
  setBoundValue("client_email", data.bill_to.client_email);
  setBoundValue("client_addr", data.bill_to.client_addr);

  setBoundValue("project_name", data.project.project_name);
  setBoundValue("project_location", data.project.project_location);
  setBoundValue("project_start", data.project.project_start);
  setBoundValue("project_overview", data.project.project_overview);

  setBoundValue("scope", data.scope);
  setBoundValue("terms", data.terms);
  setBoundValue("notes", data.notes);

  taxRateEl.value = String(data.tax_rate ?? 13);
  feesEl.value = centsToMoney(data.fees_cents ?? 0);

  // Deposit mode
  const mode = data.deposit_mode || "auto";
  $$('input[name="deposit_mode"]').forEach((r) => (r.checked = r.value === mode));
  if (mode === "custom") {
    depositDueEl.value = `$${centsToMoney(data.deposit_cents ?? 0)}`;
    depositDueEl.removeAttribute("readonly");
  }

  // Items
  itemRowsEl.innerHTML = "";
  const items = Array.isArray(data.items) && data.items.length ? data.items : [{ item: "", description: "", qty: 1, unit_price_cents: 0, taxable: true }];
  for (const it of items) itemRowsEl.appendChild(buildItemRow(it));

  recalcTotals();
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
    client_contact: getBoundValue("client_contact"),
    client_phone: getBoundValue("client_phone"),
    client_email: getBoundValue("client_email"),
    client_addr: getBoundValue("client_addr"),
  };

  const project = {
    project_name: getBoundValue("project_name"),
    project_location: getBoundValue("project_location"),
    project_start: getBoundValue("project_start"),
    project_overview: getBoundValue("project_overview"),
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
    computed: totals, // handy for debugging / later UI
    quote_code: formatQuoteCode(qRow.quote_no, meta.quote_date),
  };
}

function buildPdfClone() {
  const clone = quotePageEl.cloneNode(true);

  // Replace inputs/areas with text for cleaner PDFs
  clone.querySelectorAll("input, textarea, select").forEach((el) => {
    if (el.type === "checkbox") {
      const mark = document.createElement("span");
      mark.textContent = el.checked ? "✓" : "—";
      mark.style.display = "inline-block";
      mark.style.textAlign = "center";
      el.parentNode.replaceChild(mark, el);
      return;
    }

    const isArea = el.tagName === "TEXTAREA";
    const out = document.createElement(isArea ? "div" : "span");
    out.textContent = el.value ?? "";
    out.style.whiteSpace = "pre-wrap";
    out.style.display = "block";
    el.parentNode.replaceChild(out, el);
  });

  // Remove screen-only elements
  clone.querySelectorAll(".no-print").forEach((n) => n.remove());

  // Better print feel
  clone.style.boxShadow = "none";
  clone.style.border = "none";
  clone.style.borderRadius = "0";

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

  // Merge existing data with defaults
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
    itemRowsEl.appendChild(buildItemRow({ item: "", description: "", qty: 1, unit_price_cents: 0, taxable: true }));
    recalcTotals();
  });

  taxRateEl.addEventListener("input", recalcTotals);
  feesEl.addEventListener("input", recalcTotals);
  $$('input[name="deposit_mode"]').forEach((r) => r.addEventListener("change", recalcTotals));

  saveBtn.addEventListener("click", async () => {
    const payload = collectDataFromUI(qRow);

    if (!payload.bill_to.client_name) {
      showMsg("Customer name is required (Bill To).");
      return;
    }

    try {
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
      setTimeout(() => showMsg(""), 900);
    } catch (e) {
      showMsg(e?.message || "Save failed.");
    }
  });

  pdfBtn.addEventListener("click", async () => {
    // Save first so PDF matches DB
    saveBtn.click();

    if (!window.html2pdf) {
      showMsg("html2pdf library not loaded.");
      return;
    }

    // Build a clean clone for PDF
    pdfSandbox.innerHTML = "";
    const clone = buildPdfClone();
    pdfSandbox.appendChild(clone);

    const quoteNo = getBoundValue("quote_no") || `Q-${qRow.quote_no}`;
    const client = getBoundValue("client_name") || "Client";
    const filename = `${client.replace(/[^\w\-]+/g, "_")}_${quoteNo.replace(/[^\w\-]+/g, "_")}.pdf`;

    const opt = {
      margin: [0.5, 0.5, 0.5, 0.5],
      filename,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, backgroundColor: "#ffffff" },
      jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"] },
    };

    try {
      await window.html2pdf().set(opt).from(clone).save();
    } catch (e) {
      showMsg("PDF export failed. Check console.");
      console.error(e);
    } finally {
      pdfSandbox.innerHTML = "";
    }
  });
}

main();