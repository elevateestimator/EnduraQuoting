import { supabase } from "../js/api.js";
import { createQuote, duplicateQuoteById, cancelQuote } from "../js/quotesApi.js";
import { makeDefaultQuoteData } from "../js/quoteDefaults.js";

/**
 * Customer detail page
 * - Shows customer info
 * - Shows pipeline status / source / notes (same backing record as Leads)
 * - Lets you edit the customer directly from this page
 * - Shows quotes only for this customer
 */

const workspaceNameEl = document.getElementById("workspace-name");
const userEmailEl = document.getElementById("user-email");
const logoutBtn = document.getElementById("logout-btn");
const errorBox = document.getElementById("error-box");

const toastEl = document.getElementById("toast");
let toastTimer = null;

const btnCreateQuote = document.getElementById("btn-create-quote");
const btnEditCustomer = document.getElementById("btn-edit-customer");
const btnCopyEmail = document.getElementById("btn-copy-email");

const pageH1 = document.getElementById("page-h1");
const pageSubtitle = document.getElementById("page-subtitle");

const custNameEl = document.getElementById("cust-name");
const custCompanyEl = document.getElementById("cust-company");
const custEmailEl = document.getElementById("cust-email");
const custPhoneEl = document.getElementById("cust-phone");
const custAddressEl = document.getElementById("cust-address");
const custPipelineStatusEl = document.getElementById("cust-pipeline-status");
const custLeadSourceEl = document.getElementById("cust-lead-source");
const custNotesEmptyEl = document.getElementById("cust-notes-empty");
const custNotesIntroEl = document.getElementById("cust-notes-intro");
const custNotesDetailsEl = document.getElementById("cust-notes-details");

const kpiQuotesEl = document.getElementById("kpi-quotes");
const kpiPipelineEl = document.getElementById("kpi-pipeline");
const kpiAcceptedEl = document.getElementById("kpi-accepted");
const kpiLastEl = document.getElementById("kpi-last");

const quotesCountEl = document.getElementById("quotes-count");
const quoteSearchEl = document.getElementById("quote-search");
const quotesLoadingEl = document.getElementById("quotes-loading");
const quotesEmptyEl = document.getElementById("quotes-empty");
const quotesTableWrap = document.getElementById("quotes-table-wrap");
const quotesBody = document.getElementById("quotes-body");

// Edit dialog
const editDialog = document.getElementById("customer-edit-dialog");
const editForm = document.getElementById("customer-edit-form");
const editCancelBtn = document.getElementById("customer-edit-cancel");
const editSubmitBtn = document.getElementById("customer-edit-submit");
const editMsgEl = document.getElementById("customer-edit-msg");
const editFirstNameEl = document.getElementById("edit_first_name");
const editLastNameEl = document.getElementById("edit_last_name");
const editCompanyNameEl = document.getElementById("edit_company_name");
const editBillingAddressEl = document.getElementById("edit_billing_address");
const editEmailEl = document.getElementById("edit_email");
const editPhoneEl = document.getElementById("edit_phone");
const editPipelineStatusEl = document.getElementById("edit_pipeline_status");
const editLeadSourceEl = document.getElementById("edit_lead_source");
const editLeadNotesEl = document.getElementById("edit_lead_notes");

const params = new URLSearchParams(window.location.search);
const customerId = params.get("id");

let customer = null;
let allCustomerQuotes = [];

const STATUS_ORDER = ["new", "contacted", "qualified", "won", "lost"];

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

