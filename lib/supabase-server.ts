// Server-side Supabase client. All friends data flows through our own API
// routes (never directly from the browser), so identity always comes from the
// Google session first.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let admin: SupabaseClient | null = null;

export function sb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!client) client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

// Private server-only client for per-account training data. Never fall back to
// the public anon key: account_data deliberately has no public RLS policies.
export function sbAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!admin) admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
