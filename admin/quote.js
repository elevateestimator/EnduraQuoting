import { requireAdminOrRedirect } from "../js/adminGuard.js";
import { getQuote, updateQuote } from "../js/quotesApi.js";
import { makeDefaultQuoteData, formatQuoteCode } from "../js/quoteDefaults.js";
import { supabase } from "../js/api.js";
import { listProducts } from "../js/productsApi.js";

const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

/** Letter size in CSS pixels @ 96dpi */
const PX_PER_IN = 96;
const PAGE_W_CSS = Math.round(8.5 * PX_PER_IN); // 816
const PAGE_H_CSS = Math.round(11  * PX_PER_IN); // 1056

const backBtn = $("#back-btn");
const saveBtn = $("#save-btn");
const pdfBtn  = $("#pdf-btn");
const sendBtn = $("#send-btn");
const markAcceptedBtn = $("#mark-accepted-btn");

const saveStateEl = $("#save-state");
const saveStateTextEl = $("#save-state-text");

const msgEl = $("#msg");
const quoteCodeEl = $("#quote-code");
const quoteStatusEl = $("#quote-status");
const docQuoteCodeEl = $("#doc-quote-code");

// Company + rep
const companyLogoEl = $("#company-logo");
// Top-left app bar logo (screen) should match the company's branding too
const appLogoEl = $("#app-logo") || $(".topbar .logo");
const repSignatureEl = $("#rep-signature");
const repPrintedNameEl = $("#rep-printed-name");

const itemRowsEl = $("#item-rows");
const addItemBtn = $("#add-item");

// Products dialog
const addProductBtn = $("#add-product");
const productsDialog = $("#products-dialog");
const productsCloseBtn = $("#products-close");
const productsSearchEl = $("#products-search");
const productsListEl = $("#products-list");
const productsMsgEl = $("#products-msg");
const productsEmptyEl = $("#products-empty");

const subtotalEl = $("#subtotal");
const taxAmountEl = $("#tax-amount");
const grandTotalEl = $("#grand-total");

const taxRateEl = $("#tax-rate");
const feesEl = $("#fees");

// Payment schedule (per-quote override)
const paymentScheduleBodyEl = $("#payment-schedule-body");
const paymentScheduleTotalEl = $("#payment-schedule-total");
const paymentScheduleMsgEl = $("#payment-schedule-msg");
const addPaymentStepBtn = $("#btn-add-payment-step");
const useDefaultScheduleBtn = $("#btn-use-default-schedule");

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

/* ===== Status helpers ===== */
function normalizeStatus(value) {
  return String(value ?? "").trim().toLowerCase();
}
function isAcceptedStatus(value) {
  return normalizeStatus(value) === "accepted";
}
function isCancelledStatus(value) {
  const s = normalizeStatus(value);
  return s === "cancelled" || s === "canceled";
}

function syncMarkAcceptedButton(status) {
  if (!markAcceptedBtn) return;

  if (isCancelledStatus(status)) {
    markAcceptedBtn.disabled = true;
    markAcceptedBtn.textContent = "Cancelled";
    return;
  }

  if (isAcceptedStatus(status)) {
    markAcceptedBtn.disabled = true;
    markAcceptedBtn.textContent = "✓ Accepted";
    return;
  }

  markAcceptedBtn.disabled = false;
  markAcceptedBtn.textContent = "✓ Mark as Accepted";
}

/* ===== Save state (auto-save UX) ===== */
function setSaveState(state, text) {
  if (!saveStateEl) return;
  if (state) saveStateEl.dataset.state = state;
  else delete saveStateEl.dataset.state;
  if (saveStateTextEl) saveStateTextEl.textContent = text || "";
}

function setManualSaveVisible(visible, label) {
  if (!saveBtn) return;
  saveBtn.hidden = !visible;
  if (label) saveBtn.textContent = label;
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  else dialog.removeAttribute("open");
}

function debounce(fn, wait = 160) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* ===== Brand color helpers (company theme) ===== */
function normalizeHexColor(input) {
  let v = String(input ?? "").trim();
  if (!v) return null;
  if (!v.startsWith("#")) v = `#${v}`;
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const h = v.slice(1);
    v = "#" + h.split("").map((c) => c + c).join("");
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(v)) return null;
  return v.toUpperCase();
}

function hexToRgb(hex) {
  const h = normalizeHexColor(hex);
  if (!h) return null;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return { r, g, b };
}

function clamp255(n) {
  return Math.min(255, Math.max(0, Math.round(n)));
}

