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
        // We consume every callback explicitly in completeAuthCallback().
        // Running Supabase's automatic parser beside exchangeCodeForSession()
        // races for the same auth lock and can leave /login spinning forever.
        detectSessionInUrl: false,
        // Email is frequently requested inside the installed PWA and opened by
        // Safari/Chrome. PKCE stores its verifier in the requesting browser,
        // so that perfectly normal cross-context journey cannot complete.
        // A magic-link hash token is self-contained and still single-use.
        flowType: "implicit",
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
let callbackInFlight: Promise<boolean> | null = null;

export async function completeAuthCallback(): Promise<boolean> {
  // React Strict Mode mounts effects twice in development. A magic-link code
  // is single-use, so both mounts must share one exchange instead of racing.
  if (callbackInFlight) return callbackInFlight;
  callbackInFlight = completeAuthCallbackOnce();
  return callbackInFlight;
}

async function completeAuthCallbackOnce(): Promise<boolean> {
  const sb = sbBrowser();
  if (!sb) return false;
  try {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    if (url.searchParams.get("error_description") || hash.get("error_description")) return false;
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
    } else if (hash.get("access_token") && hash.get("refresh_token")) {
      const { error } = await sb.auth.setSession({
        access_token: hash.get("access_token")!,
        refresh_token: hash.get("refresh_token")!,
      });
      if (error) return false;
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
