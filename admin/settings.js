import { supabase } from "../js/api.js";

/**
 * Settings (v1)
 * - Company profile (name, phone, website, address, currency)
 * - Company logo upload (Supabase Storage bucket: company-logos)
 * - Billing placeholder (billing_email, seats, plan label)
 * - User profile (profiles table)
 * - Team management (invite users via /api/invite-user, role updates via company_members)
 *
 * NOTE:
 * - Company + Team sections are owner/admin only.
 * - Billing “Manage billing” is placeholder until Stripe.
 */

const workspaceNameEl = document.getElementById("workspace-name");
const userEmailEl = document.getElementById("user-email");
const errorBox = document.getElementById("error-box");
const toastEl = document.getElementById("toast");

// Top actions
const logoutBtn = document.getElementById("logout-btn");

// Company form
const companyNameEl = document.getElementById("company_name");
const companyPhoneEl = document.getElementById("company_phone");
const companyWebsiteEl = document.getElementById("company_website");
const companyCurrencyEl = document.getElementById("company_currency");
const companyAddressEl = document.getElementById("company_address");
const companyBrandColorEl = document.getElementById("company_brand_color");
const companyBrandColorPickerEl = document.getElementById("company_brand_color_picker");
const saveCompanyBtn = document.getElementById("btn-save-company");
const companyPermsNote = document.getElementById("company-perms-note");

// Quote defaults
const companyPaymentTermsEl = document.getElementById("company_payment_terms");
const companyTaxNameEl = document.getElementById("company_tax_name");
const companyTaxRateEl = document.getElementById("company_tax_rate");
const saveQuoteDefaultsBtn = document.getElementById("btn-save-quote-defaults");
const quoteDefaultsPermsNote = document.getElementById("quote-defaults-perms-note");

// Quote defaults: Payment schedule (milestone payments)
const paymentScheduleBodyEl = document.getElementById("payment-schedule-body");
const paymentScheduleTotalEl = document.getElementById("payment-schedule-total");
const paymentScheduleMsgEl = document.getElementById("payment-schedule-msg");
const addPaymentStepBtn = document.getElementById("btn-add-payment-step");
const paymentScheduleExampleBtn = document.getElementById("btn-payment-schedule-example");


// Logo
const companyLogoImg = document.getElementById("company-logo");
const logoFileEl = document.getElementById("logo-file");
const pickLogoBtn = document.getElementById("btn-pick-logo");
const uploadLogoBtn = document.getElementById("btn-upload-logo");
const logoMsgEl = document.getElementById("logo-msg");

// Billing
const billingPlanEl = document.getElementById("billing-plan");
const billingSeatsEl = document.getElementById("billing-seats");
const billingEmailEl = document.getElementById("billing_email");
const saveBillingBtn = document.getElementById("btn-save-billing");
const manageBillingBtn = document.getElementById("btn-manage-billing");

// Profile
const profileFirstEl = document.getElementById("profile_first");
const profileLastEl = document.getElementById("profile_last");
const profileEmailEl = document.getElementById("profile_email");
const profilePhoneEl = document.getElementById("profile_phone");
const saveProfileBtn = document.getElementById("btn-save-profile");
const sendResetBtn = document.getElementById("btn-send-reset");
const profileMsgEl = document.getElementById("profile-msg");

// Team
const teamNoteEl = document.getElementById("team-note");
const teamLoadingEl = document.getElementById("team-loading");
const teamEmptyEl = document.getElementById("team-empty");
const teamTableWrap = document.getElementById("team-table-wrap");
const membersBody = document.getElementById("members-body");
const inviteBtn = document.getElementById("btn-invite");

// Invite dialog
const inviteDialog = document.getElementById("invite-dialog");
const inviteForm = document.getElementById("invite-form");
const inviteCancelBtn = document.getElementById("invite-cancel");
const inviteSubmitBtn = document.getElementById("invite-submit");
const inviteEmailEl = document.getElementById("invite_email");
const inviteRoleEl = document.getElementById("invite_role");
const inviteMsgEl = document.getElementById("invite-msg");

let toastTimer = null;
let state = {
  session: null,
  membership: null,
  company: null,
  profile: null,
  isAdmin: false,
};

let autosave = {
  company: null,
  quoteDefaults: null,
  billing: null,
  profile: null,
  wired: false,
};


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

function setProfileMsg(message) {
  if (!profileMsgEl) return;
  profileMsgEl.textContent = message || "";
}

function setInviteMsg(message) {
  if (!inviteMsgEl) return;
  inviteMsgEl.textContent = message || "";
}

