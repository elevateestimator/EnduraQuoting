import { supabase } from "../js/api.js";
import { createQuote } from "../js/quotesApi.js";
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
const chartOpenArea = document.getElementById("chart-open-area");
const chartOpenLine = document.getElementById("chart-open-line");
const chartAcceptedLine = document.getElementById("chart-accepted-line");
const chartEmpty = document.getElementById("chart-empty");

// Dialog
const createDialog = document.getElementById("create-dialog");
const createForm = document.getElementById("create-form");
const createCancelBtn = document.getElementById("create-cancel");
const createSubmitBtn = document.getElementById("create-submit");
const createMsg = document.getElementById("create-msg");
const customerNameEl = document.getElementById("customer_name");
const customerEmailEl = document.getElementById("customer_email");

let toastTimer = null;
const LAST_30_DAYS = 30;

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

function buildLinePath(values, scaleMax, width = 1200, height = 260, top = 18, bottom = 22, left = 12, right = 12) {
  const usableW = width - left - right;
  const usableH = height - top - bottom;
  const max = Math.max(1, Number(scaleMax || 0));
  const step = values.length > 1 ? usableW / (values.length - 1) : usableW;

  return values
    .map((value, i) => {
      const x = left + step * i;
      const y = top + usableH - (Number(value || 0) / max) * usableH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildAreaPath(values, scaleMax, width = 1200, height = 260, top = 18, bottom = 22, left = 12, right = 12) {
  const line = buildLinePath(values, scaleMax, width, height, top, bottom, left, right);
  const usableW = width - left - right;
  const step = values.length > 1 ? usableW / (values.length - 1) : usableW;
  const lastX = left + step * (values.length - 1);
  const baseY = height - bottom;
  return `${line} L${lastX.toFixed(2)} ${baseY.toFixed(2)} L${left.toFixed(2)} ${baseY.toFixed(2)} Z`;
}

function renderChart(quotes) {
  if (!chartOpenArea || !chartOpenLine || !chartAcceptedLine) return;

  const series = buildDailySeries(quotes);
  const openValues = series.map((d) => d.open);
  const acceptedValues = series.map((d) => d.accepted);
  const hasAnyActivity = series.some((d) => d.open > 0 || d.accepted > 0);

  const max = Math.max(1, ...openValues, ...acceptedValues);

  chartOpenArea.setAttribute("d", buildAreaPath(openValues, max, 1200, 260));
  chartOpenLine.setAttribute("d", buildLinePath(openValues, max, 1200, 260));
  chartAcceptedLine.setAttribute("d", buildLinePath(acceptedValues, max, 1200, 260));

  if (chartEmpty) chartEmpty.hidden = hasAnyActivity;
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
    b.addEventListener("click", () => {
      setCreateMsg("");
      customerNameEl.value = "";
      customerEmailEl.value = "";
      openDialog(createDialog);
      customerNameEl.focus();
    });
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

  await loadDashboardQuotes();
}

init();
