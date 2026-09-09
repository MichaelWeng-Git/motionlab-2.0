// Browser-side Supabase client — passwordless email auth.
// Supabase can deliver EITHER a magic link or a 6-digit code depending on the
// project's email template, so the app must handle both. That means the client
// needs session detection in the URL turned on explicitly and a persisted
// session, and callers must listen for the session appearing (it lands
// asynchronously after the link is opened).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function sbBrowser(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!client) {
    client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true, // magic-link hash tokens are consumed on load
        flowType: "pkce",
      },
    });
  }
  return client;
}

// does this URL carry an auth callback we must not navigate away from?
export function hasAuthCallback(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hash ?? "";
  const q = window.location.search ?? "";
  return (
    h.includes("access_token") ||
    h.includes("error_description") ||
    /[?&]code=/.test(q) ||
    /[?&]token_hash=/.test(q)
  );
}

// finish whichever callback style arrived; returns true if a session now exists
export async function completeAuthCallback(): Promise<boolean> {
  const sb = sbBrowser();
  if (!sb) return false;
  try {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const tokenHash = url.searchParams.get("token_hash");
    const type = url.searchParams.get("type");
    if (code) {
      await sb.auth.exchangeCodeForSession(code); // PKCE link
    } else if (tokenHash) {
      // verify-style link (works even in a browser that never asked for it)
      await sb.auth.verifyOtp({
        token_hash: tokenHash,
        type: (type as "email" | "magiclink" | "signup" | "recovery") ?? "email",
      });
    }
    const { data } = await sb.auth.getSession();
    return !!data.session;
  } catch {
    return false;
  }
}

export async function sbAccessToken(): Promise<string | null> {
  try {
    const c = sbBrowser();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
