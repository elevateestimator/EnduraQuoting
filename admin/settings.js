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
  if (saveQuoteDefaultsBtn) saveQuoteDefaultsBtn.disabled = !isAdmin;
  if (quoteDefaultsPermsNote) quoteDefaultsPermsNote.hidden = isAdmin;

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

async function saveCompany() {
  if (!state.isAdmin) {
    toast("Only owners/admins can edit company settings.");
    return;
  }

  setError("");
  saveCompanyBtn.disabled = true;
  saveCompanyBtn.textContent = "Saving…";

  try {
    const brand = normalizeHexColor(companyBrandColorEl?.value) || "#000000";

    const updates = {
      name: sanitizeString(companyNameEl.value) || state.company.name,
      phone: normalizeOptional(companyPhoneEl.value),
      website: normalizeOptional(companyWebsiteEl.value),
      address: normalizeOptional(companyAddressEl.value),
      default_currency: sanitizeString(companyCurrencyEl.value) || "CAD",
      brand_color: brand,
    };

    const { data, error } = await supabase
      .from("companies")
      .update(updates)
      .eq("id", state.company.id)
      .select("*")
      .single();

    if (error) throw error;

    state.company = data;
    fillCompanyForm(data);
    toast("Company saved.");
  } catch (e) {
    setError(e?.message || "Failed to save company.");
  } finally {
    saveCompanyBtn.disabled = false;
    saveCompanyBtn.textContent = "Save";
  }
}

async function saveQuoteDefaults() {
  if (!state.isAdmin) {
    toast("Only owners/admins can edit quote defaults.");
    return;
  }

  setError("");
  if (!saveQuoteDefaultsBtn) return;

  saveQuoteDefaultsBtn.disabled = true;
  const oldText = saveQuoteDefaultsBtn.textContent;
  saveQuoteDefaultsBtn.textContent = "Saving…";

  try {
    const updates = {
      payment_terms: normalizeOptional(companyPaymentTermsEl?.value),
      tax_name: normalizeOptional(companyTaxNameEl?.value),
      tax_rate: normalizeNumber(companyTaxRateEl?.value, { min: 0, max: 100 }),
    };

    const { data, error } = await supabase
      .from("companies")
      .update(updates)
      .eq("id", state.company.id)
      .select("*")
      .single();

    if (error) throw error;

    state.company = data;
    if (companyPaymentTermsEl) companyPaymentTermsEl.value = data?.payment_terms || "";
    if (companyTaxNameEl) companyTaxNameEl.value = data?.tax_name || "Tax";
    if (companyTaxRateEl) companyTaxRateEl.value = data?.tax_rate ?? "";
    toast("Quote defaults saved.");
  } catch (e) {
    // If the column hasn't been added yet, Supabase will error here.
    setError(
      e?.message ||
        "Failed to save quote defaults. Make sure you added companies.payment_terms, companies.tax_name, and companies.tax_rate in Supabase."
    );
  } finally {
    saveQuoteDefaultsBtn.disabled = !state.isAdmin;
    saveQuoteDefaultsBtn.textContent = oldText || "Save";
  }
}


async function saveBilling() {
  if (!state.isAdmin) {
    toast("Only owners/admins can edit billing settings.");
    return;
  }

  setError("");
  saveBillingBtn.disabled = true;
  saveBillingBtn.textContent = "Saving…";

  try {
    const updates = {
      billing_email: normalizeOptional(billingEmailEl.value),
    };

    const { data, error } = await supabase
      .from("companies")
      .update(updates)
      .eq("id", state.company.id)
      .select("*")
      .single();

    if (error) throw error;

    state.company = data;
    toast("Billing saved.");
  } catch (e) {
    setError(e?.message || "Failed to save billing settings.");
  } finally {
    saveBillingBtn.disabled = false;
    saveBillingBtn.textContent = "Save";
  }
}

async function saveProfile() {
  setProfileMsg("");
  setError("");

  saveProfileBtn.disabled = true;
  saveProfileBtn.textContent = "Saving…";

  try {
    const first_name = normalizeOptional(profileFirstEl.value);
    const last_name = normalizeOptional(profileLastEl.value);
    const phone = normalizeOptional(profilePhoneEl.value);

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

    setProfileMsg("Saved.");
    toast("Profile saved.");
  } catch (e) {
    setProfileMsg(e?.message || "Failed to save profile.");
  } finally {
    saveProfileBtn.disabled = false;
    saveProfileBtn.textContent = "Save";
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
    const path = `${companyId}/logo.png`;

    const { error: upErr } = await supabase.storage
      .from("company-logos")
      .upload(path, file, { upsert: true, contentType: "image/png" });

    if (upErr) throw upErr;

    const { data } = supabase.storage.from("company-logos").getPublicUrl(path);
    const publicUrl = data?.publicUrl ? `${data.publicUrl}?v=${Date.now()}` : null;

    if (!publicUrl) throw new Error("Failed to generate logo URL.");

    const { data: c2, error: cErr } = await supabase
      .from("companies")
      .update({ logo_url: publicUrl })
      .eq("id", companyId)
      .select("*")
      .single();

    if (cErr) throw cErr;

    state.company = c2;
    companyLogoImg.src = publicUrl;

    setLogoMsg("Logo uploaded.");
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
  } catch (e) {
    setError(e?.message || "Failed to load settings.");
    applyPermissions();
    setTeamEmpty(true);
    setTeamLoading(false);
  }
}

init();