function setEditMsg(message) {
  if (!editMsgEl) return;
  editMsgEl.textContent = message || "";
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

function wireComingSoon() {
  const soonEls = Array.from(document.querySelectorAll("[data-soon='1']"));
  for (const el of soonEls) {
    el.addEventListener("click", () => toast("Coming next — this page isn’t built yet."));
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

function sanitizeString(s) {
  return String(s || "").trim();
}

function normalizeOptional(s) {
  const v = sanitizeString(s);
  return v ? v : null;
}

function normalizeQuoteStatus(status) {
  const s = sanitizeString(status).toLowerCase();
  if (["accepted", "signed"].includes(s)) return "accepted";
  if (s === "viewed") return "viewed";
  if (s === "sent") return "sent";
  if (["cancelled", "canceled"].includes(s)) return "cancelled";
  return s || "draft";
}

function prettyQuoteStatus(status) {
  const s = normalizeQuoteStatus(status);
  if (s === "accepted") return "Accepted";
  if (s === "viewed") return "Viewed";
  if (s === "sent") return "Sent";
  if (s === "cancelled") return "Cancelled";
  return "Draft";
}

function badgeClass(status) {
  const s = normalizeQuoteStatus(status);
  if (s === "accepted") return "accepted";
  if (s === "sent") return "sent";
  if (s === "viewed") return "viewed";
  if (s === "cancelled") return "cancelled";
  return "draft";
}

function canCancel(status) {
  const s = normalizeQuoteStatus(status);
  return s !== "accepted" && s !== "cancelled";
}

function normalizePipelineStatus(status) {
  const s = sanitizeString(status).toLowerCase();
  return STATUS_ORDER.includes(s) ? s : "new";
}

function prettyPipelineStatus(status) {
  const s = normalizePipelineStatus(status);
  if (s === "contacted") return "Contacted";
  if (s === "qualified") return "Qualified";
  if (s === "won") return "Won";
  if (s === "lost") return "Lost";
  return "New";
}

function normalizeLeadSource(source) {
  const s = sanitizeString(source).toLowerCase();
  return s || "manual";
}

function prettyLeadSource(source) {
  const s = normalizeLeadSource(source);
  if (s === "website") return "Website";
  if (s === "phone") return "Phone";
  if (s === "referral") return "Referral";
  if (s === "zapier") return "Zapier";
  if (s === "make") return "Make";
  if (s === "other") return "Other";
  return "Manual";
}

function ensureLeadSourceOption(value, label = null) {
  if (!editLeadSourceEl) return;
  const normalized = normalizeLeadSource(value);
  const exists = Array.from(editLeadSourceEl.options || []).some((opt) => opt.value === normalized);
  if (exists) return;
  const opt = document.createElement("option");
  opt.value = normalized;
  opt.textContent = label || prettyLeadSource(normalized);
  editLeadSourceEl.appendChild(opt);
}

function setQuotesLoading(isLoading) {
  if (quotesLoadingEl) quotesLoadingEl.hidden = !isLoading;
}

function setQuotesEmpty(isEmpty) {
  if (quotesEmptyEl) quotesEmptyEl.hidden = !isEmpty;
  if (quotesTableWrap) quotesTableWrap.hidden = isEmpty;
}

function clearQuotesTable() {
  if (quotesBody) quotesBody.innerHTML = "";
}

function safeLower(s) {
  return String(s || "").trim().toLowerCase();
}

function customerFullName(c) {
  const first = sanitizeString(c?.first_name || c?.firstName || "");
  const last = sanitizeString(c?.last_name || c?.lastName || "");
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full || sanitizeString(c?.full_name || c?.fullName || c?.name || c?.customer_name || "");
}

function customerCompanyName(c) {
  return sanitizeString(
    c?.company_name || c?.companyName || c?.company || c?.business_name || c?.businessName || c?.organization || c?.org || ""
  );
}

function customerEmail(c) {
  return sanitizeString(c?.email || c?.customer_email || c?.email_address || "");
}

function customerPhone(c) {
  return sanitizeString(c?.phone || c?.phone_number || c?.mobile || "");
}

function customerAddress(c) {
  return sanitizeString(c?.billing_address || c?.billingAddress || c?.address || c?.customer_address || "");
}

function customerDisplayName(c) {
  return customerFullName(c) || customerCompanyName(c) || customerEmail(c) || "Customer";
}

function parseLeadNotes(notes) {
  const raw = sanitizeString(notes);
  if (!raw) return { intro: "", details: [] };

  const lines = raw
    .split(/\r?\n+/)
    .map((line) => sanitizeString(line))
    .filter(Boolean);

  const introParts = [];
  const details = [];

  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx > 0 && idx < line.length - 1) {
      const label = sanitizeString(line.slice(0, idx));
      const value = sanitizeString(line.slice(idx + 1));
      if (label && value) {
        details.push({ label, value });
        continue;
      }
    }
    introParts.push(line);
  }

  return {
    intro: introParts.join("\n").trim(),
    details,
  };
}

function renderCustomerNotes(notes) {
  if (!custNotesEmptyEl || !custNotesIntroEl || !custNotesDetailsEl) return;
  const parsed = parseLeadNotes(notes);

  custNotesEmptyEl.hidden = !!(parsed.intro || parsed.details.length);
  custNotesIntroEl.hidden = !parsed.intro;
  custNotesDetailsEl.hidden = !parsed.details.length;

  custNotesIntroEl.textContent = parsed.intro || "";
  custNotesDetailsEl.innerHTML = "";

  for (const detail of parsed.details) {
    const row = document.createElement("div");
    row.className = "notes-detail-row";

    const labelEl = document.createElement("div");
    labelEl.className = "notes-detail-label";
    labelEl.textContent = detail.label;

    const valueEl = document.createElement("div");
    valueEl.className = "notes-detail-value";
    valueEl.textContent = detail.value;

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    custNotesDetailsEl.appendChild(row);
  }
}

// --- Quote loading (server-side filtering) ---------------------------------
const SELECT_BASE =
  "id, quote_no, customer_name, customer_email, total_cents, currency, status, created_at";
const SELECT_WITH_CUSTOMER_ID = `${SELECT_BASE}, customer_id`;

function isMissingColumnError(err, columnName) {
  const msg = String(err?.message || "").toLowerCase();
  const col = String(columnName || "").toLowerCase();
  return (
    msg.includes(col) &&
    (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("not found"))
  );
}

async function fetchQuotesByCustomerId(id) {
  if (!id) return [];
  const { data, error } = await supabase
    .from("quotes")
    .select(SELECT_WITH_CUSTOMER_ID)
    .eq("customer_id", id)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw error;
  return data || [];
}

async function fetchQuotesByDataCustomerId(id) {
  if (!id) return [];
  const { data, error } = await supabase
    .from("quotes")
    .select(SELECT_BASE)
    .contains("data", { customer_id: id })
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw error;
  return data || [];
}

async function fetchQuotesByEmail(email) {
  const e = sanitizeString(email);
  if (!e) return [];
  const { data, error } = await supabase
    .from("quotes")
    .select(SELECT_BASE)
    .eq("customer_email", e)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw error;
  return data || [];
}

async function fetchQuotesByName(fullName) {
  const n = sanitizeString(fullName);
  if (!n) return [];
  const { data, error } = await supabase
    .from("quotes")
    .select(SELECT_BASE)
    .eq("customer_name", n)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw error;
  return data || [];
}

function dedupeQuotes(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const q of list || []) {
      if (!q?.id) continue;
      map.set(q.id, q);
    }
  }
  const arr = Array.from(map.values());
  arr.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return arr;
}

