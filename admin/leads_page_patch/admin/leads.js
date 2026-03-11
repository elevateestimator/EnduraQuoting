import { supabase } from "../js/api.js";
import { listLeads, createLead, updateLead, deleteLead } from "../js/leadsApi.js";

const workspaceNameEl = document.getElementById("workspace-name");
const userEmailEl = document.getElementById("user-email");
const errorBox = document.getElementById("error-box");
const toastEl = document.getElementById("toast");

const logoutBtn = document.getElementById("logout-btn");
const btnNew = document.getElementById("btn-new");
const btnNewInline = document.getElementById("btn-new-inline");
const btnCopyEndpoint = document.getElementById("btn-copy-endpoint");
const endpointUrlEl = document.getElementById("endpoint-url");

const searchEl = document.getElementById("search");
const statusFilterEl = document.getElementById("status-filter");
const countEl = document.getElementById("lead-count");

const metricTotalEl = document.getElementById("metric-total");
const metricNewEl = document.getElementById("metric-new");
const metricQualifiedEl = document.getElementById("metric-qualified");
const metricWonEl = document.getElementById("metric-won");

const loadingEl = document.getElementById("loading");
const emptyEl = document.getElementById("empty");
const tableWrap = document.getElementById("table-wrap");
const tbody = document.getElementById("leads-body");

const dialog = document.getElementById("lead-dialog");
const form = document.getElementById("lead-form");
const cancelBtn = document.getElementById("lead-cancel");
const submitBtn = document.getElementById("lead-submit");
const dialogTitle = document.getElementById("dialog-title");
const dialogSub = document.getElementById("dialog-sub");
const metaEl = document.getElementById("lead-meta");
const msgEl = document.getElementById("lead-msg");

const firstNameEl = document.getElementById("first_name");
const lastNameEl = document.getElementById("last_name");
const companyNameEl = document.getElementById("company_name");
const emailEl = document.getElementById("email");
const phoneEl = document.getElementById("phone");
const addressEl = document.getElementById("address");
const statusEl = document.getElementById("status");
const sourceEl = document.getElementById("source");
const notesEl = document.getElementById("notes");

let toastTimer = null;
let mode = "create";
let editingId = null;

function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg || "";
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

function sanitizeString(s) {
  return String(s || "").trim();
}