function setLogoMsg(message) {
  if (!logoMsgEl) return;
  logoMsgEl.textContent = message || "";
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

function isAdminRole(role) {
  const r = String(role || "").toLowerCase();
  return r === "owner" || r === "admin";
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

async function loadMembership(userId) {
  const { data, error } = await supabase
    .from("company_members")
    .select("company_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("No company membership found for this account.");
  return data;
}

async function loadCompany(companyId) {
  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .single();

  if (error) throw error;
  return data;
}

async function loadProfile(userId) {
  // Preferred: profiles table
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();

  // If profiles table isn't created yet, gracefully fall back to metadata.
  if (error) {
    console.warn("profiles load error", error);
    return null;
  }
  return data || null;
}

function fillCompanyForm(company) {
  companyNameEl.value = company?.name || "";
  companyPhoneEl.value = company?.phone || "";
  companyWebsiteEl.value = company?.website || "";
  companyCurrencyEl.value = company?.default_currency || "CAD";
  companyAddressEl.value = company?.address || "";

  // Brand color (optional). Default black.
  if (companyBrandColorEl || companyBrandColorPickerEl) {
    syncBrandColorInputs(company?.brand_color || "#000000");
  }

  if (companyPaymentTermsEl) companyPaymentTermsEl.value = company?.payment_terms || "";

  if (companyTaxNameEl) companyTaxNameEl.value = company?.tax_name || "Tax";
  if (companyTaxRateEl) companyTaxRateEl.value = company?.tax_rate ?? "";

  // Payment schedule (milestone payments)
  if (paymentScheduleBodyEl) {
    renderPaymentSchedule(company?.payment_schedule);
  }

  // Logo (public url stored)
  if (company?.logo_url) {
    companyLogoImg.src = company.logo_url;
  }
}

function fillBilling(company, seatCount) {
  billingPlanEl.textContent = company?.plan_name || "Starter";
  billingSeatsEl.textContent = seatCount ? `${seatCount} seat${seatCount === 1 ? "" : "s"}` : "—";
  billingEmailEl.value = company?.billing_email || company?.owner_email || "";
}

function fillProfile(session, profile) {
  profileEmailEl.value = session?.user?.email || "";

  // Fill from profiles if present, else metadata
  const md = session?.user?.user_metadata || {};
  profileFirstEl.value = profile?.first_name || md.first_name || "";
  profileLastEl.value = profile?.last_name || md.last_name || "";
  profilePhoneEl.value = profile?.phone || md.phone || "";
}

function applyPermissions() {
  const isAdmin = state.isAdmin;

  // Company fields
  const companyDisabled = !isAdmin;
  for (const el of [
    companyNameEl,
    companyPhoneEl,
    companyWebsiteEl,
    companyCurrencyEl,
    companyAddressEl,
    companyBrandColorEl,
    companyBrandColorPickerEl,
  ]) {
    el.disabled = companyDisabled;
  }
  saveCompanyBtn.disabled = companyDisabled;
  pickLogoBtn.disabled = companyDisabled;
  uploadLogoBtn.disabled = companyDisabled;

  if (companyPermsNote) companyPermsNote.hidden = isAdmin;

  // Quote defaults
  if (companyPaymentTermsEl) companyPaymentTermsEl.disabled = !isAdmin;
  if (companyTaxNameEl) companyTaxNameEl.disabled = !isAdmin;
  if (companyTaxRateEl) companyTaxRateEl.disabled = !isAdmin;

  if (addPaymentStepBtn) addPaymentStepBtn.disabled = !isAdmin;
  if (paymentScheduleExampleBtn) paymentScheduleExampleBtn.disabled = !isAdmin;

  if (paymentScheduleBodyEl) {
    for (const el of paymentScheduleBodyEl.querySelectorAll("input, button")) {
      el.disabled = !isAdmin;
    }
  }

  // Save gating is handled by payment schedule validation (and admin role)
  if (saveQuoteDefaultsBtn) saveQuoteDefaultsBtn.disabled = !isAdmin;
  if (quoteDefaultsPermsNote) quoteDefaultsPermsNote.hidden = isAdmin;

  // Ensure the save button is disabled unless the schedule is valid
  syncPaymentScheduleUI();

  // Billing
  saveBillingBtn.disabled = !isAdmin;
  billingEmailEl.disabled = !isAdmin;

  // Team
  inviteBtn.disabled = !isAdmin;
  if (teamNoteEl) teamNoteEl.hidden = isAdmin;
}

function setTeamLoading(isLoading) {
  if (teamLoadingEl) teamLoadingEl.hidden = !isLoading;
}

function setTeamEmpty(isEmpty) {
  if (teamEmptyEl) teamEmptyEl.hidden = !isEmpty;
  if (teamTableWrap) teamTableWrap.hidden = isEmpty;
}

function clearMembers() {
  if (membersBody) membersBody.innerHTML = "";
}

function safeNameFromProfile(p) {
  const name = `${p?.first_name || ""} ${p?.last_name || ""}`.trim();
  if (name) return name;
  if (p?.email) return p.email.split("@")[0];
  return "";
}

function renderMemberRow(member, profilesById, company) {
  const tr = document.createElement("tr");
  const p = profilesById?.[member.user_id] || null;

  const tdMember = document.createElement("td");
  const strong = document.createElement("div");
  strong.className = "cell-strong";
  strong.textContent = safeNameFromProfile(p) || "Team member";
  const sub = document.createElement("div");
  sub.className = "cell-sub";
  sub.textContent = member.user_id === state.session?.user?.id ? "You" : "—";
  tdMember.appendChild(strong);
  tdMember.appendChild(sub);

  const tdEmail = document.createElement("td");
  tdEmail.textContent = p?.email || "—";

  const tdRole = document.createElement("td");

  const isOwnerRow = company?.owner_user_id && member.user_id === company.owner_user_id;
  if (isOwnerRow) {
    const badge = document.createElement("span");
    badge.className = "badge accepted";
    badge.textContent = "Owner";
    tdRole.appendChild(badge);
  } else {
    const sel = document.createElement("select");
    sel.className = "role-select";
    sel.disabled = !state.isAdmin;

    const role = String(member.role || "sales").toLowerCase();
    const options = [
      { value: "sales", label: "Sales" },
      { value: "admin", label: "Admin" },
    ];

    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === role) opt.selected = true;
      sel.appendChild(opt);
    }

    sel.addEventListener("change", async () => {
      try {
        setError("");
        sel.disabled = true;
        const next = sel.value;

        const { error } = await supabase
          .from("company_members")
          .update({ role: next })
          .eq("company_id", state.company.id)
          .eq("user_id", member.user_id);

        if (error) throw error;
        toast("Role updated.");
      } catch (e) {
        setError(e?.message || "Failed to update role.");
      } finally {
        sel.disabled = !state.isAdmin;
      }
    });

    tdRole.appendChild(sel);
  }

  const tdAdded = document.createElement("td");
  tdAdded.textContent = formatDateShort(member.created_at);

  tr.appendChild(tdMember);
  tr.appendChild(tdEmail);
  tr.appendChild(tdRole);
  tr.appendChild(tdAdded);

  return tr;
}

async function loadTeam() {
  setError("");
  setTeamLoading(true);
  setTeamEmpty(false);
  clearMembers();

  // Non-admins: still show self (if RLS only allows self), but keep UI calm.
  try {
    const { data: members, error } = await supabase
      .from("company_members")
      .select("user_id, role, created_at")
      .eq("company_id", state.company.id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    if (!members?.length) {
      setTeamEmpty(true);
      return;
    }

    // Load profiles for nicer names/emails (requires profiles policies)
    const ids = members.map((m) => m.user_id).filter(Boolean);
    let profilesById = {};
    if (ids.length) {
      const { data: profs, error: pe } = await supabase
        .from("profiles")
        .select("id, email, first_name, last_name")
        .in("id", ids);

      if (pe) {
        console.warn("profiles list error", pe);
      } else {
        for (const p of profs || []) profilesById[p.id] = p;
      }
    }

    for (const m of members) membersBody.appendChild(renderMemberRow(m, profilesById, state.company));

    setTeamEmpty(false);
  } catch (e) {
    // If RLS blocks listing for non-admins, show empty state rather than scary error.
    console.warn("team load error", e);
    setTeamEmpty(true);
  } finally {
    setTeamLoading(false);
  }
}

function sanitizeString(s) {
  return String(s || "").trim();
}

function normalizeOptional(s) {
  const v = sanitizeString(s);
  return v ? v : null;
}

function normalizeNumber(s, { min = 0, max = 100 } = {}) {
  const v = sanitizeString(s);
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.min(Math.max(n, min), max);
  return clamped;
}

function normalizeHexColor(s) {
  let v = sanitizeString(s);
  if (!v) return null;

  // Allow "000000" or "#000000" or "000" / "#000"
  if (!v.startsWith("#")) v = `#${v}`;

  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const h = v.slice(1);
    v = "#" + h.split("").map((c) => c + c).join("");
  }

  if (!/^#[0-9a-fA-F]{6}$/.test(v)) return null;

  return v.toUpperCase();
}

function syncBrandColorInputs(value) {
  const hex = normalizeHexColor(value) || "#000000";
  if (companyBrandColorEl && companyBrandColorEl.value !== hex) companyBrandColorEl.value = hex;
  if (companyBrandColorPickerEl && companyBrandColorPickerEl.value !== hex) companyBrandColorPickerEl.value = hex;
}

/* =========================================================
   Payment schedule (Quote defaults)
   ========================================================= */

function defaultPaymentSchedule() {
  return [
    { title: "Deposit", percent: 40 },
    { title: "On material delivery", percent: 40 },
    { title: "On completion", percent: 20 },
  ];
}

function coercePaymentSchedule(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value;

  // In case a JSON string was stored accidentally
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }

  return null;
}

function clampNumber(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

function percentToHundredths(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n)) return 0;
  const clamped = clampNumber(n, 0, 100);
  return Math.round(clamped * 100);
}

