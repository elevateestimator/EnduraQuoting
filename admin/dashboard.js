import { supabase } from "../js/api.js";
import { listQuotes, createQuote } from "../js/quotesApi.js";
import { makeDefaultQuoteData } from "../js/quoteDefaults.js";

// ===== DOM =====
const companyNameEl = document.getElementById("company-name");
const userEmailEl = document.getElementById("user-email");
const errorBox = document.getElementById("error-box");

const createBtn = document.getElementById("create-btn");
const qaCreate = document.getElementById("qa-create");
const logoutBtn = document.getElementById("logout-btn");

const toastEl = document.getElementById("toast");

// KPIs
const kpiDraft = document.getElementById("kpi-draft");
const kpiSent = document.getElementById("kpi-sent");
const kpiAccepted = document.getElementById("kpi-accepted");
const kpiPipeline = document.getElementById("kpi-pipeline");

// Recent
const recentLoading = document.getElementById("recent-loading");
const recentEmpty = document.getElementById("recent-empty");
const recentList = document.getElementById("recent-list");

// Dialog
const createDialog = document.getElementById("create-dialog");
const createForm = document.getElementById("create-form");
const createCancelBtn = document.getElementById("create-cancel");
const createSubmitBtn = document.getElementById("create-submit");
const createMsg = document.getElementById("create-msg");
const customerNameEl = document.getElementById("customer_name");
const customerEmailEl = document.getElementById("customer_email");

let toastTimer = null;

// ===== UI helpers =====
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

function setCreateMsg(text) {
  if (!createMsg) return;
  createMsg.textContent = text || "";
}

function formatMoney(cents = 0, currency = "CAD") {
  const dollars = (Number(cents) || 0) / 100;
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
  }).format(dollars);
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
  if (s === "signed") return "signed";
  if (s === "sent") return "sent";
  if (s === "viewed") return "viewed";
  if (s === "cancelled") return "cancelled";
  return "draft";
}

function prettyStatus(status) {
  const s = normalizeStatus(status);
  if (s === "accepted") return "Signed";
  if (s === "viewed") return "Viewed";
  if (s === "sent") return "Sent";
  if (s === "cancelled") return "Cancelled";
  return "Draft";
}

// ===== Render =====
function renderRecentRow(q) {
  const row = document.createElement("a");
  row.className = "recent-row";
  row.href = `./quote.html?id=${q.id}`;

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

  row.appendChild(left);
  row.appendChild(right);

  return row;
}

function updateKPIs(quotes) {
  const counts = { draft: 0, sent: 0, accepted: 0 };
  let pipeline = 0;

  for (const q of quotes) {
    const s = normalizeStatus(q.status);

    if (s === "accepted") counts.accepted += 1;
    else if (s === "sent" || s === "viewed") counts.sent += 1;
    else if (s === "draft") counts.draft += 1;

    // Pipeline: Draft + Sent + Viewed (exclude cancelled + accepted)
    if (s !== "cancelled" && s !== "accepted") {
      pipeline += Number(q.total_cents || 0);
    }
  }

  if (kpiDraft) kpiDraft.textContent = String(counts.draft);
  if (kpiSent) kpiSent.textContent = String(counts.sent);
  if (kpiAccepted) kpiAccepted.textContent = String(counts.accepted);
  if (kpiPipeline) kpiPipeline.textContent = formatMoney(pipeline, "CAD");
}

// ===== Auth =====
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

// ===== Data =====
async function loadDashboard() {
  setError("");

  if (recentLoading) recentLoading.hidden = false;
  if (recentEmpty) recentEmpty.hidden = true;
  if (recentList) recentList.innerHTML = "";

  try {
    const quotes = await listQuotes({ limit: 200 });

    if (recentLoading) recentLoading.hidden = true;

    if (!quotes?.length) {
      if (recentEmpty) recentEmpty.hidden = false;
      updateKPIs([]);
      return;
    }

    const sorted = [...quotes].sort((a, b) => {
      const da = new Date(a.created_at).getTime();
      const db = new Date(b.created_at).getTime();
      return db - da;
    });

    updateKPIs(sorted);

    const recent = sorted.slice(0, 6);
    for (const q of recent) {
      recentList.appendChild(renderRecentRow(q));
    }
  } catch (e) {
    if (recentLoading) recentLoading.hidden = true;
    setError(e?.message || "Failed to load dashboard.");
  }
}

// ===== Wiring =====
function wireComingSoon() {
  const soonEls = Array.from(document.querySelectorAll("[data-soon='1']"));
  for (const el of soonEls) {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      toast("Coming next — this page isn’t built yet.");
    });
  }
}

function wireCreate() {
  const openers = [createBtn, qaCreate].filter(Boolean);
  for (const el of openers) {
    el.addEventListener("click", () => {
      setCreateMsg("");
      customerNameEl.value = "";
      customerEmailEl.value = "";
      openDialog(createDialog);
      customerNameEl.focus();
    });
  }

  createCancelBtn?.addEventListener("click", () => closeDialog(createDialog));

  createForm?.addEventListener("submit", async (e) => {
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

      const data = makeDefaultQuoteData({ customer_name, customer_email });

      const q = await createQuote({
        customer_name,
        customer_email,
        total_cents: 0,
        currency: "CAD",
        data,
      });

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

async function init() {
  wireComingSoon();
  wireCreate();

  logoutBtn?.addEventListener("click", logout);

  const session = await requireSessionOrRedirect();
  if (!session) return;

  const email = session.user.email || "";
  if (userEmailEl) userEmailEl.textContent = email;

  // Optional: display a workspace/company name if you store it in user_metadata
  const meta = session.user.user_metadata || {};
  const workspaceName =
    meta.company_name || meta.company || meta.workspace || meta.business_name || null;
  if (companyNameEl) companyNameEl.textContent = workspaceName || "Workspace";

  await loadDashboard();
}

init();