function normalizeOptional(s) {
  const v = sanitizeString(s);
  return v ? v : null;
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

function formatDateTimeShort(iso) {
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

function setLoading(isLoading) {
  if (loadingEl) loadingEl.hidden = !isLoading;
}

function setEmpty(isEmpty) {
  if (emptyEl) emptyEl.hidden = !isEmpty;
  if (tableWrap) tableWrap.hidden = isEmpty;
}

function clearTable() {
  if (tbody) tbody.innerHTML = "";
}

function leadDisplayName(lead) {
  const first = sanitizeString(lead?.first_name);
  const last = sanitizeString(lead?.last_name);
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full || sanitizeString(lead?.company_name) || sanitizeString(lead?.email) || "(Unnamed lead)";
}

function normalizeStatus(status) {
  const s = sanitizeString(status).toLowerCase();
  return ["new", "contacted", "qualified", "won", "lost"].includes(s) ? s : "new";
}

function prettyStatus(status) {
  const s = normalizeStatus(status);
  if (s === "contacted") return "Contacted";
  if (s === "qualified") return "Qualified";
  if (s === "won") return "Won";
  if (s === "lost") return "Lost";
  return "New";
}

function normalizeSource(source) {
  const s = sanitizeString(source).toLowerCase();
  return s || "manual";
}

function prettySource(source) {
  const s = normalizeSource(source);
  if (s === "zapier") return "Zapier";
  if (s === "make") return "Make";
  if (s === "website") return "Website";
  if (s === "phone") return "Phone";
  if (s === "referral") return "Referral";
  if (s === "other") return "Other";
  return "Manual";
}

function updateMetrics(leads) {
  const counts = { total: leads.length, new: 0, qualified: 0, won: 0 };
  for (const lead of leads) {
    const s = normalizeStatus(lead.status);
    if (s === "new") counts.new += 1;
    if (s === "qualified") counts.qualified += 1;
    if (s === "won") counts.won += 1;
  }
  if (metricTotalEl) metricTotalEl.textContent = String(counts.total);
  if (metricNewEl) metricNewEl.textContent = String(counts.new);
  if (metricQualifiedEl) metricQualifiedEl.textContent = String(counts.qualified);
  if (metricWonEl) metricWonEl.textContent = String(counts.won);
}

function renderRow(lead) {
  const tr = document.createElement("tr");

  const tdLead = document.createElement("td");
  const leadName = document.createElement("div");
  leadName.className = "lead-name";
  leadName.textContent = leadDisplayName(lead);
  const leadSub = document.createElement("div");
  leadSub.className = "lead-sub";
  leadSub.textContent = sanitizeString(lead.notes) || "No notes yet";
  tdLead.appendChild(leadName);
  tdLead.appendChild(leadSub);
  tr.appendChild(tdLead);

  const tdCompany = document.createElement("td");
  tdCompany.textContent = sanitizeString(lead.company_name) || "—";
  tr.appendChild(tdCompany);

  const tdContact = document.createElement("td");
  const stack = document.createElement("div");
  stack.className = "contact-stack";
  const emailLine = document.createElement("div");
  emailLine.className = "contact-line";
  emailLine.textContent = sanitizeString(lead.email) || "—";
  const phoneLine = document.createElement("div");
  phoneLine.className = "contact-line muted";
  phoneLine.textContent = sanitizeString(lead.phone) || "—";
  stack.appendChild(emailLine);
  stack.appendChild(phoneLine);
  tdContact.appendChild(stack);
  tr.appendChild(tdContact);

  const tdStatus = document.createElement("td");
  const statusBadge = document.createElement("span");
  const normalizedStatus = normalizeStatus(lead.status);
  statusBadge.className = `lead-badge ${normalizedStatus}`;
  statusBadge.textContent = prettyStatus(normalizedStatus);
  tdStatus.appendChild(statusBadge);
  tr.appendChild(tdStatus);

  const tdSource = document.createElement("td");
  const sourceBadge = document.createElement("span");
  const normalizedSource = normalizeSource(lead.source);
  sourceBadge.className = `source-badge ${normalizedSource}`;
  sourceBadge.textContent = prettySource(normalizedSource);
  tdSource.appendChild(sourceBadge);
  tr.appendChild(tdSource);

  const tdCreated = document.createElement("td");
  tdCreated.textContent = formatDateShort(lead.created_at);
  tr.appendChild(tdCreated);

  const tdActions = document.createElement("td");
  const actions = document.createElement("div");
  actions.className = "row-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "btn btn-secondary";
  editBtn.type = "button";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openEdit(lead);
  });
  actions.appendChild(editBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "btn btn-danger";
  delBtn.type = "button";
  delBtn.textContent = "Delete";
  delBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = window.confirm(`Delete ${leadDisplayName(lead)}?\n\nThis permanently removes the lead.`);
    if (!ok) return;

    try {
      setError("");
      delBtn.disabled = true;
      await deleteLead(lead.id);
      toast("Lead deleted.");
      await loadLeads({ search: searchEl?.value || "", status: statusFilterEl?.value || "" });
    } catch (err) {
      setError(err?.message || "Failed to delete lead.");
    } finally {
      delBtn.disabled = false;
    }
  });
  actions.appendChild(delBtn);

  tdActions.appendChild(actions);
  tr.appendChild(tdActions);

  tr.addEventListener("click", () => openEdit(lead));
  return tr;
}

function resetForm() {
  setFormMsg("");
  setMeta("");
  firstNameEl.value = "";
  lastNameEl.value = "";
  companyNameEl.value = "";
  emailEl.value = "";
  phoneEl.value = "";
  addressEl.value = "";
  statusEl.value = "new";
  sourceEl.value = "manual";
  notesEl.value = "";
}

function openCreate() {
  mode = "create";
  editingId = null;
  resetForm();
  dialogTitle.textContent = "New lead";
  dialogSub.textContent = "Add a new opportunity to your workspace.";
  submitBtn.textContent = "Create lead";
  openDialog(dialog);
  firstNameEl.focus();
}

