import { supabase } from "../js/api.js";
import { makeDefaultQuoteData } from "../js/quoteDefaults.js";

const userEmailEl = document.getElementById("user-email");

const logoutBtn = document.getElementById("logout-btn");
const createBtn = document.getElementById("create-btn");
const emptyCreateBtn = document.getElementById("empty-create");
const refreshBtn = document.getElementById("refresh-btn");
const btnDashboard = document.getElementById("btn-dashboard");

const searchEl = document.getElementById("search");
const statusFilterEl = document.getElementById("status-filter");

const errorBox = document.getElementById("error-box");
const resultsMeta = document.getElementById("results-meta");
const tbody = document.getElementById("quotes-body");
const emptyState = document.getElementById("empty-state");

const createDialog = document.getElementById("create-dialog");
const createForm = document.getElementById("create-form");
const createCancelBtn = document.getElementById("create-cancel");
const createSubmitBtn = document.getElementById("create-submit");
const createMsg = document.getElementById("create-msg");
const customerNameEl = document.getElementById("customer_name");
const customerEmailEl = document.getElementById("customer_email");

const toastEl = document.getElementById("toast");

let toastTimer = null;
let allQuotes = [];
let companyId = null;
let userId = null;

function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg || "";
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 2200);
}

function setError(message) {
  if (!message) {
    errorBox.hidden = true;
    errorBox.textContent = "";
    return;
  }
  errorBox.hidden = false;
  errorBox.textContent = message;
}

function openDialog(d) {
  if (typeof d.showModal === "function") d.showModal();
  else d.setAttribute("open", "");
}
function closeDialog(d) {
  if (typeof d.close === "function") d.close();
  else d.removeAttribute("open");
}

function formatMoney(cents = 0, currency = "CAD") {
  const dollars = (Number(cents) || 0) / 100;
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(dollars);
}

function formatDate(iso) {
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

function normalizeStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  if (["accepted", "signed"].includes(s)) return "accepted";
  if (s === "viewed") return "viewed";
  if (s === "sent") return "sent";
  if (["cancelled", "canceled"].includes(s)) return "cancelled";
  return s || "draft";
}

function prettyStatus(status) {
  const s = normalizeStatus(status);
  if (s === "accepted") return "Accepted";
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
  // Only unsigned/uncancelled quotes can be cancelled
  return s !== "accepted" && s !== "cancelled";
}

function scrubForNewVersion(data) {
  if (!data || typeof data !== "object") return data;
  const clone = JSON.parse(JSON.stringify(data));

  // wipe common acceptance/signature keys wherever they exist
  const kill = [
    "accepted",
    "accepted_at",
    "acceptedAt",
    "signed",
    "signed_at",
    "signedAt",
    "signature",
    "signatureDataUrl",
    "signature_data_url",
    "signatureSvg",
    "signature_svg",
    "signer_email",
    "signerEmail",
    "signer_name",
    "signerName",
    "printed_name",
    "printedName",
    "public_id",
    "publicId",
    "public_token",
    "publicToken",
  ];

  for (const k of kill) {
    if (k in clone) delete clone[k];
    if (clone.meta && k in clone.meta) delete clone.meta[k];
  }

  if (clone.acceptance) delete clone.acceptance;
  if (clone.signing) delete clone.signing;

  clone.meta = clone.meta || {};
  clone.meta.version_type = "new_version";
  clone.meta.version_created_at = new Date().toISOString();

  return clone;
}

function clearTable() {
  tbody.innerHTML = "";
}

