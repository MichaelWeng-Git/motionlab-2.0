"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getProfile, type Profile } from "@/lib/profile";
import { getDailyStreak } from "@/lib/streak";
import { Avatar } from "@/components/Avatar";
import { Flame } from "@/components/Flame";

export function TopBar() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [streak, setStreak] = useState(0);
  const [flamePop, setFlamePop] = useState(false); // big bounce on today's first open

  // one right-side cluster: streak + avatar (no chips scattered elsewhere).
  // the flame is a LOGIN streak (lib/streak) — the app dispatches ml:streak
  // when today's first open bumps it, and we bounce the chip then.
  useEffect(() => {
    const load = () => {
      setProfile(getProfile());
      try { setStreak(getDailyStreak()); } catch {}
    };
    load();
    const onStreak = (e: Event) => {
      const d = (e as CustomEvent<{ count: number; bumped: boolean }>).detail;
      setStreak(d.count);
      if (d.bumped) {
        setFlamePop(false);
        requestAnimationFrame(() => setFlamePop(true));
        setTimeout(() => setFlamePop(false), 1100);
      }
    };
    window.addEventListener("ml:profile", load);
    window.addEventListener("focus", load);
    window.addEventListener("ml:streak", onStreak as EventListener);
    return () => {
      window.removeEventListener("ml:profile", load);
      window.removeEventListener("focus", load);
      window.removeEventListener("ml:streak", onStreak as EventListener);
    };
  }, []);
  // ask-AI popover: tiny window under the top bar; submit warps to the assistant
  const pathname = usePathname();
  const [askOpen, setAskOpen] = useState(false);
  const [q, setQ] = useState("");

  // ChatGPT-style draft memory: a half-typed question survives leaving the
  // app for up to 30 minutes, then quietly expires
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem("ml_ask_draft") ?? "null");
      if (d?.q && Date.now() - d.t < 30 * 60_000) setQ(d.q);
      else localStorage.removeItem("ml_ask_draft");
    } catch {}
  }, []);
  function setDraft(v: string) {
    setQ(v);
    try {
      if (v.trim()) localStorage.setItem("ml_ask_draft", JSON.stringify({ q: v, t: Date.now() }));
      else localStorage.removeItem("ml_ask_draft");
    } catch {}
  }

  // switching pages closes the window — the draft stays
  useEffect(() => setAskOpen(false), [pathname]);

  // tap ANYWHERE outside the window (or the pill) → it closes. Document-level,
  // so no z-index stack can ever swallow the tap.
  useEffect(() => {
    if (!askOpen) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.("[data-ask]")) setAskOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [askOpen]);

  function submitAsk(e: React.FormEvent) {
    e.preventDefault();
    const t = q.trim();
    if (!t) return;
    setAskOpen(false);
    setDraft("");
    router.push(`/account/help?q=${encodeURIComponent(t)}`);
  }

  // iOS-style compaction: shrink + deepen the frosted glass once content scrolls
  useEffect(() => {
    const el = document.getElementById("ml-scroll");
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 8);
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-all duration-300 ${
        scrolled ? "border-white/10 bg-graphite/95 shadow-lift backdrop-blur-2xl" : "border-white/5 bg-graphite/90 backdrop-blur-xl"
      }`}
    >
      <div
        className={`flex w-full items-center justify-between px-5 transition-[height] duration-300 ${
          scrolled ? "h-11" : "h-14"
        }`}
      >
        <Link href="/" className="flex items-center">
          {/* the M2 ribbon mark IS the wordmark — no text beside it */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="MotionLab" className="h-[24px] w-auto brightness-0 invert" />
        </Link>

        {/* ask MotionLab AI — centered pill, opens a floating input window.
            Centering lives on the WRAPPER so press feedback can't shift it. */}
        <div className="absolute left-1/2 -translate-x-1/2">
          <button
            data-ask
            onClick={() => setAskOpen(!askOpen)}
            aria-label="Ask MotionLab AI"
            className="flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-white ring-1 ring-inset ring-white/10"
          >
            <SparkleIcon />
            <span className="font-golden text-xs text-white">AI</span>
          </button>
        </div>

        {/* right cluster: streak + profile, one place, one size */}
        <div className="flex items-center gap-2">
          <Link
            href="/streak"
            aria-label="My streak"
            className={`flex h-9 items-center gap-1 rounded-full pl-1.5 pr-2.5 shadow-soft transition active:scale-95 ${
              streak > 0 ? "bg-award-gold-wash/15 text-award-gold-light" : "bg-white/10 text-white/55"
            } ${flamePop ? "streak-pop" : ""}`}
          >
            <Flame size={18} lit={streak > 0} />
            <span className="text-[13px] font-extrabold tabular-nums">{streak}</span>
          </Link>
          <Link
            href="/account"
            className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-white/10 ring-1 ring-inset ring-white/10 transition active:scale-95"
            aria-label="My profile"
          >
            {profile && <Avatar p={profile} iconSize={24} />}
          </Link>
        </div>
      </div>

      {/* the tiny ask window — clean white card, no border */}
      {askOpen && (
        <div data-ask className="absolute left-1/2 top-full z-50 mt-2 w-[min(88%,340px)] -translate-x-1/2">
          <form
            onSubmit={submitAsk}
            className="rise-in flex items-center gap-2 rounded-2xl bg-white p-1.5 pl-3 shadow-lift"
          >
            <SparkleIcon />
            <input
              autoFocus
              value={q}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask MotionLab AI anything…"
              className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-ink-muted"
            />
            <button
              type="submit"
              aria-label="Ask"
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition active:scale-95 ${
                q.trim() ? "bg-ink text-white" : "bg-black/10 text-ink-muted"
              }`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </header>
  );
}

// little AI sparkle
function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 text-volt-glow">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" fill="currentColor" />
      <path d="M18.5 15l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z" fill="currentColor" opacity="0.55" />
    </svg>
  );
}
