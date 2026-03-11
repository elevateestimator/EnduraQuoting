import { supabase } from "../js/api.js";
import { makeDefaultQuoteData } from "../js/quoteDefaults.js";

/**
 * Command Center Dashboard
 * - Real last 30 day metrics + chart
 * - Proper navigation to all built pages
 */

const workspaceNameEl = document.getElementById("workspace-name");
const userEmailEl = document.getElementById("user-email");
const errorBox = document.getElementById("error-box");

const toastEl = document.getElementById("toast");

// Primary actions
const createBtn = document.getElementById("create-btn");
const createBtnHero = document.getElementById("create-btn-hero");
const qaCreate = document.getElementById("qa-create");
const logoutBtn = document.getElementById("logout-btn");
const qaCustomers = document.getElementById("qa-customers");
const qaQuotes = document.getElementById("qa-quotes");
const qaProducts = document.getElementById("qa-products");
const qaSettings = document.getElementById("qa-settings");
const btnAllQuotes = document.getElementById("btn-all-quotes");
const btnViewAllRecent = document.getElementById("btn-view-all-recent");
const btnLeaderboard = document.getElementById("btn-leaderboard");

// Recent
const recentLoading = document.getElementById("recent-loading");
const recentEmpty = document.getElementById("recent-empty");
const recentList = document.getElementById("recent-list");

// Leads snippet
const leadsLoading = document.getElementById("leads-loading");
const leadsEmpty = document.getElementById("leads-empty");
const leadsList = document.getElementById("leads-list");
const btnViewAllLeads = document.getElementById("btn-view-all-leads");

// KPIs
const kpiDraft = document.getElementById("kpi-draft");
const kpiSent = document.getElementById("kpi-sent");
const kpiAccepted = document.getElementById("kpi-accepted");
const kpiAcceptedValue = document.getElementById("kpi-accepted-value");
const kpiPipeline = document.getElementById("kpi-pipeline");
const kpiClose = document.getElementById("kpi-close");
const teamOpenKpi = document.getElementById("team-open-kpi");
const teamOpenBar = document.getElementById("team-open-bar");
const teamCloseKpi = document.getElementById("team-close-kpi");
const teamCloseBar = document.getElementById("team-close-bar");

// Chart
const chartSvg = document.getElementById("chart-svg");
const chartYAxis = document.getElementById("chart-y-axis");
const chartXAxis = document.getElementById("chart-x-axis");
const chartEmpty = document.getElementById("chart-empty");
const chartPlotWrap = document.querySelector(".chart-plot-wrap");
let chartTooltip = document.getElementById("chart-tooltip");

const CHART_W = 1200;
const CHART_H = 280;
const CHART_TOP = 8;
const CHART_BOTTOM = 20;
const CHART_LEFT = 6;
const CHART_RIGHT = 6;
const CHART_X_TICKS = [0, 6, 12, 18, 24, 29];
const CHART_Y_SEGMENTS = 5;

// Dialog
const createDialog = document.getElementById("create-dialog");
const createForm = document.getElementById("create-form");
const createCancelBtn = document.getElementById("create-cancel");
const createSubmitBtn = document.getElementById("create-submit");
const createMsg = document.getElementById("create-msg");
const customerSearchEl = document.getElementById("customer_search");
const customerListEl = document.getElementById("customer_list");
const customerEmptyEl = document.getElementById("customer_empty");
const selectedCustomerEl = document.getElementById("selected_customer");
const selectedCustomerNameEl = document.getElementById("selected_customer_name");
const selectedCustomerMetaEl = document.getElementById("selected_customer_meta");
const quickCustomerToggleBtn = document.getElementById("quick_customer_toggle");
const quickCustomerPanel = document.getElementById("quick_customer_panel");
const quickCustomerNameEl = document.getElementById("quick_customer_name");
const quickCustomerCompanyEl = document.getElementById("quick_customer_company");
const quickCustomerEmailEl = document.getElementById("quick_customer_email");
const quickCustomerPhoneEl = document.getElementById("quick_customer_phone");
const quickCustomerAddressEl = document.getElementById("quick_customer_address");
const quickCustomerCancelBtn = document.getElementById("quick_customer_cancel");
const quickCustomerSubmitBtn = document.getElementById("quick_customer_submit");
const quickCustomerMsgEl = document.getElementById("quick_customer_msg");

let toastTimer = null;
const LAST_30_DAYS = 30;
let companyId = null;
let userId = null;
let allCustomers = [];
let selectedCustomer = null;

function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2400);
}

function setError(message) {
  if (!errorBox) return;
  if (!message) {
    errorBox.hidden = true;
    errorBox.textContent = "";
    return;
  }
  errorBox.hidden = false;
  errorBox.textContent = message;
}

function openDialog(d) {
  if (!d) return;
  if (typeof d.showModal === "function") d.showModal();
  else d.setAttribute("open", "");
}

