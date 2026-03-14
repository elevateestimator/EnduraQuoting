import { supabase } from "../js/api.js";
import { listCustomers, createCustomer, deleteCustomer } from "../js/customersApi.js";

/**
 * Customers page (v1)
 * - Search customers
 * - Create customer
 * - Delete customer
 * - Multi-tenant safe via RLS + company_id scoping in customersApi
 */

const workspaceNameEl = document.getElementById("workspace-name");
const userEmailEl = document.getElementById("user-email");
const errorBox = document.getElementById("error-box");

const toastEl = document.getElementById("toast");
let toastTimer = null;

const logoutBtn = document.getElementById("logout-btn");

const btnNew = document.getElementById("btn-new");
const btnNewInline = document.getElementById("btn-new-inline");

const searchEl = document.getElementById("search");
const countEl = document.getElementById("customer-count");

const loadingEl = document.getElementById("loading");
const emptyEl = document.getElementById("empty");
const tableWrap = document.getElementById("table-wrap");
const tbody = document.getElementById("customers-body");

// Dialog
const dialog = document.getElementById("customer-dialog");
const form = document.getElementById("customer-form");
const cancelBtn = document.getElementById("customer-cancel");
const submitBtn = document.getElementById("customer-submit");
const msgEl = document.getElementById("customer-msg");

// Inputs
const firstNameEl = document.getElementById("first_name");
const lastNameEl = document.getElementById("last_name");
const companyNameEl = document.getElementById("company_name");
const billingAddressEl = document.getElementById("billing_address");
const emailEl = document.getElementById("email");
const phoneEl = document.getElementById("phone");

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

function setFormMsg(message) {
  if (msgEl) msgEl.textContent = message || "";
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

function wireComingSoon() {
  const soonEls = Array.from(document.querySelectorAll("[data-soon='1']"));
  for (const el of soonEls) {
    el.addEventListener("click", () => toast("Coming next — this page isn’t built yet."));
  }
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

function renderRow(c) {
  const tr = document.createElement("tr");

  // Customer
  const tdName = document.createElement("td");
  const strong = document.createElement("div");
  strong.className = "cell-strong";
  strong.textContent = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "(Unnamed)";
  tdName.appendChild(strong);
  tr.appendChild(tdName);

  // Company
  const tdCompany = document.createElement("td");
  tdCompany.textContent = c.company_name || "—";
  tr.appendChild(tdCompany);

  // Email
  const tdEmail = document.createElement("td");
  tdEmail.textContent = c.email || "—";
  tr.appendChild(tdEmail);

  // Phone
  const tdPhone = document.createElement("td");
  tdPhone.textContent = c.phone || "—";
  tr.appendChild(tdPhone);

  // Billing address
  const tdAddr = document.createElement("td");
  tdAddr.className = "cell-truncate";
  tdAddr.title = c.billing_address || "";
  tdAddr.textContent = c.billing_address || "—";
  tr.appendChild(tdAddr);

  // Created
  const tdCreated = document.createElement("td");
  tdCreated.textContent = formatDateShort(c.created_at);
  tr.appendChild(tdCreated);

  // Actions
  const tdActions = document.createElement("td");
  const actions = document.createElement("div");
  actions.className = "row-actions";

  const view = document.createElement("button");
  view.className = "btn btn-secondary";
  view.type = "button";
  view.textContent = "View";
  view.addEventListener("click", (e) => {
    e.stopPropagation();
    window.location.href = `./customer.html?id=${c.id}`;
  });

  actions.appendChild(view);

  const del = document.createElement("button");
  del.className = "btn btn-danger";
  del.type = "button";
  del.textContent = "Delete";
  del.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = window.confirm(
      `Delete ${strong.textContent}?\n\nThis permanently removes the customer.`
    );
    if (!ok) return;

    try {
      del.disabled = true;
      await deleteCustomer(c.id);
      toast("Customer deleted.");
      await loadCustomers({ search: searchEl?.value || "" });
    } catch (err) {
      setError(err?.message || "Failed to delete customer.");
    } finally {
      del.disabled = false;
    }
  });

  actions.appendChild(del);
  tdActions.appendChild(actions);
  tr.appendChild(tdActions);

  return tr;
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

function clearTable() {
  if (tbody) tbody.innerHTML = "";
}

function setLoading(isLoading) {
  if (loadingEl) loadingEl.hidden = !isLoading;
}

function setEmpty(isEmpty) {
  if (emptyEl) emptyEl.hidden = !isEmpty;
  if (tableWrap) tableWrap.hidden = isEmpty;
}

async function loadCustomers({ search = "" } = {}) {
  setError("");
  setLoading(true);
  setEmpty(false);
  clearTable();

  try {
    const customers = await listCustomers({ search, limit: 500 });

    if (countEl) countEl.textContent = String(customers.length);

    if (!customers.length) {
      setEmpty(true);
      return;
    }

    for (const c of customers) tbody.appendChild(renderRow(c));
  } catch (err) {
    setError(err?.message || "Failed to load customers.");
    setEmpty(true);
  } finally {
    setLoading(false);
  }
}

function resetForm() {
  setFormMsg("");
  firstNameEl.value = "";
  lastNameEl.value = "";
  companyNameEl.value = "";
  billingAddressEl.value = "";
  emailEl.value = "";
  phoneEl.value = "";
}

function wireCreateButtons() {
  const opens = [btnNew, btnNewInline].filter(Boolean);
  for (const b of opens) {
    b.addEventListener("click", () => {
      resetForm();
      openDialog(dialog);
      firstNameEl.focus();
    });
  }
}

function sanitizeString(s) {
  return String(s || "").trim();
}

function normalizeOptional(s) {
  const v = sanitizeString(s);
  return v ? v : null;
}

let searchTimer = null;
function wireSearch() {
  if (!searchEl) return;
  searchEl.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      loadCustomers({ search: searchEl.value || "" });
    }, 180);
  });
}

async function init() {
  wireComingSoon();
  wireCreateButtons();
  wireSearch();

  if (logoutBtn) logoutBtn.addEventListener("click", logout);
  if (cancelBtn) cancelBtn.addEventListener("click", () => closeDialog(dialog));

  const session = await requireSessionOrRedirect();
  if (!session) return;

  if (userEmailEl) userEmailEl.textContent = session.user.email || "";
  if (workspaceNameEl) workspaceNameEl.textContent = inferWorkspaceName(session);

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setFormMsg("");
      setError("");

      const first_name = sanitizeString(firstNameEl.value);
      const last_name = sanitizeString(lastNameEl.value);

      if (!first_name || !last_name) {
        setFormMsg("First name and last name are required.");
        return;
      }

      const payload = {
        first_name,
        last_name,
        company_name: normalizeOptional(companyNameEl.value),
        billing_address: normalizeOptional(billingAddressEl.value),
        email: normalizeOptional(emailEl.value),
        phone: normalizeOptional(phoneEl.value),
      };

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = "Creating…";

        await createCustomer(payload);

        closeDialog(dialog);
        toast("Customer created.");
        await loadCustomers({ search: searchEl?.value || "" });
      } catch (err) {
        setFormMsg(err?.message || "Failed to create customer.");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create customer";
      }
    });
  }

  await loadCustomers({ search: "" });
}

init();
