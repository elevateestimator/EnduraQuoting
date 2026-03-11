import { supabase } from "../js/api.js";
import {
  listLeads,
  createLead,
  updateLead,
  deleteLead,
  getCompanyContext,
} from "../js/leadsApi.js";
import { createQuote } from "../js/quotesApi.js";
import { makeDefaultQuoteData } from "../js/quoteDefaults.js";

const workspaceNameEl = document.getElementById("workspace-name");
const userEmailEl = document.getElementById("user-email");
const errorBox = document.getElementById("error-box");
const toastEl = document.getElementById("toast");

const logoutBtn = document.getElementById("logout-btn");
const btnNew = document.getElementById("btn-new");
const btnNewInline = document.getElementById("btn-new-inline");
const btnCopyEndpoint = document.getElementById("btn-copy-endpoint");
const endpointUrlEl = document.getElementById("endpoint-url");

const searchEl = document.getElementById("search");
const statusFilterEl = document.getElementById("status-filter");
const countEl = document.getElementById("lead-count");

const metricTotalEl = document.getElementById("metric-total");
const metricNewEl = document.getElementById("metric-new");
const metricContactedEl = document.getElementById("metric-contacted");
const metricQualifiedEl = document.getElementById("metric-qualified");
const metricWonEl = document.getElementById("metric-won");
const metricLostEl = document.getElementById("metric-lost");

const loadingEl = document.getElementById("loading");
const emptyEl = document.getElementById("empty");
const hubWrap = document.getElementById("hub-wrap");
const leadListEl = document.getElementById("lead-list");

const dialog = document.getElementById("lead-dialog");
const form = document.getElementById("lead-form");
const cancelBtn = document.getElementById("lead-cancel");
const submitBtn = document.getElementById("lead-submit");
const dialogTitle = document.getElementById("dialog-title");
const dialogSub = document.getElementById("dialog-sub");
const metaEl = document.getElementById("lead-meta");
const msgEl = document.getElementById("lead-msg");

const firstNameEl = document.getElementById("first_name");
const lastNameEl = document.getElementById("last_name");
const companyNameEl = document.getElementById("company_name");
const emailEl = document.getElementById("email");
const phoneEl = document.getElementById("phone");
const addressEl = document.getElementById("address");
const statusEl = document.getElementById("status");
const sourceEl = document.getElementById("source");
const notesEl = document.getElementById("notes");

const STATUS_ORDER = ["new", "contacted", "qualified", "won", "lost"];
const STATUS_PRIORITY = Object.fromEntries(STATUS_ORDER.map((s, i) => [s, i]));

let toastTimer = null;
let searchTimer = null;
let mode = "create";
let editingId = null;

let allLeads = [];
let quotesByLeadId = new Map();
let _companyContext = null;
let _webhookUrl = "";

function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg || "";
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

function setFormMsg(message) {
  if (msgEl) msgEl.textContent = message || "";
}