function closeDialog(d) {
  if (!d) return;
  if (typeof d.close === "function") d.close();
  else d.removeAttribute("open");
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function splitFullName(name) {
  const parts = safeStr(name).split(/\s+/).filter(Boolean);
  return {
    first_name: parts.shift() || null,
    last_name: parts.join(" ") || null,
  };
}

function chooseCustomerDisplayName(c) {
  const first = safeStr(c?.first_name);
  const last = safeStr(c?.last_name);
  const full = [first, last].filter(Boolean).join(" ").trim();
  const company = safeStr(c?.company_name);
  if (company && full) return `${full} (${company})`;
  return company || full || safeStr(c?.email) || "Unnamed customer";
}

function chooseCustomerMeta(c) {
  return [safeStr(c?.email), safeStr(c?.phone), safeStr(c?.billing_address)].filter(Boolean).join(" • ") || "No extra details yet";
}

function customerSearchText(c) {
  return [
    chooseCustomerDisplayName(c),
    safeStr(c?.company_name),
    safeStr(c?.email),
    safeStr(c?.phone),
    safeStr(c?.billing_address),
  ].join(" ").toLowerCase();
}

function chooseLeadDisplayName(lead) {
  const first = safeStr(lead?.first_name);
  const last = safeStr(lead?.last_name);
  const full = [first, last].filter(Boolean).join(" ").trim();
  const company = safeStr(lead?.company_name);
  if (company && full) return `${full} (${company})`;
  return full || company || safeStr(lead?.email) || "Unnamed lead";
}

function chooseLeadSecondary(lead) {
  const email = safeStr(lead?.email);
  const phone = safeStr(lead?.phone);
  const company = safeStr(lead?.company_name);
  return company || [email, phone].filter(Boolean).join(" • ") || "No contact info yet";
}

function normalizeLeadStatus(status) {
  const s = safeStr(status).toLowerCase();
  return ["new", "contacted", "qualified", "won", "lost"].includes(s) ? s : "new";
}

function prettyLeadStatus(status) {
  const s = normalizeLeadStatus(status);
  if (s === "contacted") return "Contacted";
  if (s === "qualified") return "Qualified";
  if (s === "won") return "Won";
  if (s === "lost") return "Lost";
  return "New";
}

function normalizeLeadSource(source) {
  return safeStr(source).toLowerCase() || "manual";
}

function prettyLeadSource(source) {
  const s = normalizeLeadSource(source);
  if (s === "meta" || s === "meta lead ad" || s === "meta lead ads") return "Meta";
  if (s === "make") return "Make";
  if (s === "zapier") return "Zapier";
  if (s === "website") return "Website";
  if (s === "phone") return "Phone";
  if (s === "referral") return "Referral";
  if (s === "other") return "Other";
  return s ? s.replace(/(^|\s)\S/g, (m) => m.toUpperCase()) : "Manual";
}

function renderLeadSnippet(lead) {
  const item = document.createElement("div");
  item.className = "lead-snippet-item";
  item.addEventListener("click", () => {
    if (lead?.id) goTo(`./customer.html?id=${encodeURIComponent(lead.id)}`);
  });

  const main = document.createElement("div");
  main.className = "lead-snippet-main";

  const name = document.createElement("div");
  name.className = "lead-snippet-name";
  name.textContent = chooseLeadDisplayName(lead);

  const sub = document.createElement("div");
  sub.className = "lead-snippet-sub";
  sub.textContent = chooseLeadSecondary(lead);

  const meta = document.createElement("div");
  meta.className = "lead-snippet-meta";
  const source = document.createElement("span");
  source.className = "lead-source-pill";
  source.textContent = prettyLeadSource(lead?.lead_source);
  meta.appendChild(source);

  main.appendChild(name);
  main.appendChild(sub);
  main.appendChild(meta);

  const right = document.createElement("div");
  right.className = "lead-snippet-right";

  const status = document.createElement("span");
  status.className = `lead-status-badge ${normalizeLeadStatus(lead?.pipeline_status)}`;
  status.textContent = prettyLeadStatus(lead?.pipeline_status);

  const date = document.createElement("div");
  date.className = "lead-snippet-date";
  date.textContent = formatDateShort(lead?.created_at);

  right.appendChild(status);
  right.appendChild(date);

  item.appendChild(main);
  item.appendChild(right);
  return item;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setQuickCustomerMsg(text) {
  if (quickCustomerMsgEl) quickCustomerMsgEl.textContent = text || "";
}

function resetQuickCustomerForm() {
  if (quickCustomerNameEl) quickCustomerNameEl.value = "";
  if (quickCustomerCompanyEl) quickCustomerCompanyEl.value = "";
  if (quickCustomerEmailEl) quickCustomerEmailEl.value = "";
  if (quickCustomerPhoneEl) quickCustomerPhoneEl.value = "";
  if (quickCustomerAddressEl) quickCustomerAddressEl.value = "";
  setQuickCustomerMsg("");
}

function toggleQuickCustomerPanel(open) {
  if (!quickCustomerPanel) return;
  quickCustomerPanel.hidden = !open;
  if (quickCustomerToggleBtn) {
    quickCustomerToggleBtn.textContent = open ? "Hide quick add" : "+ Quick add customer";
  }
  if (open) {
    quickCustomerNameEl?.focus();
  } else {
    resetQuickCustomerForm();
  }
}

function updateCreateSubmitState() {
  if (!createSubmitBtn) return;
  const hasCustomer = !!selectedCustomer;
  createSubmitBtn.disabled = !hasCustomer;
  createSubmitBtn.textContent = hasCustomer ? "Create & open" : "Choose customer first";
}

function setSelectedCustomer(customer) {
  selectedCustomer = customer || null;

  if (selectedCustomer && selectedCustomerEl) {
    selectedCustomerEl.hidden = false;
    if (selectedCustomerNameEl) selectedCustomerNameEl.textContent = chooseCustomerDisplayName(selectedCustomer);
    if (selectedCustomerMetaEl) selectedCustomerMetaEl.textContent = chooseCustomerMeta(selectedCustomer);
  } else if (selectedCustomerEl) {
    selectedCustomerEl.hidden = true;
    if (selectedCustomerNameEl) selectedCustomerNameEl.textContent = "";
    if (selectedCustomerMetaEl) selectedCustomerMetaEl.textContent = "";
  }

  renderCustomerList(customerSearchEl?.value || "");
  updateCreateSubmitState();
}

function renderCustomerList(search = "") {
  if (!customerListEl) return;
  const q = safeStr(search).toLowerCase();
  const rows = q ? allCustomers.filter((c) => customerSearchText(c).includes(q)) : [...allCustomers];

  customerListEl.innerHTML = "";

  if (!rows.length) {
    if (customerEmptyEl) customerEmptyEl.hidden = false;
    customerListEl.innerHTML = '<div class="customer-loading">No matching customers.</div>';
    return;
  }

  if (customerEmptyEl) customerEmptyEl.hidden = true;

  for (const customer of rows) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "customer-option" + (selectedCustomer?.id === customer.id ? " is-selected" : "");
    btn.innerHTML = `
      <span class="customer-option-name">${escapeHtml(chooseCustomerDisplayName(customer))}</span>
      <span class="customer-option-meta">${escapeHtml(chooseCustomerMeta(customer))}</span>
    `;
    btn.addEventListener("click", () => {
      setCreateMsg("");
      setSelectedCustomer(customer);
    });
    customerListEl.appendChild(btn);
  }
}

async function loadCustomersForCreateDialog() {
  if (!customerListEl) return;
  customerListEl.innerHTML = '<div class="customer-loading">Loading customers…</div>';
  if (customerEmptyEl) customerEmptyEl.hidden = true;

  const { data, error } = await supabase
    .from("customers")
    .select("id, first_name, last_name, company_name, email, phone, billing_address")
    .limit(300);

  if (error) throw error;

  allCustomers = (data || []).sort((a, b) => chooseCustomerDisplayName(a).localeCompare(chooseCustomerDisplayName(b)));
  renderCustomerList(customerSearchEl?.value || "");
}

function buildQuoteSeedFromCustomer(customer) {
  const customer_name = chooseCustomerDisplayName(customer);
  const customer_email = safeStr(customer?.email) || null;
  const data = makeDefaultQuoteData({ customer_name, customer_email });
  data.customer_id = customer.id;
  data.bill_to = data.bill_to || {};
  data.bill_to.client_name = customer_name;
  data.bill_to.client_email = safeStr(customer?.email);
  data.bill_to.client_phone = safeStr(customer?.phone);
  data.bill_to.client_addr = safeStr(customer?.billing_address);
  return { customer_name, customer_email, data };
}

async function createCustomerRecord() {
  const rawName = safeStr(quickCustomerNameEl?.value);
  if (!rawName) throw new Error("Customer / homeowner name is required.");

  const { first_name, last_name } = splitFullName(rawName);
  const payloadBase = {
    first_name,
    last_name,
    company_name: safeStr(quickCustomerCompanyEl?.value) || null,
    email: safeStr(quickCustomerEmailEl?.value) || null,
    phone: safeStr(quickCustomerPhoneEl?.value) || null,
    billing_address: safeStr(quickCustomerAddressEl?.value) || null,
    company_id: companyId,
    created_by: userId,
  };

  let result = await supabase
    .from("customers")
    .insert(payloadBase)
    .select("id, first_name, last_name, company_name, email, phone, billing_address")
    .single();

  if (result.error && /created_by/i.test(String(result.error.message || result.error.details || ""))) {
    const { created_by, ...fallback } = payloadBase;
    result = await supabase
      .from("customers")
      .insert(fallback)
      .select("id, first_name, last_name, company_name, email, phone, billing_address")
      .single();
  }

  if (result.error) throw result.error;
  return result.data;
}

async function handleQuickCustomerCreate() {
  setQuickCustomerMsg("");
  setCreateMsg("");

  try {
    if (quickCustomerSubmitBtn) {
      quickCustomerSubmitBtn.disabled = true;
      quickCustomerSubmitBtn.textContent = "Saving…";
    }

    const customer = await createCustomerRecord();
    allCustomers = [customer, ...allCustomers.filter((c) => c.id !== customer.id)];
    if (customerSearchEl) customerSearchEl.value = "";
    setSelectedCustomer(customer);
    toggleQuickCustomerPanel(false);
    toast("Customer created.");
  } catch (err) {
    setQuickCustomerMsg(err?.message || "Failed to create customer.");
  } finally {
    if (quickCustomerSubmitBtn) {
      quickCustomerSubmitBtn.disabled = false;
      quickCustomerSubmitBtn.textContent = "Save customer";
    }
  }
}

async function openCreateQuoteDialog() {
  setError("");
  setCreateMsg("");
  setSelectedCustomer(null);
  if (customerSearchEl) customerSearchEl.value = "";
  toggleQuickCustomerPanel(false);
  openDialog(createDialog);
  customerSearchEl?.focus();

  try {
    await loadCustomersForCreateDialog();
  } catch (err) {
    setCreateMsg(err?.message || "Failed to load customers.");
    if (customerListEl) customerListEl.innerHTML = '<div class="customer-loading">Could not load customers.</div>';
  }
}

async function getCompanyContext(uid) {
  const { data, error } = await supabase
    .from("company_members")
    .select("company_id, role")
    .eq("user_id", uid)
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

async function createQuoteShellFromSelectedCustomer() {
  if (!selectedCustomer) throw new Error("Choose a customer first.");
  const seed = buildQuoteSeedFromCustomer(selectedCustomer);

  const payloadBase = {
    customer_name: seed.customer_name,
    customer_email: seed.customer_email,
    customer_id: selectedCustomer.id,
    total_cents: 0,
    currency: "CAD",
    status: "draft",
    data: seed.data,
    company_id: companyId,
    created_by: userId,
  };

  let result = await supabase.from("quotes").insert(payloadBase).select("id, quote_no").single();

  if (result.error && /customer_id/i.test(String(result.error.message || result.error.details || ""))) {
    const { customer_id, ...fallback } = payloadBase;
    result = await supabase.from("quotes").insert(fallback).select("id, quote_no").single();
  }

  if (result.error) throw result.error;
  return result.data;
}

function formatMoney(cents = 0, currency = "CAD") {
  const dollars = (Number(cents) || 0) / 100;
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(dollars);
}

function formatDateShort(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-CA", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return iso ?? "";
  }
}

function normalizeStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  if (["accepted", "signed"].includes(s)) return "accepted";
  if (["viewed"].includes(s)) return "viewed";
  if (["sent"].includes(s)) return "sent";
  if (["cancelled", "canceled"].includes(s)) return "cancelled";
  return s || "draft";
}

