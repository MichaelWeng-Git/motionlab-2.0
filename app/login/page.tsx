"use client";

// ONE welcome page, no signup/login split. The system tells new from
// returning users by itself:
//  - Email → 6-digit code (Supabase passwordless). Unknown email = account
//    created on the spot; known email = straight back into the account.
//  - Google → same idea via OAuth (profile auto-created on first sign-in).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { completeAuthCallback, hasAuthCallback, sbBrowser } from "@/lib/supabase-client";
import { bootstrapAccountData } from "@/lib/cloud-data";
import { restoreSessionsFromBackup } from "@/lib/stats";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // true while we silently check for an existing session — the form only
  // appears once we KNOW there isn't one, so returning from Google (or an
  // email magic link) never flashes the login form before moving on
  const [checking, setChecking] = useState(true);

  async function afterLogin(kind: "google" | "email") {
    localStorage.setItem("ml_auth", kind);
    setChecking(true);
    const cloud = await bootstrapAccountData();
    if (!cloud.ok) {
      localStorage.removeItem("ml_auth");
      setError(cloud.error === "sync-not-configured"
        ? "Account sync is not configured on the server yet."
        : "Couldn’t load your account data. Your existing records were not changed. Try again.");
      setChecking(false);
      return;
    }

    // The server-side email record is the authority for new vs returning.
    // Local storage can belong to a different browser/account and must never
    // decide identity.
    const has = (k: string) => {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) return false;
        const v = JSON.parse(raw);
        return Array.isArray(v) ? v.length > 0 : !!v;
      } catch { return false; }
    };
    let hasProfile = false;
    try { hasProfile = !!JSON.parse(localStorage.getItem("ml_profile") ?? "{}").name; } catch {}
    const returning = !cloud.isNew;

    if (returning) {
      localStorage.setItem("ml_onboarded", "1");
      // primary list wiped but the mirror survived → restore it now
      if (!has("ml_sessions") && has("ml_sessions_backup")) restoreSessionsFromBackup();
      // returning user → the black "Welcome back" veil plays once on Home
      try { sessionStorage.setItem("ml_welcome_back", "1"); } catch {}
      // An existing email whose onboarding never finished resumes onboarding;
      // otherwise all cloud-restored data is already in place before Home mounts.
      router.replace(hasProfile ? "/" : "/onboarding");
    } else {
      // genuinely first time on this device: reset only the GAMIFICATION
      // counters so streaks/coins start at zero. Analyses, activities and
      // goals are never touched — losing them can't be undone.
      [
        "ml_login", "ml_daily_claim", "ml_coins_bonus", "ml_coins_spent",
        "ml_ornaments", "ml_streak", "ml_seen_analyze",
      ].forEach((k) => localStorage.removeItem(k));
      router.replace("/onboarding");
    }
  }

  // Returning from Google (NextAuth session) or from an email magic link
  // (Supabase session in the URL): pick either up and continue straight into
  // the app. The form stays hidden until BOTH checks come back empty.
  useEffect(() => {
    let done = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const go = (kind: "google" | "email") => {
      if (done) return;
      done = true;
      afterLogin(kind);
    };

    const check = async () => {
      // Callback handling is deliberately first and sequential. Never call
      // getSession concurrently with a code exchange on the same auth client.
      if (hasAuthCallback()) {
        const ok = await Promise.race([
          completeAuthCallback(),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000)),
        ]);
        try { window.history.replaceState(null, "", "/login"); } catch {}
        if (ok) { go("email"); return; }
        if (!done) {
          done = true;
          setError("This sign-in link could not be completed. Request a new link and open the newest email.");
          setChecking(false);
        }
        return;
      }

      try {
        const { data } = (await sbBrowser()?.auth.getSession()) ?? { data: { session: null } };
        if (data.session) { go("email"); return; }
      } catch {}

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        const response = await fetch("/api/auth/session", { signal: controller.signal });
        clearTimeout(timeout);
        const session = response.ok ? await response.json() : null;
        if (session?.user) {
          if (session.user.name) localStorage.setItem("ml_google_name", session.user.name);
          go("google"); return;
        }
      } catch {}
      if (!done) {
        // The silent session check is finished. Without closing this state,
        // its watchdog survives into the code-entry screen and shows a false
        // "sign-in is taking too long" error twelve seconds later.
        done = true;
        setChecking(false);
      }
    };

    check();
    // Absolute escape hatch: network/auth SDK failure must become an actionable
    // login screen, never an infinite logo.
    watchdog = setTimeout(() => { if (!done) { setError("Sign-in is taking too long. Please request a new link."); setChecking(false); } }, 12_000);
    return () => { if (watchdog) clearTimeout(watchdog); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    const sb = sbBrowser();
    if (!sb) {
      setError("Email sign-in isn't available right now.");
      return;
    }
    setBusy(true);
    setError("");
    // shouldCreateUser: unknown email = new account, known email = same account
    const { error: err } = await sb.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        // the link must return to THIS app (otherwise it lands on the
        // project's Site URL and the session is never picked up)
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    setBusy(false);
    if (err) {
      setError(err.message.includes("rate") ? "Too many attempts — try again in a minute." : err.message);
      return;
    }
    setCode("");
    setPhase("code");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    const token = code.trim();
    if (!token) {
      setError("Enter the code from the email — or just tap the link in it.");
      return;
    }
    const sb = sbBrowser()!;
    setBusy(true);
    setError("");
    const { data, error: err } = await sb.auth.verifyOtp({ email, token, type: "email" });
    setBusy(false);
    if (err || !data.session) {
      setError("That code didn't work — check it and try again.");
      return;
    }
    afterLogin("email");
  }

  // session check in flight (or a redirect already underway): just the logo,
  // no form — so OAuth/magic-link returns never flash the login card
  if (checking) {
    return (
      <div className="relative flex flex-1 items-center justify-center px-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.png" alt="MotionLab" className="h-8 w-auto animate-pulse" />
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-6">
      {/* atmospheric depth: cool low-alpha washes (violet data-light + sage), one per corner */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -right-16 top-14 h-48 w-48 rounded-full bg-[#7C5CFF]/[0.10] blur-2xl" />
        <div className="absolute -right-6 top-24 h-24 w-24 rounded-full bg-[#7C5CFF]/[0.14] blur-xl" />
        <div className="absolute -left-20 bottom-40 h-56 w-56 rounded-full bg-white/50 blur-xl" />
        <div className="absolute -bottom-24 left-1/2 h-64 w-[560px] -translate-x-1/2 rounded-[50%] bg-[#DFE9E2]/80" />
      </div>

      <div className="relative w-full max-w-[340px] pb-8">
        {/* logo + WELCOME glide in from the right */}
        <div className="flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-mark.png"
            alt="MotionLab"
            className="login-in-r h-10 w-auto"
            style={{ animationDelay: "0.85s" }}
          />
          <h1 className="login-in-r mt-5 font-golden text-[28px] leading-none text-ink drop-shadow-sm" style={{ animationDelay: "0.6s" }}>
            WELCOME
          </h1>
        </div>

        {/* THE BIG BUBBLE rises fast from below; its pieces then slide in and
            click together — layered shadows give it real depth */}
        <div className="login-card mt-7 rounded-3xl bg-white p-6 shadow-[0_10px_24px_-12px_rgba(14,31,26,0.18),0_30px_70px_-24px_rgba(14,31,26,0.35)]">
          {phase === "email" ? (
            <>
              <form onSubmit={sendCode} className="space-y-3">
                <div className="login-in-l" style={{ animationDelay: "1.1s" }}>
                  <input
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(""); }}
                    className="w-full rounded-2xl bg-paper px-4 py-3.5 text-[15px] font-medium shadow-[inset_0_2px_6px_rgba(14,31,26,0.06)] outline-none placeholder:text-ink-muted focus:border-ink"
                  />
                </div>

                {error && <p className="text-center text-sm font-semibold text-signal-work">{error}</p>}

                <button
                  type="submit"
                  disabled={busy}
                  className="login-in-r btn-press w-full rounded-full bg-action py-3.5 text-[15px] font-bold text-on-action transition disabled:opacity-60"
                  style={{ animationDelay: "1.4s" }}
                >
                  {busy ? "Sending link…" : "Continue"}
                </button>
              </form>

              {/* divider */}
              <div className="login-in-l mt-5 flex items-center gap-3" style={{ animationDelay: "1.7s" }}>
                <span className="h-px flex-1 bg-black/10" />
                <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">or</span>
                <span className="h-px flex-1 bg-black/10" />
              </div>

              <button
                onClick={() => signIn("google", { callbackUrl: "/login" })}
                className="login-in-l mt-5 flex w-full items-center justify-center gap-2.5 rounded-full bg-white py-3.5 text-sm font-bold text-ink shadow-[0_3px_14px_-4px_rgba(14,31,26,0.22)] transition active:scale-[0.98]"
                style={{ animationDelay: "1.9s" }}
              >
                <GoogleMark />
                Continue with Google
              </button>
            </>
          ) : (
            <form onSubmit={verifyCode} className="space-y-3">
              <p className="text-center text-sm font-semibold text-ink-soft">Check your inbox</p>
              <p className="text-center font-bold text-ink">{email}</p>
              <input
                autoFocus
                inputMode="numeric"
                placeholder="······"
                value={code}
                onChange={(e) => { setCode(e.target.value.trim()); setError(""); }}
                className="w-full rounded-2xl bg-paper px-4 py-3.5 text-center text-xl font-extrabold tracking-[0.35em] outline-none placeholder:text-ink-muted focus:border-ink"
              />

              {error && <p className="text-center text-sm font-semibold text-signal-work">{error}</p>}

              <button
                type="submit"
                disabled={busy}
                className="btn-press w-full rounded-full bg-action py-3.5 text-[15px] font-bold text-on-action transition disabled:opacity-60"
              >
                {busy ? "Checking…" : "Verify"}
              </button>

              <div className="flex items-center justify-center gap-4 pt-1">
                <button
                  type="button"
                  onClick={() => { setPhase("email"); setError(""); }}
                  className="text-xs font-semibold text-ink-muted underline-offset-2 hover:underline"
                >
                  Change email
                </button>
                <button
                  type="button"
                  onClick={(e) => sendCode(e as unknown as React.FormEvent)}
                  className="text-xs font-semibold text-ink-muted underline-offset-2 hover:underline"
                >
                  Resend link
                </button>
              </div>
            </form>
          )}

          {/* Readable before signing in, not after. Someone is about to hand this
              app a video of themselves — the page that says what happens to it
              has to be reachable from here. */}
          <p className="mt-6 text-center text-[11px] font-semibold text-ink-muted">
            Your video is analysed on your device.{" "}
            <Link href="/privacy" className="font-bold underline underline-offset-2">
              What we do with your data
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
    </svg>
  );
}