function renderRow(q) {
  const tr = document.createElement("tr");

  const tdQuote = document.createElement("td");
  const link = document.createElement("a");
  link.className = "quote-link";
  link.href = `./quote.html?id=${q.id}`;
  link.textContent = `Q-${q.quote_no ?? "—"}`;
  tdQuote.appendChild(link);

  const tdCustomer = document.createElement("td");
  const name = document.createElement("div");
  name.textContent = q.customer_name || "(No customer)";
  name.style.fontWeight = "800";

  const sub = document.createElement("span");
  sub.className = "customer-sub";
  sub.textContent = q.customer_email || "";
  tdCustomer.appendChild(name);
  if (q.customer_email) tdCustomer.appendChild(sub);

  const tdTotal = document.createElement("td");
  tdTotal.textContent = formatMoney(q.total_cents ?? 0, q.currency ?? "CAD");

  const tdStatus = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `badge ${badgeClass(q.status)}`;
  const dot = document.createElement("span");
  dot.className = "dot";
  badge.appendChild(dot);
  badge.appendChild(document.createTextNode(prettyStatus(q.status)));
  tdStatus.appendChild(badge);

  const tdCreated = document.createElement("td");
  tdCreated.textContent = formatDate(q.created_at);

  const tdActions = document.createElement("td");
  const actions = document.createElement("div");
  actions.className = "actions";

  const btnOpen = document.createElement("button");
  btnOpen.className = "btn small";
  btnOpen.textContent = "Open";
  btnOpen.addEventListener("click", () => {
    window.location.href = `./quote.html?id=${q.id}`;
  });
  actions.appendChild(btnOpen);

  const btnNewVersion = document.createElement("button");
  btnNewVersion.className = "btn small";
  btnNewVersion.textContent = "New version";
  btnNewVersion.addEventListener("click", async () => {
    const ok = window.confirm(`Create a new Draft copied from Q-${q.quote_no}?`);
    if (!ok) return;

    try {
      setError("");
      btnNewVersion.disabled = true;
      const newQ = await duplicateQuoteById(q.id);
      window.location.href = `./quote.html?id=${newQ.id}`;
    } catch (e) {
      setError(e?.message || "Failed to create new version.");
    } finally {
      btnNewVersion.disabled = false;
    }
  });
  actions.appendChild(btnNewVersion);

  if (canCancel(q.status)) {
    const btnCancel = document.createElement("button");
    btnCancel.className = "btn small danger";
    btnCancel.textContent = "Cancel";
    btnCancel.addEventListener("click", async () => {
      const ok = window.confirm(`Cancel Q-${q.quote_no}? (This does not delete it.)`);
      if (!ok) return;

      try {
        setError("");
        btnCancel.disabled = true;
        await cancelQuoteById(q.id);
        await loadQuotes();
        toast("Quote cancelled.");
      } catch (e) {
        setError(e?.message || "Failed to cancel quote.");
      } finally {
        btnCancel.disabled = false;
      }
    });
    actions.appendChild(btnCancel);
  }

  tdActions.appendChild(actions);

  tr.appendChild(tdQuote);
  tr.appendChild(tdCustomer);
  tr.appendChild(tdTotal);
  tr.appendChild(tdStatus);
  tr.appendChild(tdCreated);
  tr.appendChild(tdActions);

  return tr;
}