function formatPercentDisplay(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n)) return "0";
  const fixed = n.toFixed(2);
  if (fixed.endsWith(".00")) return String(Math.round(n));
  return fixed.replace(/0$/, "");
}

function normalizePaymentSchedule(raw) {
  const arr = coercePaymentSchedule(raw);
  if (!arr || !arr.length) return null;

  const out = [];
  for (const step of arr) {
    const title = sanitizeString(step?.title || step?.name || step?.label || "");
    const percent = Number(step?.percent ?? step?.percentage ?? step?.pct ?? 0);
    out.push({ title, percent: clampNumber(percent, 0, 100) });
  }

  return out;
}

function getPaymentScheduleRows() {
  if (!paymentScheduleBodyEl) return [];
  return Array.from(paymentScheduleBodyEl.querySelectorAll("tr.ps-row"));
}

function readPaymentScheduleFromUI() {
  const rows = getPaymentScheduleRows();
  const steps = [];

  for (const row of rows) {
    const titleEl = row.querySelector(".ps-title");
    const percentEl = row.querySelector(".ps-percent");

    const title = sanitizeString(titleEl?.value);
    const p = normalizeNumber(percentEl?.value, { min: 0, max: 100 });
    const percent = p == null ? 0 : p;

    steps.push({ title, percent });
  }

  return steps;
}

function validatePaymentSchedule(steps) {
  const schedule = Array.isArray(steps) ? steps : [];
  if (!schedule.length) {
    return {
      ok: false,
      totalHundredths: 0,
      message: "Add at least 1 payment step.",
    };
  }

  // Validate row-by-row
  for (const s of schedule) {
    if (!sanitizeString(s?.title)) {
      return {
        ok: false,
        totalHundredths: schedule.reduce((sum, x) => sum + percentToHundredths(x?.percent), 0),
        message: "Each payment step needs a name (example: Deposit).",
      };
    }

    const p = Number(s?.percent);
    if (!Number.isFinite(p) || p <= 0) {
      return {
        ok: false,
        totalHundredths: schedule.reduce((sum, x) => sum + percentToHundredths(x?.percent), 0),
        message: "Each payment step needs a percent greater than 0%.",
      };
    }
  }

  const totalHundredths = schedule.reduce((sum, s) => sum + percentToHundredths(s?.percent), 0);
  const ok = totalHundredths === 10000;
  const total = totalHundredths / 100;

  return {
    ok,
    totalHundredths,
    message: ok
      ? "Total is 100%. This will show on new quotes as your payment plan."
      : `Total must equal 100% (currently ${formatPercentDisplay(total)}%).`,
  };
}

function syncPaymentScheduleRemoveButtons() {
  const rows = getPaymentScheduleRows();
  const onlyOne = rows.length <= 1;
  for (const row of rows) {
    const btn = row.querySelector(".ps-remove");
    if (!btn) continue;

    // Non-admin: everything disabled anyway
    if (!state.isAdmin) {
      btn.disabled = true;
      continue;
    }

    btn.disabled = onlyOne;
  }
}

function syncPaymentScheduleUI() {
  if (!paymentScheduleBodyEl || !paymentScheduleTotalEl || !paymentScheduleMsgEl) return;

  const steps = readPaymentScheduleFromUI();
  const v = validatePaymentSchedule(steps);

  // Total display
  const total = v.totalHundredths / 100;
  paymentScheduleTotalEl.textContent = formatPercentDisplay(total);

  // Message styling
  paymentScheduleMsgEl.textContent = v.message || "";
  paymentScheduleMsgEl.classList.toggle("error", !v.ok);
  paymentScheduleMsgEl.classList.toggle("ok", v.ok);

  // Save button gating (must be admin AND schedule valid)
  if (saveQuoteDefaultsBtn) {
    saveQuoteDefaultsBtn.disabled = !state.isAdmin || !v.ok;
  }

  // Remove buttons
  syncPaymentScheduleRemoveButtons();
}

function addPaymentScheduleRow(step = {}) {
  if (!paymentScheduleBodyEl) return null;

  const tr = document.createElement("tr");
  tr.className = "ps-row";

  const tdTitle = document.createElement("td");
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "ps-title";
  titleInput.placeholder = "Deposit (upon acceptance)";
  titleInput.value = sanitizeString(step?.title || "");
  titleInput.disabled = !state.isAdmin;
  tdTitle.appendChild(titleInput);

  const tdPct = document.createElement("td");
  const pctInput = document.createElement("input");
  pctInput.type = "number";
  pctInput.inputMode = "decimal";
  pctInput.step = "0.01";
  pctInput.min = "0";
  pctInput.max = "100";
  pctInput.className = "ps-percent";
  pctInput.placeholder = "40";

  const pct = Number(step?.percent);
  pctInput.value = Number.isFinite(pct) && pct > 0 ? String(pct) : "";
  pctInput.disabled = !state.isAdmin;
  tdPct.appendChild(pctInput);

  const tdAct = document.createElement("td");
  const rmBtn = document.createElement("button");
  rmBtn.type = "button";
  rmBtn.className = "ps-remove";
  rmBtn.textContent = "✕";
  rmBtn.setAttribute("aria-label", "Remove payment step");
  rmBtn.disabled = !state.isAdmin;
  tdAct.appendChild(rmBtn);

  rmBtn.addEventListener("click", () => {
    // Keep at least 1 row
    const rows = getPaymentScheduleRows();
    if (rows.length <= 1) return;

    tr.remove();
    syncPaymentScheduleUI();
  });

  // Live validation
  for (const el of [titleInput, pctInput]) {
    el.addEventListener("input", syncPaymentScheduleUI);
    el.addEventListener("change", syncPaymentScheduleUI);
  }

  tr.appendChild(tdTitle);
  tr.appendChild(tdPct);
  tr.appendChild(tdAct);
  paymentScheduleBodyEl.appendChild(tr);

  return { tr, titleInput, pctInput };
}

