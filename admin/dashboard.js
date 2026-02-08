import { supabase } from "../js/api.js";
import { requireAdminOrRedirect } from "../js/adminGuard.js";
import { listQuotes, createQuote, duplicateQuote, cancelQuote } from "../js/quotesApi.js";

const userEmailEl = document.getElementById("user-email");
const errorBox = document.getElementById("error-box");
const quotesBody = document.getElementById("quotes-body");
const emptyState = document.getElementById("empty-state");

const refreshBtn = document.getElementById("refresh-btn");
const createBtn = document.getElementById("create-btn");
const logoutBtn = document.getElementById("logout-btn");

const createDialog = document.getElementById("create-dialog");
const createForm = document.getElementById("create-form");
const createCancelBtn = document.getElementById("create-cancel");
const createSubmitBtn = document.getElementById("create-submit");
const createMsg = document.getElementById("create-msg");

const customerNameEl = document.getElementById("customer_name");
const customerEmailEl = document.getElementById("customer_email");
const totalEl = document.getElementById("total");

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

function toCents(input) {
  const cleaned = String(input ?? "")
    .trim()
    .replace(/[^0-9.-]/g, "");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function formatMoney(cents = 0, currency = "CAD") {
  const dollars = (Number(cents) || 0) / 100;
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
  }).format(dollars);
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

function statusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "draft") return "draft";
  if (s === "sent") return "sent";
  if (s === "viewed") return "viewed";
  if (s === "signed") return "signed";
  if (s === "cancelled") return "cancelled";
  return "draft";
}

function canCancel(status) {
  const s = String(status || "").toLowerCase();
  return s !== "signed" && s !== "cancelled";
}

function clearTable() {
  quotesBody.innerHTML = "";
}

function renderRow(q) {
  const tr = document.createElement("tr");

  const tdQuote = document.createElement("td");
  tdQuote.textContent = `Q-${q.quote_no}`;

  const tdCustomer = document.createElement("td");
  const name = q.customer_name || "(No name)";
  const email = q.customer_email ? ` • ${q.customer_email}` : "";
  tdCustomer.textContent = name + email;

  const tdTotal = document.createElement("td");
  tdTotal.textContent = formatMoney(q.total_cents ?? 0, q.currency ?? "CAD");

  const tdStatus = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `badge ${statusClass(q.status)}`;
  badge.textContent = q.status;
  tdStatus.appendChild(badge);

  const tdCreated = document.createElement("td");
  tdCreated.textContent = formatDate(q.created_at);

  const tdActions = document.createElement("td");
  const actions = document.createElement("div");
  actions.className = "row-actions";

  const btnNewVersion = document.createElement("button");
  btnNewVersion.className = "btn small";
  btnNewVersion.textContent = "New Version";
  btnNewVersion.addEventListener("click", async () => {
    const ok = window.confirm(
      `Create a new Draft version copied from Q-${q.quote_no}?`
    );
    if (!ok) return;

    try {
      setError("");
      btnNewVersion.disabled = true;
      await duplicateQuote(q);
      await loadQuotes();
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
      const ok = window.confirm(
        `Cancel Q-${q.quote_no}? (This does not delete it.)`
      );
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

  tr.appendChild(tdQuote);
  tr.appendChild(tdCustomer);
  tr.appendChild(tdTotal);
  tr.appendChild(tdStatus);
  tr.appendChild(tdCreated);
  tr.appendChild(tdActions);

  return tr;
}

async function loadQuotes() {
  setError("");
  emptyState.hidden = true;

  clearTable();

  try {
    const quotes = await listQuotes({ limit: 200 });

    if (!quotes.length) {
      emptyState.hidden = false;
      return;
    }

    for (const q of quotes) {
      quotesBody.appendChild(renderRow(q));
    }
  } catch (e) {
    setError(
      (e?.message || "Failed to load quotes.") +
        " (If this is your first run, confirm the quotes table + RLS policy exist.)"
    );
  }
}

async function logout() {
  await supabase.auth.signOut();
  window.location.href = "../index.html";
}

function setCreateMsg(text) {
  createMsg.textContent = text || "";
}

async function init() {
  const session = await requireAdminOrRedirect({ redirectTo: "../index.html" });
  if (!session) return;

  userEmailEl.textContent = session.user.email || "";

  refreshBtn.addEventListener("click", loadQuotes);

  logoutBtn.addEventListener("click", logout);

  createBtn.addEventListener("click", () => {
    setCreateMsg("");
    customerNameEl.value = "";
    customerEmailEl.value = "";
    totalEl.value = "0";
    openDialog(createDialog);
    customerNameEl.focus();
  });

  createCancelBtn.addEventListener("click", () => closeDialog(createDialog));

  createForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setCreateMsg("");

    const customer_name = customerNameEl.value.trim();
    const customer_email = customerEmailEl.value.trim() || null;
    const total_cents = toCents(totalEl.value);

    if (!customer_name) {
      setCreateMsg("Customer name is required.");
      return;
    }

    try {
      createSubmitBtn.disabled = true;
      createSubmitBtn.textContent = "Saving…";
      await createQuote({
        customer_name,
        customer_email,
        total_cents,
        currency: "CAD",
        data: {}, // later you’ll store template/items here
      });
      closeDialog(createDialog);
      await loadQuotes();
    } catch (e2) {
      setCreateMsg(e2?.message || "Failed to create quote.");
    } finally {
      createSubmitBtn.disabled = false;
      createSubmitBtn.textContent = "Save Draft";
    }
  });

  await loadQuotes();
}

init();