import { supabase } from "../js/api.js";
import { listQuotes, createQuote } from "../js/quotesApi.js";
import { makeDefaultQuoteData } from "../js/quoteDefaults.js";

/**
 * Dashboard v1:
 * - Overview layout (admin/owner first)
 * - Only shows Recent Quotes (no full-table view)
 * - “Quotes / Customers” buttons are placeholders for now
 */

const userEmailEl = document.getElementById("user-email");
const errorBox = document.getElementById("error-box");

const createBtn = document.getElementById("create-btn");
const createBtnHero = document.getElementById("create-btn-hero");
const qaCreate = document.getElementById("qa-create");

const logoutBtn = document.getElementById("logout-btn");

// Placeholder navigation buttons (no pages yet)
const navQuotes = document.getElementById("nav-quotes");
const navCustomers = document.getElementById("nav-customers");
const btnAllQuotes = document.getElementById("btn-all-quotes");
const btnCustomers = document.getElementById("btn-customers");
const btnAllQuotesHero = document.getElementById("btn-all-quotes-hero");
const btnCustomersHero = document.getElementById("btn-customers-hero");
const btnViewAllRecent = document.getElementById("btn-view-all-recent");
const qaQuotes = document.getElementById("qa-quotes");
const qaCustomers = document.getElementById("qa-customers");

const toastEl = document.getElementById("toast");

// Recent quotes
const recentLoading = document.getElementById("recent-loading");
const recentEmpty = document.getElementById("recent-empty");
const recentList = document.getElementById("recent-list");

// KPIs
const kpiDraft = document.getElementById("kpi-draft");
const kpiSent = document.getElementById("kpi-sent");
const kpiAccepted = document.getElementById("kpi-accepted");
const kpiPipeline = document.getElementById("kpi-pipeline");

// Dialog
const createDialog = document.getElementById("create-dialog");
const createForm = document.getElementById("create-form");
const createCancelBtn = document.getElementById("create-cancel");
const createSubmitBtn = document.getElementById("create-submit");
const createMsg = document.getElementById("create-msg");
const customerNameEl = document.getElementById("customer_name");
const customerEmailEl = document.getElementById("customer_email");

let toastTimer = null;

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
  if (s === "accepted") return "Accepted";
  if (s === "signed") return "Signed";
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

function updateKPIs(quotes) {
  const counts = { draft: 0, sent: 0, accepted: 0 };
  let pipeline = 0;

  for (const q of quotes) {
    const s = normalizeStatus(q.status);

    if (s === "accepted") counts.accepted += 1;
    else if (s === "sent" || s === "viewed") counts.sent += 1;
    else if (s === "draft") counts.draft += 1;

    // Simple pipeline: include Draft+Sent+Viewed (exclude cancelled)
    if (s !== "cancelled" && s !== "accepted") {
      pipeline += Number(q.total_cents || 0);
    }
  }

  kpiDraft.textContent = String(counts.draft);
  kpiSent.textContent = String(counts.sent);
  kpiAccepted.textContent = String(counts.accepted);
  kpiPipeline.textContent = formatMoney(pipeline, "CAD");
}

async function requireSessionOrRedirect() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn("getSession error", error);
  }
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
  createMsg.textContent = text || "";
}

function wireComingSoonButtons() {
  const comingSoon = [
    navQuotes,
    navCustomers,
    btnAllQuotes,
    btnCustomers,
    btnAllQuotesHero,
    btnCustomersHero,
    btnViewAllRecent,
    qaQuotes,
    qaCustomers,
  ].filter(Boolean);

  for (const el of comingSoon) {
    el.addEventListener("click", () => {
      // Keeps the dashboard “design complete” without 404s yet
      toast("Coming next — this page isn’t built yet.");
    });
  }
}

function wireCreateButtons() {
  const opens = [createBtn, createBtnHero, qaCreate].filter(Boolean);
  for (const b of opens) {
    b.addEventListener("click", () => {
      setCreateMsg("");
      customerNameEl.value = "";
      customerEmailEl.value = "";
      openDialog(createDialog);
      customerNameEl.focus();
    });
  }
}

async function loadRecentQuotes() {
  setError("");
  recentEmpty.hidden = true;
  recentList.innerHTML = "";
  recentLoading.hidden = false;

  try {
    // Load more than we display so KPIs feel “real”
    const quotes = await listQuotes({ limit: 200 });

    recentLoading.hidden = true;

    if (!quotes?.length) {
      recentEmpty.hidden = false;
      updateKPIs([]);
      return;
    }

    // Sort newest first and render only a small list
    const sorted = [...quotes].sort((a, b) => {
      const da = new Date(a.created_at).getTime();
      const db = new Date(b.created_at).getTime();
      return db - da;
    });

    const recent = sorted.slice(0, 6);
    for (const q of recent) recentList.appendChild(renderRecentItem(q));

    updateKPIs(sorted);
  } catch (e) {
    recentLoading.hidden = true;
    setError(e?.message || "Failed to load quotes.");
  }
}

async function init() {
  wireComingSoonButtons();
  wireCreateButtons();

  logoutBtn.addEventListener("click", logout);
  createCancelBtn.addEventListener("click", () => closeDialog(createDialog));

  const session = await requireSessionOrRedirect();
  if (!session) return;

  userEmailEl.textContent = session.user.email || "";

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

      // Create “shell” quote with default payload
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

  await loadRecentQuotes();
}

init();