async function fetchCustomerQuotes(c) {
  if (!c?.id) return [];

  const email = customerEmail(c);
  const fullName = customerFullName(c);

  let customerIdColumnOK = true;
  let byId = [];

  try {
    byId = await fetchQuotesByCustomerId(c.id);
  } catch (e) {
    if (isMissingColumnError(e, "customer_id")) {
      customerIdColumnOK = false;
      byId = [];
    } else {
      throw e;
    }
  }

  const byData = customerIdColumnOK ? [] : await fetchQuotesByDataCustomerId(c.id);
  const byEmail = email ? await fetchQuotesByEmail(email) : [];

  let byName = [];
  if (!email && fullName) {
    if ((byId?.length || 0) + (byData?.length || 0) === 0) {
      byName = await fetchQuotesByName(fullName);
    }
  }

  return dedupeQuotes(byId, byData, byEmail, byName);
}

function computeKPIs(quotes) {
  const totalQuotes = quotes.length;
  let pipeline = 0;
  let accepted = 0;
  let last = null;

  for (const q of quotes) {
    const s = normalizeQuoteStatus(q.status);
    const cents = Number(q.total_cents || 0);

    if (s === "accepted") accepted += cents;
    if (s !== "accepted" && s !== "cancelled") pipeline += cents;

    const t = new Date(q.created_at).getTime();
    if (!Number.isNaN(t)) {
      if (!last || t > last) last = t;
    }
  }

  kpiQuotesEl.textContent = String(totalQuotes);
  kpiPipelineEl.textContent = formatMoney(pipeline, "CAD");
  kpiAcceptedEl.textContent = formatMoney(accepted, "CAD");
  kpiLastEl.textContent = last ? formatDateShort(new Date(last).toISOString()) : "—";
}