function renderPaymentSchedule(schedule) {
  if (!paymentScheduleBodyEl) return;
  paymentScheduleBodyEl.innerHTML = "";

  const normalized = normalizePaymentSchedule(schedule) || defaultPaymentSchedule();
  for (const step of normalized) addPaymentScheduleRow(step);

  syncPaymentScheduleUI();
}

function addPaymentScheduleStep() {
  if (!state.isAdmin) {
    toast("Only owners/admins can edit quote defaults.");
    return;
  }
  if (!paymentScheduleBodyEl) return;

  const current = readPaymentScheduleFromUI();
  const totalHundredths = current.reduce((sum, s) => sum + percentToHundredths(s?.percent), 0);
  const remaining = Math.max(0, 10000 - totalHundredths) / 100;

  const added = addPaymentScheduleRow({ title: "", percent: remaining > 0 ? remaining : "" });
  syncPaymentScheduleUI();

  // Focus the new title field
  try {
    added?.titleInput?.focus();
  } catch {}
}

function usePaymentScheduleExample() {
  if (!state.isAdmin) {
    toast("Only owners/admins can edit quote defaults.");
    return;
  }

  renderPaymentSchedule(defaultPaymentSchedule());
  toast("Example payment schedule added.");
}

function wirePaymentSchedule() {
  if (addPaymentStepBtn) addPaymentStepBtn.addEventListener("click", addPaymentScheduleStep);
  if (paymentScheduleExampleBtn)
    paymentScheduleExampleBtn.addEventListener("click", usePaymentScheduleExample);
}


/* =========================================================
   Auto-save (Settings)
   ---------------------------------------------------------
   Goal: Nobody should lose changes because they forgot to click Save.
   - Debounced auto-save on input/change
   - Flush on blur / page hide
   - Subtle status text beside each Save button
   - Safe handling for "invalid while typing" fields (brand color, payment schedule)
   ========================================================= */

function ensureAutosaveStatusEl(saveBtn, id) {
  if (!saveBtn) return null;
  const parent = saveBtn.parentElement;
  if (!parent) return null;

  let el = parent.querySelector(`#${id}`);
  if (el) return el;

  el = document.createElement("span");
  el.id = id;
  el.className = "muted small";
  el.style.marginRight = "10px";
  el.style.fontWeight = "850";
  el.style.whiteSpace = "nowrap";
  el.style.userSelect = "none";
  el.setAttribute("aria-live", "polite");

  parent.insertBefore(el, saveBtn);
  return el;
}

function setAutosaveStatus(el, text, kind = "idle") {
  if (!el) return;
  el.textContent = text || "";
  el.dataset.kind = kind;

  // Tiny visual hint without needing CSS changes.
  if (kind === "error") {
    el.style.color = "#b91c1c";
  } else {
    el.style.color = "rgba(90, 101, 114, 0.95)";
  }
}

function createAutoSaver({
  name,
  delay = 900,
  isEnabled,
  getSnapshot,
  onSave,
  statusEl,
  idleText = "Auto-save on",
  readOnlyText = "Read-only",
}) {
  let lastSaved = null;
  let timer = null;
  let inFlight = false;
  let queued = false;
  let idleTimer = null;

  function setIdle() {
    if (!statusEl) return;
    if (!isEnabled()) {
      setAutosaveStatus(statusEl, readOnlyText, "idle");
      return;
    }
    setAutosaveStatus(statusEl, idleText, "idle");
  }

  function markClean() {
    try {
      lastSaved = getSnapshot();
    } catch {
      lastSaved = null;
    }
    setIdle();
  }

  async function run() {
    if (!isEnabled()) return;

    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    const snap = getSnapshot();
    if (lastSaved != null && snap === lastSaved) {
      setIdle();
      return;
    }

    if (inFlight) {
      queued = true;
      return;
    }

    inFlight = true;
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }

    setAutosaveStatus(statusEl, "Saving…", "saving");

    let ok = false;
    try {
      ok = await onSave();
    } catch (e) {
      console.warn(`[autosave:${name}]`, e);
      ok = false;
    }

    inFlight = false;

    if (ok) {
      lastSaved = getSnapshot();
      setAutosaveStatus(statusEl, "Saved", "saved");
      idleTimer = setTimeout(setIdle, 1400);
    } else {
      setAutosaveStatus(statusEl, "Save failed", "error");
    }

    if (queued) {
      queued = false;
      setTimeout(run, 80);
    }
  }

  function schedule() {
    if (!isEnabled()) return;
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  function flush() {
    if (!isEnabled()) return;
    run();
  }

  function cancel() {
    clearTimeout(timer);
    timer = null;
  }

  return { schedule, flush, cancel, markClean, setIdle };
}

function companySnapshotForSave() {
  // Brand color: if user is mid-typing an invalid hex, don't treat it as a change yet.
  const brandTyped = normalizeHexColor(companyBrandColorEl?.value);
  const brandFallback = normalizeHexColor(state.company?.brand_color) || "#000000";
  const brand = brandTyped || brandFallback;

  return JSON.stringify({
    name: sanitizeString(companyNameEl?.value) || sanitizeString(state.company?.name) || "",
    phone: normalizeOptional(companyPhoneEl?.value),
    website: normalizeOptional(companyWebsiteEl?.value),
    address: normalizeOptional(companyAddressEl?.value),
    default_currency: sanitizeString(companyCurrencyEl?.value) || "CAD",
    brand_color: brand,
  });
}

function quoteDefaultsSnapshotForSave() {
  const terms = normalizeOptional(companyPaymentTermsEl?.value);
  const tax_name = normalizeOptional(companyTaxNameEl?.value);
  const tax_rate = normalizeNumber(companyTaxRateEl?.value, { min: 0, max: 100 });

  // Payment schedule: while invalid, keep snapshot pinned to last-saved schedule
  // so we don't spam saves while the user is adjusting percents.
  let scheduleForSnap = normalizePaymentSchedule(state.company?.payment_schedule) || null;

  if (paymentScheduleBodyEl) {
    const schedule = readPaymentScheduleFromUI();
    const v = validatePaymentSchedule(schedule);
    if (v.ok) scheduleForSnap = schedule;
  }

  return JSON.stringify({
    payment_terms: terms,
    tax_name,
    tax_rate,
    payment_schedule: scheduleForSnap,
  });
}

