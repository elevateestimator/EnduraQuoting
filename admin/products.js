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
const aiDescBtn = document.getElementById("ai-desc-btn");
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

function updateAiDescButton() {
  if (!aiDescBtn) return;
  const hasText = sanitizeString(descEl?.value).length > 0;
  aiDescBtn.textContent = hasText
    ? "Click for AI enhanced description"
    : "Click for AI description";
}

async function callAiProductDescription({ name, unit_type, description }) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token || "";

  const res = await fetch("/api/ai-product-description", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ name, unit_type, description }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || "AI request failed.");
  return String(json?.description || "");
}

async function handleAiDescClick() {
  if (!aiDescBtn || aiDescBtn.disabled) return;

  setFormMsg("");
  setError("");

  const name = sanitizeString(nameEl.value);
  if (!name) {
    setFormMsg("Add the item name first.");
    nameEl.focus();
    return;
  }

  const unit_type = sanitizeString(unitEl.value) || "Each";
  const current = sanitizeString(descEl.value);
  const action = current ? "enhance" : "create";

  aiDescBtn.disabled = true;
  aiDescBtn.textContent = action === "enhance" ? "Enhancing…" : "Generating…";

  try {
    const out = await callAiProductDescription({ name, unit_type, description: current });
    if (!out.trim()) throw new Error("AI returned an empty description.");

    descEl.value = out;
    descEl.dispatchEvent(new Event("input", { bubbles: true }));
    descEl.focus();
    toast(action === "enhance" ? "AI enhanced the description." : "AI created the description.");
  } catch (err) {
    const msg =
      err?.message ||
      "Could not generate a description. Make sure OPENAI_API_KEY is set in Vercel environment variables.";
    setFormMsg(msg);
  } finally {
    aiDescBtn.disabled = false;
    updateAiDescButton();
  }
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

  updateAiDescButton();
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

  updateAiDescButton();

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
  if (descEl) descEl.addEventListener("input", updateAiDescButton);
  if (aiDescBtn) aiDescBtn.addEventListener("click", handleAiDescClick);

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

/* =========================================================
   Mobile menu + mobile table labels for Products page
   Append this to the bottom of products.js
   ========================================================= */
(function () {
  const doc = document;
  const body = doc.body;
  if (!body) return;

  const topbarLeft = doc.querySelector('.topbar-left');
  const topbar = doc.querySelector('.topbar');
  const workspaceNameNode = doc.getElementById('workspace-name');
  const userEmailNode = doc.getElementById('user-email');
  const btnNewDesktop = doc.getElementById('btn-new');
  const logoutDesktop = doc.getElementById('logout-btn');
  const productsTbody = doc.getElementById('products-body');

  function isMobileViewport() {
    return window.matchMedia('(max-width: 1040px)').matches;
  }

  function applyMobileTableLabels() {
    const table = doc.querySelector('.table');
    const tbody = doc.getElementById('products-body');
    if (!table || !tbody) return;
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => String(th.textContent || '').trim());
    tbody.querySelectorAll('tr').forEach((tr) => {
      Array.from(tr.children).forEach((td, idx) => {
        td.setAttribute('data-label', headers[idx] || '');
      });
    });
  }

  function syncMobileMenuMeta() {
    const mobileWorkspaceName = doc.getElementById('mobile-workspace-name');
    const mobileUserEmail = doc.getElementById('mobile-user-email');
    if (mobileWorkspaceName) mobileWorkspaceName.textContent = workspaceNameNode?.textContent?.trim() || 'Workspace';
    if (mobileUserEmail) mobileUserEmail.textContent = userEmailNode?.textContent?.trim() || '—';
  }

  function closeMobileMenu() {
    body.classList.remove('mobile-menu-open');
    const btn = doc.getElementById('mobile-menu-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function openMobileMenu() {
    if (!isMobileViewport()) return;
    syncMobileMenuMeta();
    body.classList.add('mobile-menu-open');
    const btn = doc.getElementById('mobile-menu-btn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }

  function injectMobileMenu() {
    if (!topbar || !topbarLeft) return;
    if (!doc.getElementById('mobile-menu-btn')) {
      const btn = doc.createElement('button');
      btn.id = 'mobile-menu-btn';
      btn.className = 'mobile-menu-btn';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Open menu');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = '<span></span><span></span><span></span>';
      topbarLeft.insertBefore(btn, topbarLeft.firstChild);
      btn.addEventListener('click', () => {
        if (body.classList.contains('mobile-menu-open')) closeMobileMenu();
        else openMobileMenu();
      });
    }

    if (!doc.getElementById('mobile-menu-backdrop')) {
      const backdrop = doc.createElement('button');
      backdrop.id = 'mobile-menu-backdrop';
      backdrop.className = 'mobile-menu-backdrop';
      backdrop.type = 'button';
      backdrop.setAttribute('aria-label', 'Close menu');
      backdrop.addEventListener('click', closeMobileMenu);
      body.appendChild(backdrop);
    }

    if (!doc.getElementById('mobile-menu-panel')) {
      const panel = doc.createElement('aside');
      panel.id = 'mobile-menu-panel';
      panel.className = 'mobile-menu-panel';
      panel.setAttribute('aria-label', 'Mobile menu');
      panel.innerHTML = `
        <div class="mobile-menu-head">
          <div class="mobile-menu-brand">
            <img class="mobile-menu-logo" src="../assets/elevate-estimator-logo-light.png" alt="Elevate Estimator" />
            <div class="mobile-menu-meta">
              <div id="mobile-workspace-name" class="mobile-workspace-name">Workspace</div>
              <div id="mobile-user-email" class="mobile-user-email">—</div>
            </div>
          </div>
          <button id="mobile-menu-close" class="mobile-menu-close" type="button" aria-label="Close menu">✕</button>
        </div>

        <nav class="mobile-menu-nav" aria-label="Mobile primary">
          <div class="nav-group">
            <div class="nav-group-label">Overview</div>
            <a class="nav-item" href="./dashboard.html" data-mobile-close>
              <span class="nav-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
              </span>
              <span>Dashboard</span>
            </a>
          </div>

          <div class="nav-group">
            <div class="nav-group-label">Sales</div>
            <a class="nav-item" href="./quotes.html" data-mobile-close>
              <span class="nav-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M7 3h8l4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="2"/><path d="M15 3v5h5" stroke="currentColor" stroke-width="2"/><path d="M8 12h8M8 16h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </span>
              <span>Quotes</span>
            </a>
            <a class="nav-item" href="./customers.html" data-mobile-close>
              <span class="nav-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z" stroke="currentColor" stroke-width="2"/><path d="M4 21a8 8 0 0 1 16 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </span>
              <span>Customers</span>
            </a>
            <a class="nav-item" href="./leads.html" data-mobile-close>
              <span class="nav-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M5 11.5v4.8c0 .5.2 1 .6 1.3 1.4 1.2 3.9 2.9 6.4 2.9 2.5 0 5-1.7 6.4-2.9.4-.3.6-.8.6-1.3v-4.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              <span>Leads</span>
            </a>
          </div>

          <div class="nav-group">
            <div class="nav-group-label">Catalog</div>
            <a class="nav-item active" href="./products.html" aria-current="page" data-mobile-close>
              <span class="nav-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M20 7 12 3 4 7v10l8 4 8-4V7Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 7v14" stroke="currentColor" stroke-width="2" opacity=".55"/><path d="M4 7l8 4 8-4" stroke="currentColor" stroke-width="2" opacity=".55"/></svg>
              </span>
              <span>Products</span>
            </a>
          </div>

          <div class="nav-group">
            <div class="nav-group-label">Admin</div>
            <a class="nav-item" href="./settings.html" data-mobile-close>
              <span class="nav-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a7.7 7.7 0 0 0 .1-1 7.7 7.7 0 0 0-.1-1l2-1.5-2-3.5-2.4.6a7.8 7.8 0 0 0-1.7-1L13.8 3h-3.6L8.7 6.6a7.8 7.8 0 0 0-1.7 1L4.6 7l-2 3.5 2 1.5a7.7 7.7 0 0 0-.1 1 7.7 7.7 0 0 0 .1 1l-2 1.5 2 3.5 2.4-.6a7.8 7.8 0 0 0 1.7 1L10.2 21h3.6l1.5-3.6a7.8 7.8 0 0 0 1.7-1l2.4.6 2-3.5-2-1.5Z" stroke="currentColor" stroke-width="2" opacity=".55" stroke-linejoin="round"/></svg>
              </span>
              <span>Settings</span>
            </a>
          </div>
        </nav>

        <div class="mobile-menu-actions">
          <button id="mobile-new-btn" class="btn btn-primary" type="button">New sale item</button>
          <button id="mobile-logout-btn" class="btn btn-quiet" type="button">Log out</button>
        </div>
      `;
      body.appendChild(panel);

      panel.querySelector('#mobile-menu-close')?.addEventListener('click', closeMobileMenu);
      panel.querySelectorAll('[data-mobile-close]').forEach((el) => {
        el.addEventListener('click', () => {
          if (isMobileViewport()) closeMobileMenu();
        });
      });
      panel.querySelector('#mobile-new-btn')?.addEventListener('click', () => {
        closeMobileMenu();
        (btnNewDesktop || doc.getElementById('btn-new-inline'))?.click();
      });
      panel.querySelector('#mobile-logout-btn')?.addEventListener('click', () => {
        closeMobileMenu();
        logoutDesktop?.click();
      });
    }

    syncMobileMenuMeta();
  }

  injectMobileMenu();
  applyMobileTableLabels();

  if (productsTbody) {
    const observer = new MutationObserver(() => applyMobileTableLabels());
    observer.observe(productsTbody, { childList: true, subtree: true });
  }

  if (workspaceNameNode || userEmailNode) {
    const metaObserver = new MutationObserver(() => syncMobileMenuMeta());
    if (workspaceNameNode) metaObserver.observe(workspaceNameNode, { childList: true, subtree: true, characterData: true });
    if (userEmailNode) metaObserver.observe(userEmailNode, { childList: true, subtree: true, characterData: true });
  }

  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMobileMenu();
  });

  window.addEventListener('resize', () => {
    if (!isMobileViewport()) closeMobileMenu();
    applyMobileTableLabels();
  });
})();