function renderQuoteRow(q) {
  const tr = document.createElement("tr");

  const tdQuote = document.createElement("td");
  const code = document.createElement("div");
  code.className = "cell-strong";
  code.textContent = `Q-${q.quote_no}`;
  tdQuote.appendChild(code);
  tr.appendChild(tdQuote);

  const tdStatus = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `badge ${badgeClass(q.status)}`;
  badge.textContent = prettyQuoteStatus(q.status);
  tdStatus.appendChild(badge);
  tr.appendChild(tdStatus);

  const tdTotal = document.createElement("td");
  tdTotal.textContent = formatMoney(q.total_cents ?? 0, q.currency ?? "CAD");
  tr.appendChild(tdTotal);

  const tdCreated = document.createElement("td");
  tdCreated.textContent = formatDateShort(q.created_at);
  tr.appendChild(tdCreated);

  const tdWho = document.createElement("td");
  const name = q.customer_name || "—";
  const email = q.customer_email ? ` • ${q.customer_email}` : "";
  tdWho.textContent = name + email;
  tr.appendChild(tdWho);

  const tdActions = document.createElement("td");
  const actions = document.createElement("div");
  actions.className = "row-actions";

  const btnOpen = document.createElement("button");
  btnOpen.className = "btn btn-secondary";
  btnOpen.type = "button";
  btnOpen.textContent = "Open";
  btnOpen.addEventListener("click", () => {
    window.location.href = `./quote.html?id=${q.id}`;
  });
  actions.appendChild(btnOpen);

  const btnNew = document.createElement("button");
  btnNew.className = "btn btn-secondary";
  btnNew.type = "button";
  btnNew.textContent = "New version";
  btnNew.addEventListener("click", async () => {
    const ok = window.confirm(`Create a new Draft copied from Q-${q.quote_no}?`);
    if (!ok) return;

    try {
      setError("");
      btnNew.disabled = true;
      const newQ = await duplicateQuoteById(q.id);
      window.location.href = `./quote.html?id=${newQ.id}`;
    } catch (e) {
      setError(e?.message || "Failed to create new version.");
    } finally {
      btnNew.disabled = false;
    }
  });
  actions.appendChild(btnNew);

  if (canCancel(q.status)) {
    const btnCancel = document.createElement("button");
    btnCancel.className = "btn btn-danger";
    btnCancel.type = "button";
    btnCancel.textContent = "Cancel";
    btnCancel.addEventListener("click", async () => {
      const ok = window.confirm(`Cancel Q-${q.quote_no}? (This does not delete it.)`);
      if (!ok) return;

      try {
        setError("");
        btnCancel.disabled = true;
        await cancelQuote(q.id);
        await loadQuotes();
      } catch (e) {
        setError(e?.message || "Failed to cancel quote.");
      } finally {
        btnCancel.disabled = false;
      }
    });
    actions.appendChild(btnCancel);
  }

  tdActions.appendChild(actions);
  tr.appendChild(tdActions);

  return tr;
}

