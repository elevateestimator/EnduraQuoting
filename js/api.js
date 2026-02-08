import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Fill these in from:
 * Supabase Dashboard -> Project Settings -> API
 */
export const SUPABASE_URL = "https://iahowsrpngjbvwvczcsz.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhaG93c3JwbmdqYnZ3dmN6Y3N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1NjMxNzYsImV4cCI6MjA4NjEzOTE3Nn0.NYO3DYhwpGaQSm1I_wDOxy1JzyG2OWNGdN4QBxvfZMc";

/**
 * Admin allow-list (client-side guard).
 * This is NOT your only security layer — you’ll still lock signups + use RLS later.
 */
export const ADMIN_EMAILS = [
  "you@yourcompany.com",
  // "second-admin@yourcompany.com",
];

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export function isAdminEmail(email) {
  if (!email) return false;
  const normalized = String(email).trim().toLowerCase();
  return ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(normalized);
}