function setMeta(text) {
  if (metaEl) metaEl.textContent = text || "";
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

function sanitizeString(s) {
  return String(s || "").trim();
}

function safeLower(s) {
  return sanitizeString(s).toLowerCase();
}

function normalizeOptional(s) {
  const v = sanitizeString(s);
  return v ? v : null;
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

function formatDateTimeShort(iso) {
  try {
    return new Date(iso).toLocaleString("en-CA", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso ?? "";
  }
}

function formatMoney(cents = 0, currency = "CAD") {
  const dollars = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(dollars);
  } catch {
    return `$${dollars.toFixed(2)}`;
  }
}

function setLoading(isLoading) {
  if (loadingEl) loadingEl.hidden = !isLoading;
}

function setEmpty(isEmpty) {
  if (emptyEl) emptyEl.hidden = !isEmpty;
  if (hubWrap) hubWrap.hidden = isEmpty;
}

function clearHub() {
  if (leadListEl) leadListEl.innerHTML = "";
}

function leadDisplayName(lead) {
  const first = sanitizeString(lead?.first_name);
  const last = sanitizeString(lead?.last_name);
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full || sanitizeString(lead?.company_name) || sanitizeString(lead?.email) || "(Unnamed customer)";
}

function quoteCustomerNameForLead(lead) {
  const first = sanitizeString(lead?.first_name);
  const last = sanitizeString(lead?.last_name);
  const full = [first, last].filter(Boolean).join(" ").trim();
  const company = sanitizeString(lead?.company_name);
  if (company && full) return `${full} (${company})`;
  return company || full || sanitizeString(lead?.email) || "Customer";
}

function normalizeStatus(status) {
  const s = sanitizeString(status).toLowerCase();
  return STATUS_ORDER.includes(s) ? s : "new";
}

function prettyStatus(status) {
  const s = normalizeStatus(status);
  if (s === "contacted") return "Contacted";
  if (s === "qualified") return "Qualified";
  if (s === "won") return "Won";
  if (s === "lost") return "Lost";
  return "New";
}

function normalizeSource(source) {
  const s = sanitizeString(source).toLowerCase();
  return s || "manual";
}

function prettySource(source) {
  const s = normalizeSource(source);
  if (s === "meta") return "Meta";
  if (s === "zapier") return "Zapier";
  if (s === "make") return "Make";
  if (s === "website") return "Website";
  if (s === "phone") return "Phone";
  if (s === "referral") return "Referral";
  if (s === "other") return "Other";
  return "Manual";
}

function ensureSourceOption(value, label = null) {
  if (!sourceEl) return;
  const normalized = normalizeSource(value);
  if (!normalized) return;
  const exists = Array.from(sourceEl.options || []).some((opt) => opt.value === normalized);
  if (exists) return;

  const opt = document.createElement("option");
  opt.value = normalized;
  opt.textContent = label || prettySource(normalized);
  sourceEl.appendChild(opt);
}

function isOpenQuoteStatus(status) {
  const s = sanitizeString(status).toLowerCase();
  return s === "draft" || s === "sent" || s === "viewed";
}

function isAcceptedQuoteStatus(status) {
  const s = sanitizeString(status).toLowerCase();
  return s === "accepted" || s === "signed";
}

function prettyQuoteStatus(status) {
  const s = sanitizeString(status).toLowerCase();
  if (isAcceptedQuoteStatus(s)) return "Accepted";
  if (s === "viewed") return "Viewed";
  if (s === "sent") return "Sent";
  if (s === "cancelled" || s === "canceled") return "Cancelled";
  return "Draft";
}

function quoteStatusClass(status) {
  const s = sanitizeString(status).toLowerCase();
  if (isAcceptedQuoteStatus(s)) return "accepted";
  if (s === "viewed") return "viewed";
  if (s === "sent") return "sent";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return "draft";
}

function getLeadQuotes(leadId) {
  return quotesByLeadId.get(leadId) || [];
}

function getLeadStats(lead) {
  const quotes = getLeadQuotes(lead.id);
  let openValue = 0;
  let acceptedValue = 0;
  let lastQuoteAt = null;

  for (const q of quotes) {
    const cents = Number(q.total_cents || 0);
    if (isAcceptedQuoteStatus(q.status)) acceptedValue += cents;
    else if (isOpenQuoteStatus(q.status)) openValue += cents;

    const t = q.created_at ? new Date(q.created_at).getTime() : NaN;
    if (!Number.isNaN(t) && (!lastQuoteAt || t > lastQuoteAt)) lastQuoteAt = t;
  }

  const leadUpdated = lead.updated_at ? new Date(lead.updated_at).getTime() : NaN;
  const leadCreated = lead.created_at ? new Date(lead.created_at).getTime() : NaN;
  const activityAt = Math.max(
    Number.isNaN(lastQuoteAt) ? 0 : lastQuoteAt,
    Number.isNaN(leadUpdated) ? 0 : leadUpdated,
    Number.isNaN(leadCreated) ? 0 : leadCreated,
  );

  return {
    quotes,
    quoteCount: quotes.length,
    openValue,
    acceptedValue,
    activityAt: activityAt || 0,
    lastQuoteAt,
  };
}

function updateMetrics(leads) {
  const counts = { total: leads.length, new: 0, contacted: 0, qualified: 0, won: 0, lost: 0 };
  for (const lead of leads) {
    const s = normalizeStatus(lead.status);
    counts[s] += 1;
  }
  if (metricTotalEl) metricTotalEl.textContent = String(counts.total);
  if (metricNewEl) metricNewEl.textContent = String(counts.new);
  if (metricContactedEl) metricContactedEl.textContent = String(counts.contacted);
  if (metricQualifiedEl) metricQualifiedEl.textContent = String(counts.qualified);
  if (metricWonEl) metricWonEl.textContent = String(counts.won);
  if (metricLostEl) metricLostEl.textContent = String(counts.lost);
}

function resetForm() {
  setFormMsg("");
  setMeta("");
  firstNameEl.value = "";
  lastNameEl.value = "";
  companyNameEl.value = "";
  emailEl.value = "";
  phoneEl.value = "";
  addressEl.value = "";
  statusEl.value = "new";
  sourceEl.value = "manual";
  notesEl.value = "";
}

function openCreate() {
  mode = "create";
  editingId = null;
  resetForm();
  dialogTitle.textContent = "New customer";
  dialogSub.textContent = "Add a new customer to your workspace and track them in pipeline.";
  submitBtn.textContent = "Create customer";
  openDialog(dialog);
  firstNameEl.focus();
}

function openEdit(lead) {
  mode = "edit";
  editingId = lead.id;
  setFormMsg("");
  setError("");

  firstNameEl.value = sanitizeString(lead.first_name);
  lastNameEl.value = sanitizeString(lead.last_name);
  companyNameEl.value = sanitizeString(lead.company_name);
  emailEl.value = sanitizeString(lead.email);
  phoneEl.value = sanitizeString(lead.phone);
  addressEl.value = sanitizeString(lead.address);
  statusEl.value = normalizeStatus(lead.status);
  ensureSourceOption(lead.source);
  sourceEl.value = normalizeSource(lead.source);
  notesEl.value = sanitizeString(lead.notes);

  dialogTitle.textContent = "Customer";
  dialogSub.textContent = "Update pipeline status, contact details, or notes without leaving the page.";
  submitBtn.textContent = "Save changes";
  setMeta(`Created: ${formatDateTimeShort(lead.created_at)} • Updated: ${formatDateTimeShort(lead.updated_at || lead.created_at)}`);

  openDialog(dialog);
  firstNameEl.focus();
}

function buildPayloadFromForm() {
  return {
    first_name: normalizeOptional(firstNameEl.value),
    last_name: normalizeOptional(lastNameEl.value),
    company_name: normalizeOptional(companyNameEl.value),
    email: normalizeOptional(emailEl.value),
    phone: normalizeOptional(phoneEl.value),
    address: normalizeOptional(addressEl.value),
    status: normalizeStatus(statusEl.value),
    source: normalizeSource(sourceEl.value),
    notes: normalizeOptional(notesEl.value),
  };
}

function validateLeadPayload(payload) {
  const hasIdentity = [payload.first_name, payload.last_name, payload.company_name, payload.email, payload.phone].some(Boolean);
  if (!hasIdentity) {
    return "Add at least a name, company, email, or phone so the customer is identifiable.";
  }
  return "";
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

function maybeMissingTableMessage(err) {
  const msg = String(err?.message || "").toLowerCase();
  if (
    msg.includes("pipeline_status") ||
    msg.includes("lead_source") ||
    msg.includes("lead_notes") ||
    (msg.includes("customers") && (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("relation")))
  ) {
    return "Customer pipeline columns not found yet. Run the customers_pipeline_columns.sql file from the earlier patch in Supabase, then refresh.";
  }
  return err?.message || "Failed to load customers.";
}

function buildWebhookUrl(webhookId, secret) {
  const url = new URL(`${window.location.origin}/api/customers-inbox/${encodeURIComponent(webhookId)}`);
  const s = sanitizeString(secret);
  if (s) url.searchParams.set("secret", s);
  return url.toString();
}

async function copyFutureEndpoint() {
  const fallback = `${window.location.origin}/api/customers-inbox/<company-webhook-id>?secret=<company-secret>`;
  const url = _webhookUrl || sanitizeString(endpointUrlEl?.textContent) || fallback;
  if (!url || url.includes("<company-webhook-id>") || url.includes("Run the webhook SQL patch first")) {
    toast("Run the webhook SQL patch first.");
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Webhook URL copied.");
  } catch {
    toast("Copy failed.");
  }
}

async function ensureCompanyContext() {
  if (_companyContext) return _companyContext;
  _companyContext = await getCompanyContext();
  return _companyContext;
}

async function loadWebhookEndpoint() {
  const fallback = `${window.location.origin}/api/customers-inbox/<company-webhook-id>?secret=<company-secret>`;
  if (btnCopyEndpoint) btnCopyEndpoint.textContent = "Copy webhook URL";
  if (endpointUrlEl) endpointUrlEl.textContent = fallback;

  try {
    const { companyId } = await ensureCompanyContext();
    const { data, error } = await supabase
      .from("companies")
      .select("lead_webhook_id, lead_webhook_secret")
      .eq("id", companyId)
      .single();

    if (error) throw error;

    const webhookId = sanitizeString(data?.lead_webhook_id);
    if (!webhookId) throw new Error("Missing lead_webhook_id");

    _webhookUrl = buildWebhookUrl(webhookId, data?.lead_webhook_secret);
    if (endpointUrlEl) endpointUrlEl.textContent = _webhookUrl;
  } catch (err) {
    const msg = String(err?.message || "").toLowerCase();
    if (msg.includes("lead_webhook_id") || msg.includes("lead_webhook_secret")) {
      if (endpointUrlEl) endpointUrlEl.textContent = "Run the webhook SQL patch first";
    } else if (endpointUrlEl) {
      endpointUrlEl.textContent = fallback;
    }
  }
}

async function fetchQuotesIndex(leads) {
  const byLead = new Map();
  for (const lead of leads) byLead.set(lead.id, []);
  if (!leads.length) return byLead;

  const { companyId } = await ensureCompanyContext();

  const ids = new Set(leads.map((lead) => lead.id));
  const emailToLeadId = new Map();
  const nameToLeadId = new Map();
  const duplicateNames = new Set();

  for (const lead of leads) {
    const email = safeLower(lead.email);
    if (email) emailToLeadId.set(email, lead.id);

    const name = safeLower(leadDisplayName(lead));
    if (!name) continue;
    if (nameToLeadId.has(name) && nameToLeadId.get(name) !== lead.id) duplicateNames.add(name);
    else nameToLeadId.set(name, lead.id);
  }

  let rows = [];

  try {
    const { data, error } = await supabase
      .from("quotes")
      .select("id, company_id, customer_id, quote_no, customer_name, customer_email, total_cents, currency, status, created_at, data")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) throw error;
    rows = data || [];
  } catch (err) {
    const msg = String(err?.message || "").toLowerCase();
    const missingCustomerId = msg.includes("customer_id") && (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("not found"));
    if (!missingCustomerId) throw err;

    const { data, error } = await supabase
      .from("quotes")
      .select("id, company_id, quote_no, customer_name, customer_email, total_cents, currency, status, created_at, data")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) throw error;
    rows = data || [];
  }

  for (const row of rows) {
    let leadId = row.customer_id || row?.data?.customer_id || null;

    if (!leadId) {
      const email = safeLower(row.customer_email);
      if (email && emailToLeadId.has(email)) leadId = emailToLeadId.get(email);
    }

    if (!leadId) {
      const name = safeLower(row.customer_name);
      if (name && nameToLeadId.has(name) && !duplicateNames.has(name)) leadId = nameToLeadId.get(name);
    }

    if (leadId && ids.has(leadId)) byLead.get(leadId).push(row);
  }

  for (const [leadId, rowsForLead] of byLead.entries()) {
    rowsForLead.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    byLead.set(leadId, rowsForLead);
  }

  return byLead;
}

async function loadLeads() {
  setError("");
  setLoading(true);
  setEmpty(false);
  clearHub();

  try {
    allLeads = await listLeads({ limit: 500 });
    quotesByLeadId = await fetchQuotesIndex(allLeads);
    renderHub();
  } catch (err) {
    setError(maybeMissingTableMessage(err));
    allLeads = [];
    quotesByLeadId = new Map();
    updateMetrics([]);
    setEmpty(true);
  } finally {
    setLoading(false);
  }
}

function getFilteredLeads() {
  const term = safeLower(searchEl?.value || "");
  const wantedStatus = normalizeOptional(statusFilterEl?.value || "");

  return allLeads.filter((lead) => {
    const leadStatus = normalizeStatus(lead.status);
    if (wantedStatus && leadStatus !== wantedStatus) return false;
    if (!term) return true;

    const quotes = getLeadQuotes(lead.id);
    const quoteHay = quotes
      .map((q) => `Q-${q.quote_no} ${prettyQuoteStatus(q.status)} ${formatMoney(q.total_cents || 0, q.currency || "CAD")}`)
      .join(" ");

    const hay = [
      leadDisplayName(lead),
      sanitizeString(lead.company_name),
      sanitizeString(lead.email),
      sanitizeString(lead.phone),
      sanitizeString(lead.address),
      sanitizeString(lead.notes),
      prettyStatus(lead.status),
      prettySource(lead.source),
      quoteHay,
    ]
      .join(" ")
      .toLowerCase();

    return hay.includes(term);
  });
}

function sortLeadsForHub(leads) {
  return [...leads].sort((a, b) => {
    const pa = STATUS_PRIORITY[normalizeStatus(a.status)] ?? 999;
    const pb = STATUS_PRIORITY[normalizeStatus(b.status)] ?? 999;
    if (pa !== pb) return pa - pb;

    const sa = getLeadStats(a).activityAt;
    const sb = getLeadStats(b).activityAt;
    if (sa !== sb) return sb - sa;

    return new Date(b.created_at) - new Date(a.created_at);
  });
}

function quotePill(q) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quote-pill";
  button.addEventListener("click", () => {
    window.location.href = `./quote.html?id=${q.id}`;
  });

  const top = document.createElement("div");
  top.className = "quote-pill-top";

  const code = document.createElement("div");
  code.className = "quote-pill-code";
  code.textContent = `Q-${q.quote_no}`;

  const amount = document.createElement("div");
  amount.className = "quote-pill-amount";
  amount.textContent = formatMoney(q.total_cents || 0, q.currency || "CAD");

  top.appendChild(code);
  top.appendChild(amount);

  const status = document.createElement("div");
  status.className = `quote-pill-status ${quoteStatusClass(q.status)}`;
  status.textContent = prettyQuoteStatus(q.status);

  button.appendChild(top);
  button.appendChild(status);
  return button;
}

