const { createClient } = require("@supabase/supabase-js");

/**
 * POST /api/invite-user
 * Body: { email: string, role: 'sales' | 'admin' }
 *
 * Security:
 * - Caller must be authenticated (Authorization: Bearer <access_token>)
 * - Caller must be owner/admin in a company (company_members)
 * - Invite is sent via Supabase Auth Admin API (requires SERVICE ROLE key)
 * - Membership row is created for the invited user (company_members)
 *
 * Vercel env vars required:
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY
 * - SUPABASE_SERVICE_ROLE_KEY
 */

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: "Missing Supabase env vars." });
    }

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing bearer token." });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const email = String(body?.email || "").trim().toLowerCase();
    const role = String(body?.role || "sales").trim().toLowerCase();

    if (!email) return res.status(400).json({ error: "Email is required." });
    if (!["sales", "admin"].includes(role)) return res.status(400).json({ error: "Invalid role." });

    // User-scoped client (RLS enforced) to verify the caller and determine their company.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: "Invalid session." });
    }

    const caller = userData.user;

    const { data: membership, error: memErr } = await userClient
      .from("company_members")
      .select("company_id, role")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (memErr) return res.status(400).json({ error: memErr.message });
    if (!membership) return res.status(403).json({ error: "No company membership found." });

    const callerRole = String(membership.role || "").toLowerCase();
    if (!["owner", "admin"].includes(callerRole)) {
      return res.status(403).json({ error: "Only owners/admins can invite users." });
    }

    const companyId = membership.company_id;

    // Service role client (bypasses RLS) for admin actions.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Invite user by email (sends email from Supabase).
    const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { invited_by: caller.id, company_id: companyId },
    });

    if (inviteErr) return res.status(400).json({ error: inviteErr.message });

    const invitedUser = inviteData?.user;
    if (!invitedUser?.id) {
      return res.status(500).json({ error: "Invite succeeded but no user id returned." });
    }

    // Ensure the invited user is attached to the company.
    const { error: insErr } = await admin
      .from("company_members")
      .upsert(
        { company_id: companyId, user_id: invitedUser.id, role },
        { onConflict: "company_id,user_id" }
      );

    if (insErr) return res.status(400).json({ error: insErr.message });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
};
