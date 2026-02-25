import { supabase } from "../js/api.js";
import { listQuotes, createQuote } from "../js/quotesApi.js";
import { makeDefaultQuoteData } from "../js/quoteDefaults.js";

/**
 * Command Center Dashboard
 * - One dominant metric: Open Pipeline
 * - Recent quotes feed (small, fast)
 * - Everything else is intentionally staged as “coming soon”
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

// Recent
const recentLoading = document.getElementById("recent-loading");
const recentEmpty = document.getElementById("recent-empty");
const recentList = document.getElementById("recent-list");

// KPIs
const kpiDraft = document.getElementById("kpi-draft");
const kpiSent = document.getElementById("kpi-sent");
const kpiAccepted = document.getElementById("kpi-accepted");
const kpiAcceptedValue = document.getElementById("kpi-accepted-value");
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

function updateKPIs(quotes) {
  const counts = { draft: 0, sent: 0, accepted: 0 };
  let pipeline = 0;        // open pipeline (Draft + Sent/View, exclude Accepted/Cancelled)
  let acceptedValue = 0;   // total accepted value (all-time for now)

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

function wireComingSoon() {
  const soonEls = Array.from(document.querySelectorAll("[data-soon='1']"));
  for (const el of soonEls) {
    el.addEventListener("click", () => {
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

function wireRealNav() {
  // Customers page exists now (no "coming soon" toast)
  if (qaCustomers) {
    qaCustomers.addEventListener("click", () => {
      window.location.href = "./customers.html";
    });
  }
}

async function loadRecentQuotes() {
  setError("");
  if (recentEmpty) recentEmpty.hidden = true;
  if (recentList) recentList.innerHTML = "";
  if (recentLoading) recentLoading.hidden = false;

  try {
    // Load more than we render so KPIs feel real
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

    const recent = sorted.slice(0, 8);
    for (const q of recent) recentList.appendChild(renderRecentItem(q));

    updateKPIs(sorted);
  } catch (e) {
    if (recentLoading) recentLoading.hidden = true;
    setError(e?.message || "Failed to load quotes.");
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
  wireComingSoon();
  wireCreateButtons();
  wireRealNav();

  if (logoutBtn) logoutBtn.addEventListener("click", logout);
  if (createCancelBtn) createCancelBtn.addEventListener("click", () => closeDialog(createDialog));

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