function rgbToHex({ r, g, b }) {
  const to2 = (n) => clamp255(n).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`.toUpperCase();
}

function darkenHex(hex, amount = 0.22) {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#000000";
  const f = 1 - Math.min(Math.max(amount, 0), 0.9);
  return rgbToHex({ r: rgb.r * f, g: rgb.g * f, b: rgb.b * f });
}

function applyQuoteBrandColor(hex) {
  if (!quotePageEl) return;

  const brand = normalizeHexColor(hex) || "#000000";
  const rgb = hexToRgb(brand) || { r: 0, g: 0, b: 0 };
  const dark = darkenHex(brand, 0.22);

  quotePageEl.style.setProperty("--brand", brand);
  quotePageEl.style.setProperty("--brand-dark", dark);
  quotePageEl.style.setProperty("--brand-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
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

/* ===== Payment schedule (per quote) ===== */

function defaultPaymentSchedule(ctx) {
  // Company default schedule comes from Settings; fallback to a common 40/40/20.
  const fromCompany = normalizePaymentSchedule(ctx?.company?.payment_schedule);
  if (fromCompany && fromCompany.length) return fromCompany;

  return [
    { title: "Deposit", percent: 40 },
    { title: "On material delivery", percent: 40 },
    { title: "On completion", percent: 20 },
  ];
}

function coercePaymentSchedule(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value;

  // In case a JSON string was stored accidentally
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }

  return null;
}

function clampNumber(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

function percentToHundredths(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n)) return 0;
  const clamped = clampNumber(n, 0, 100);
  return Math.round(clamped * 100);
}

function formatPercentDisplay(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n)) return "0";
  const fixed = n.toFixed(2);
  if (fixed.endsWith(".00")) return String(Math.round(n));
  return fixed.replace(/0$/, "");
}

function normalizePaymentSchedule(raw) {
  const arr = coercePaymentSchedule(raw);
  if (!arr || !arr.length) return null;

  const out = [];
  for (const step of arr) {
    const title = safeStr(step?.title || step?.name || step?.label || "");
    const percent = Number(step?.percent ?? step?.percentage ?? step?.pct ?? 0);
    out.push({ title, percent: clampNumber(percent, 0, 100) });
  }

  return out;
}

function ensurePaymentSchedule(data, ctx) {
  if (!data) return;
  const existing = normalizePaymentSchedule(data.payment_schedule);
  if (existing && existing.length) {
    data.payment_schedule = existing;
    return;
  }
  data.payment_schedule = defaultPaymentSchedule(ctx);
}

function getPaymentScheduleRows() {
  if (!paymentScheduleBodyEl) return [];
  return Array.from(paymentScheduleBodyEl.querySelectorAll("tr.ps-row"));
}

function readPaymentScheduleFromUI() {
  const rows = getPaymentScheduleRows();
  const steps = [];

  for (const row of rows) {
    const titleEl = row.querySelector(".ps-title");
    const percentEl = row.querySelector(".ps-percent");

    const title = safeStr(titleEl?.value);
    const p = Number(percentEl?.value);
    steps.push({ title, percent: Number.isFinite(p) ? p : 0 });
  }

  return steps;
}

function validatePaymentSchedule(steps) {
  const schedule = Array.isArray(steps) ? steps : [];
  if (!schedule.length) {
    return { ok: false, totalHundredths: 0, message: "Add at least 1 payment step." };
  }

  for (const s of schedule) {
    if (!safeStr(s?.title)) {
      return {
        ok: false,
        totalHundredths: schedule.reduce((sum, x) => sum + percentToHundredths(x?.percent), 0),
        message: "Each payment step needs a name (example: Deposit).",
      };
    }

    const p = Number(s?.percent);
    if (!Number.isFinite(p) || p <= 0) {
      return {
        ok: false,
        totalHundredths: schedule.reduce((sum, x) => sum + percentToHundredths(x?.percent), 0),
        message: "Each payment step needs a percent greater than 0%.",
      };
    }
  }

  const totalHundredths = schedule.reduce((sum, s) => sum + percentToHundredths(s?.percent), 0);
  const ok = totalHundredths === 10000;
  const total = totalHundredths / 100;

  return {
    ok,
    totalHundredths,
    message: ok ? "Total is 100%." : `Total must equal 100% (currently ${formatPercentDisplay(total)}%).`,
  };
}

function allocateCentsByPercent(totalCents, schedule) {
  const total = Math.max(0, Number(totalCents) || 0);
  const steps = Array.isArray(schedule) ? schedule : [];
  const pHund = steps.map((s) => percentToHundredths(s?.percent));
  const base = pHund.map((p) => Math.floor((total * p) / 10000));
  let used = base.reduce((a, b) => a + b, 0);

  // Distribute remaining cents to keep totals exact when schedule sums to 100%.
  let remainder = total - used;
  let i = 0;
  while (remainder > 0 && base.length) {
    base[i % base.length] += 1;
    remainder -= 1;
    i += 1;
  }

  return base;
}

function syncPaymentScheduleRemoveButtons() {
  const rows = getPaymentScheduleRows();
  const onlyOne = rows.length <= 1;
  for (const row of rows) {
    const btn = row.querySelector(".ps-remove");
    if (!btn) continue;
    btn.disabled = onlyOne;
  }
}

function syncPaymentScheduleUI(totalCents) {
  if (!paymentScheduleBodyEl || !paymentScheduleTotalEl || !paymentScheduleMsgEl) return;

  const schedule = readPaymentScheduleFromUI();
  const v = validatePaymentSchedule(schedule);

  // Total display
  const total = v.totalHundredths / 100;
  paymentScheduleTotalEl.textContent = formatPercentDisplay(total);

  // Message styling
  paymentScheduleMsgEl.textContent = v.message || "";
  paymentScheduleMsgEl.classList.toggle("error", !v.ok);
  paymentScheduleMsgEl.classList.toggle("ok", v.ok);

  // Amounts
  const currency = _companySnapshot?.currency || "CAD";
  const rows = getPaymentScheduleRows();

  if (rows.length) {
    let amounts = [];

    if (v.ok) {
      amounts = allocateCentsByPercent(totalCents, schedule);
    } else {
      // Still show helpful amounts while editing (based on each % of total)
      amounts = schedule.map((s) => Math.round((Math.max(0, Number(totalCents) || 0) * percentToHundredths(s?.percent)) / 10000));
    }

    for (let i = 0; i < rows.length; i++) {
      const amtEl = rows[i].querySelector(".ps-amount");
      if (!amtEl) continue;
      const cents = amounts[i] ?? 0;
      amtEl.textContent = formatCurrency(cents, currency);
    }
  }

  syncPaymentScheduleRemoveButtons();

  return v;
}

function addPaymentScheduleRow(step = {}) {
  if (!paymentScheduleBodyEl) return null;

  const tr = document.createElement("tr");
  tr.className = "ps-row";

  const tdTitle = document.createElement("td");
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "ps-title";
  titleInput.placeholder = "Deposit (upon acceptance)";
  titleInput.value = safeStr(step?.title || "");
  tdTitle.appendChild(titleInput);

  const tdPct = document.createElement("td");
  tdPct.className = "num";

  const pctWrap = document.createElement("div");
  pctWrap.className = "ps-percent-wrap";

  const pctInput = document.createElement("input");
  pctInput.type = "number";
  pctInput.inputMode = "decimal";
  pctInput.step = "0.01";
  pctInput.min = "0";
  pctInput.max = "100";
  pctInput.className = "ps-percent";
  pctInput.placeholder = "40";
  const pct = Number(step?.percent);
  pctInput.value = Number.isFinite(pct) && pct > 0 ? String(pct) : "";

  const pctSuf = document.createElement("span");
  pctSuf.className = "ps-suf";
  pctSuf.textContent = "%";

  pctWrap.appendChild(pctInput);
  pctWrap.appendChild(pctSuf);
  tdPct.appendChild(pctWrap);

  const tdAmt = document.createElement("td");
  tdAmt.className = "num";
  const amt = document.createElement("div");
  amt.className = "ps-amount";
  amt.textContent = "—";
  tdAmt.appendChild(amt);

  const tdAct = document.createElement("td");
  tdAct.className = "no-print slim";
  const rmBtn = document.createElement("button");
  rmBtn.type = "button";
  rmBtn.className = "btn small ps-remove";
  rmBtn.textContent = "✕";
  rmBtn.setAttribute("aria-label", "Remove payment step");
  tdAct.appendChild(rmBtn);

  rmBtn.addEventListener("click", () => {
    const rows = getPaymentScheduleRows();
    if (rows.length <= 1) return;
    tr.remove();
    syncPaymentScheduleUI(_lastTotals?.total_cents ?? 0);
  });

  for (const el of [titleInput, pctInput]) {
    el.addEventListener("input", () => syncPaymentScheduleUI(_lastTotals?.total_cents ?? 0));
    el.addEventListener("change", () => syncPaymentScheduleUI(_lastTotals?.total_cents ?? 0));
  }

  tr.appendChild(tdTitle);
  tr.appendChild(tdPct);
  tr.appendChild(tdAmt);
  tr.appendChild(tdAct);

  paymentScheduleBodyEl.appendChild(tr);
  return { tr, titleInput, pctInput };
}

function renderPaymentSchedule(schedule) {
  if (!paymentScheduleBodyEl) return;

  paymentScheduleBodyEl.innerHTML = "";
  const normalized = normalizePaymentSchedule(schedule) || defaultPaymentSchedule(_ctx);

  for (const step of normalized) addPaymentScheduleRow(step);

  syncPaymentScheduleUI(_lastTotals?.total_cents ?? 0);
}

function addPaymentScheduleStep() {
  if (!paymentScheduleBodyEl) return;

  const current = readPaymentScheduleFromUI();
  const totalHundredths = current.reduce((sum, s) => sum + percentToHundredths(s?.percent), 0);
  const remaining = Math.max(0, 10000 - totalHundredths) / 100;

  const added = addPaymentScheduleRow({ title: "", percent: remaining > 0 ? remaining : "" });
  syncPaymentScheduleUI(_lastTotals?.total_cents ?? 0);

  try { added?.titleInput?.focus(); } catch {}
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
  wireAutosize('[data-bind="terms"]');
  wireAutosize('[data-bind="notes"]');
}

/* ===== Tenant context (company + user) ===== */
let _ctx = null;
let _companySnapshot = null;
let _lastTotals = { subtotal_cents: 0, tax_cents: 0, fees_cents: 0, total_cents: 0 };

function safeStr(v) {
  return String(v ?? "").trim();
}

function deriveNameFromEmail(email) {
  const e = safeStr(email);
  if (!e.includes("@")) return "";
  const local = e.split("@")[0] || "";
  if (!local) return "";
  // e.g. "jacob.docherty" -> "Jacob Docherty"
  return local
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .trim();
}

async function getContext() {
  if (_ctx) return _ctx;

  const { data: sData, error: sErr } = await supabase.auth.getSession();
  if (sErr) throw new Error(sErr.message);
  const session = sData?.session;
  if (!session) throw new Error("Not authenticated.");

  const user = session.user;
  const userId = user.id;

  const { data: memRows, error: memErr } = await supabase
    .from("company_members")
    .select("company_id, role")
    .eq("user_id", userId)
    .limit(1);

  if (memErr) throw new Error(memErr.message);

  const membership = memRows?.[0] || null;
  if (!membership?.company_id) {
    throw new Error(
      "No company membership found for this account. Create a company (owner) or ask an admin to invite you."
    );
  }

  const companyId = membership.company_id;
  const role = membership.role || "member";

  const { data: company, error: compErr } = await supabase
    .from("companies")
    // Use select("*") so optional fields (like payment_terms) don't break the app.
    // Row-level security still applies.
    .select("*")
    .eq("id", companyId)
    .single();

  if (compErr) throw new Error(compErr.message);

  // Profiles table is optional. We'll try both common schemas:
  // - profiles.id = auth.uid()
  // - profiles.user_id = auth.uid()
  let profile = null;
  try {
    const { data: p1, error: e1 } = await supabase
      .from("profiles")
      .select("first_name, last_name, phone")
      .eq("id", userId)
      .maybeSingle();
    if (!e1 && p1) profile = p1;
  } catch {}

  if (!profile) {
    try {
      const { data: p2, error: e2 } = await supabase
        .from("profiles")
        .select("first_name, last_name, phone")
        .eq("user_id", userId)
        .maybeSingle();
      if (!e2 && p2) profile = p2;
    } catch {}
  }

  const md = user.user_metadata || {};
  const first = safeStr(profile?.first_name) || safeStr(md.first_name);
  const last = safeStr(profile?.last_name) || safeStr(md.last_name);
  const fullName =
    safeStr(`${first} ${last}`) ||
    safeStr(md.full_name) ||
    safeStr(md.name) ||
    deriveNameFromEmail(user.email) ||
    safeStr(user.email) ||
    "User";

  _ctx = { session, user, userId, companyId, role, company, profile, userName: fullName };
  return _ctx;
}

function companyToQuoteCompany(company) {
  const address = safeStr(company?.address);
  let addr1 = "";
  let addr2 = "";

  if (address.includes("\n")) {
    const lines = address
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    addr1 = lines.shift() || "";
    addr2 = lines.join(", ");
  } else {
    addr1 = address;
  }

  return {
    company_id: company?.id || null,
    name: safeStr(company?.name),
    addr1,
    addr2,
    phone: safeStr(company?.phone),
    email: safeStr(company?.billing_email) || safeStr(company?.owner_email),
    web: safeStr(company?.website),
    logo_url: safeStr(company?.logo_url),
    brand_color: safeStr(company?.brand_color) || "#000000",
    currency: safeStr(company?.default_currency) || "CAD",
  };
}

function ensureCompanySnapshot(data, ctx) {
  const snap = companyToQuoteCompany(ctx?.company);
  const cur = data?.company || {};

  // If the quote doesn't have a company snapshot yet (or it's from another company), set it.
  if (!cur?.company_id || cur.company_id !== snap.company_id) {
    data.company = { ...snap };
  } else {
    // Fill missing fields but do not clobber an existing snapshot.
    data.company = { ...snap, ...cur, company_id: snap.company_id };
  }

  _companySnapshot = data.company;
  return _companySnapshot;
}

function applyCompanyToDom(company) {
  if (!company) return;

  const set = (key, value) => {
    const el = document.querySelector(`[data-company="${key}"]`);
    if (!el) return null;
    el.textContent = value || "";
    return el;
  };

  set("name", company.name);
  set("addr1", company.addr1);
  set("addr2", company.addr2);
  set("phone", company.phone);
  set("email", company.email);
  set("web", company.web);

  // Remove empty spans so bullet separators don't render awkwardly.
  ["addr1", "addr2", "phone", "email", "web"].forEach((k) => {
    const el = document.querySelector(`[data-company="${k}"]`);
    if (el && !safeStr(el.textContent)) el.remove();
  });

  // Keep BOTH the document letterhead logo and the app topbar logo in sync.
  const logoSrc =
    safeStr(company.logo_url) ||
    safeStr(companyLogoEl?.getAttribute("src")) ||
    safeStr(appLogoEl?.getAttribute("src"));

  if (companyLogoEl && logoSrc) companyLogoEl.src = logoSrc;
  if (appLogoEl && logoSrc) appLogoEl.src = logoSrc;

  const alt = company.name ? `${company.name} logo` : "Company logo";
  if (companyLogoEl) companyLogoEl.alt = alt;
  if (appLogoEl) appLogoEl.alt = alt;
}

function ensurePreparedBy(data, ctx) {
  if (!data.meta) data.meta = {};

  const current = safeStr(data.meta.prepared_by);
  const candidate = safeStr(ctx?.userName);
  const lower = current.toLowerCase();
  const email = safeStr(ctx?.user?.email).toLowerCase();
  const derived = deriveNameFromEmail(ctx?.user?.email).toLowerCase();

  // Legacy placeholder(s) / generic placeholders from early builds.
  const looksLikePlaceholder =
    !current ||
    ["jacob docherty", "jacob", "user", "unknown"].includes(lower) ||
    (email && lower === email) ||
    (derived && lower === derived);

  if (looksLikePlaceholder && candidate) {
    data.meta.prepared_by = candidate;
  }

  return data.meta.prepared_by;
}

function todayIsoLocal() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDaysIso(isoDate, days) {
  const base = isoDate && /^\d{4}-\d{2}-\d{2}$/.test(isoDate)
    ? new Date(`${isoDate}T00:00:00`)
    : new Date();
  base.setDate(base.getDate() + (Number(days) || 0));
  const local = new Date(base.getTime() - base.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function ensureMetaDates(data) {
  if (!data.meta) data.meta = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.meta.quote_date || ""))) {
    data.meta.quote_date = todayIsoLocal();
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.meta.quote_expires || ""))) {
    data.meta.quote_expires = addDaysIso(data.meta.quote_date, 30);
  }
}

function ensureBillToShape(data) {
  if (!data.bill_to || typeof data.bill_to !== "object") data.bill_to = {};
  data.bill_to.client_name = safeStr(data.bill_to.client_name);
  data.bill_to.client_phone = safeStr(data.bill_to.client_phone);
  data.bill_to.client_email = safeStr(data.bill_to.client_email);
  data.bill_to.client_addr = safeStr(data.bill_to.client_addr);
  return data.bill_to;
}

function ensureProjectShape(data) {
  if (!data.project || typeof data.project !== "object") data.project = {};
  data.project.project_location = safeStr(data.project.project_location);
  return data.project;
}

function ensureBillToFromQuoteRow(data, qRow) {
  const bill = ensureBillToShape(data);
  if (!bill.client_name && safeStr(qRow?.customer_name)) bill.client_name = safeStr(qRow.customer_name);
  if (!bill.client_email && safeStr(qRow?.customer_email)) bill.client_email = safeStr(qRow.customer_email);
}

function chooseCustomerDisplayName(c) {
  const first = safeStr(c?.first_name);
  const last = safeStr(c?.last_name);
  const full = safeStr([first, last].filter(Boolean).join(" "));
  const company = safeStr(c?.company_name);
  if (company && full) return `${full} (${company})`;
  return company || full;
}

async function hydrateBillToFromCustomer(data, qRow) {
  // Supports either a dedicated column (quotes.customer_id) or a stamped json key (data.customer_id).
  const custId =
    safeStr(qRow?.customer_id) ||
    safeStr(data?.customer_id) ||
    safeStr(data?.meta?.customer_id) ||
    safeStr(data?.bill_to?.customer_id);

  if (!custId) return;

  // Keep a copy in JSON for future-proof querying.
  if (!safeStr(data.customer_id)) data.customer_id = custId;

  try {
    const { data: c, error } = await supabase
      .from("customers")
      .select("id, first_name, last_name, company_name, billing_address, email, phone")
      .eq("id", custId)
      .single();

    if (error || !c) return;

    const bill = ensureBillToShape(data);
    const name = chooseCustomerDisplayName(c);
    if (!bill.client_name && name) bill.client_name = name;
    if (!bill.client_email && safeStr(c.email)) bill.client_email = safeStr(c.email);
    if (!bill.client_phone && safeStr(c.phone)) bill.client_phone = safeStr(c.phone);
    if (!bill.client_addr && safeStr(c.billing_address)) bill.client_addr = safeStr(c.billing_address);
  } catch {
    // If customers table isn't in place yet or RLS blocks it, we just skip hydration.
  }
}

function applyRepName(name) {
  if (repSignatureEl) repSignatureEl.textContent = name || "";
  if (repPrintedNameEl) repPrintedNameEl.textContent = name || "";
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


function acceptedDateIsoFromAcceptance(acc) {
  if (!acc) return "";
  if (acc.accepted_date && /^\d{4}-\d{2}-\d{2}$/.test(acc.accepted_date)) return acc.accepted_date;
  if (acc.accepted_date_local && /^\d{4}-\d{2}-\d{2}$/.test(acc.accepted_date_local)) return acc.accepted_date_local;
  if (acc.accepted_at) {
    const d = new Date(acc.accepted_at);
    if (!Number.isNaN(d.getTime())) {
      // Use local date (admin machine timezone)
      const parts = new Intl.DateTimeFormat("en-CA", { year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(d);
      const map = {};
      for (const p of parts) map[p.type] = p.value;
      return `${map.year}-${map.month}-${map.day}`;
    }
  }
  return "";
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
    const dateIso = acceptedDateIsoFromAcceptance(acc);
    const src = acc.signature_image_data_url || acc.signature_data_url || "";

    if (src) {
      clientSigImg.src = src;
      clientSigImg.hidden = false;
    } else {
      // Avoid showing a broken image icon/alt text when there's no signature.
      clientSigImg.removeAttribute("src");
      clientSigImg.hidden = true;
    }

    clientSignedNameEl.textContent = name;
    clientSignedDateEl.textContent = formatDateDisplay(dateIso);
  } else {
    // Avoid showing a broken image icon/alt text when the customer hasn't signed yet.
    clientSigImg.removeAttribute("src");
    clientSigImg.hidden = true;
    clientSignedNameEl.textContent = "";
    clientSignedDateEl.textContent = "";
  }
}

/* ===== Quote field binding helpers ===== */
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

/* ===== Items (Products & Services) ===== */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildItemRow(item = {}) {
  const tr = document.createElement("tr");
  tr.className = "item-row avoid-break";

  // NOTE:
  // show_qty_unit_price controls what the CUSTOMER sees (PDF + customer view),
  // NOT what the admin can edit. Admins always get qty + unit price inputs.
  const show = item.show_qty_unit_price !== false; // default true
  const productId = item.product_id || "";
  const unitType = item.unit_type || "Each";

  tr.dataset.productId = productId;
  tr.dataset.unitType = unitType;
  tr.dataset.showQtyUnitPrice = show ? "1" : "0";

  const name = item.name ?? "";
  const description = item.description ?? item.desc ?? "";
  const qty = Number.isFinite(Number(item.qty)) ? Number(item.qty) : 1;
  const unitPriceCents = Number.isFinite(Number(item.unit_price_cents)) ? Number(item.unit_price_cents) : 0;
  const taxable = typeof item.taxable === "boolean" ? item.taxable : true;
  const lineCents = Math.round((qty || 0) * (unitPriceCents || 0));

  tr.innerHTML = `
    <td>
      <input type="text" class="i-name" placeholder="Item name" value="${escapeHtml(name)}" />
      <textarea rows="2" class="i-desc" placeholder="Description">${escapeHtml(description)}</textarea>
    </td>
    <td class="num"><input type="text" class="i-qty" inputmode="decimal" value="${qty || 0}" /></td>
    <td class="center">
      <input
        type="text"
        class="i-unit-input"
        placeholder="Each"
        value="${escapeHtml(unitType)}"
        aria-label="Unit type"
        title="Unit type (eg. Each, sqft, lf)"
      />
    </td>
    <td class="num"><input type="text" class="i-price" inputmode="decimal" value="${centsToMoney(unitPriceCents)}" /></td>
    <td class="center"><input type="checkbox" class="i-tax" ${taxable ? "checked" : ""} /></td>
    <td class="line-total"><span>$${centsToMoney(lineCents)}</span></td>
    <td class="no-print slim">
      <button
        class="btn small"
        type="button"
        data-action="remove"
        title="Remove line"
        aria-label="Remove line"
      >✕</button>
    </td>
  `;

  tr.querySelectorAll("input, textarea").forEach((el) => {
    el.addEventListener("input", () => recalcTotals());
    el.addEventListener("change", () => recalcTotals());
  });

  // Unit type is now editable per-quote (so you can override catalog defaults when needed)
  const unitInput = tr.querySelector(".i-unit-input");
  if (unitInput) {
    const sync = () => {
      tr.dataset.unitType = safeStr(unitInput.value) || "Each";
    };
    unitInput.addEventListener("input", sync);
    unitInput.addEventListener("change", sync);
    sync();
  }

  // Money tidy-up (keeps PDFs clean too)
  const priceInput = tr.querySelector(".i-price");
  if (priceInput) {
    priceInput.addEventListener("blur", () => {
      const cents = Math.max(0, parseMoneyToCents(priceInput.value));
      priceInput.value = centsToMoney(cents);
      recalcTotals();
    });
  }

  tr.querySelector('[data-action="remove"]').addEventListener("click", () => {
    tr.remove();
    if (!itemRowsEl.children.length) itemRowsEl.appendChild(buildItemRow());
    recalcTotals();
  });

  // Auto-grow item description so it never scrolls (premium + easier to read)
  const descEl = tr.querySelector(".i-desc");
  if (descEl) {
    const resize = () => {
      descEl.style.height = "auto";
      descEl.style.height = `${descEl.scrollHeight + 2}px`;
    };
    descEl.addEventListener("input", resize);
    descEl.addEventListener("change", resize);
    // Run after insertion (so scrollHeight is correct)
    requestAnimationFrame(resize);
  }

  return tr;
}

function isRowEffectivelyEmpty(row) {
  const name = safeStr($(".i-name", row)?.value);
  const desc = safeStr($(".i-desc", row)?.value);

  if (name || desc) return false;

  const qty = parseNum($(".i-qty", row)?.value);
  const price = parseMoneyToCents($(".i-price", row)?.value);

  return (qty === 0 || qty === 1) && price === 0;
}

function maybeRemoveSingleEmptyRow() {
  const rows = $$(".item-row", itemRowsEl);
  if (rows.length !== 1) return;
  if (isRowEffectivelyEmpty(rows[0])) rows[0].remove();
}

function getItemsFromUI() {
  const rows = $$(".item-row", itemRowsEl);
  return rows.map((row) => {
    const show_qty_unit_price = row.dataset.showQtyUnitPrice !== "0";
    const product_id = safeStr(row.dataset.productId) || null;
    const unit_type =
      safeStr($(".i-unit-input", row)?.value) ||
      safeStr(row.dataset.unitType) ||
      "Each";

    const name = safeStr($(".i-name", row)?.value);
    const description = safeStr($(".i-desc", row)?.value);
    const taxable = !!$(".i-tax", row)?.checked;

    const qty = Math.max(0, parseNum($(".i-qty", row)?.value));
    const unit_price_cents = Math.max(0, parseMoneyToCents($(".i-price", row)?.value));

    return { product_id, name, description, unit_type, show_qty_unit_price, qty, unit_price_cents, taxable };
  });
}

function writeLineTotals(items) {
  const rows = $$(".item-row", itemRowsEl);
  items.forEach((it, idx) => {
    const line = Math.round((it.qty || 0) * (it.unit_price_cents || 0));
    const span = rows[idx]?.querySelector(".line-total span");
    if (span) span.textContent = `$${centsToMoney(line)}`;
  });
}

/* ===== Products dialog ===== */

function formatCurrency(cents, currency = "CAD") {
  const amount = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(amount);
  } catch {
    return `$${centsToMoney(Number(cents) || 0)}`;
  }
}


function getProductTitle(p) {
  return (
    safeStr(p?.name) ||
    safeStr(p?.title) ||
    safeStr(p?.product_name) ||
    safeStr(p?.service_name) ||
    "Unnamed"
  );
}

function getProductDescription(p) {
  return safeStr(p?.description) || safeStr(p?.desc) || "";
}

function getProductUnitType(p) {
  return safeStr(p?.unit_type) || safeStr(p?.unit) || "Each";
}

function getProductPriceCents(p) {
  const v = p?.price_per_unit_cents ?? p?.unit_price_cents ?? p?.price_cents ?? p?.price ?? 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function productToItem(product) {
  return {
    product_id: product.id,
    name: getProductTitle(product),
    description: getProductDescription(product),
    unit_type: getProductUnitType(product),
    // Default to showing breakdown unless explicitly turned off
    show_qty_unit_price: product.show_qty_unit_price !== false,
    qty: 1,
    unit_price_cents: getProductPriceCents(product),
    taxable: true,
  };
}

function renderProductsList(products, currency) {
  if (!productsListEl) return;
  productsListEl.innerHTML = "";

  products.forEach((p) => {
    const row = document.createElement("div");
    row.className = "product-row";

    const main = document.createElement("div");
    main.className = "product-main";

    const name = document.createElement("div");
    name.className = "product-name";
    name.textContent = getProductTitle(p);

    const desc = document.createElement("div");
    desc.className = "product-desc";
    desc.textContent = getProductDescription(p);
    if (!safeStr(desc.textContent)) desc.style.display = "none";

    const meta = document.createElement("div");
    meta.className = "product-meta";

    const priceTag = document.createElement("span");
    priceTag.className = "tag";
    priceTag.textContent = formatCurrency(getProductPriceCents(p), currency);

    const unitTag = document.createElement("span");
    unitTag.className = "tag";
    unitTag.textContent = getProductUnitType(p);

    const modeTag = document.createElement("span");
    modeTag.className = "tag";
    const breakdown = p.show_qty_unit_price !== false;
    modeTag.textContent = breakdown ? "Breakdown" : "Total only";

    meta.appendChild(priceTag);
    meta.appendChild(unitTag);
    meta.appendChild(modeTag);

    main.appendChild(name);
    main.appendChild(desc);
    main.appendChild(meta);

    const actions = document.createElement("div");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn small brand";
    btn.textContent = "Add";
    btn.addEventListener("click", () => {
      maybeRemoveSingleEmptyRow();
      itemRowsEl.appendChild(buildItemRow(productToItem(p)));
      recalcTotals();
      closeDialog(productsDialog);
    });
    actions.appendChild(btn);

    row.appendChild(main);
    row.appendChild(actions);

    productsListEl.appendChild(row);
  });
}

async function loadProductsIntoDialog(search = "") {
  if (!productsDialog || !productsListEl) return;

  const currency = _companySnapshot?.currency || "CAD";
  if (productsMsgEl) {
    productsMsgEl.hidden = false;
    productsMsgEl.textContent = "Loading…";
  }
  if (productsEmptyEl) productsEmptyEl.hidden = true;

  try {
    const products = await listProducts({ search, limit: 200 });
    if (productsMsgEl) productsMsgEl.hidden = true;

    if (!products.length) {
      productsListEl.innerHTML = "";
      if (productsEmptyEl) productsEmptyEl.hidden = false;
      return;
    }

    if (productsEmptyEl) productsEmptyEl.hidden = true;
    renderProductsList(products, currency);
  } catch (e) {
    console.error(e);
    if (productsMsgEl) {
      productsMsgEl.hidden = false;
      productsMsgEl.textContent = e?.message || "Failed to load products.";
    }
  }
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

  _lastTotals = { subtotal_cents: subtotal, tax_cents: tax, fees_cents: fees, total_cents: grand };

  // Keep payment schedule amounts in sync with the current quote total
  syncPaymentScheduleUI(grand);

  return _lastTotals;
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
      product_id: it.product_id ?? it.productId ?? null,
      name: it.name ?? "",
      description: it.description ?? it.desc ?? it.item ?? "",
      unit_type: it.unit_type ?? it.unitType ?? it.unit ?? "Each",
      show_qty_unit_price:
        typeof it.show_qty_unit_price === "boolean" ? it.show_qty_unit_price : true,
      qty: it.qty ?? 1,
      unit_price_cents: it.unit_price_cents ?? it.price_per_unit_cents ?? 0,
      taxable: typeof it.taxable === "boolean" ? it.taxable : true,
    }));
  }

  return out;
}

function fillUIFromData(qRow, data, ctx) {
  // Ensure shape + core defaults exist (prevents blank meta fields)
  ensureMetaDates(data);
  ensureBillToShape(data);
  ensureProjectShape(data);
  ensureBillToFromQuoteRow(data, qRow);

  // Company snapshot (customer-facing letterhead)
  const company = ensureCompanySnapshot(data, ctx);
  applyCompanyToDom(company);

  // Apply the company brand color to the quote (PDF + customer view consistency)
  applyQuoteBrandColor(company?.brand_color || ctx?.company?.brand_color);

  // Prepared-by (quote creator)
  const preparedBy = ensurePreparedBy(data, ctx);
  applyRepName(preparedBy);

  let quoteCode = formatQuoteCode(qRow.quote_no, data.meta.quote_date);
  if (!safeStr(quoteCode)) {
    quoteCode = qRow.quote_no ? `Q-${qRow.quote_no}` : `Q-${String(qRow.id || "").slice(0, 8)}`;
  }

  quoteCodeEl.textContent = quoteCode;
  if (docQuoteCodeEl) docQuoteCodeEl.textContent = quoteCode;

  quoteStatusEl.textContent = qRow.status || "Draft";

  setBoundValue("quote_no", quoteCode);
  setBoundValue("quote_date", data.meta.quote_date);
  setBoundValue("quote_expires", data.meta.quote_expires);
  setBoundValue("prepared_by", preparedBy);

  setBoundValue("client_name", data.bill_to.client_name);
  setBoundValue("client_phone", data.bill_to.client_phone);
  setBoundValue("client_email", data.bill_to.client_email);
  setBoundValue("client_addr", data.bill_to.client_addr);

  setBoundValue("project_location", data.project.project_location);

  setBoundValue("terms", data.terms);
  setBoundValue("notes", data.notes);

  taxRateEl.value = String(data.tax_rate ?? 13);
  feesEl.value = centsToMoney(data.fees_cents ?? 0);

  // Payment schedule (per-quote override). If missing, seed from Company Settings.
  ensurePaymentSchedule(data, ctx);
  renderPaymentSchedule(data.payment_schedule);

  itemRowsEl.innerHTML = "";
  const items = Array.isArray(data.items) && data.items.length
    ? data.items
    : [{ name: "", description: "", unit_type: "Each", show_qty_unit_price: true, qty: 1, unit_price_cents: 0, taxable: true }];

  for (const it of items) itemRowsEl.appendChild(buildItemRow(it));

  recalcTotals();
  autosizeAll();
  syncRepDateFromQuoteDate();
  renderClientAcceptance(data, qRow);
}

function collectDataFromUI(qRow, existingAcceptance = null) {
  const totals = recalcTotals();

  const meta = {
    ...(qRow?.data?.meta && typeof qRow.data.meta === "object" ? qRow.data.meta : {}),
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
  const itemsForSave = items.filter(
    (it) => safeStr(it?.name) || safeStr(it?.description) || (it?.unit_price_cents || 0) > 0
  );

    const payment_schedule = readPaymentScheduleFromUI();


  return {
    // Keep the customer linkage in json so customer pages can query reliably
    customer_id: safeStr(qRow?.customer_id) || safeStr(qRow?.data?.customer_id) || safeStr(meta?.customer_id) || "",
    company: _companySnapshot || qRow.data?.company || {},
    meta,
    bill_to,
    project,
    items: itemsForSave,
    tax_rate: parseNum(taxRateEl.value) || 13,
    fees_cents: totals.fees_cents,
    payment_schedule,
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
  clone.classList.add("pdf-export");

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

  // Normalize Bill To + Job Site blocks so partial info doesn’t look scattered in the PDF
  const billFields = clone.querySelector(".bill-fields");
  if (billFields) {
    const name = billFields.querySelector('[data-bind="client_name"]')?.value?.trim() || "";
    const phone = billFields.querySelector('[data-bind="client_phone"]')?.value?.trim() || "";
    const email = billFields.querySelector('[data-bind="client_email"]')?.value?.trim() || "";
    const addr = billFields.querySelector('[data-bind="client_addr"]')?.value?.trim() || "";

    const contact = document.createElement("div");
    contact.className = "pdf-contact";

    const nameEl = document.createElement("div");
    nameEl.className = "pdf-contact-name";
    nameEl.textContent = name || "Client";
    contact.appendChild(nameEl);

    const subParts = [];
    if (phone) subParts.push(phone);
    if (email) subParts.push(email);
    if (subParts.length) {
      const subEl = document.createElement("div");
      subEl.className = "pdf-contact-sub";
      subEl.textContent = subParts.join(" • ");
      contact.appendChild(subEl);
    }

    if (addr) {
      const addrEl = document.createElement("div");
      addrEl.className = "pdf-contact-addr";
      addrEl.textContent = addr;
      contact.appendChild(addrEl);
    }

    billFields.replaceWith(contact);
  }

  const jobFields = clone.querySelector(".job-fields");
  if (jobFields) {
    const loc = jobFields.querySelector('[data-bind="project_location"]')?.value?.trim() || "";
    const field = document.createElement("div");
    field.className = "pdf-field";
    field.textContent = loc || "Same as billing address";

    const card = jobFields.closest(".card");
    card?.querySelectorAll(".helper").forEach((n) => n.remove());

    jobFields.innerHTML = "";
    jobFields.appendChild(field);
  }

  // Replace inputs/textareas with clean, printed-looking text blocks (no “typing boxes”)
  clone.querySelectorAll("input, textarea, select").forEach((el) => {
    if (el.type === "checkbox") {
      const mark = document.createElement("span");
      mark.textContent = el.checked ? "✓" : "";
      mark.style.display = "inline-block";
      mark.style.width = "100%";
      mark.style.textAlign = "center";
      el.parentNode.replaceChild(mark, el);
      return;
    }

    const inItems = !!el.closest(".items-table");
    const inTotals = !!el.closest(".totals-grid");
    const inMeta = !!el.closest(".meta-strip");
    const inBill = !!el.closest(".bill-fields");
    const inJob  = !!el.closest(".job-fields");
    const inInline = !!el.closest(".inline");
    const isArea = el.tagName === "TEXTAREA";

    const bindKey = el.getAttribute?.("data-bind") || "";

    // Prefer human-readable values in the PDF
    let value = "";
    if (el.tagName === "SELECT") {
      value = el.options?.[el.selectedIndex]?.textContent ?? el.value ?? "";
    } else {
      value = el.value ?? "";
    }
    if (el.type === "date" && value) value = formatDateDisplay(value);

    const out = document.createElement("div");
    out.textContent = value;
    out.style.whiteSpace = "pre-wrap";
    out.style.display = "block";

    // Prevent long unbroken strings (eg. pasted model numbers / notes) from
    // bleeding outside the PDF table/page.
    out.style.overflowWrap = "anywhere";
    out.style.wordBreak = "break-word";
    out.style.maxWidth = "100%";

    // Base typography for PDF text replacements
    out.style.border = "0";
    out.style.background = "transparent";
    out.style.color = "#0b0f14";
    out.style.fontSize = isArea ? "12.5px" : "13px";
    out.style.lineHeight = isArea ? "1.55" : "1.35";
    out.style.padding = "0";

    if (inItems) {
      out.style.padding = "10px";
    } else if (inTotals) {
      // totals should look like a document, not a form
      out.style.border = "0";
      out.style.padding = "0";
      out.style.background = "transparent";
      out.style.fontWeight = "900";
      out.style.textAlign = "right";
    } else {
      // Everything else should read like printed content
      out.style.border = "0";
      out.style.background = "transparent";

      if (inMeta) {
        // Keep meta strip height + create a “printed label/value” feel
        out.style.textAlign = "center";
        out.style.fontWeight = "950";
        out.style.letterSpacing = ".02em";
        out.style.padding = "9px 0 7px";
        out.style.minHeight = "34px";

        if (bindKey === "quote_no") {
          out.style.letterSpacing = ".10em";
        }
      } else if (inBill || inJob) {
        out.style.textAlign = "left";
        out.style.padding = "2px 0";
        out.style.minHeight = "18px";

        if (bindKey === "client_name") {
          out.style.fontWeight = "950";
          out.style.fontSize = "14px";
        } else {
          out.style.fontWeight = "700";
        }
      } else if (inInline) {
        // Deposit due row – keep it clean but aligned like a number
        out.style.textAlign = "right";
        out.style.fontWeight = "950";
        out.style.minWidth = "160px";
      } else {
        // Default: plain printed text (no borders)
        out.style.textAlign = isArea ? "left" : "left";
        out.style.fontWeight = isArea ? "700" : "700";
        if (isArea) out.style.paddingTop = "2px";
      }
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

    // If none of the items show qty/unit/unit price, collapse those columns for a cleaner PDF.
    applyItemsTablePdfRules(table);

    const wrap = table.closest(".table-wrap");
    if (wrap) wrap.style.overflow = "visible";
  }

  return clone;
}

function applyItemsTablePdfRules(table) {
  const bodyRows = Array.from(table.querySelectorAll("tbody tr.item-row"));
  if (!bodyRows.length) return;

  const anyShowsBreakdown = bodyRows.some((r) => r.dataset.showQtyUnitPrice === "1");

  // In the cloned table (no-print removed) indexes are:
  // 0 Item | 1 Qty | 2 Unit | 3 Unit Price | 4 Tax | 5 Line Total
  const breakdownCols = [1, 2, 3];

  if (!anyShowsBreakdown) {
    removeTableColumns(table, breakdownCols);
    // After collapsing columns, re-balance widths so large totals never
    // spill outside the right edge in the PDF (eg. $122,000.00).
    tuneCollapsedItemsTable(table);
    return;
  }

  // Mixed mode: keep columns but blank them for total-only rows.
  bodyRows.forEach((row) => {
    if (row.dataset.showQtyUnitPrice !== "0") return;
    breakdownCols.forEach((idx) => {
      const cell = row.children[idx];
      if (cell) cell.textContent = "";
    });
  });
}

function tuneCollapsedItemsTable(table) {
  // Collapsed layout is: 0 Item | 1 Tax | 2 Line Total
  const cg = table.querySelector("colgroup");
  if (cg && cg.children.length === 3) {
    cg.children[0].style.width = "auto";
    cg.children[1].style.width = "10%";
    cg.children[2].style.width = "22%";
  }
}

function removeTableColumns(table, colIndexes) {
  const sorted = [...colIndexes].sort((a, b) => b - a);
  const headRow = table.tHead?.rows?.[0];

  sorted.forEach((idx) => {
    if (headRow?.children?.[idx]) headRow.children[idx].remove();
  });

  Array.from(table.tBodies?.[0]?.rows || []).forEach((row) => {
    sorted.forEach((idx) => {
      if (row.children?.[idx]) row.children[idx].remove();
    });
  });

  const cg = table.querySelector("colgroup");
  if (cg) {
    sorted.forEach((idx) => {
      if (cg.children?.[idx]) cg.children[idx].remove();
    });
  }
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

  // Keep a small margin so sections don't touch the top of a new page
  const marginPt = 22; // ~0.30"
  const contentW = pdfW - marginPt * 2;
  const contentH = pdfH - marginPt * 2;

  const canvasW = canvas.width;
  const canvasH = canvas.height;

  const scaleFactor = canvasW / clone.offsetWidth;
  const idealPageHeightPxCanvas = Math.floor(canvasW * (contentH / contentW));
  const cuts = computeCutPositionsPx(clone, scaleFactor, idealPageHeightPxCanvas);

  // IMPORTANT: avoid trailing blank PDF pages.
  // `cuts` always ends at the last real content bottom (maxBottom), so we use that
  // instead of the full canvas height (which can include extra whitespace).
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

    // Skip tiny slices (can happen from rounding and looks like a blank page)
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

/* ===== Main ===== */
async function main() {
  await requireAdminOrRedirect({ redirectTo: "../index.html" });

  // Company + user context (letterhead + prepared-by)
  let ctx;
  try {
    ctx = await getContext();
  } catch (e) {
    showMsg(e?.message || "Failed to load company context.");
    return;
  }

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

// If this quote has no saved terms yet (older quotes / imported quotes),
// pull the current Company Settings *once* as a starting point.
// After you save, the terms are stored on the quote and won't change when Settings change.
if (!safeStr(data.terms) && safeStr(ctx?.company?.payment_terms)) {
  data.terms = safeStr(ctx.company.payment_terms);
}


  // If this quote is linked to a customer, pull in their phone/address so Bill To is pre-filled.
  ensureBillToFromQuoteRow(data, qRow);
  await hydrateBillToFromCustomer(data, qRow);

  fillUIFromData(qRow, data, ctx);

  // Keep the manual "Mark as Accepted" button in sync with the current quote status.
  syncMarkAcceptedButton(qRow.status);

  backBtn.addEventListener("click", () => {
    window.location.href = "./dashboard.html";
  });

  addItemBtn.addEventListener("click", () => {
    itemRowsEl.appendChild(buildItemRow());
    recalcTotals();
  });

  // Add from Products
  addProductBtn?.addEventListener("click", async () => {
    openDialog(productsDialog);
    if (productsSearchEl) productsSearchEl.value = "";
    await loadProductsIntoDialog("");
    setTimeout(() => productsSearchEl?.focus(), 0);
  });

  productsCloseBtn?.addEventListener("click", () => closeDialog(productsDialog));
  productsSearchEl?.addEventListener(
    "input",
    debounce(() => loadProductsIntoDialog(productsSearchEl.value || ""), 180)
  );

  taxRateEl.addEventListener("input", recalcTotals);
  feesEl.addEventListener("input", recalcTotals);

  // Payment schedule controls
  addPaymentStepBtn?.addEventListener("click", addPaymentScheduleStep);
  useDefaultScheduleBtn?.addEventListener("click", () => {
    renderPaymentSchedule(defaultPaymentSchedule(ctx));
    showMsg("Payment schedule reset to your company default.");
    syncPaymentScheduleUI(_lastTotals?.total_cents ?? 0);
  });

  quoteDateInput?.addEventListener("change", () => {
    syncRepDateFromQuoteDate();
  });

/* =======================
   AUTO-SAVE (admin)
   - Saves after changes with a short debounce so users don't lose work.
   - Replaces the always-visible "Save" button with a clear status pill.
   - If auto-save fails (network), we reveal a "Retry Save" button.
   ======================= */
const AUTO_SAVE_DELAY_MS = 900;

let _autoDirty = false;
let _autoTimer = null;
let _autoInFlight = null;
let _lastAutoErrorAt = 0;

function setStateSaved() {
  setSaveState("saved", "All changes saved");
  setManualSaveVisible(false);
}

function setStateSaving() {
  setSaveState("saving", "Saving…");
  // If the user previously had an error, hide the retry button as soon as they edit again.
  setManualSaveVisible(false);
}

function setStateAttention(message) {
  setSaveState("attention", message || "Needs info to save");
  setManualSaveVisible(false);
}

function setStateError(message) {
  setSaveState("error", message || "Not saved");
  setManualSaveVisible(true, "Retry Save");
}

// We just loaded the quote from the server, so we're in a "saved" state.
setStateSaved();

function scheduleAutoSave() {
  clearTimeout(_autoTimer);
  _autoTimer = setTimeout(() => runAutoSave(), AUTO_SAVE_DELAY_MS);
}

function markDirty() {
  _autoDirty = true;

  // Update the status immediately so the user understands they don't need a Save button.
  if (canAutoSaveNow()) {
    setStateSaving();
  }
  // If canAutoSaveNow() returns false, it already set a helpful status message.

  scheduleAutoSave();
}

async function flushAutoSave() {
  clearTimeout(_autoTimer);
  if (_autoInFlight) {
    try { await _autoInFlight; } catch {}
  }
}

function canAutoSaveNow() {
  // Match the same validation rules as manual Save/Send/PDF
  const name = safeStr(getBoundValue("client_name"));
  if (!name) {
    setStateAttention("Add customer name to save");
    return false;
  }

  if (paymentScheduleBodyEl) {
    const v = validatePaymentSchedule(readPaymentScheduleFromUI());
    if (!v.ok) {
      setStateAttention(v.message || "Fix payment schedule to save");
      return false;
    }
  }

  return true;
}

function runAutoSave() {
  if (!_autoDirty) return;
  if (_autoInFlight) return;

  // If a manual action is running, try again shortly.
  if (saveBtn?.disabled || sendBtn?.disabled || pdfBtn?.disabled) {
    scheduleAutoSave();
    return;
  }

  if (!canAutoSaveNow()) return;

  setStateSaving();

  _autoInFlight = (async () => {
    try {
      const saved = await saveNow({ quiet: true });
      if (saved) {
        _autoDirty = false;
        setStateSaved();
      }
    } catch (e) {
      console.error("Auto-save failed:", e);
      setStateError("Not saved");

      const now = Date.now();
      if (now - _lastAutoErrorAt > 12000) {
        _lastAutoErrorAt = now;
        showMsg("Auto-save failed. Please click Retry Save.");
        setTimeout(() => showMsg(""), 2600);
      }
    } finally {
      _autoInFlight = null;
    }
  })();

  return _autoInFlight;
}

function wireAutoSaveListeners() {
  if (!quotePageEl) return;

  // Typing/changes anywhere inside the quote triggers autosave.
  quotePageEl.addEventListener("input", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.matches("input, textarea, select")) markDirty();
  });

  quotePageEl.addEventListener("change", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.matches("input, textarea, select")) markDirty();
  });

  // Click actions that mutate the quote but don't fire input/change.
  quotePageEl.addEventListener("click", (e) => {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;

    if (
      el.closest('[data-action="remove"]') ||
      el.closest(".ps-remove") ||
      el.closest("#add-item") ||
      el.closest("#btn-add-payment-step") ||
      el.closest("#btn-use-default-schedule")
    ) {
      markDirty();
    }
  });

  // Adding a product from the dialog (Add button).
  productsDialog?.addEventListener("click", (e) => {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;

    const row = el.closest(".product-row");
    const btn = el.closest("button");
    if (!row || !btn) return;

    if (safeStr(btn.textContent).toLowerCase() === "add") {
      markDirty();
    }
  });
}

wireAutoSaveListeners();


  async function saveNow({ quiet = false } = {}) {
    // Preserve any customer acceptance signature so admin saves don't wipe it
    let existingAcceptance = qRow?.data?.acceptance || null;
    try {
      const latest = await getQuote(quoteId);
      existingAcceptance = latest?.data?.acceptance || existingAcceptance;
    } catch {}

    const payload = collectDataFromUI(qRow, existingAcceptance);

    // Payment schedule must be valid before saving/sending
    const schedV = validatePaymentSchedule(payload.payment_schedule);
    if (!schedV.ok) {
      setStateAttention(schedV.message || "Fix payment schedule to save");
      if (!quiet) showMsg(schedV.message || "Payment schedule must total 100%.");
      return null;
    }

    // Ensure acceptance (if present) is visible in the UI (so PDF includes it too)
    renderClientAcceptance(payload, qRow);

    if (!payload.bill_to.client_name) {
      setStateAttention("Add customer name to save");
      if (!quiet) showMsg("Customer name is required (Bill To).");
      return null;
    }

    setStateSaving();
    if (!quiet) showMsg("Saving…");

    const updated = await updateQuote(quoteId, {
      customer_name: payload.bill_to.client_name,
      customer_email: payload.bill_to.client_email || null,
      total_cents: payload.computed.total_cents,
      data: payload,
    });

    qRow = updated;
    quoteStatusEl.textContent = qRow.status || "Draft";
    syncMarkAcceptedButton(qRow.status);

    quoteCodeEl.textContent = payload.quote_code;
    if (docQuoteCodeEl) docQuoteCodeEl.textContent = payload.quote_code;

    // Any successful save means there are no pending unsaved changes.
    _autoDirty = false;
    setStateSaved();

    if (!quiet) {
      showMsg("Saved.");
      setTimeout(() => showMsg(""), 800);
    }

    return { qRow, payload };
  }

  saveBtn?.addEventListener("click", async () => {
    try {
      await flushAutoSave();
      saveBtn.disabled = true;

      const saved = await saveNow({ quiet: true });
      if (!saved) return;

      showMsg("Saved.");
      setTimeout(() => showMsg(""), 900);
    } catch (e) {
      console.error(e);
      setStateError("Not saved");
      showMsg(e?.message || "Save failed.");
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
  sendBtn?.addEventListener("click", async () => {
    try {
      sendBtn.disabled = true;

      await flushAutoSave();

      const saved = await saveNow();
      if (!saved) return;

      const { payload } = saved;

      if (!payload.bill_to.client_email) {
        showMsg("Customer email is required to send.");
        return;
      }

      showMsg("Sending email…");

      const result = await postJSON("/api/send-quote-link", {
        quote_id: quoteId,
      });

      // Update UI if API returns status
      if (result?.status) {
        quoteStatusEl.textContent = result.status;
        syncMarkAcceptedButton(result.status);
      }

      // Copy link (nice touch)
      if (result?.view_url && navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(result.view_url); } catch {}
      }

      showMsg("Sent. Customer link copied to clipboard.");
      setTimeout(() => showMsg(""), 1400);
    } catch (e) {
      showMsg(e?.message || "Send failed.");
    } finally {
      sendBtn.disabled = false;
    }
  });

  // Manual: Mark quote as Accepted (without a customer signature)
  markAcceptedBtn?.addEventListener("click", async () => {
    try {
      if (isCancelledStatus(qRow?.status)) {
        showMsg("This quote is cancelled.");
        return;
      }
      if (isAcceptedStatus(qRow?.status)) return;

      const ok = window.confirm(
        "Mark this quote as Accepted?\n\nUse this when a customer approves without signing online (eg. deposit received).\nThis does NOT add a customer signature."
      );
      if (!ok) return;

      markAcceptedBtn.disabled = true;

      await flushAutoSave();
      const saved = await saveNow();
      if (!saved) return;

      const { payload } = saved;

      // Record internal audit info (customer can still sign later)
      const nowIso = new Date().toISOString();
      const data = (payload && typeof payload === "object") ? { ...payload } : {};
      data.meta = (data.meta && typeof data.meta === "object") ? { ...data.meta } : {};
      data.meta.manual_accepted_at = nowIso;
      data.meta.manual_accepted_by = String(ctx?.userName || ctx?.user?.email || "").trim();

      // Status drives dashboards + filtering. We intentionally do NOT create data.acceptance here.
      const updated = await updateQuote(quoteId, { status: "Accepted", data });
      qRow = updated;

      quoteStatusEl.textContent = qRow.status || "Accepted";
      syncMarkAcceptedButton(qRow.status);

      showMsg("Marked as accepted.");
      setTimeout(() => showMsg(""), 1200);
    } catch (e) {
      console.error(e);
      showMsg(e?.message || "Failed to mark as accepted.");
      setTimeout(() => showMsg(""), 2200);
    } finally {
      syncMarkAcceptedButton(qRow?.status);
    }
  });



  pdfBtn.addEventListener("click", async () => {
    try {
      pdfBtn.disabled = true;

      await flushAutoSave();

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