function renderQuotes(quotes, { search = "" } = {}) {
  const term = safeLower(search);
  let filtered = quotes;

  if (term) {
    filtered = quotes.filter((q) => {
      const hay = [
        `q-${q.quote_no}`,
        q.status,
        q.customer_name,
        q.customer_email,
        String(q.total_cents ?? ""),
        String(q.currency ?? ""),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(term);
    });
  }

  if (quotesCountEl) quotesCountEl.textContent = String(filtered.length);
  clearQuotesTable();

  if (!filtered.length) {
    setQuotesEmpty(true);
    computeKPIs([]);
    return;
  }

  setQuotesEmpty(false);
  for (const q of filtered) quotesBody.appendChild(renderQuoteRow(q));
  computeKPIs(quotes);
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

async function loadCustomer() {
  if (!customerId) {
    setError("Missing customer id in URL. Go back to Customers.");
    pageSubtitle.textContent = "Missing customer id";
    return null;
  }

  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .single();

  if (error) throw error;
  return data;
}

function populateEditForm(c) {
  if (!c) return;
  setEditMsg("");
  editFirstNameEl.value = sanitizeString(c?.first_name || c?.firstName || "");
  editLastNameEl.value = sanitizeString(c?.last_name || c?.lastName || "");
  editCompanyNameEl.value = customerCompanyName(c);
  editBillingAddressEl.value = customerAddress(c);
  editEmailEl.value = customerEmail(c);
  editPhoneEl.value = customerPhone(c);
  if (editPipelineStatusEl) editPipelineStatusEl.value = normalizePipelineStatus(c?.pipeline_status);
  ensureLeadSourceOption(c?.lead_source);
  if (editLeadSourceEl) editLeadSourceEl.value = normalizeLeadSource(c?.lead_source);
  if (editLeadNotesEl) editLeadNotesEl.value = sanitizeString(c?.lead_notes);
}

function openEditCustomer() {
  if (!customer) return;
  populateEditForm(customer);
  openDialog(editDialog);
  editFirstNameEl?.focus();
}

function setCustomerUI(c) {
  const full = customerDisplayName(c);
  const company = customerCompanyName(c);
  const email = customerEmail(c);
  const phone = customerPhone(c);
  const address = customerAddress(c);
  const pipelineStatus = normalizePipelineStatus(c?.pipeline_status);
  const leadSource = normalizeLeadSource(c?.lead_source);
  const notes = sanitizeString(c?.lead_notes);

  pageH1.textContent = full;
  pageSubtitle.textContent = company
    ? `${company} • Pipeline + quote history.`
    : "Pipeline + quote history.";

  custNameEl.textContent = full;
  custCompanyEl.textContent = company ? `Company • ${company}` : "Company • —";
  custEmailEl.textContent = email || "—";
  custPhoneEl.textContent = phone || "—";
  custAddressEl.textContent = address || "—";

  if (custPipelineStatusEl) {
    custPipelineStatusEl.textContent = prettyPipelineStatus(pipelineStatus);
    custPipelineStatusEl.className = `pipeline-badge ${pipelineStatus}`;
  }
  if (custLeadSourceEl) custLeadSourceEl.textContent = prettyLeadSource(leadSource);
  renderCustomerNotes(notes);

  if (btnCopyEmail) {
    if (email) {
      btnCopyEmail.hidden = false;
      btnCopyEmail.onclick = async () => {
        try {
          await navigator.clipboard.writeText(email);
          toast("Email copied.");
        } catch {
          toast("Copy failed.");
        }
      };
    } else {
      btnCopyEmail.hidden = true;
      btnCopyEmail.onclick = null;
    }
  }
}

async function updateCustomerRecord() {
  if (!customer?.id) return;

  const payload = {
    first_name: normalizeOptional(editFirstNameEl.value),
    last_name: normalizeOptional(editLastNameEl.value),
    company_name: normalizeOptional(editCompanyNameEl.value),
    billing_address: normalizeOptional(editBillingAddressEl.value),
    email: normalizeOptional(editEmailEl.value),
    phone: normalizeOptional(editPhoneEl.value),
    pipeline_status: normalizePipelineStatus(editPipelineStatusEl?.value),
    lead_source: normalizeLeadSource(editLeadSourceEl?.value),
    lead_notes: normalizeOptional(editLeadNotesEl?.value),
    updated_at: new Date().toISOString(),
  };

  const hasIdentity = [payload.first_name, payload.last_name, payload.company_name, payload.email, payload.phone].some(Boolean);
  if (!hasIdentity) {
    setEditMsg("Add at least a name, company, email, or phone so the customer is identifiable.");
    return;
  }

  try {
    setError("");
    setEditMsg("");
    editSubmitBtn.disabled = true;
    editSubmitBtn.textContent = "Saving…";

    const { data, error } = await supabase
      .from("customers")
      .update(payload)
      .eq("id", customer.id)
      .select("*")
      .single();

    if (error) throw error;

    customer = data || { ...customer, ...payload };
    setCustomerUI(customer);
    closeDialog(editDialog);
    toast("Customer updated.");
  } catch (e) {
    setEditMsg(e?.message || "Failed to save customer.");
  } finally {
    editSubmitBtn.disabled = false;
    editSubmitBtn.textContent = "Save changes";
  }
}

async function createQuoteForCustomer() {
  if (!customer) return;

  const name = customerDisplayName(customer) || "(Customer)";
  const email = customerEmail(customer) || null;

  try {
    btnCreateQuote.disabled = true;
    btnCreateQuote.textContent = "Creating…";

    const data = makeDefaultQuoteData({ customer_name: name, customer_email: email });
    try {
      if (data && typeof data === "object") data.customer_id = customer.id;
    } catch {}

    const payload = {
      customer_id: customer.id,
      customer_name: name,
      customer_email: email,
      total_cents: 0,
      currency: "CAD",
      data,
    };

    let q = null;

    try {
      q = await createQuote(payload);
    } catch (e) {
      const msg = String(e?.message || "").toLowerCase();
      if (msg.includes("customer_id") || msg.includes("column") || msg.includes("schema")) {
        const fallback = { ...payload };
        delete fallback.customer_id;
        q = await createQuote(fallback);
      } else {
        throw e;
      }
    }

    if (!q?.id) throw new Error("Quote created but missing id.");
    window.location.href = `./quote.html?id=${q.id}`;
  } catch (err) {
    setError(err?.message || "Failed to create quote.");
  } finally {
    btnCreateQuote.disabled = false;
    btnCreateQuote.textContent = "Create quote";
  }
}

async function loadQuotes() {
  setError("");
  setQuotesLoading(true);
  setQuotesEmpty(false);
  clearQuotesTable();

  try {
    const matched = await fetchCustomerQuotes(customer);
    allCustomerQuotes = matched || [];
    renderQuotes(allCustomerQuotes, { search: quoteSearchEl?.value || "" });
  } catch (e) {
    setError(e?.message || "Failed to load quotes.");
    setQuotesEmpty(true);
  } finally {
    setQuotesLoading(false);
  }
}

let searchTimer = null;
function wireQuoteSearch() {
  if (!quoteSearchEl) return;
  quoteSearchEl.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      renderQuotes(allCustomerQuotes, { search: quoteSearchEl.value || "" });
    }, 140);
  });
}

