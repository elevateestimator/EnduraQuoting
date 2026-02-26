import { supabase } from "../js/api.js";
import { listProducts, createProduct, updateProduct } from "../js/productsApi.js";

/**
 * Products & services (sale items) page
 * - List + search
 * - Create new item
 * - View/Edit in modal
 * - Multi-tenant safe via company_id + RLS
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
const countEl = document.getElementById("product-count");

const loadingEl = document.getElementById("loading");
const emptyEl = document.getElementById("empty");
const tableWrap = document.getElementById("table-wrap");
const tbody = document.getElementById("products-body");

// Dialog
const dialog = document.getElementById("product-dialog");
const form = document.getElementById("product-form");
const cancelBtn = document.getElementById("product-cancel");
const submitBtn = document.getElementById("product-submit");
const dialogTitle = document.getElementById("dialog-title");
const dialogSub = document.getElementById("dialog-sub");
const metaEl = document.getElementById("product-meta");
const msgEl = document.getElementById("product-msg");

// Inputs
const nameEl = document.getElementById("name");
const descEl = document.getElementById("description");
const unitEl = document.getElementById("unit_type");
const priceEl = document.getElementById("price_per_unit");
const showQtyUnitEl = document.getElementById("show_qty_unit");

let mode = "create"; // create | edit
let editingId = null;

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

function setMeta(text) {
  if (metaEl) metaEl.textContent = text || "";
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

function formatMoney(cents = 0, currency = "CAD") {
  const dollars = (Number(cents) || 0) / 100;
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(dollars);
}

function centsToInput(cents) {
  const n = Number(cents || 0) / 100;
  return n.toFixed(2);
}

function inputToCents(value) {
  const n = Number(String(value || "").replace(/[^0-9.]/g, ""));
  if (!isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function sanitizeString(s) {
  return String(s || "").trim();
}

function normalizeOptional(s) {
  const v = sanitizeString(s);
  return v ? v : null;
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

function renderRow(p) {
  const tr = document.createElement("tr");

  // Item
  const tdItem = document.createElement("td");
  const strong = document.createElement("div");
  strong.className = "cell-strong";
  strong.textContent = p.name || "(Untitled)";
  tdItem.appendChild(strong);

  const sub = document.createElement("div");
  sub.className = "cell-sub cell-truncate";
  sub.title = p.description || "";
  sub.textContent = p.description || "—";
  tdItem.appendChild(sub);
  tr.appendChild(tdItem);

  // Unit
  const tdUnit = document.createElement("td");
  tdUnit.textContent = p.unit_type || "—";
  tr.appendChild(tdUnit);

  // Price
  const tdPrice = document.createElement("td");
  tdPrice.className = "price-cell";
  tdPrice.textContent = formatMoney(p.price_per_unit_cents ?? 0, p.currency ?? "CAD");
  tr.appendChild(tdPrice);

  // Quote display
  const tdShow = document.createElement("td");
  tdShow.textContent = p.show_qty_unit_price ? "Show qty + unit price" : "Total only";
  tr.appendChild(tdShow);

  // Updated
  const tdUpdated = document.createElement("td");
  tdUpdated.textContent = formatDateShort(p.updated_at || p.created_at);
  tr.appendChild(tdUpdated);

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
    openEdit(p);
  });

  actions.appendChild(view);
  tdActions.appendChild(actions);
  tr.appendChild(tdActions);

  // Whole row click also opens
  tr.addEventListener("click", () => openEdit(p));

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

async function loadProducts({ search = "" } = {}) {
  setError("");
  setLoading(true);
  setEmpty(false);
  clearTable();

  try {
    const products = await listProducts({ search, limit: 500 });

    if (countEl) countEl.textContent = String(products.length);

    if (!products.length) {
      setEmpty(true);
      return;
    }

    for (const p of products) tbody.appendChild(renderRow(p));
  } catch (err) {
    setError(err?.message || "Failed to load products.");
    setEmpty(true);
  } finally {
    setLoading(false);
  }
}

function resetForm() {
  setFormMsg("");
  setMeta("");

  nameEl.value = "";
  descEl.value = "";
  unitEl.value = "Each";
  priceEl.value = "0.00";
  showQtyUnitEl.checked = true;
}

function openCreate() {
  mode = "create";
  editingId = null;

  resetForm();

  dialogTitle.textContent = "New sale item";
  dialogSub.textContent = "Create a standardized item your team can reuse on quotes.";
  submitBtn.textContent = "Create item";

  openDialog(dialog);
  nameEl.focus();
}

function openEdit(p) {
  mode = "edit";
  editingId = p.id;

  setFormMsg("");
  setError("");

  nameEl.value = p.name || "";
  descEl.value = p.description || "";
  unitEl.value = p.unit_type || "Each";
  priceEl.value = centsToInput(p.price_per_unit_cents ?? 0);
  showQtyUnitEl.checked = !!p.show_qty_unit_price;

  dialogTitle.textContent = "Sale item";
  dialogSub.textContent = "Edit details. Changes apply to future quotes (existing quotes keep their snapshot).";
  submitBtn.textContent = "Save changes";

  const meta = [
    `ID: ${p.id}`,
    `Created: ${formatDateShort(p.created_at)}`,
    `Updated: ${formatDateShort(p.updated_at || p.created_at)}`,
  ].join("  •  ");
  setMeta(meta);

  openDialog(dialog);
}

function wireCreateButtons() {
  const opens = [btnNew, btnNewInline].filter(Boolean);
  for (const b of opens) b.addEventListener("click", openCreate);
}

let searchTimer = null;
function wireSearch() {
  if (!searchEl) return;
  searchEl.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      loadProducts({ search: searchEl.value || "" });
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

      const name = sanitizeString(nameEl.value);
      const unit_type = sanitizeString(unitEl.value);
      const price_per_unit_cents = inputToCents(priceEl.value);
      const show_qty_unit_price = !!showQtyUnitEl.checked;

      if (!name) {
        setFormMsg("Name is required.");
        return;
      }
      if (!unit_type) {
        setFormMsg("Unit type is required.");
        return;
      }

      const payload = {
        name,
        description: normalizeOptional(descEl.value),
        unit_type,
        price_per_unit_cents,
        currency: "CAD",
        show_qty_unit_price,
      };

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = mode === "edit" ? "Saving…" : "Creating…";

        if (mode === "edit" && editingId) {
          await updateProduct(editingId, payload);
          toast("Sale item updated.");
        } else {
          await createProduct(payload);
          toast("Sale item created.");
        }

        closeDialog(dialog);
        await loadProducts({ search: searchEl?.value || "" });
      } catch (err) {
        setFormMsg(err?.message || "Failed to save item.");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = mode === "edit" ? "Save changes" : "Create item";
      }
    });
  }

  await loadProducts({ search: "" });
}

init();
