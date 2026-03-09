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
const chartSvg = document.getElementById("chart-svg");
const chartYAxis = document.getElementById("chart-y-axis");
const chartXAxis = document.getElementById("chart-x-axis");
const chartEmpty = document.getElementById("chart-empty");

const CHART_W = 1200;
const CHART_H = 280;
const CHART_TOP = 16;
const CHART_BOTTOM = 18;
const CHART_LEFT = 8;
const CHART_RIGHT = 8;
const CHART_X_TICKS = [0, 6, 12, 18, 24, 29];
const CHART_Y_SEGMENTS = 4;

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

function niceScaleMax(maxCents, segments = CHART_Y_SEGMENTS) {
  const raw = Math.max(0, Number(maxCents || 0));
  if (raw <= 0) return 0;

  const roughStep = raw / segments;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const residual = roughStep / magnitude;

  let niceResidual = 1;
  if (residual <= 1) niceResidual = 1;
  else if (residual <= 2) niceResidual = 2;
  else if (residual <= 2.5) niceResidual = 2.5;
  else if (residual <= 5) niceResidual = 5;
  else niceResidual = 10;

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

  chartSvg.innerHTML = svgParts.join('');
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