async function init() {
  wireComingSoon();
  wireQuoteSearch();

  if (logoutBtn) logoutBtn.addEventListener("click", logout);
  if (btnCreateQuote) btnCreateQuote.addEventListener("click", createQuoteForCustomer);
  if (btnEditCustomer) btnEditCustomer.addEventListener("click", openEditCustomer);
  if (editCancelBtn) editCancelBtn.addEventListener("click", () => closeDialog(editDialog));
  if (editForm) {
    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await updateCustomerRecord();
    });
  }

  const session = await requireSessionOrRedirect();
  if (!session) return;

  if (userEmailEl) userEmailEl.textContent = session.user.email || "";
  if (workspaceNameEl) workspaceNameEl.textContent = inferWorkspaceName(session);

  try {
    customer = await loadCustomer();
    setCustomerUI(customer);
    await loadQuotes();
  } catch (e) {
    setError(e?.message || "Failed to load customer.");
  }
}

init();

/* =========================================================
   Customer detail page mobile menu
   Append this to the BOTTOM of your current customer.js
   Preserves current page logic and only adds the mobile drawer.
   ========================================================= */
(function initCustomerMobileMenu(){
  if (typeof document === "undefined") return;
  if (document.getElementById("mobile-menu-panel")) return;

  const topbarLeft = document.querySelector(".topbar-left") || document.querySelector(".topbar .page-title")?.parentElement;
  const appRoot = document.querySelector(".app");
  if (!topbarLeft || !appRoot) return;

  const workspaceNameEl = document.getElementById("workspace-name");
  const userEmailEl = document.getElementById("user-email");
  const editCustomerBtn = document.getElementById("btn-edit-customer");
  const createQuoteBtn = document.getElementById("btn-create-quote");
  const logoutBtn = document.getElementById("logout-btn");

  const menuBtn = document.createElement("button");
  menuBtn.id = "mobile-menu-btn";
  menuBtn.className = "mobile-menu-btn";
  menuBtn.type = "button";
  menuBtn.setAttribute("aria-label", "Open menu");
  menuBtn.setAttribute("aria-expanded", "false");
  menuBtn.setAttribute("aria-controls", "mobile-menu-panel");
  menuBtn.innerHTML = "<span></span><span></span><span></span>";
  topbarLeft.insertBefore(menuBtn, topbarLeft.firstChild || null);

  const backdrop = document.createElement("button");
  backdrop.id = "mobile-menu-backdrop";
  backdrop.className = "mobile-menu-backdrop";
  backdrop.type = "button";
  backdrop.setAttribute("aria-label", "Close menu");

  const panel = document.createElement("aside");
  panel.id = "mobile-menu-panel";
  panel.className = "mobile-menu-panel";
  panel.setAttribute("aria-label", "Mobile menu");
  panel.innerHTML = `
    <div class="mobile-menu-head">
      <div class="mobile-menu-brand">
        <img class="mobile-menu-logo" src="../assets/elevate-estimator-logo-light.png" alt="Elevate Estimator" />
        <div class="mobile-menu-meta">
          <div id="mobile-workspace-name" class="mobile-workspace-name">${(workspaceNameEl?.textContent || "Workspace")}</div>
          <div id="mobile-user-email" class="mobile-user-email">${(userEmailEl?.textContent || "")}</div>
        </div>
      </div>
      <button id="mobile-menu-close" class="mobile-menu-close" type="button" aria-label="Close menu">✕</button>
    </div>

    <nav class="mobile-menu-nav" aria-label="Mobile primary">
      <div class="nav-group">
        <div class="nav-group-label">Overview</div>
        <a class="nav-item" href="./dashboard.html" data-mobile-close>
          <span class="nav-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            </svg>
          </span>
          <span>Dashboard</span>
        </a>
      </div>

      <div class="nav-group">
        <div class="nav-group-label">Sales</div>
        <a class="nav-item" href="./quotes.html" data-mobile-close>
          <span class="nav-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M7 3h8l4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="2"/>
              <path d="M15 3v5h5" stroke="currentColor" stroke-width="2"/>
              <path d="M8 12h8M8 16h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </span>
          <span>Quotes</span>
        </a>

        <a class="nav-item active" href="./customers.html" aria-current="page" data-mobile-close>
          <span class="nav-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z" stroke="currentColor" stroke-width="2"/>
              <path d="M4 21a8 8 0 0 1 16 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </span>
          <span>Customers</span>
        </a>

        <a class="nav-item" href="./leads.html" data-mobile-close>
          <span class="nav-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
              <path d="M5 11.5v4.8c0 .5.2 1 .6 1.3 1.4 1.2 3.9 2.9 6.4 2.9 2.5 0 5-1.7 6.4-2.9.4-.3.6-.8.6-1.3v-4.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <span>Leads</span>
        </a>
      </div>

      <div class="nav-group">
        <div class="nav-group-label">Catalog</div>
        <a class="nav-item" href="./products.html" data-mobile-close>
          <span class="nav-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M20 7 12 3 4 7v10l8 4 8-4V7Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
              <path d="M12 7v14" stroke="currentColor" stroke-width="2" opacity=".55"/>
              <path d="M4 7l8 4 8-4" stroke="currentColor" stroke-width="2" opacity=".55"/>
            </svg>
          </span>
          <span>Products</span>
        </a>
      </div>

      <div class="nav-group">
        <div class="nav-group-label">Admin</div>
        <a class="nav-item" href="./settings.html" data-mobile-close>
          <span class="nav-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" stroke-width="2"/>
              <path d="M19.4 15a7.7 7.7 0 0 0 .1-1 7.7 7.7 0 0 0-.1-1l2-1.5-2-3.5-2.4.6a7.8 7.8 0 0 0-1.7-1L13.8 3h-3.6L8.7 6.6a7.8 7.8 0 0 0-1.7 1L4.6 7l-2 3.5 2 1.5a7.7 7.7 0 0 0-.1 1 7.7 7.7 0 0 0 .1 1l-2 1.5 2 3.5 2.4-.6a7.8 7.8 0 0 0 1.7 1L10.2 21h3.6l1.5-3.6a7.8 7.8 0 0 0 1.7-1l2.4.6 2-3.5-2-1.5Z" stroke="currentColor" stroke-width="2" opacity=".55" stroke-linejoin="round"/>
            </svg>
          </span>
          <span>Settings</span>
        </a>
      </div>
    </nav>

    <div class="mobile-menu-actions">
      ${editCustomerBtn ? '<button id="mobile-edit-customer-btn" class="btn btn-secondary" type="button">Edit customer</button>' : ''}
      <button id="mobile-create-quote-btn" class="btn btn-primary" type="button">Create quote</button>
      <button id="mobile-logout-btn" class="btn btn-quiet" type="button">Log out</button>
    </div>
  `;

  appRoot.parentNode.insertBefore(backdrop, appRoot.nextSibling);
  appRoot.parentNode.insertBefore(panel, backdrop.nextSibling);

  const closeBtn = panel.querySelector("#mobile-menu-close");
  const mobileEditBtn = panel.querySelector("#mobile-edit-customer-btn");
  const mobileCreateBtn = panel.querySelector("#mobile-create-quote-btn");
  const mobileLogoutBtn = panel.querySelector("#mobile-logout-btn");
  const mobileCloseEls = Array.from(panel.querySelectorAll("[data-mobile-close]"));

  const isMobileViewport = () => window.matchMedia("(max-width: 1040px)").matches;

  function openMobileMenu() {
    if (!isMobileViewport()) return;
    document.body.classList.add("mobile-menu-open");
    menuBtn.setAttribute("aria-expanded", "true");
  }

  function closeMobileMenu() {
    document.body.classList.remove("mobile-menu-open");
    menuBtn.setAttribute("aria-expanded", "false");
  }

  menuBtn.addEventListener("click", () => {
    if (document.body.classList.contains("mobile-menu-open")) closeMobileMenu();
    else openMobileMenu();
  });

  closeBtn?.addEventListener("click", closeMobileMenu);
  backdrop?.addEventListener("click", closeMobileMenu);

  mobileCloseEls.forEach((el) => {
    el.addEventListener("click", () => {
      if (isMobileViewport()) closeMobileMenu();
    });
  });

  mobileEditBtn?.addEventListener("click", () => {
    closeMobileMenu();
    editCustomerBtn?.click();
  });

  mobileCreateBtn?.addEventListener("click", () => {
    closeMobileMenu();
    createQuoteBtn?.click();
  });

  mobileLogoutBtn?.addEventListener("click", () => {
    closeMobileMenu();
    logoutBtn?.click();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMobileMenu();
  });

  window.addEventListener("resize", () => {
    if (!isMobileViewport()) closeMobileMenu();
  });
})();
