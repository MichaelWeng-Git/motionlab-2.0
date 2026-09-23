"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// One-time hint pointing at the 分析 tab.
// Shows until the user opens /analyze once — then never again.
export function CoachMark() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem("ml_seen_analyze");
    if (pathname === "/analyze") {
      // first visit — remember it, hint is done forever
      if (!seen) localStorage.setItem("ml_seen_analyze", "1");
      setShow(false);
      return;
    }
    // only nudge on Home — floating over other pages' content reads as a glitch
    setShow(pathname === "/" && !seen);
  }, [pathname]);

  // hide instantly when the launcher opens (avoids overlapping its fly-out)
  useEffect(() => {
    const done = () => setShow(false);
    window.addEventListener("ml:coach-done", done);
    return () => window.removeEventListener("ml:coach-done", done);
  }, []);

  if (!show) return null;

  return (
    // resting position clears the + button — the bob only ever moves UP from here
    <div className="pointer-events-none fixed bottom-[78px] left-1/2 z-50 -translate-x-1/2 animate-bob">
      <div className="relative rounded-2xl bg-sheet px-4 py-2.5 text-sm font-semibold text-fg ring-1 ring-inset ring-hair">
        Start here — upload your first video
        {/* arrow */}
        <span className="absolute -bottom-[7px] left-1/2 h-3.5 w-3.5 -translate-x-1/2 rotate-45 rounded-[3px] bg-sheet" />
      </div>
    </div>
  );
}
