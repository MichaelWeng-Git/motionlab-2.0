"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { CoachMark } from "@/components/CoachMark";
import { hasAuthCallback } from "@/lib/supabase-client";
import { CloudSync } from "@/components/CloudSync";
import { isLocalDevAuthBypass } from "@/lib/dev-auth";
import { bootstrapAccountData } from "@/lib/cloud-data";

// Only true authentication/onboarding routes live outside the product shell.
// The assistant is a normal signed-in destination: excluding it here used to
// remove both pieces of chrome and reveal the old white document canvas.
const AUTH_PATHS = ["/login", "/onboarding"];
// Readable WITHOUT an account. A privacy policy you must sign in to read is no
// use to the person deciding whether to sign in — /login links here, so the gate
// must let it through. It keeps the dark shell; it just has no chrome.
const PUBLIC_PATHS = ["/privacy"];

// Has the gate finished deciding? Until it has, the app must render NOTHING of
// its own — not the home page, not the login form. Both directions used to be
// wrong: a logged-out visitor watched an empty Home paint and then snap to
// /login, and the redirect itself was a second frame of the wrong screen.
type AuthState = "unknown" | "in" | "out";

/** The athlete's name from local storage, or "" — the one signal that says
 *  onboarding has actually been completed for this profile. */
function localProfileName(): string {
  try { return JSON.parse(localStorage.getItem("ml_profile") ?? "{}").name ?? ""; }
  catch { return ""; }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState>("unknown");
  const isAuthPage = AUTH_PATHS.includes(pathname);
  const isPublicPage = PUBLIC_PATHS.includes(pathname);
  // MotionLab is one dark product shell. Individual light cards can still be
  // deliberate surfaces, but navigation must never swap the whole viewport to
  // paper and flash white between routes.
  const darkCanvas = !isAuthPage;

  // Pure workout mode: while actively recording, the Activity page raises
  // this flag and ALL app chrome disappears (no top bar to mis-tap, no nav).
  // Pausing or stopping brings it back.
  const [immersive, setImmersive] = useState(false);
  useEffect(() => {
    const h = (e: Event) => setImmersive(Boolean((e as CustomEvent).detail));
    window.addEventListener("ml:immersive", h as EventListener);
    return () => window.removeEventListener("ml:immersive", h as EventListener);
  }, []);
  useEffect(() => setImmersive(false), [pathname]); // safety: never sticks across routes

  // welcome ritual: a black veil plays once on Home — "WELCOME BACK" after a
  // returning login (/login sets the flag), plain "WELCOME" after onboarding.
  // Holds 5s, then melts away.
  const [welcome, setWelcome] = useState<"back" | "new" | null>(null);
  useEffect(() => {
    if (pathname !== "/") return;
    let kind: "back" | "new" | null = null;
    try {
      if (sessionStorage.getItem("ml_welcome_back")) kind = "back";
      else if (sessionStorage.getItem("ml_welcome_new")) kind = "new";
      if (!kind) return;
      sessionStorage.removeItem("ml_welcome_back");
      sessionStorage.removeItem("ml_welcome_new");
    } catch { return; }
    setWelcome(kind);
    const t = setTimeout(() => setWelcome(null), 6300);
    return () => clearTimeout(t);
  }, [pathname]);

  // REAL auth gate: nobody enters the app without logging in.
  // Google login → server session; email OTP → ml_auth flag set by /login.
  useEffect(() => {
    let dead = false;
    // Local product review goes straight to the app. This deliberately does
    // not write ml_auth: it is a UI-gate bypass, not a fake account, and it
    // therefore cannot upload local records under an invented identity.
    if (isLocalDevAuthBypass() && !hasAuthCallback()) {
      if (pathname === "/login") router.replace("/");
      setAuth("in");
      return;
    }
    if (isAuthPage || isPublicPage) { setAuth("in"); return; }
    // A magic link may land on ANY route (the Supabase Site URL is often just
    // "/"). Its tokens live in the URL — bounce to /login WITH them intact so
    // the login page can complete the sign-in. Redirecting normally here would
    // strip the hash and silently break every email login.
    if (hasAuthCallback()) {
      const { hash, search } = window.location;
      router.replace(`/login${search}${hash}`);
      return;
    }
    // Synchronous, so a returning athlete never sees a splash at all: the very
    // first effect after mount already knows they are in.
    if (localStorage.getItem("ml_auth")) { setAuth("in"); return; }
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((sess) => {
        if (sess?.user) {
          localStorage.setItem("ml_auth", "google");
          void (async () => {
            // A live session with no LOCAL profile does not mean a new athlete.
            // It is also exactly what a returning one looks like on a device or
            // an origin they have not used before — and localhost and the
            // deployed domain are different origins, so every athlete's first
            // visit to the real site lands here with empty storage.
            //
            // Deciding from local state alone sent them through onboarding
            // again, asking a returning athlete to re-introduce themselves. The
            // cloud snapshot is the one thing that knows better, so consult it
            // BEFORE concluding anyone is new. CloudSync cannot do it — it
            // mounts inside the shell, which this redirect never reaches.
            if (!localProfileName() && !localStorage.getItem("ml_onboarded")) {
              try { await bootstrapAccountData(); } catch { /* offline: fall through to onboarding */ }
              if (dead) return;
            }
            if (!localProfileName() && !localStorage.getItem("ml_onboarded")) router.replace("/onboarding");
            else setAuth("in");
          })();
        } else { setAuth("out"); router.replace("/login"); }
      })
      .catch(() => { setAuth("out"); router.replace("/login"); });
    return () => { dead = true; };
  }, [pathname, isAuthPage, isPublicPage, router]);

  if (isAuthPage) {
    // immersive: no top bar, no bottom nav — main is the scroll area, fills the shell.
    // data-shell has to be here too: /login and /onboarding sit on the same
    // graphite ground as the app, so without it every token on those pages
    // resolves to the LIGHT :root values — which is how WELCOME ended up as
    // near-black text on a near-black background.
    return (
      <div className="contents" data-shell="dark">
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-graphite">{children}</main>
      </div>
    );
  }

  if (isPublicPage) {
    // No chrome (there is no account to navigate), but the data-shell wrapper
    // still has to be here: without it every --panel/--fg token on the page
    // falls back to the light :root values on a dark canvas.
    return (
      <div className="contents" data-shell="dark">
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-graphite">{children}</main>
      </div>
    );
  }

  // Render the app ONLY once the gate has confirmed a signed-in athlete.
  //
  // The condition is `!== "in"`, not `=== "unknown"`. That was the bug, and it
  // was measured: with `=== "unknown"`, the session fetch came back, set the
  // state to "out" and called router.replace in the same tick — but "out" fell
  // straight through the gate, so React painted Home at 399 ms and the redirect
  // only landed at 421 ms. Twenty-two milliseconds of somebody else's empty
  // dashboard, every single time a logged-out visitor arrived.
  //
  // "out" means a redirect is already in flight, so it must keep the splash up
  // exactly like "unknown" does. A returning athlete resolves synchronously
  // from localStorage in the first effect after mount and never sees it.
  if (auth !== "in") {
    return (
      <div className="contents" data-shell="dark">
        <main className="flex min-h-0 flex-1 items-center justify-center bg-graphite">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark-light.png" alt="MotionLab" className="h-8 w-auto animate-pulse" />
        </main>
      </div>
    );
  }

  return (
    // SHELL SCOPE — this wrapper, not <main>.
    //
    // The shell's CSS variables (app/globals.css SURFACES) only reach what is
    // INSIDE the element carrying data-shell. While it sat on <main>, TopBar,
    // BottomNav and CoachMark were siblings, so all 20 of their token uses fell
    // back to :root — the LIGHT values — on a dark app. The visible symptom was
    // the Start button's plus vanishing: text-on-action resolved to #FFFFFF on
    // a white button. The page code was right; the scope was wrong.
    //
    // display:contents generates no box, so the flex layout below is unchanged.
    <div className="contents" data-shell={darkCanvas ? "dark" : "light"}>
      <CloudSync />
      {!immersive && <TopBar />}
      {/* the ONLY scroll container in the app; a flex column so full-height pages
          (Activity) can flex-1 to fill without fragile percentage-height chains */}
      <main
        id="ml-scroll"
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto pb-28 ${darkCanvas ? "bg-graphite" : "bg-paper"}`}
      >
        {/* the entrance animation lives in app/template.tsx, which Next
            re-mounts on every navigation. A second wrapper here nested the
            same animation inside itself and played it twice. */}
        {children}
      </main>
      {!immersive && <BottomNav />}
      {!immersive && <CoachMark />}

      {/* welcome veil — above everything, never intercepts after it fades */}
      {welcome && (
        <div className="welcome-veil fixed inset-0 z-[100] grid place-items-center bg-black">
          <div className="text-center">
            <p className="welcome-text font-golden text-3xl text-white">
              {welcome === "back" ? "WELCOME BACK" : "WELCOME"}
            </p>
            <p className="welcome-sub mt-2.5 text-sm font-semibold tracking-wide text-white/65">to MotionLab 2.0</p>
          </div>
        </div>
      )}
    </div>
  );
}
