"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Big-brand convention (Instagram / Spotify / Nike): active tab = filled icon + ink color.
// Center button opens a two-way launcher: Analyze (video) or Activity (live workout).
export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // close the launcher whenever the route changes
  useEffect(() => setOpen(false), [pathname]);

  const centerActive = pathname === "/analyze" || pathname === "/activity";
  const warmed = useRef(false);

  // Preload the Analyze route + its heavy vision libraries the moment the launcher
  // opens, so tapping Analyze enters instantly instead of downloading on click.
  function warmAnalyze() {
    if (warmed.current) return;
    warmed.current = true;
    router.prefetch("/analyze");
    import("@/lib/ensemble").catch(() => {});
    import("@mediapipe/tasks-vision").catch(() => {});
  }

  function openLauncher() {
    if (!open) {
      localStorage.setItem("ml_seen_analyze", "1");
      window.dispatchEvent(new Event("ml:coach-done"));
      // warm the heavy vision bundles only AFTER the fly-out has finished —
      // importing them on the tap froze the main thread and ATE the animation
      setTimeout(warmAnalyze, 700);
    }
    setOpen(!open);
  }

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      {/* dim backdrop while launcher is open */}
      {open && (
        <button
          aria-label="Close"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px]"
        />
      )}

      {/* the STANDARD mobile tab bar: full-width, flush to the bottom edge,
          white with a hairline divider — every destination labeled */}
      <nav className="fixed bottom-0 left-1/2 z-50 w-full max-w-[430px] -translate-x-1/2 border-t border-white/10 bg-graphite/95 text-white backdrop-blur-xl">
        <div className="relative grid grid-cols-3 items-start px-2 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1.5">
          {/* Home */}
          <Link href="/" className="flex flex-col items-center gap-1 py-1">
            <HomeIcon filled={pathname === "/"} />
            <span className={`text-[11px] ${pathname === "/" ? "font-bold text-white" : "font-medium text-fg-muted"}`}>
              Home
            </span>
          </Link>

          {/* Center launcher */}
          <div className="relative flex flex-col items-center">
            {/* fly-out options */}
            <div
              className={`pointer-events-none absolute bottom-16 left-1/2 z-10 flex -translate-x-1/2 items-center gap-4 transition-all duration-500 ${
                open ? "pointer-events-auto translate-y-0 opacity-100" : "translate-y-6 opacity-0"
              }`}
              style={{ transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}
            >
              <button
                onClick={() => go("/analyze")}
                className={`flex w-[96px] flex-col items-center gap-1.5 rounded-2xl bg-graphite py-3.5 text-white shadow-lift ring-1 ring-inset ring-hair transition-all duration-500 ${
                  open ? "translate-x-0 scale-100" : "translate-x-8 scale-90"
                }`}
                style={{ transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}
              >
                <ScanIcon />
                <span className="text-xs font-bold">Analyze</span>
              </button>
              <button
                onClick={() => go("/fuel")}
                className={`mb-7 flex w-[96px] flex-col items-center gap-1.5 rounded-2xl bg-signal-okay py-3.5 text-white shadow-lift transition-all duration-500 ${
                  open ? "translate-y-0 scale-100" : "translate-y-4 scale-90"
                }`}
                style={{ transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 3v7a2 2 0 0 0 2 2v9M11 3v7a2 2 0 0 1-2 2M17 3c-1.5 1-2.5 3.2-2.5 5.5 0 2 .8 3 2.5 3v9.5" />
                </svg>
                <span className="text-xs font-bold">Fuel</span>
              </button>
              <button
                onClick={() => go("/activity")}
                className={`flex w-[96px] flex-col items-center gap-1.5 rounded-2xl bg-signal-good py-3.5 text-white shadow-lift transition-all duration-500 ${
                  open ? "translate-x-0 scale-100" : "-translate-x-8 scale-90"
                }`}
                style={{ transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}
              >
                <PulseIcon />
                <span className="text-xs font-bold">Activity</span>
              </button>
            </div>

            {/* main button — Strava-style: same row as the other tabs, just a
                solid accent block instead of a line icon */}
            <button
              onClick={openLauncher}
              aria-expanded={open}
              className={`grid h-9 w-12 place-items-center rounded-full bg-white text-on-action shadow-soft transition-all duration-300 active:scale-95 ${
                open ? "rotate-45" : ""
              }`}
            >
              <PlusIcon />
            </button>
            <span className={`mt-1 text-[11px] ${centerActive || open ? "font-bold text-white" : "font-semibold text-white/70"}`}>Start</span>
          </div>

          {/* Progress */}
          <Link href="/history" className="flex flex-col items-center gap-1 py-1">
            <ChartIcon filled={pathname === "/history"} />
            <span
                className={`text-[11px] ${pathname === "/history" ? "font-bold text-white" : "font-medium text-fg-muted"}`}
            >
              Progress
            </span>
          </Link>

        </div>
      </nav>
    </>
  );
}

function HomeIcon({ filled }: { filled: boolean }) {
  if (filled) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="text-white">
        <path d="M11.4 2.5a1 1 0 0 1 1.2 0l8.6 7.2c.5.4.2 1.3-.5 1.3H19v8.5a1.5 1.5 0 0 1-1.5 1.5H14v-6a2 2 0 0 0-4 0v6H6.5A1.5 1.5 0 0 1 5 19.5V11H3.3c-.7 0-1-.9-.5-1.3l8.6-7.2Z" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-fg-muted">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

function ChartIcon({ filled }: { filled: boolean }) {
  if (filled) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="text-white">
        <rect x="5.2" y="10.5" width="3.6" height="8.5" rx="1.2" />
        <rect x="10.2" y="5" width="3.6" height="14" rx="1.2" />
        <rect x="15.2" y="7.5" width="3.6" height="11.5" rx="1.2" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-fg-muted">
      <path d="M7 19v-8M12 19V6M17 19v-6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ScanIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function PulseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />
    </svg>
  );
}