function applyFilters() {
  const q = (searchEl.value || "").trim().toLowerCase();
  const status = (statusFilterEl.value || "").trim().toLowerCase();

  let filtered = [...allQuotes];

  if (status) {
    filtered = filtered.filter((row) => normalizeStatus(row.status) === normalizeStatus(status));
  }

  if (q) {
    filtered = filtered.filter((row) => {
      const quoteNo = String(row.quote_no ?? "").toLowerCase();
      const name = String(row.customer_name ?? "").toLowerCase();
      const email = String(row.customer_email ?? "").toLowerCase();
      const st = String(row.status ?? "").toLowerCase();
      return (
        quoteNo.includes(q) ||
        (`q-${quoteNo}`).includes(q) ||
        name.includes(q) ||
        email.includes(q) ||
        st.includes(q)
      );
    });
  }

  // Meta
  resultsMeta.textContent = `${filtered.length} result${filtered.length === 1 ? "" : "s"}`;

  clearTable();

  if (!filtered.length) {
    emptyState.hidden = allQuotes.length > 0 ? true : false;
    return;
  }

  emptyState.hidden = true;
  for (const row of filtered) tbody.appendChild(renderRow(row));
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

async function getCompanyContext(uid) {
  const { data, error } = await supabase
    .from("company_members")
    .select("company_id, role")
    .eq("user_id", uid)
    .limit(1);

  if (error) throw error;

  const row = data?.[0] || null;
  return row;
}

async function loadQuotes() {
  setError("");
  emptyState.hidden = true;
  resultsMeta.textContent = "Loading…";
  clearTable();

  try {
    const { data, error } = await supabase
      .from("quotes")
      .select("id, quote_no, customer_name, customer_email, total_cents, currency, status, created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    allQuotes = data || [];

    if (!allQuotes.length) {
      emptyState.hidden = false;
      resultsMeta.textContent = "0 results";
      return;
    }

    applyFilters();
  } catch (e) {
    resultsMeta.textContent = "—";
    setError(e?.message || "Failed to load quotes.");
  }
}

async function createQuoteShell({ customer_name, customer_email }) {
  const data = makeDefaultQuoteData({ customer_name, customer_email });

  const payload = {
    customer_name,
    customer_email,
    total_cents: 0,
    currency: "CAD",
    status: "draft",
    data,
    company_id: companyId,
    created_by: userId,
  };

  const { data: inserted, error } = await supabase
    .from("quotes")
    .insert(payload)
    .select("id, quote_no")
    .single();

  if (error) throw error;
  return inserted;
}

async function duplicateQuoteById(quoteId) {
  // Load the original quote including JSON data so we can copy it.
  const { data, error } = await supabase
    .from("quotes")
    .select("id, quote_no, customer_name, customer_email, total_cents, currency, data")
    .eq("id", quoteId)
    .limit(1);

  if (error) throw error;

  const original = data?.[0];
  if (!original) throw new Error("Quote not found.");

  const copiedData = scrubForNewVersion(original.data);
  // Record version source
  copiedData.meta = copiedData.meta || {};
  copiedData.meta.version_of_quote_id = original.id;
  copiedData.meta.version_of_quote_no = original.quote_no;

  const payload = {
    customer_name: original.customer_name,
    customer_email: original.customer_email,
    total_cents: original.total_cents ?? 0,
    currency: original.currency ?? "CAD",
    status: "draft",
    data: copiedData,
    company_id: companyId,
    created_by: userId,
  };

  const { data: inserted, error: insErr } = await supabase
    .from("quotes")
    .insert(payload)
    .select("id, quote_no")
    .single();

  if (insErr) throw insErr;
  return inserted;
}

async function cancelQuoteById(quoteId) {
  const { error } = await supabase.from("quotes").update({ status: "cancelled" }).eq("id", quoteId);
  if (error) throw error;
}

async function logout() {
  await supabase.auth.signOut();
  window.location.href = "../index.html";
}

function wireComingSoon() {
  for (const el of document.querySelectorAll("[data-soon='1']")) {
    el.addEventListener("click", () => toast("Coming next — this page isn’t built yet."));
  }
}

function wireEvents() {
  wireComingSoon();

  btnDashboard.addEventListener("click", () => {
    window.location.href = "./dashboard.html";
  });

  logoutBtn.addEventListener("click", logout);

  refreshBtn.addEventListener("click", loadQuotes);

  const onFilter = () => applyFilters();
  searchEl.addEventListener("input", onFilter);
  statusFilterEl.addEventListener("change", onFilter);

  const openCreate = () => {
    setCreateMsg("");
    customerNameEl.value = "";
    customerEmailEl.value = "";
    openDialog(createDialog);
    customerNameEl.focus();
  };

  createBtn.addEventListener("click", openCreate);
  emptyCreateBtn.addEventListener("click", openCreate);

  createCancelBtn.addEventListener("click", () => closeDialog(createDialog));

  createForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setCreateMsg("");

    const customer_name = customerNameEl.value.trim();
    const customer_email = customerEmailEl.value.trim() || null;

    if (!customer_name) {
      setCreateMsg("Customer name is required.");
      return;
    }

    try {
      createSubmitBtn.disabled = true;
      createSubmitBtn.textContent = "Creating…";

      const q = await createQuoteShell({ customer_name, customer_email });

      closeDialog(createDialog);
      window.location.href = `./quote.html?id=${q.id}`;
    } catch (err) {
      setCreateMsg(err?.message || "Failed to create quote.");
    } finally {
      createSubmitBtn.disabled = false;
      createSubmitBtn.textContent = "Create & open";
    }
  });
}

function setCreateMsg(text) {
  createMsg.textContent = text || "";
}

async function init() {
  wireEvents();

  const session = await requireSessionOrRedirect();
  if (!session) return;

  userId = session.user.id;
  userEmailEl.textContent = session.user.email || "";

  // Get company_id so inserts/duplicates work under RLS
  try {
    const membership = await getCompanyContext(userId);
    companyId = membership?.company_id || null;

    if (!companyId) {
      setError(
        "No company membership found for this account. Create a company (owner) or ask an admin to invite you."
      );
      createBtn.disabled = true;
      emptyCreateBtn.disabled = true;
      return;
    }
  } catch (e) {
    setError(e?.message || "Could not load company membership.");
    return;
  }

  await loadQuotes();
}

init();