function billingSnapshotForSave() {
  return JSON.stringify({
    billing_email: normalizeOptional(billingEmailEl?.value),
  });
}

function profileSnapshotForSave() {
  return JSON.stringify({
    first_name: normalizeOptional(profileFirstEl?.value),
    last_name: normalizeOptional(profileLastEl?.value),
    phone: normalizeOptional(profilePhoneEl?.value),
  });
}

function wireAutosaveField(el, saver) {
  if (!el || !saver) return;

  el.addEventListener("input", () => saver.schedule());
  el.addEventListener("change", () => saver.schedule());
  el.addEventListener("blur", () => saver.flush());
}

function flushAllAutosaves() {
  try { autosave.company?.flush(); } catch {}
  try { autosave.quoteDefaults?.flush(); } catch {}
  try { autosave.billing?.flush(); } catch {}
  try { autosave.profile?.flush(); } catch {}
}

function setupAutoSave() {
  if (autosave.wired) return;
  if (!state.session || !state.company) return;

  autosave.wired = true;

  // Status text beside Save buttons
  const companyStatusEl = ensureAutosaveStatusEl(saveCompanyBtn, "autosave-company");
  const quoteStatusEl = ensureAutosaveStatusEl(saveQuoteDefaultsBtn, "autosave-quote-defaults");
  const billingStatusEl = ensureAutosaveStatusEl(saveBillingBtn, "autosave-billing");
  const profileStatusEl = ensureAutosaveStatusEl(saveProfileBtn, "autosave-profile");

  autosave.company = createAutoSaver({
    name: "company",
    delay: 900,
    isEnabled: () => Boolean(state.isAdmin && state.company),
    getSnapshot: companySnapshotForSave,
    onSave: () => saveCompany({ mode: "auto" }),
    statusEl: companyStatusEl,
    idleText: "Auto-save on",
    readOnlyText: "Read-only",
  });

  autosave.quoteDefaults = createAutoSaver({
    name: "quote-defaults",
    delay: 950,
    isEnabled: () => Boolean(state.isAdmin && state.company),
    getSnapshot: quoteDefaultsSnapshotForSave,
    onSave: () => saveQuoteDefaults({ mode: "auto" }),
    statusEl: quoteStatusEl,
    idleText: "Auto-save on",
    readOnlyText: "Read-only",
  });

  autosave.billing = createAutoSaver({
    name: "billing",
    delay: 900,
    isEnabled: () => Boolean(state.isAdmin && state.company),
    getSnapshot: billingSnapshotForSave,
    onSave: () => saveBilling({ mode: "auto" }),
    statusEl: billingStatusEl,
    idleText: "Auto-save on",
    readOnlyText: "Read-only",
  });

  // Profile is always editable by the current user
  autosave.profile = createAutoSaver({
    name: "profile",
    delay: 1100,
    isEnabled: () => Boolean(state.session),
    getSnapshot: profileSnapshotForSave,
    onSave: () => saveProfile({ mode: "auto" }),
    statusEl: profileStatusEl,
    idleText: "Auto-save on",
    readOnlyText: "—",
  });

  // Initial baseline (prevents immediate save on load)
  autosave.company.markClean();
  autosave.quoteDefaults.markClean();
  autosave.billing.markClean();
  autosave.profile.markClean();

  // Company fields
  for (const el of [
    companyNameEl,
    companyPhoneEl,
    companyWebsiteEl,
    companyCurrencyEl,
    companyAddressEl,
    companyBrandColorEl,
    companyBrandColorPickerEl,
  ]) {
    wireAutosaveField(el, autosave.company);
  }

  // Quote defaults fields
  for (const el of [companyPaymentTermsEl, companyTaxNameEl, companyTaxRateEl]) {
    wireAutosaveField(el, autosave.quoteDefaults);
  }

  // Payment schedule inputs (event delegation)
  if (paymentScheduleBodyEl) {
    const scheduleHandler = () => autosave.quoteDefaults?.schedule();
    paymentScheduleBodyEl.addEventListener("input", scheduleHandler);
    paymentScheduleBodyEl.addEventListener("change", scheduleHandler);
    paymentScheduleBodyEl.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.closest && t.closest("button")) scheduleHandler();
    });
  }
  if (addPaymentStepBtn) addPaymentStepBtn.addEventListener("click", () => autosave.quoteDefaults?.schedule());
  if (paymentScheduleExampleBtn)
    paymentScheduleExampleBtn.addEventListener("click", () => autosave.quoteDefaults?.schedule());

  // Billing
  wireAutosaveField(billingEmailEl, autosave.billing);

  // Profile
  for (const el of [profileFirstEl, profileLastEl, profilePhoneEl]) {
    wireAutosaveField(el, autosave.profile);
  }

  // Flush pending saves if the tab is closed / navigated away.
  window.addEventListener("pagehide", flushAllAutosaves);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAllAutosaves();
  });
}


async function saveCompany({ mode = "manual" } = {}) {
  const isAuto = mode === "auto";

  if (!state.isAdmin) {
    if (!isAuto) toast("Only owners/admins can edit company settings.");
    return false;
  }
  if (!state.company?.id) return false;

  setError("");

  // Only show button loading state for manual saves.
  if (!isAuto && saveCompanyBtn) {
    saveCompanyBtn.disabled = true;
    saveCompanyBtn.textContent = "Saving…";
  }

  try {
    const brandTyped = normalizeHexColor(companyBrandColorEl?.value);

    const updates = {
      name: sanitizeString(companyNameEl?.value) || state.company.name,
      phone: normalizeOptional(companyPhoneEl?.value),
      website: normalizeOptional(companyWebsiteEl?.value),
      address: normalizeOptional(companyAddressEl?.value),
      default_currency: sanitizeString(companyCurrencyEl?.value) || "CAD",
    };

    // Only update brand_color when it's valid (prevents clobbering while user types).
    if (brandTyped) updates.brand_color = brandTyped;

    const { data, error } = await supabase
      .from("companies")
      .update(updates)
      .eq("id", state.company.id)
      .select("*")
      .single();

    if (error) throw error;

    state.company = data;

    // Keep workspace label in sync if the company name changes.
    if (workspaceNameEl) workspaceNameEl.textContent = data?.name || "Workspace";

    if (!isAuto) toast("Company saved.");

    // Manual saves should reset the autosave baseline too.
    if (!isAuto) {
      try {
        autosave.company?.markClean();
      } catch {}
    }

    return true;
  } catch (e) {
    setError(e?.message || "Failed to save company.");
    return false;
  } finally {
    if (!isAuto && saveCompanyBtn) {
      saveCompanyBtn.disabled = false;
      saveCompanyBtn.textContent = "Save";
    }
  }
}