async function createQuoteForLead(lead, triggerBtn) {
  const originalText = triggerBtn?.textContent || "Create quote";

  try {
    setError("");
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = "Creating…";
    }

    const customer_name = quoteCustomerNameForLead(lead);
    const customer_email = normalizeOptional(lead.email);

    const data = makeDefaultQuoteData({ customer_name, customer_email });
    if (data && typeof data === "object") data.customer_id = lead.id;

    const payload = {
      customer_id: lead.id,
      customer_name,
      customer_email,
      total_cents: 0,
      currency: "CAD",
      data,
    };

    let q = null;

    try {
      q = await createQuote(payload);
    } catch (err) {
      const msg = String(err?.message || "").toLowerCase();
      if (msg.includes("customer_id") || msg.includes("column") || msg.includes("schema")) {
        const fallback = { ...payload };
        delete fallback.customer_id;
        q = await createQuote(fallback);
      } else {
        throw err;
      }
    }

    if (!q?.id) throw new Error("Quote created but missing id.");
    window.location.href = `./quote.html?id=${q.id}`;
  } catch (err) {
    setError(err?.message || "Failed to create quote.");
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = originalText;
    }
  }
}

function renderLeadCard(lead) {
  const stats = getLeadStats(lead);
  const card = document.createElement("article");
  card.className = "lead-card";

  const top = document.createElement("div");
  top.className = "lead-card-top";

  const main = document.createElement("div");
  main.className = "lead-main";

  const nameRow = document.createElement("div");
  nameRow.className = "lead-name-row";

  const nameEl = document.createElement("div");
  nameEl.className = "lead-name";
  nameEl.textContent = leadDisplayName(lead);
  nameRow.appendChild(nameEl);

  if (sanitizeString(lead.company_name) && sanitizeString(lead.company_name) !== leadDisplayName(lead)) {
    const companyEl = document.createElement("div");
    companyEl.className = "lead-company";
    companyEl.textContent = lead.company_name;
    nameRow.appendChild(companyEl);
  }

  const contactBits = [sanitizeString(lead.email), sanitizeString(lead.phone)].filter(Boolean);
  const contactEl = document.createElement("div");
  contactEl.className = "lead-contact-inline";
  contactEl.textContent = contactBits.length ? contactBits.join(" • ") : "No contact info yet";

  const notesValue = sanitizeString(lead.notes);
  const notesPreview = notesValue.length > 220 ? `${notesValue.slice(0, 220).trim()}…` : notesValue;
  const noteEl = document.createElement("div");
  noteEl.className = "lead-notes";
  noteEl.textContent = notesPreview || "No notes yet. Add what came in, timing, job details, objections, or follow-up reminders.";

  main.appendChild(nameRow);
  main.appendChild(contactEl);
  main.appendChild(noteEl);

  const meta = document.createElement("div");
  meta.className = "lead-meta-stack";

  const badges = document.createElement("div");
  badges.className = "lead-meta-badges";

  const statusBadge = document.createElement("span");
  statusBadge.className = `lead-badge ${normalizeStatus(lead.status)}`;
  statusBadge.textContent = prettyStatus(lead.status);

  const sourceBadge = document.createElement("span");
  sourceBadge.className = `source-badge ${normalizeSource(lead.source)}`;
  sourceBadge.textContent = prettySource(lead.source);

  badges.appendChild(statusBadge);
  badges.appendChild(sourceBadge);

  const dateEl = document.createElement("div");
  dateEl.className = "lead-date";
  dateEl.textContent = stats.lastQuoteAt ? `Last quote ${formatDateShort(new Date(stats.lastQuoteAt).toISOString())}` : `Created ${formatDateShort(lead.created_at)}`;

  meta.appendChild(badges);
  meta.appendChild(dateEl);

  top.appendChild(main);
  top.appendChild(meta);

  const statGrid = document.createElement("div");
  statGrid.className = "lead-stats";
  const statDefs = [
    { label: "Quotes", value: String(stats.quoteCount), mono: true },
    { label: "Open value", value: formatMoney(stats.openValue, "CAD") },
    { label: "Accepted", value: formatMoney(stats.acceptedValue, "CAD") },
    { label: "Last activity", value: stats.activityAt ? formatDateShort(new Date(stats.activityAt).toISOString()) : "—" },
  ];
  statDefs.forEach((stat) => {
    const box = document.createElement("div");
    box.className = "hub-stat";
    box.innerHTML = `<div class="hub-stat-k">${stat.label}</div><div class="hub-stat-v ${stat.mono ? "mono" : ""}">${stat.value}</div>`;
    statGrid.appendChild(box);
  });

  const quotesSection = document.createElement("div");
  quotesSection.className = "lead-quotes";

  const qHead = document.createElement("div");
  qHead.className = "lead-quotes-head";
  qHead.innerHTML = `<div class="lead-quotes-title">Quotes</div><div class="lead-quotes-sub">Most recent quotes for this lead</div>`;

  const qList = document.createElement("div");
  qList.className = "quote-pill-list";
  if (!stats.quotes.length) {
    const empty = document.createElement("div");
    empty.className = "quote-empty";
    empty.textContent = "No quotes yet — use Create quote to start moving this lead forward.";
    qList.appendChild(empty);
  } else {
    stats.quotes.slice(0, 4).forEach((q) => qList.appendChild(quotePill(q)));
    if (stats.quotes.length > 4) {
      const more = document.createElement("div");
      more.className = "quote-more";
      more.textContent = `+${stats.quotes.length - 4} more in customer view`;
      qList.appendChild(more);
    }
  }

  quotesSection.appendChild(qHead);
  quotesSection.appendChild(qList);

  const actions = document.createElement("div");
  actions.className = "lead-actions";

  const createQuoteBtn = document.createElement("button");
  createQuoteBtn.className = "btn btn-primary";
  createQuoteBtn.type = "button";
  createQuoteBtn.textContent = "Create quote";
  createQuoteBtn.addEventListener("click", () => createQuoteForLead(lead, createQuoteBtn));

  const viewCustomerLink = document.createElement("a");
  viewCustomerLink.className = "btn btn-secondary";
  viewCustomerLink.href = `./customer.html?id=${encodeURIComponent(lead.id)}`;
  viewCustomerLink.textContent = "View customer";

  const editBtn = document.createElement("button");
  editBtn.className = "btn btn-secondary";
  editBtn.type = "button";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => openEdit(lead));

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn btn-danger";
  deleteBtn.type = "button";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", async () => {
    const ok = window.confirm(`Delete ${leadDisplayName(lead)}?\n\nThis permanently removes the customer record.`);
    if (!ok) return;
    try {
      setError("");
      deleteBtn.disabled = true;
      await deleteLead(lead.id);
      toast("Customer deleted.");
      await loadLeads();
    } catch (err) {
      setError(err?.message || "Failed to delete customer.");
    } finally {
      deleteBtn.disabled = false;
    }
  });

  actions.appendChild(createQuoteBtn);
  actions.appendChild(viewCustomerLink);
  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  card.appendChild(top);
  card.appendChild(statGrid);
  card.appendChild(quotesSection);
  card.appendChild(actions);
  return card;
}