function badgeClass(status) {
  const s = normalizeStatus(status);
  if (s === "accepted") return "accepted";
  if (s === "sent") return "sent";
  if (s === "viewed") return "viewed";
  if (s === "cancelled") return "cancelled";
  return "draft";
}

function prettyStatus(status) {
  const s = normalizeStatus(status);
  if (s === "accepted") return "Accepted";
  if (s === "viewed") return "Viewed";
  if (s === "sent") return "Sent";
  if (s === "cancelled") return "Cancelled";
  return "Draft";
}

function renderRecentItem(q) {
  const item = document.createElement("div");
  item.className = "recent-item";

  item.addEventListener("click", () => {
    window.location.href = `./quote.html?id=${q.id}`;
  });

  const left = document.createElement("div");
  left.className = "recent-left";

  const top = document.createElement("div");
  top.className = "recent-top";

  const code = document.createElement("div");
  code.className = "quote-code";
  code.textContent = `Q-${q.quote_no}`;

  const badge = document.createElement("span");
  badge.className = `badge ${badgeClass(q.status)}`;
  badge.textContent = prettyStatus(q.status);

  top.appendChild(code);
  top.appendChild(badge);

  const customer = document.createElement("div");
  customer.className = "customer";
  customer.textContent = q.customer_name || "(No customer name)";

  left.appendChild(top);
  left.appendChild(customer);

  const right = document.createElement("div");
  right.className = "recent-right";

  const amt = document.createElement("div");
  amt.className = "amount";
  amt.textContent = formatMoney(q.total_cents ?? 0, q.currency ?? "CAD");

  const date = document.createElement("div");
  date.className = "date";
  date.textContent = formatDateShort(q.created_at);

  right.appendChild(amt);
  right.appendChild(date);

  item.appendChild(left);
  item.appendChild(right);

  return item;
}

function startOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function localDayKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function last30DayStart() {
  const today = startOfLocalDay(new Date());
  return addDays(today, -(LAST_30_DAYS - 1));
}

function buildDailySeries(quotes) {
  const start = last30DayStart();
  const buckets = [];
  const index = new Map();

  for (let i = 0; i < LAST_30_DAYS; i += 1) {
    const date = addDays(start, i);
    const key = localDayKey(date);
    const row = { date, key, open: 0, accepted: 0 };
    buckets.push(row);
    index.set(key, row);
  }

  for (const q of quotes) {
    if (!q?.created_at) continue;
    const key = localDayKey(new Date(q.created_at));
    const bucket = index.get(key);
    if (!bucket) continue;

    const cents = Number(q.total_cents || 0);
    const status = normalizeStatus(q.status);

    if (status === "accepted") {
      bucket.accepted += cents;
    } else if (status === "draft" || status === "sent" || status === "viewed") {
      bucket.open += cents;
    }
  }

  return buckets;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatCompactMoney(cents = 0) {
  const dollars = Math.abs(Number(cents || 0)) / 100;
  const sign = Number(cents || 0) < 0 ? "-" : "";

  if (dollars >= 1000000) {
    const v = dollars >= 10000000 ? Math.round(dollars / 1000000) : Math.round((dollars / 1000000) * 10) / 10;
    return `${sign}$${String(v).replace(/\.0$/, "")}M`;
  }

  if (dollars >= 1000) {
    const v = dollars >= 100000 ? Math.round(dollars / 1000) : Math.round((dollars / 1000) * 10) / 10;
    return `${sign}$${String(v).replace(/\.0$/, "")}k`;
  }

  return `${sign}$${Math.round(dollars).toLocaleString("en-CA")}`;
}

function formatAxisDate(date) {
  try {
    return new Date(date).toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}


function formatTooltipDate(date) {
  try {
    return new Date(date).toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function ensureChartTooltip() {
  if (!chartPlotWrap) return null;
  if (!chartTooltip) {
    chartTooltip = document.createElement("div");
    chartTooltip.id = "chart-tooltip";
    chartTooltip.className = "chart-tooltip";
    chartTooltip.hidden = true;
    chartTooltip.setAttribute("aria-hidden", "true");
    chartPlotWrap.appendChild(chartTooltip);
  }
  return chartTooltip;
}

function niceScaleMax(maxCents, segments = CHART_Y_SEGMENTS) {
  const raw = Math.max(0, Number(maxCents || 0));
  if (raw <= 0) return 0;

  const roughStep = raw / segments;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const residual = roughStep / magnitude;
  const niceSteps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];
  const niceResidual = niceSteps.find((step) => residual <= step) || 10;

  return niceResidual * magnitude * segments;
}

function buildChartPoints(values, scaleMax) {
  const usableW = CHART_W - CHART_LEFT - CHART_RIGHT;
  const usableH = CHART_H - CHART_TOP - CHART_BOTTOM;
  const max = Math.max(1, Number(scaleMax || 0));
  const step = values.length > 1 ? usableW / (values.length - 1) : usableW;

  return values.map((value, i) => {
    const x = CHART_LEFT + step * i;
    const y = CHART_TOP + usableH - (Number(value || 0) / max) * usableH;
    return { x, y, value: Number(value || 0) };
  });
}

function buildSmoothLinePath(points, minY = CHART_TOP, maxY = CHART_H - CHART_BOTTOM) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp1y = clamp(p1.y + (p2.y - p0.y) / 6, minY, maxY);
    const cp2y = clamp(p2.y - (p3.y - p1.y) / 6, minY, maxY);

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  return d;
}

function buildSmoothAreaPath(points, baseY = CHART_H - CHART_BOTTOM) {
  if (!points.length) return "";
  const line = buildSmoothLinePath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${line} L ${last.x.toFixed(2)} ${baseY.toFixed(2)} L ${first.x.toFixed(2)} ${baseY.toFixed(2)} Z`;
}

function renderYAxis(scaleMax, tickValues) {
  if (!chartYAxis) return;
  if (!tickValues.length) {
    chartYAxis.innerHTML = `<span class="chart-y-label is-bottom" style="top:100%">$0</span>`;
    return;
  }

  const usableH = CHART_H - CHART_TOP - CHART_BOTTOM;
  const max = Math.max(1, Number(scaleMax || 0));

  chartYAxis.innerHTML = tickValues
    .map((value, idx) => {
      const y = CHART_TOP + usableH - (Number(value || 0) / max) * usableH;
      const classes = ["chart-y-label"];
      if (idx === 0) classes.push("is-top");
      if (idx === tickValues.length - 1) classes.push("is-bottom");
      return `<span class="${classes.join(" ")}" style="top:${(y / CHART_H) * 100}%">${formatCompactMoney(value)}</span>`;
    })
    .join("");
}

function renderXAxis(series) {
  if (!chartXAxis) return;
  const usableW = CHART_W - CHART_LEFT - CHART_RIGHT;
  const step = series.length > 1 ? usableW / (series.length - 1) : usableW;

  chartXAxis.innerHTML = CHART_X_TICKS.map((idx, i) => {
    const safeIdx = Math.min(series.length - 1, Math.max(0, idx));
    const x = CHART_LEFT + step * safeIdx;
    const classes = ["chart-x-label"];
    if (i === 0) classes.push("is-start");
    if (i === CHART_X_TICKS.length - 1) classes.push("is-end");
    return `<span class="${classes.join(" ")}" style="left:${(x / CHART_W) * 100}%">${formatAxisDate(series[safeIdx]?.date)}</span>`;
  }).join("");
}

function hideChartTooltipAndHover() {
  if (chartTooltip) chartTooltip.hidden = true;
  const hoverGroup = chartSvg?.querySelector("#chart-hover-group");
  if (hoverGroup) hoverGroup.setAttribute("display", "none");
}

function positionChartTooltip(index, series, openPoints, acceptedPoints) {
  const tooltip = ensureChartTooltip();
  if (!tooltip || !chartPlotWrap) return;

  const day = series[index];
  tooltip.innerHTML = `
    <div class="chart-tooltip-date">${formatTooltipDate(day.date)}</div>
    <div class="chart-tooltip-row">
      <span class="chart-tooltip-swatch open"></span>
      <span class="chart-tooltip-label">Open pipeline</span>
      <span class="chart-tooltip-value">${formatMoney(day.open, "CAD")}</span>
    </div>
    <div class="chart-tooltip-row">
      <span class="chart-tooltip-swatch accepted"></span>
      <span class="chart-tooltip-label">Accepted</span>
      <span class="chart-tooltip-value">${formatMoney(day.accepted, "CAD")}</span>
    </div>
  `;
  tooltip.hidden = false;

  const wrapRect = chartPlotWrap.getBoundingClientRect();
  const anchorPoint = openPoints[index] && acceptedPoints[index]
    ? (openPoints[index].y <= acceptedPoints[index].y ? openPoints[index] : acceptedPoints[index])
    : (openPoints[index] || acceptedPoints[index]);

  const anchorX = (anchorPoint.x / CHART_W) * wrapRect.width;
  const anchorY = (anchorPoint.y / CHART_H) * wrapRect.height;

  const tooltipRect = tooltip.getBoundingClientRect();
  let left = anchorX + 14;
  if (left + tooltipRect.width > wrapRect.width - 10) {
    left = anchorX - tooltipRect.width - 14;
  }
  left = Math.max(10, Math.min(left, wrapRect.width - tooltipRect.width - 10));

  let top = anchorY - tooltipRect.height - 12;
  if (top < 10) top = anchorY + 14;
  top = Math.max(10, Math.min(top, wrapRect.height - tooltipRect.height - 10));

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showChartHover(index, series, openPoints, acceptedPoints, baseY) {
  const hoverGroup = chartSvg?.querySelector("#chart-hover-group");
  const hoverLine = chartSvg?.querySelector("#chart-hover-line");
  const hoverOpen = chartSvg?.querySelector("#chart-hover-open");
  const hoverAccepted = chartSvg?.querySelector("#chart-hover-accepted");
  if (!hoverGroup || !hoverLine || !hoverOpen || !hoverAccepted) return;

  const openPoint = openPoints[index];
  const acceptedPoint = acceptedPoints[index];

  hoverGroup.setAttribute("display", "block");
  hoverLine.setAttribute("x1", openPoint.x.toFixed(2));
  hoverLine.setAttribute("x2", openPoint.x.toFixed(2));
  hoverLine.setAttribute("y1", CHART_TOP.toFixed(2));
  hoverLine.setAttribute("y2", baseY.toFixed(2));

  hoverOpen.setAttribute("cx", openPoint.x.toFixed(2));
  hoverOpen.setAttribute("cy", openPoint.y.toFixed(2));
  hoverAccepted.setAttribute("cx", acceptedPoint.x.toFixed(2));
  hoverAccepted.setAttribute("cy", acceptedPoint.y.toFixed(2));

  positionChartTooltip(index, series, openPoints, acceptedPoints);
}

function wireChartHover(series, openPoints, acceptedPoints, baseY) {
  const hitArea = chartSvg?.querySelector(".chart-hit-area");
  if (!hitArea || !chartSvg || !chartPlotWrap || !series.length) return;

  const usableW = CHART_W - CHART_LEFT - CHART_RIGHT;
  const step = series.length > 1 ? usableW / (series.length - 1) : usableW;

  const getIndexFromEvent = (event) => {
    const rect = chartSvg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * CHART_W;
    const local = clamp(x - CHART_LEFT, 0, usableW);
    return clamp(Math.round(local / step), 0, series.length - 1);
  };

  const onMove = (event) => {
    const index = getIndexFromEvent(event);
    showChartHover(index, series, openPoints, acceptedPoints, baseY);
  };

  hitArea.addEventListener("mouseenter", onMove);
  hitArea.addEventListener("mousemove", onMove);
  hitArea.addEventListener("mouseleave", hideChartTooltipAndHover);
}

function renderChart(quotes) {
  if (!chartSvg) return;

  const series = buildDailySeries(quotes);
  const openValues = series.map((d) => d.open);
  const acceptedValues = series.map((d) => d.accepted);
  const hasAnyActivity = series.some((d) => d.open > 0 || d.accepted > 0);

  const maxRaw = Math.max(0, ...openValues, ...acceptedValues);
  const scaleMax = niceScaleMax(maxRaw);
  const tickValues = scaleMax > 0
    ? Array.from({ length: CHART_Y_SEGMENTS + 1 }, (_, i) => scaleMax - (scaleMax / CHART_Y_SEGMENTS) * i)
    : [0];

  const openPoints = buildChartPoints(openValues, scaleMax || 1);
  const acceptedPoints = buildChartPoints(acceptedValues, scaleMax || 1);
  const baseY = CHART_H - CHART_BOTTOM;
  const xStep = series.length > 1 ? (CHART_W - CHART_LEFT - CHART_RIGHT) / (series.length - 1) : (CHART_W - CHART_LEFT - CHART_RIGHT);

  renderYAxis(scaleMax, tickValues);
  renderXAxis(series);

  const svgParts = [];
  svgParts.push(`
    <defs>
      <linearGradient id="chart-open-gradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3b5bdb" stop-opacity="0.18"></stop>
        <stop offset="65%" stop-color="#3b5bdb" stop-opacity="0.06"></stop>
        <stop offset="100%" stop-color="#3b5bdb" stop-opacity="0"></stop>
      </linearGradient>
      <filter id="chart-soft-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#3b5bdb" flood-opacity="0.10"></feDropShadow>
      </filter>
    </defs>
  `);

  svgParts.push('<g class="chart-grid-group">');
  tickValues.forEach((value) => {
    const y = scaleMax > 0
      ? CHART_TOP + (CHART_H - CHART_TOP - CHART_BOTTOM) - (Number(value || 0) / scaleMax) * (CHART_H - CHART_TOP - CHART_BOTTOM)
      : baseY;
    svgParts.push(`<line x1="${CHART_LEFT}" y1="${y.toFixed(2)}" x2="${(CHART_W - CHART_RIGHT).toFixed(2)}" y2="${y.toFixed(2)}" class="chart-grid-line ${value === 0 ? 'is-zero' : ''}" />`);
  });
  CHART_X_TICKS.forEach((idx) => {
    const safeIdx = Math.min(series.length - 1, Math.max(0, idx));
    const x = CHART_LEFT + xStep * safeIdx;
    svgParts.push(`<line x1="${x.toFixed(2)}" y1="${CHART_TOP}" x2="${x.toFixed(2)}" y2="${baseY.toFixed(2)}" class="chart-grid-vertical" />`);
  });
  svgParts.push('</g>');

  const openPath = buildSmoothLinePath(openPoints);
  const acceptedPath = buildSmoothLinePath(acceptedPoints);
  const openAreaPath = buildSmoothAreaPath(openPoints, baseY);

  svgParts.push(`<path class="chart-open-area" d="${openAreaPath}" />`);
  svgParts.push(`<path class="chart-open-line" d="${openPath}" />`);
  svgParts.push(`<path class="chart-accepted-line" d="${acceptedPath}" />`);

  if (hasAnyActivity) {
    const latestOpen = [...openPoints].reverse().find((p) => p.value > 0) || openPoints[openPoints.length - 1];
    const latestAccepted = [...acceptedPoints].reverse().find((p) => p.value > 0) || acceptedPoints[acceptedPoints.length - 1];
    if (latestOpen) {
      svgParts.push(`<circle class="chart-open-point" cx="${latestOpen.x.toFixed(2)}" cy="${latestOpen.y.toFixed(2)}" r="4.5" />`);
    }
    if (latestAccepted) {
      svgParts.push(`<circle class="chart-accepted-point" cx="${latestAccepted.x.toFixed(2)}" cy="${latestAccepted.y.toFixed(2)}" r="4" />`);
    }
  }

  svgParts.push(`
    <g id="chart-hover-group" display="none">
      <line id="chart-hover-line" class="chart-hover-line" x1="0" y1="${CHART_TOP}" x2="0" y2="${baseY}" />
      <circle id="chart-hover-open" class="chart-hover-point open" cx="0" cy="0" r="5"></circle>
      <circle id="chart-hover-accepted" class="chart-hover-point accepted" cx="0" cy="0" r="4.5"></circle>
    </g>
  `);

  svgParts.push(`<rect class="chart-hit-area" x="${CHART_LEFT}" y="${CHART_TOP}" width="${(CHART_W - CHART_LEFT - CHART_RIGHT).toFixed(2)}" height="${(CHART_H - CHART_TOP - CHART_BOTTOM).toFixed(2)}"></rect>`);

  chartSvg.innerHTML = svgParts.join('');
  if (chartEmpty) chartEmpty.hidden = hasAnyActivity;

  ensureChartTooltip();
  hideChartTooltipAndHover();
  wireChartHover(series, openPoints, acceptedPoints, baseY);
}

function updateKPIs(quotes) {
  const counts = { draft: 0, sent: 0, accepted: 0 };
  let pipeline = 0;
  let acceptedValue = 0;

  for (const q of quotes) {
    const s = normalizeStatus(q.status);
    const total = Number(q.total_cents || 0);

    if (s === "accepted") {
      counts.accepted += 1;
      acceptedValue += total;
    } else if (s === "sent" || s === "viewed") {
      counts.sent += 1;
      pipeline += total;
    } else if (s === "draft") {
      counts.draft += 1;
      pipeline += total;
    }
  }

  const denom = counts.accepted + counts.sent + counts.draft;
  const closeRate = denom ? Math.round((counts.accepted / denom) * 100) : null;

  if (kpiDraft) kpiDraft.textContent = String(counts.draft);
  if (kpiSent) kpiSent.textContent = String(counts.sent);
  if (kpiAccepted) kpiAccepted.textContent = String(counts.accepted);
  if (kpiAcceptedValue) kpiAcceptedValue.textContent = formatMoney(acceptedValue, "CAD");
  if (kpiPipeline) kpiPipeline.textContent = formatMoney(pipeline, "CAD");
  if (kpiClose) kpiClose.textContent = closeRate === null ? "—%" : `${closeRate}%`;

  if (teamOpenKpi) teamOpenKpi.textContent = formatMoney(pipeline, "CAD");
  if (teamCloseKpi) teamCloseKpi.textContent = closeRate === null ? "—%" : `${closeRate}%`;
  if (teamOpenBar) {
    const acceptedOrOpen = pipeline + acceptedValue;
    const pct = acceptedOrOpen > 0 ? Math.round((pipeline / acceptedOrOpen) * 100) : 0;
    teamOpenBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  }
  if (teamCloseBar) {
    teamCloseBar.style.width = `${Math.min(100, Math.max(0, closeRate || 0))}%`;
  }
}

async function requireSessionOrRedirect() {
  const { data, error } = await supabase.auth.getSession();
  if (error) console.warn("getSession error", error);
  const session = data?.session;
  if (!session) {
    window.location.href = "../index.html";
    return null;
  }
  return session;
}

async function logout() {
  await supabase.auth.signOut();
  window.location.href = "../index.html";
}

function setCreateMsg(text) {
  if (createMsg) createMsg.textContent = text || "";
}

function wireCreateButtons() {
  const opens = [createBtn, createBtnHero, qaCreate].filter(Boolean);
  for (const b of opens) {
    b.addEventListener("click", openCreateQuoteDialog);
  }
}

function goTo(path) {
  window.location.href = path;
}

function wireRealNav() {
  const quoteButtons = [btnAllQuotes, btnViewAllRecent, btnLeaderboard, qaQuotes].filter(Boolean);
  quoteButtons.forEach((el) => {
    el.addEventListener("click", () => goTo("./quotes.html"));
  });

  if (btnViewAllLeads) {
    btnViewAllLeads.addEventListener("click", () => goTo("./leads.html"));
  }

  if (qaCustomers) {
    qaCustomers.addEventListener("click", () => goTo("./customers.html"));
  }
  if (qaProducts) {
    qaProducts.addEventListener("click", () => goTo("./products.html"));
  }
  if (qaSettings) {
    qaSettings.addEventListener("click", () => goTo("./settings.html"));
  }
}

async function loadDashboardQuotes() {
  setError("");
  if (recentEmpty) recentEmpty.hidden = true;
  if (recentList) recentList.innerHTML = "";
  if (recentLoading) recentLoading.hidden = false;

  try {
    const since = last30DayStart().toISOString();

    const { data, error } = await supabase
      .from("quotes")
      .select("id, quote_no, customer_name, customer_email, total_cents, currency, status, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    const quotes = data || [];

    if (recentLoading) recentLoading.hidden = true;

    if (!quotes.length) {
      if (recentEmpty) recentEmpty.hidden = false;
      updateKPIs([]);
      renderChart([]);
      return;
    }

    const recent = quotes.slice(0, 8);
    for (const q of recent) recentList.appendChild(renderRecentItem(q));

    updateKPIs(quotes);
    renderChart(quotes);
  } catch (e) {
    if (recentLoading) recentLoading.hidden = true;
    setError(e?.message || "Failed to load dashboard data.");
  }
}

async function loadRecentLeads() {
  if (!leadsList) return;

  if (leadsEmpty) leadsEmpty.hidden = true;
  leadsList.innerHTML = "";
  if (leadsLoading) leadsLoading.hidden = false;

  if (!companyId) {
    if (leadsLoading) leadsLoading.hidden = true;
    if (leadsEmpty) leadsEmpty.hidden = false;
    return;
  }

  try {
    const { data, error } = await supabase
      .from("customers")
      .select("id, first_name, last_name, company_name, email, phone, pipeline_status, lead_source, created_at")
      .eq("company_id", companyId)
      .not("pipeline_status", "is", null)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) throw error;

    const leads = data || [];

    if (leadsLoading) leadsLoading.hidden = true;

    if (!leads.length) {
      if (leadsEmpty) leadsEmpty.hidden = false;
      return;
    }

    for (const lead of leads) {
      leadsList.appendChild(renderLeadSnippet(lead));
    }
  } catch (e) {
    if (leadsLoading) leadsLoading.hidden = true;
    if (leadsEmpty) {
      leadsEmpty.hidden = false;
      const title = leadsEmpty.querySelector('.empty-title');
      const sub = leadsEmpty.querySelector('.empty-sub');
      if (title) title.textContent = 'Could not load leads';
      if (sub) sub.textContent = e?.message || 'Check your leads setup and try again.';
    }
  }
}

function inferWorkspaceName(session) {
  const md = session?.user?.user_metadata || {};
  const name =
    md.company_name ||
    md.company ||
    md.workspace ||
    md.business_name ||
    md.org ||
    md.organization ||
    "";
  if (name) return String(name);

  const email = session?.user?.email || "";
  const domain = email.includes("@") ? email.split("@")[1] : "";
  if (domain) return domain.replace(/^www\./, "");
  return "Workspace";
}

async function init() {
  wireCreateButtons();
  wireRealNav();

  if (logoutBtn) logoutBtn.addEventListener("click", logout);
  if (createCancelBtn) createCancelBtn.addEventListener("click", () => closeDialog(createDialog));

  const session = await requireSessionOrRedirect();
  if (!session) return;

  if (userEmailEl) userEmailEl.textContent = session.user.email || "";
  if (workspaceNameEl) workspaceNameEl.textContent = inferWorkspaceName(session);

  try {
    userId = session.user.id;
    const membership = await getCompanyContext(userId);
    companyId = membership?.company_id || null;

    if (!companyId) {
      setError("No company membership found for this account. Create a company or ask an admin to invite you.");
      [createBtn, createBtnHero, qaCreate].filter(Boolean).forEach((el) => (el.disabled = true));
    }
  } catch (err) {
    setError(err?.message || "Could not load company membership.");
    [createBtn, createBtnHero, qaCreate].filter(Boolean).forEach((el) => (el.disabled = true));
  }

  if (createForm) {
    customerSearchEl?.addEventListener("input", () => renderCustomerList(customerSearchEl.value || ""));
    quickCustomerToggleBtn?.addEventListener("click", () => toggleQuickCustomerPanel(quickCustomerPanel?.hidden ?? true));
    quickCustomerCancelBtn?.addEventListener("click", () => toggleQuickCustomerPanel(false));
    quickCustomerSubmitBtn?.addEventListener("click", handleQuickCustomerCreate);

    createForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      setCreateMsg("");

      if (!selectedCustomer) {
        setCreateMsg("Choose a customer first.");
        return;
      }

      try {
        createSubmitBtn.disabled = true;
        createSubmitBtn.textContent = "Creating…";

        const q = await createQuoteShellFromSelectedCustomer();

        closeDialog(createDialog);
        window.location.href = `./quote.html?id=${q.id}`;
      } catch (err) {
        setCreateMsg(err?.message || "Failed to create quote.");
      } finally {
        updateCreateSubmitState();
      }
    });
  }

  await Promise.all([loadDashboardQuotes(), loadRecentLeads()]);
}

init();