async function saveQuoteDefaults({ mode = "manual" } = {}) {
  const isAuto = mode === "auto";

  if (!state.isAdmin) {
    if (!isAuto) toast("Only owners/admins can edit quote defaults.");
    return false;
  }
  if (!state.company?.id) return false;

  setError("");

  let oldText = "";
  if (!isAuto && saveQuoteDefaultsBtn) {
    saveQuoteDefaultsBtn.disabled = true;
    oldText = saveQuoteDefaultsBtn.textContent;
    saveQuoteDefaultsBtn.textContent = "Saving…";
  }

  try {
    // Payment schedule: only persist when valid. While editing (invalid totals),
    // autosave will still persist terms/tax, but will *not* overwrite the saved schedule.
    let schedule = null;
    let scheduleOk = true;

    if (paymentScheduleBodyEl) {
      schedule = readPaymentScheduleFromUI();
      const v = validatePaymentSchedule(schedule);
      scheduleOk = v.ok;

      if (!scheduleOk && !isAuto) {
        setError(v.message || "Payment schedule must total 100%.");
        return false;
      }
    }

    const updates = {
      payment_terms: normalizeOptional(companyPaymentTermsEl?.value),
      tax_name: normalizeOptional(companyTaxNameEl?.value),
      tax_rate: normalizeNumber(companyTaxRateEl?.value, { min: 0, max: 100 }),
    };

    if (paymentScheduleBodyEl && scheduleOk) {
      updates.payment_schedule = schedule;
    }

    const { data, error } = await supabase
      .from("companies")
      .update(updates)
      .eq("id", state.company.id)
      .select("*")
      .single();

    if (error) throw error;

    state.company = data;

    if (!isAuto) toast("Quote defaults saved.");

    // Manual saves should reset the autosave baseline too.
    if (!isAuto) {
      try {
        autosave.quoteDefaults?.markClean();
      } catch {}
    }

    return true;
  } catch (e) {
    // If the column hasn't been added yet, Supabase will error here.
    setError(
      e?.message ||
        "Failed to save quote defaults. Make sure you added companies.payment_terms, companies.tax_name, companies.tax_rate, and companies.payment_schedule (jsonb) in Supabase."
    );
    return false;
  } finally {
    if (!isAuto && saveQuoteDefaultsBtn) {
      saveQuoteDefaultsBtn.textContent = oldText || "Save";
    }

    // Re-apply validation gating (admin + schedule must total 100%)
    if (paymentScheduleBodyEl) syncPaymentScheduleUI();
    else if (saveQuoteDefaultsBtn) saveQuoteDefaultsBtn.disabled = !state.isAdmin;
  }
}

async function saveBilling({ mode = "manual" } = {}) {
  const isAuto = mode === "auto";

  if (!state.isAdmin) {
    if (!isAuto) toast("Only owners/admins can edit billing settings.");
    return false;
  }
  if (!state.company?.id) return false;

  setError("");

  if (!isAuto && saveBillingBtn) {
    saveBillingBtn.disabled = true;
    saveBillingBtn.textContent = "Saving…";
  }

  try {
    const updates = {
      billing_email: normalizeOptional(billingEmailEl?.value),
    };

    const { data, error } = await supabase
      .from("companies")
      .update(updates)
      .eq("id", state.company.id)
      .select("*")
      .single();

    if (error) throw error;

    state.company = data;

    if (!isAuto) toast("Billing saved.");

    // Manual saves should reset the autosave baseline too.
    if (!isAuto) {
      try {
        autosave.billing?.markClean();
      } catch {}
    }

    return true;
  } catch (e) {
    setError(e?.message || "Failed to save billing settings.");
    return false;
  } finally {
    if (!isAuto && saveBillingBtn) {
      saveBillingBtn.disabled = false;
      saveBillingBtn.textContent = "Save";
    }
  }
}

async function saveProfile({ mode = "manual" } = {}) {
  const isAuto = mode === "auto";

  // For manual saves, keep the original UX (button loading state + toasts).
  if (!isAuto) {
    setProfileMsg("");
    setError("");

    if (saveProfileBtn) {
      saveProfileBtn.disabled = true;
      saveProfileBtn.textContent = "Saving…";
    }
  } else {
    // Auto-save: stay quiet (status text near Save button handles feedback).
    setError("");
  }

  try {
    const first_name = normalizeOptional(profileFirstEl?.value);
    const last_name = normalizeOptional(profileLastEl?.value);
    const phone = normalizeOptional(profilePhoneEl?.value);

    // Update profiles table if exists
    const { error: pe } = await supabase
      .from("profiles")
      .update({ first_name, last_name, phone, updated_at: new Date().toISOString() })
      .eq("id", state.session.user.id);

    if (pe) {
      console.warn("profiles update error", pe);
    }

    // Also keep auth metadata in sync (nice for future)
    const { error: ue } = await supabase.auth.updateUser({
      data: { first_name, last_name, phone },
    });

    if (ue) console.warn("updateUser metadata error", ue);

    if (!isAuto) {
      setProfileMsg("Saved.");
      toast("Profile saved.");

      // Manual saves should reset the autosave baseline too.
      try {
        autosave.profile?.markClean();
      } catch {}
    }

    return true;
  } catch (e) {
    if (!isAuto) setProfileMsg(e?.message || "Failed to save profile.");
    else setError(e?.message || "Failed to save profile.");
    return false;
  } finally {
    if (!isAuto && saveProfileBtn) {
      saveProfileBtn.disabled = false;
      saveProfileBtn.textContent = "Save";
    }
  }
}

async function sendResetEmail() {
  setProfileMsg("");
  setError("");

  try {
    const email = state.session?.user?.email;
    if (!email) throw new Error("No email found for this user.");

    // Your reset.html page lives at the app root (not /admin)
    const redirectTo = `${window.location.origin}/reset.html`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;

    setProfileMsg("Password reset email sent.");
    toast("Reset email sent.");
  } catch (e) {
    setProfileMsg(e?.message || "Failed to send reset email.");
  }
}

/* =========================================================
   Logo helpers (embed logo as data URL for 100% reliability)
   ========================================================= */

