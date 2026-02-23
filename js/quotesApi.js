// js/quotesApi.js
// Tenant-safe Quotes API + automatic first-run company setup
//
// Why this file exists:
// - In SaaS mode, every row MUST belong to a company_id.
// - New Supabase Auth users do NOT automatically get a company_members row.
// - Without a membership row, inserts into quotes will fail with RLS errors.
//
// What this file does:
// - Reads the logged-in user's company_members row.
// - If missing, it will:
//   1) Reuse an existing company owned by the user (if any), otherwise
//   2) Create a new company using user_metadata.company_name (set during signup), then
//   3) Insert the owner membership row.
//
// This makes "sign up → confirm → sign in → dashboard" work with no manual SQL steps.

import { supabase } from "./api.js";

async function getSessionOrThrow() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const session = data?.session;
  if (!session) throw new Error("Not signed in.");
  return session;
}

function deriveCompanyNameFromEmail(email) {
  const e = String(email || "").trim();
  const domain = e.split("@")[1] || "";
  if (!domain) return "My Company";
  const base = domain.replace(/^www\./i, "").split(".")[0] || "My Company";
  // Title case-ish
  return base
    .replace(/[-_]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function getMembershipOrBootstrap() {
  const session = await getSessionOrThrow();
  const user = session.user;
  const userId = user.id;

  // 1) Try current membership
  const { data: membership, error: memErr } = await supabase
    .from("company_members")
    .select("company_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (memErr) throw memErr;
  if (membership?.company_id) {
    return { session, userId, companyId: membership.company_id, role: membership.role };
  }

  // 2) No membership found — bootstrap.
  // First try to reuse a company the user already owns (if they created one manually).
  let companyId = null;

  const { data: ownedCompany, error: ownedErr } = await supabase
    .from("companies")
    .select("id")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true })
    .maybeSingle();

  if (ownedErr) throw ownedErr;
  if (ownedCompany?.id) companyId = ownedCompany.id;

  // If no owned company exists, create one using signup metadata.
  if (!companyId) {
    const meta = user.user_metadata || {};
    const companyName =
      String(meta.company_name || meta.company || "").trim() ||
      deriveCompanyNameFromEmail(user.email);

    const { data: createdCompany, error: createCompanyErr } = await supabase
      .from("companies")
      .insert({ name: companyName, owner_user_id: userId })
      .select("id")
      .single();

    if (createCompanyErr) {
      // Give a helpful message if policies aren't installed correctly.
      const msg =
        createCompanyErr?.message ||
        "Failed to create company for this account.";
      throw new Error(
        msg +
          "\n\nFix: In Supabase, ensure RLS policies allow authenticated users to insert into companies where owner_user_id = auth.uid()."
      );
    }
    companyId = createdCompany.id;
  }

  // 3) Insert membership row as owner (idempotent-ish)
  const { error: insertMemberErr } = await supabase
    .from("company_members")
    .insert({ company_id: companyId, user_id: userId, role: "owner" });

  // Ignore duplicate-key errors if the row was created in parallel
  if (insertMemberErr && insertMemberErr.code !== "23505") {
    const msg =
      insertMemberErr?.message ||
      "Failed to create company membership for this account.";
    throw new Error(
      msg +
        "\n\nFix: In Supabase, ensure RLS policies allow an owner to insert their own membership row into company_members (role = owner)."
    );
  }

  // 4) Re-fetch membership
  const { data: membership2, error: memErr2 } = await supabase
    .from("company_members")
    .select("company_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (memErr2) throw memErr2;
  if (!membership2?.company_id) {
    throw new Error(
      "Company setup did not complete. Your account is signed in, but no company membership exists." +
        "\n\nFix: Check your company_members RLS policies, then retry."
    );
  }

  return { session, userId, companyId: membership2.company_id, role: membership2.role };
}

export async function listQuotes({ limit = 200 } = {}) {
  const { companyId } = await getMembershipOrBootstrap();

  const { data, error } = await supabase
    .from("quotes")
    .select(
      "id, quote_no, customer_name, customer_email, total_cents, currency, status, created_at"
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function createQuote(payload) {
  const { userId, companyId } = await getMembershipOrBootstrap();

  const insertRow = {
    ...payload,
    company_id: companyId,
    created_by: userId,
    status: payload?.status ?? "Draft",
  };

  const { data, error } = await supabase
    .from("quotes")
    .insert(insertRow)
    .select(
      "id, quote_no, customer_name, customer_email, total_cents, currency, status, created_at, data"
    )
    .single();

  if (error) throw error;
  return data;
}

export async function cancelQuote(quoteId) {
  if (!quoteId) throw new Error("Missing quote id.");

  const { data, error } = await supabase
    .from("quotes")
    .update({ status: "Cancelled" })
    .eq("id", quoteId)
    .select("id, status")
    .single();

  if (error) throw error;
  return data;
}

export async function duplicateQuoteById(sourceQuoteId) {
  if (!sourceQuoteId) throw new Error("Missing source quote id.");

  const { userId, companyId } = await getMembershipOrBootstrap();

  const { data: src, error: srcErr } = await supabase
    .from("quotes")
    .select("customer_name, customer_email, total_cents, currency, data")
    .eq("id", sourceQuoteId)
    .single();

  if (srcErr) throw srcErr;

  const clonedData = structuredClone(src.data || {});
  if (clonedData.acceptance) delete clonedData.acceptance;

  const insertRow = {
    customer_name: src.customer_name,
    customer_email: src.customer_email,
    total_cents: src.total_cents ?? 0,
    currency: src.currency ?? "CAD",
    data: clonedData,
    status: "Draft",
    company_id: companyId,
    created_by: userId,
  };

  const { data: created, error: createErr } = await supabase
    .from("quotes")
    .insert(insertRow)
    .select("id, quote_no")
    .single();

  if (createErr) throw createErr;
  return created;
}