function openEdit(lead) {
  mode = "edit";
  editingId = lead.id;
  setFormMsg("");
  setError("");

  firstNameEl.value = sanitizeString(lead.first_name);
  lastNameEl.value = sanitizeString(lead.last_name);
  companyNameEl.value = sanitizeString(lead.company_name);
  emailEl.value = sanitizeString(lead.email);
  phoneEl.value = sanitizeString(lead.phone);
  addressEl.value = sanitizeString(lead.address);
  statusEl.value = normalizeStatus(lead.status);
  sourceEl.value = normalizeSource(lead.source);
  notesEl.value = sanitizeString(lead.notes);

  dialogTitle.textContent = "Lead";
  dialogSub.textContent = "Update status, contact details, or notes without leaving the page.";
  submitBtn.textContent = "Save changes";
  setMeta(`Created: ${formatDateTimeShort(lead.created_at)}  •  Updated: ${formatDateTimeShort(lead.updated_at || lead.created_at)}`);

  openDialog(dialog);
  firstNameEl.focus();
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

let searchTimer = null;
function wireSearch() {
  if (searchEl) {
    searchEl.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        loadLeads({ search: searchEl.value || "", status: statusFilterEl?.value || "" });
      }, 180);
    });
  }

  if (statusFilterEl) {
    statusFilterEl.addEventListener("change", () => {
      loadLeads({ search: searchEl?.value || "", status: statusFilterEl.value || "" });
    });
  }
}

function maybeMissingTableMessage(err) {
  const msg = String(err?.message || "").toLowerCase();
  if (
    msg.includes("leads") &&
    (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("relation"))
  ) {
    return "Leads table not found yet. Run the leads_table.sql file from this patch in Supabase, then refresh.";
  }
  return err?.message || "Failed to load leads.";
}

async function loadLeads({ search = "", status = "" } = {}) {
  setError("");
  setLoading(true);
  setEmpty(false);
  clearTable();

  try {
    const leads = await listLeads({ search, status, limit: 500 });

    if (countEl) countEl.textContent = String(leads.length);
    updateMetrics(leads);

    if (!leads.length) {
      setEmpty(true);
      return;
    }

    for (const lead of leads) tbody.appendChild(renderRow(lead));
  } catch (err) {
    setError(maybeMissingTableMessage(err));
    updateMetrics([]);
    setEmpty(true);
  } finally {
    setLoading(false);
  }
}

function buildPayloadFromForm() {
  return {
    first_name: normalizeOptional(firstNameEl.value),
    last_name: normalizeOptional(lastNameEl.value),
    company_name: normalizeOptional(companyNameEl.value),
    email: normalizeOptional(emailEl.value),
    phone: normalizeOptional(phoneEl.value),
    address: normalizeOptional(addressEl.value),
    status: normalizeStatus(statusEl.value),
    source: normalizeSource(sourceEl.value),
    notes: normalizeOptional(notesEl.value),
  };
}

function validateLeadPayload(payload) {
  const hasIdentity = [payload.first_name, payload.last_name, payload.company_name, payload.email, payload.phone]
    .some(Boolean);
  if (!hasIdentity) {
    return "Add at least a name, company, email, or phone so the lead is identifiable.";
  }
  return "";
}

async function copyFutureEndpoint() {
  const url = `${window.location.origin}/api/leads-inbox`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Future endpoint copied.");
  } catch {
    toast("Copy failed.");
  }
}

async function init() {
  if (logoutBtn) logoutBtn.addEventListener("click", logout);
  if (cancelBtn) cancelBtn.addEventListener("click", () => closeDialog(dialog));
  if (btnCopyEndpoint) btnCopyEndpoint.addEventListener("click", copyFutureEndpoint);

  [btnNew, btnNewInline].filter(Boolean).forEach((btn) => {
    btn.addEventListener("click", openCreate);
  });

  wireSearch();

  const session = await requireSessionOrRedirect();
  if (!session) return;

  if (userEmailEl) userEmailEl.textContent = session.user.email || "";
  if (workspaceNameEl) workspaceNameEl.textContent = inferWorkspaceName(session);
  if (endpointUrlEl) endpointUrlEl.textContent = `${window.location.origin}/api/leads-inbox`;

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setFormMsg("");
      setError("");

      const payload = buildPayloadFromForm();
      const validation = validateLeadPayload(payload);
      if (validation) {
        setFormMsg(validation);
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = mode === "edit" ? "Saving…" : "Creating…";

        if (mode === "edit" && editingId) {
          await updateLead(editingId, payload);
          toast("Lead updated.");
        } else {
          await createLead(payload);
          toast("Lead created.");
        }

        closeDialog(dialog);
        await loadLeads({ search: searchEl?.value || "", status: statusFilterEl?.value || "" });
      } catch (err) {
        setFormMsg(maybeMissingTableMessage(err));
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = mode === "edit" ? "Save changes" : "Create lead";
      }
    });
  }

  await loadLeads({ search: "", status: "" });
}

init();