/**
 * Read a File as a data: URL (base64).
 */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    try {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => reject(new Error("Failed to read image file."));
      fr.readAsDataURL(file);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Resize an image data URL to a smaller PNG data URL.
 * This keeps the stored logo lightweight while still crisp.
 */
function resizeImageDataUrlToPng(dataUrl, { maxWidth = 520, maxHeight = 220 } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width || 1;
          const h = img.naturalHeight || img.height || 1;

          // Never upscale
          const scale = Math.min(1, maxWidth / w, maxHeight / h);
          const outW = Math.max(1, Math.round(w * scale));
          const outH = Math.max(1, Math.round(h * scale));

          const canvas = document.createElement("canvas");
          canvas.width = outW;
          canvas.height = outH;

          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas not supported.");

          ctx.clearRect(0, 0, outW, outH);
          ctx.drawImage(img, 0, 0, outW, outH);

          const out = canvas.toDataURL("image/png");
          resolve(out);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error("Could not load image for resizing."));
      img.src = String(dataUrl || "");
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Convert the uploaded logo file into an embedded PNG data URL.
 * This avoids Storage permission/CORS issues and guarantees the logo renders
 * on public customer quote pages and in PDFs.
 */
async function fileToEmbeddedLogoDataUrl(file) {
  const raw = await readFileAsDataUrl(file);
  try {
    // Keep it small and fast. Adjust if you want larger letterhead logos.
    return await resizeImageDataUrlToPng(raw, { maxWidth: 520, maxHeight: 220 });
  } catch {
    // If resizing fails for any reason, fall back to the original data URL.
    return raw;
  }
}

/* Logo upload flow */
function wireLogoPicker() {
  if (!pickLogoBtn || !logoFileEl) return;

  pickLogoBtn.addEventListener("click", () => {
    if (!state.isAdmin) {
      toast("Only owners/admins can upload a company logo.");
      return;
    }
    setLogoMsg("");
    logoFileEl.click();
  });

  logoFileEl.addEventListener("change", () => {
    setLogoMsg("");
    const file = logoFileEl.files?.[0];
    if (!file) return;

    if (file.type !== "image/png") {
      setLogoMsg("Please upload a PNG file.");
      logoFileEl.value = "";
      uploadLogoBtn.disabled = true;
      return;
    }

    // Preview
    const url = URL.createObjectURL(file);
    companyLogoImg.src = url;
    uploadLogoBtn.disabled = false;

    // Auto-upload so people don't forget to click "Upload"
    if (state.isAdmin) {
      // Let the preview paint first
      setTimeout(() => {
        if (logoFileEl.files?.[0]) uploadLogo();
      }, 80);
    }
  });

  uploadLogoBtn.addEventListener("click", uploadLogo);
}

async function uploadLogo() {
  if (!state.isAdmin) return;

  const file = logoFileEl.files?.[0];
  if (!file) return;

  setError("");
  setLogoMsg("");
  uploadLogoBtn.disabled = true;
  uploadLogoBtn.textContent = "Uploading…";

  try {
    const companyId = state.company.id;

    // 1) Create an embedded logo (data URL) that ALWAYS works on public pages/PDFs.
    const embeddedDataUrl = await fileToEmbeddedLogoDataUrl(file);

    // 2) Optional: also upload to Storage for backup/future use (non-blocking).
    //    The customer-facing app will rely on the embedded data URL, not Storage.
    try {
      const path = `${companyId}/logo.png`;
      const { error: upErr } = await supabase.storage
        .from("company-logos")
        .upload(path, file, { upsert: true, contentType: "image/png" });

      if (upErr) console.warn("Logo Storage upload error:", upErr);
    } catch (e) {
      console.warn("Logo Storage upload exception:", e);
    }

    // 3) Save the embedded data URL to the company record.
    const { data: c2, error: cErr } = await supabase
      .from("companies")
      .update({ logo_url: embeddedDataUrl })
      .eq("id", companyId)
      .select("*")
      .single();

    if (cErr) throw cErr;

    state.company = c2;
    companyLogoImg.src = embeddedDataUrl;

    setLogoMsg("Logo updated (stored as embedded image for reliable customer viewing).");
    toast("Logo updated.");
  } catch (e) {
    setError(e?.message || "Failed to upload logo.");
    uploadLogoBtn.disabled = false;
  } finally {
    uploadLogoBtn.textContent = "Upload";
    // Keep disabled unless user re-picks a new file
    logoFileEl.value = "";
  }
}

/* Invite flow */
function wireInvite() {
  if (!inviteBtn) return;

  inviteBtn.addEventListener("click", () => {
    if (!state.isAdmin) {
      toast("Only owners/admins can invite users.");
      return;
    }
    setInviteMsg("");
    inviteEmailEl.value = "";
    inviteRoleEl.value = "sales";
    openDialog(inviteDialog);
    inviteEmailEl.focus();
  });

  if (inviteCancelBtn) inviteCancelBtn.addEventListener("click", () => closeDialog(inviteDialog));

  if (inviteForm) {
    inviteForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      setInviteMsg("");
      setError("");

      if (!state.isAdmin) {
        setInviteMsg("Only owners/admins can invite users.");
        return;
      }

      const email = sanitizeString(inviteEmailEl.value).toLowerCase();
      const role = sanitizeString(inviteRoleEl.value);

      if (!email) {
        setInviteMsg("Email is required.");
        return;
      }

      inviteSubmitBtn.disabled = true;
      inviteSubmitBtn.textContent = "Sending…";

      try {
        const token = state.session?.access_token;
        if (!token) throw new Error("Missing session token.");

        const res = await fetch("/api/invite-user", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ email, role }),
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Invite failed.");

        closeDialog(inviteDialog);
        toast("Invite sent.");
        await loadTeam();
      } catch (err) {
        setInviteMsg(err?.message || "Invite failed.");
      } finally {
        inviteSubmitBtn.disabled = false;
        inviteSubmitBtn.textContent = "Send invite";
      }
    });
  }
}

