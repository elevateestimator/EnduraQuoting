import { supabase } from "../js/api.js";
import { createQuote, duplicateQuoteById, cancelQuote } from "../js/quotesApi.js";
import { makeDefaultQuoteData } from "../js/quoteDefaults.js";

/**
 * Customer detail page
 * - Shows customer info
 * - Shows quotes only for this customer
 *   (queries server-side by customer_id when available, else falls back to json/email/name)
 * - Actions: Open, New version, Cancel
 * - Can edit the customer directly from the detail page
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

const params = new URLSearchParams(window.location.search);
const customerId = params.get("id");

let customer = null;
let allCustomerQuotes = [];

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

function normalizeStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  if (["accepted", "signed"].includes(s)) return "accepted";
  if (["viewed"].includes(s)) return "viewed";
  if (["sent"].includes(s)) return "sent";
  if (["cancelled", "canceled"].includes(s)) return "cancelled";
  return s || "draft";
}

function prettyStatus(status) {
  const s = normalizeStatus(status);
  if (s === "accepted") return "Accepted";
  if (s === "signed") return "Signed";
  if (s === "viewed") return "Viewed";
  if (s === "sent") return "Sent";
  if (s === "cancelled") return "Cancelled";
  return "Draft";
}

function badgeClass(status) {
  const s = normalizeStatus(status);
  if (s === "accepted") return "accepted";
  if (s === "sent") return "sent";
  if (s === "viewed") return "viewed";
  if (s === "cancelled") return "cancelled";
  return "draft";
}

function canCancel(status) {
  const s = normalizeStatus(status);
  return s !== "accepted" && s !== "cancelled";
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

  // 1) Prefer a real FK column if you have it
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

  // 2) If no customer_id column, use json fallback (we stamp data.customer_id on create)
  const byData = customerIdColumnOK ? [] : await fetchQuotesByDataCustomerId(c.id);

  // 3) Backfill older quotes by email (best) or name (last resort)
  const byEmail = email ? await fetchQuotesByEmail(email) : [];

  let byName = [];
  if (!email && fullName) {
    // Only use name fallback if we didn't find anything by ID/json.
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
    const s = normalizeStatus(q.status);
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
  badge.textContent = prettyStatus(q.status);
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

  // KPIs should reflect the full customer set, not search filter
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
}

function openEditCustomer() {
  if (!customer) return;
  populateEditForm(customer);
  openDialog(editDialog);
  editFirstNameEl?.focus();
}

function setCustomerUI(c) {
  const full = customerFullName(c) || "Customer";
  const company = customerCompanyName(c);
  const email = customerEmail(c);
  const phone = customerPhone(c);
  const address = customerAddress(c);

  pageH1.textContent = full;
  pageSubtitle.textContent = company ? `${company} • Customer profile + quote history.` : "Customer profile + quote history.";

  custNameEl.textContent = full;
  custCompanyEl.textContent = company ? `Company • ${company}` : "Company • —";

  custEmailEl.textContent = email || "—";
  custPhoneEl.textContent = phone || "—";
  custAddressEl.textContent = address || "—";

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

  const first_name = sanitizeString(editFirstNameEl.value);
  const last_name = sanitizeString(editLastNameEl.value);

  if (!first_name || !last_name) {
    setEditMsg("First name and last name are required.");
    return;
  }

  const payload = {
    first_name,
    last_name,
    company_name: normalizeOptional(editCompanyNameEl.value),
    billing_address: normalizeOptional(editBillingAddressEl.value),
    email: normalizeOptional(editEmailEl.value),
    phone: normalizeOptional(editPhoneEl.value),
  };

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

  const name = customerFullName(customer) || "(Customer)";
  const email = customerEmail(customer) || null;

  try {
    btnCreateQuote.disabled = true;
    btnCreateQuote.textContent = "Creating…";

    const data = makeDefaultQuoteData({ customer_name: name, customer_email: email });

    // Stamp linkage in json so we can always query quotes for this customer,
    // even if your quotes table doesn't have a customer_id column yet.
    try {
      if (data && typeof data === "object") data.customer_id = customer.id;
    } catch {
      // ignore
    }

    // Try to set customer_id if your quotes table supports it.
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

      // If customer_id column isn't in your quotes table yet, fall back gracefully.
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
  if (editForm) editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await updateCustomerRecord();
  });

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