function renderGroup(status, leads) {
  const section = document.createElement("section");
  section.className = `lead-group ${status}`;

  const head = document.createElement("div");
  head.className = "lead-group-head";

  const title = document.createElement("div");
  title.className = "lead-group-title";
  title.innerHTML = `${prettyStatus(status)} <span class="lead-group-count">${leads.length}</span>`;

  const sub = document.createElement("div");
  sub.className = "lead-group-sub";
  if (status === "new") sub.textContent = "Fresh opportunities that need the fastest response.";
  else if (status === "contacted") sub.textContent = "Already touched — keep momentum and follow-up moving.";
  else if (status === "qualified") sub.textContent = "Best leads to quote, revisit, and push toward close.";
  else if (status === "won") sub.textContent = "Closed business kept visible for awareness and context.";
  else sub.textContent = "Closed out opportunities kept for reference.";

  head.appendChild(title);
  head.appendChild(sub);

  section.appendChild(head);
  leads.forEach((lead) => section.appendChild(renderLeadCard(lead)));
  return section;
}

function renderHub() {
  const filtered = sortLeadsForHub(getFilteredLeads());
  updateMetrics(filtered);
  if (countEl) countEl.textContent = String(filtered.length);

  clearHub();
  if (!filtered.length) {
    setEmpty(true);
    return;
  }
  setEmpty(false);

  const wantedStatus = normalizeOptional(statusFilterEl?.value || "");
  const groups = new Map();
  STATUS_ORDER.forEach((status) => groups.set(status, []));
  filtered.forEach((lead) => groups.get(normalizeStatus(lead.status)).push(lead));

  if (wantedStatus) {
    const only = groups.get(wantedStatus) || [];
    if (only.length) leadListEl.appendChild(renderGroup(wantedStatus, only));
    return;
  }

  STATUS_ORDER.forEach((status) => {
    const items = groups.get(status) || [];
    if (!items.length) return;
    leadListEl.appendChild(renderGroup(status, items));
  });
}

