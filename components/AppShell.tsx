"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { CoachMark } from "@/components/CoachMark";
import { hasAuthCallback } from "@/lib/supabase-client";
import { CloudSync } from "@/components/CloudSync";
import { isLocalDevAuthBypass } from "@/lib/dev-auth";

// Only true authentication/onboarding routes live outside the product shell.
// The assistant is a normal signed-in destination: excluding it here used to
// remove both pieces of chrome and reveal the old white document canvas.
const AUTH_PATHS = ["/login", "/onboarding"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthPage = AUTH_PATHS.includes(pathname);
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
    // Local product review goes straight to the app. This deliberately does
    // not write ml_auth: it is a UI-gate bypass, not a fake account, and it
    // therefore cannot upload local records under an invented identity.
    if (isLocalDevAuthBypass() && !hasAuthCallback()) {
      if (pathname === "/login") router.replace("/");
      return;
    }
    if (isAuthPage) return;
    // A magic link may land on ANY route (the Supabase Site URL is often just
    // "/"). Its tokens live in the URL — bounce to /login WITH them intact so
    // the login page can complete the sign-in. Redirecting normally here would
    // strip the hash and silently break every email login.
    if (hasAuthCallback()) {
      const { hash, search } = window.location;
      router.replace(`/login${search}${hash}`);
      return;
    }
    if (localStorage.getItem("ml_auth")) return;
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((sess) => {
        if (sess?.user) {
          localStorage.setItem("ml_auth", "google");
          // BUT a live session with no local profile = fresh install/new user:
          // they still owe us onboarding (weight etc.) before seeing the app
          let hasProfile = false;
          try {
            hasProfile = !!JSON.parse(localStorage.getItem("ml_profile") ?? "{}").name;
          } catch {}
          if (!hasProfile && !localStorage.getItem("ml_onboarded")) router.replace("/onboarding");
        } else router.replace("/login");
      })
      .catch(() => router.replace("/login"));
  }, [pathname, isAuthPage, router]);

  if (isAuthPage) {
    // immersive: no top bar, no bottom nav — main is the scroll area, fills the shell
    return <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>;
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
