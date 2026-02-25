import { supabase } from "../js/api.js";
import { listQuotes, createQuote } from "../js/quotesApi.js";
import { makeDefaultQuoteData } from "../js/quoteDefaults.js";

/**
 * Growth Command Center Dashboard (Owner/Admin first)
 * - Dominant pipeline metric + immersive chart placeholder
 * - Recent quotes (small list, no giant table)
 * - Navigation entry points (Quotes/Customers/Products/Settings) are coming soon
 */

const userEmailEl = document.getElementById("user-email");
const workspaceNameEl = document.getElementById("workspace-name");
const errorBox = document.getElementById("error-box");

const createBtn = document.getElementById("create-btn");
const createBtnHero = document.getElementById("create-btn-hero");
const qaCreate = document.getElementById("qa-create");

const logoutBtn = document.getElementById("logout-btn");
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
const kpiClose = document.getElementById("kpi-close");

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
    maximumFractionDigits: 0,
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

function prettyStatus(status) {
  const s = normalizeStatus(status);
  if (s === "accepted") return "Accepted";
  if (s === "viewed") return "Viewed";
  if (s === "sent") return "Sent";
  if (s === "cancelled") return "Cancelled";
  return "Draft";
}

function safeText(v, fallback = "") {
  const s = String(v ?? "").trim();
  return s || fallback;
}

function renderRecentRow(q) {
  const row = document.createElement("div");
  row.className = "recent-row";
  row.setAttribute("role", "row");
  row.tabIndex = 0;

  const open = () => {
    window.location.href = `./quote.html?id=${q.id}`;
  };

  row.addEventListener("click", open);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") open();
  });

  const code = document.createElement("div");
  code.className = "cell quote-code";
  code.textContent = `Q-${q.quote_no}`;

  const customer = document.createElement("div");
  customer.className = "cell customer-name";
  customer.textContent = safeText(q.customer_name, "(No customer)");

  const status = document.createElement("div");
  const s = normalizeStatus(q.status);
  status.className = `cell status ${s}`;
  const dot = document.createElement("span");
  dot.className = "status-dot";
  const label = document.createElement("span");
  label.textContent = prettyStatus(q.status);
  status.appendChild(dot);
  status.appendChild(label);

  const amount = document.createElement("div");
  amount.className = "cell right amount";
  amount.textContent = formatMoney(q.total_cents ?? 0, q.currency ?? "CAD");

  const date = document.createElement("div");
  date.className = "cell right date";
  date.textContent = formatDateShort(q.created_at);

  row.appendChild(code);
  row.appendChild(customer);
  row.appendChild(status);
  row.appendChild(amount);
  row.appendChild(date);

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

    // Open pipeline: include Draft + Sent + Viewed (exclude cancelled + accepted)
    if (s !== "cancelled" && s !== "accepted") {
      pipeline += Number(q.total_cents || 0);
    }
  }

  if (kpiDraft) kpiDraft.textContent = String(counts.draft);
  if (kpiSent) kpiSent.textContent = String(counts.sent);
  if (kpiAccepted) kpiAccepted.textContent = String(counts.accepted);
  if (kpiPipeline) kpiPipeline.textContent = formatMoney(pipeline, "CAD");

  const denom = counts.accepted + counts.sent + counts.draft;
  const closeRate = denom ? Math.round((counts.accepted / denom) * 100) : 0;
  if (kpiClose) kpiClose.textContent = denom ? `${closeRate}%` : "—";
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

function wireComingSoon() {
  const els = Array.from(document.querySelectorAll("[data-soon=\"1\"]"));
  for (const el of els) {
    el.addEventListener("click", (e) => {
      // buttons don't need preventDefault, but links do.
      if (el.tagName.toLowerCase() === "a") e.preventDefault();
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
    const quotes = await listQuotes({ limit: 200 });
    recentLoading.hidden = true;

    if (!quotes?.length) {
      recentEmpty.hidden = false;
      updateKPIs([]);
      return;
    }

    // Newest first; render only a small list
    const sorted = [...quotes].sort((a, b) => {
      const da = new Date(a.created_at).getTime();
      const db = new Date(b.created_at).getTime();
      return db - da;
    });

    const recent = sorted.slice(0, 8);
    for (const q of recent) recentList.appendChild(renderRecentRow(q));
    updateKPIs(sorted);
  } catch (e) {
    recentLoading.hidden = true;
    setError(e?.message || "Failed to load quotes.");
  }
}

function inferWorkspaceName(session) {
  const md = session?.user?.user_metadata || {};
  return (
    md.company_name ||
    md.company ||
    md.workspace ||
    md.business_name ||
    md.org ||
    "Workspace"
  );
}

async function init() {
  wireComingSoon();
  wireCreateButtons();

  if (logoutBtn) logoutBtn.addEventListener("click", logout);
  if (createCancelBtn)
    createCancelBtn.addEventListener("click", () => closeDialog(createDialog));

  const session = await requireSessionOrRedirect();
  if (!session) return;

  if (userEmailEl) userEmailEl.textContent = session.user.email || "";
  if (workspaceNameEl) workspaceNameEl.textContent = inferWorkspaceName(session);

  if (createForm) {
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

  await loadRecentQuotes();
}

init();