function wireSearch() {
  if (searchEl) {
    searchEl.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => renderHub(), 140);
    });
  }
  if (statusFilterEl) statusFilterEl.addEventListener("change", () => renderHub());
}

async function init() {
  if (logoutBtn) logoutBtn.addEventListener("click", logout);
  if (cancelBtn) cancelBtn.addEventListener("click", () => closeDialog(dialog));
  if (btnCopyEndpoint) btnCopyEndpoint.addEventListener("click", copyFutureEndpoint);
  [btnNew, btnNewInline].filter(Boolean).forEach((btn) => btn.addEventListener("click", openCreate));
  wireSearch();
  ensureSourceOption("meta", "Meta");

  const session = await requireSessionOrRedirect();
  if (!session) return;
  if (userEmailEl) userEmailEl.textContent = session.user.email || "";
  if (workspaceNameEl) workspaceNameEl.textContent = inferWorkspaceName(session);
  await loadWebhookEndpoint();

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setFormMsg("");
      setError("");

      const payload = buildPayloadFromForm();
      const validation = validateLeadPayload(payload);
      if (validation) {
        setFormMsg(validation);
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = mode === "edit" ? "Saving…" : "Creating…";

        if (mode === "edit" && editingId) {
          await updateLead(editingId, payload);
          toast("Customer updated.");
        } else {
          await createLead(payload);
          toast("Customer created.");
        }

        closeDialog(dialog);
        await loadLeads();
      } catch (err) {
        setFormMsg(maybeMissingTableMessage(err));
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = mode === "edit" ? "Save changes" : "Create customer";
      }
    });
  }

  await loadLeads();
}

init();