async function init() {
  // Wire
  if (logoutBtn) logoutBtn.addEventListener("click", logout);

  if (saveCompanyBtn) saveCompanyBtn.addEventListener("click", saveCompany);
  if (saveQuoteDefaultsBtn) saveQuoteDefaultsBtn.addEventListener("click", saveQuoteDefaults);
  if (saveBillingBtn) saveBillingBtn.addEventListener("click", saveBilling);
  if (manageBillingBtn) manageBillingBtn.addEventListener("click", () => toast("Billing is coming next."));

  if (saveProfileBtn) saveProfileBtn.addEventListener("click", saveProfile);
  if (sendResetBtn) sendResetBtn.addEventListener("click", sendResetEmail);

  // Brand color sync (hex <-> picker)
  if (companyBrandColorEl) {
    companyBrandColorEl.addEventListener("input", () => {
      const hex = normalizeHexColor(companyBrandColorEl.value);
      if (hex && companyBrandColorPickerEl) companyBrandColorPickerEl.value = hex;
    });
    companyBrandColorEl.addEventListener("blur", () => {
      // Snap to a clean, valid hex on blur
      syncBrandColorInputs(companyBrandColorEl.value);
    });
  }
  if (companyBrandColorPickerEl) {
    companyBrandColorPickerEl.addEventListener("input", () => {
      if (companyBrandColorEl) companyBrandColorEl.value = companyBrandColorPickerEl.value.toUpperCase();
    });
  }

  wireLogoPicker();
  wirePaymentSchedule();
  wireInvite();

  // Session
  const session = await requireSessionOrRedirect();
  if (!session) return;
  state.session = session;

  if (userEmailEl) userEmailEl.textContent = session.user.email || "";

  try {
    const membership = await loadMembership(session.user.id);
    state.membership = membership;
    state.isAdmin = isAdminRole(membership.role);

    const company = await loadCompany(membership.company_id);
    state.company = company;

    if (workspaceNameEl) workspaceNameEl.textContent = company?.name || "Workspace";

    const profile = await loadProfile(session.user.id);
    state.profile = profile;

    fillCompanyForm(company);
    fillProfile(session, profile);

    // Team list + billing seats
    applyPermissions();
    await loadTeam();

    // Seats derived from rows in team table (members count)
    const seatCount = membersBody?.children?.length || 0;
    fillBilling(company, seatCount);

    // Turn on auto-save (so users don't lose changes)
    setupAutoSave();
  } catch (e) {
    setError(e?.message || "Failed to load settings.");
    applyPermissions();
    setTeamEmpty(true);
    setTeamLoading(false);
  }
}

init();

/* =========================================================
   Settings page mobile menu
   Append this to the bottom of your current settings.js
   Preserves existing logic and only adds a mobile drawer.
   ========================================================= */
(function initSettingsMobileMenu(){
  if (typeof document === 'undefined') return;
  if (document.getElementById('mobile-menu-panel')) return;

  const body = document.body;
  const topbarLeft = document.querySelector('.topbar-left');
  if (!body || !topbarLeft) return;

  const workspaceNameNode = document.getElementById('workspace-name');
  const userEmailNode = document.getElementById('user-email');
  const logoutDesktop = document.getElementById('logout-btn');

  function isMobileViewport() {
    return window.matchMedia('(max-width: 1040px)').matches;
  }

  function syncMobileMenuMeta() {
    const mobileWorkspaceName = document.getElementById('mobile-workspace-name');
    const mobileUserEmail = document.getElementById('mobile-user-email');
    if (mobileWorkspaceName) mobileWorkspaceName.textContent = workspaceNameNode?.textContent?.trim() || 'Workspace';
    if (mobileUserEmail) mobileUserEmail.textContent = userEmailNode?.textContent?.trim() || '—';
  }

  function closeMobileMenu() {
    body.classList.remove('mobile-menu-open');
    const btn = document.getElementById('mobile-menu-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function openMobileMenu() {
    if (!isMobileViewport()) return;
    syncMobileMenuMeta();
    body.classList.add('mobile-menu-open');
    const btn = document.getElementById('mobile-menu-btn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }

  const menuBtn = document.createElement('button');
  menuBtn.id = 'mobile-menu-btn';
  menuBtn.className = 'mobile-menu-btn';
  menuBtn.type = 'button';
  menuBtn.setAttribute('aria-label', 'Open menu');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.setAttribute('aria-controls', 'mobile-menu-panel');
  menuBtn.innerHTML = '<span></span><span></span><span></span>';
  topbarLeft.insertBefore(menuBtn, topbarLeft.firstChild || null);

  const backdrop = document.createElement('button');
  backdrop.id = 'mobile-menu-backdrop';
  backdrop.className = 'mobile-menu-backdrop';
  backdrop.type = 'button';
  backdrop.setAttribute('aria-label', 'Close menu');

  const panel = document.createElement('aside');
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
        <a class="nav-item" href="./products.html" data-mobile-close>
          <span class="nav-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M20 7 12 3 4 7v10l8 4 8-4V7Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 7v14" stroke="currentColor" stroke-width="2" opacity=".55"/><path d="M4 7l8 4 8-4" stroke="currentColor" stroke-width="2" opacity=".55"/></svg>
          </span>
          <span>Products</span>
        </a>
      </div>

      <div class="nav-group">
        <div class="nav-group-label">Admin</div>
        <a class="nav-item active" href="./settings.html" aria-current="page" data-mobile-close>
          <span class="nav-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a7.7 7.7 0 0 0 .1-1 7.7 7.7 0 0 0-.1-1l2-1.5-2-3.5-2.4.6a7.8 7.8 0 0 0-1.7-1L13.8 3h-3.6L8.7 6.6a7.8 7.8 0 0 0-1.7 1L4.6 7l-2 3.5 2 1.5a7.7 7.7 0 0 0-.1 1 7.7 7.7 0 0 0 .1 1l-2 1.5 2 3.5 2.4-.6a7.8 7.8 0 0 0 1.7 1L10.2 21h3.6l1.5-3.6a7.8 7.8 0 0 0 1.7-1l2.4.6 2-3.5-2-1.5Z" stroke="currentColor" stroke-width="2" opacity=".55" stroke-linejoin="round"/></svg>
          </span>
          <span>Settings</span>
        </a>
      </div>
    </nav>

    <div class="mobile-menu-actions">
      <button id="mobile-logout-btn" class="btn btn-quiet" type="button">Log out</button>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);

  menuBtn.addEventListener('click', () => {
    if (body.classList.contains('mobile-menu-open')) closeMobileMenu();
    else openMobileMenu();
  });
  backdrop.addEventListener('click', closeMobileMenu);
  panel.querySelector('#mobile-menu-close')?.addEventListener('click', closeMobileMenu);
  panel.querySelectorAll('[data-mobile-close]').forEach((el) => {
    el.addEventListener('click', () => {
      if (isMobileViewport()) closeMobileMenu();
    });
  });
  panel.querySelector('#mobile-logout-btn')?.addEventListener('click', () => {
    closeMobileMenu();
    logoutDesktop?.click();
  });

  if (workspaceNameNode || userEmailNode) {
    const metaObserver = new MutationObserver(() => syncMobileMenuMeta());
    if (workspaceNameNode) metaObserver.observe(workspaceNameNode, { childList:true, subtree:true, characterData:true });
    if (userEmailNode) metaObserver.observe(userEmailNode, { childList:true, subtree:true, characterData:true });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMobileMenu();
  });

  window.addEventListener('resize', () => {
    if (!isMobileViewport()) closeMobileMenu();
  });

  syncMobileMenuMeta();
})();
