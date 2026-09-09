"use client";

// Progress — real sessions only. No mock rows, ever.
// Only the latest report is stored (privacy), so only the newest row opens one.

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSessions, getStats, type Session } from "@/lib/stats";
import { ClapperIcon, DiamondIcon, FlameIcon, MapPinIcon, MedalIcon, PlayIcon, RocketIcon, TrophyIcon } from "@/components/Icons";

// wireframe earth: continents scroll behind a circular clip = the globe turns
function Globe({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className}>
      <defs>
        <clipPath id="globeClip">
          <circle cx="50" cy="50" r="42" />
        </clipPath>
        <radialGradient id="globeShade" cx="35%" cy="28%" r="80%">
          <stop offset="0" stopColor="rgba(255,255,255,0.28)" />
          <stop offset="0.55" stopColor="rgba(255,255,255,0)" />
          <stop offset="1" stopColor="rgba(0,0,0,0.35)" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="42" fill="#0E2F45" />
      <g clipPath="url(#globeClip)">
        <g className="globe-spin">
          {[0, 120].map((off) => (
            <g key={off} transform={`translate(${off} 0)`} fill="#35855A">
              <path d="M8 28 q9 -7 18 -2 q11 5 6 13 q-7 9 -18 6 q-11 -5 -6 -17z" />
              <path d="M46 54 q11 -9 22 -2 q9 7 2 15 q-9 9 -20 4 q-9 -7 -4 -17z" />
              <path d="M82 24 q9 -5 15 2 q5 9 -4 13 q-11 3 -13 -4 q-3 -7 2 -11z" />
              <path d="M24 72 q7 -5 13 0 q7 6 0 11 q-9 4 -13 -2 q-3 -5 0 -9z" />
              <path d="M95 62 q8 -4 13 1 q4 7 -3 11 q-9 3 -12 -3 q-2 -5 2 -9z" />
            </g>
          ))}
        </g>
        {[32, 50, 68].map((y) => (
          <line key={y} x1="8" y1={y} x2="92" y2={y} stroke="rgba(255,255,255,0.14)" strokeWidth="0.8" />
        ))}
        <ellipse cx="50" cy="50" rx="17" ry="42" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.8" />
        <ellipse cx="50" cy="50" rx="33" ry="42" fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="0.8" />
      </g>
      <circle cx="50" cy="50" r="42" fill="url(#globeShade)" />
      <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.2" />
    </svg>
  );
}


export default function History() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [acts, setActs] = useState(0);
  const [actDates, setActDates] = useState<string[]>([]);
  const [lastThumb, setLastThumb] = useState<string | null>(null);
  const [medalStats, setMedalStats] = useState({ total: 0, bestScore: 0, streakDays: 0 });

  useEffect(() => {
    setSessions(getSessions().sort((a, b) => b.date.localeCompare(a.date)));
    try {
      const s = getStats();
      setMedalStats({ total: s.total, bestScore: s.bestScore, streakDays: s.streakDays });
    } catch {}
    try {
      const a = JSON.parse(localStorage.getItem("ml_activities") ?? "[]") as { date: string; thumb?: string }[];
      setActs(a.length);
      setActDates(a.map((x) => x.date));
      const withThumb = a.filter((x) => x.thumb);
      setLastThumb(withThumb.length ? withThumb[withThumb.length - 1].thumb! : null);
    } catch {}
  }, []);

  // this-week day markers (Mon..Sun)
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const weekDays = new Set(
    [...sessions.map((s) => s.date), ...actDates]
      .filter((d) => new Date(d) >= monday)
      .map((d) => (new Date(d).getDay() + 6) % 7)
  );

  const best = sessions.reduce((m, x) => Math.max(m, x.score), 0);


  return (
    <div className="stagger px-5 pt-8">
      <h1 className="text-3xl font-extrabold tracking-tight">Progress</h1>

      {/* all-time at a glance — ONE bordered block, three bold columns */}
      <div className="mt-4 overflow-hidden rounded-3xl bg-white shadow-soft">
        <div className="grid grid-cols-3 divide-x divide-black/10 py-4">
          {[
            { v: sessions.length, l: "Analyses" },
            { v: acts, l: "Workouts" },
            { v: best, l: "Best score" },
          ].map((x) => (
            <div key={x.l} className="text-center">
              <p className="text-2xl font-extrabold tabular-nums text-ink">{x.v}</p>
              <p className="mt-0.5 text-[11px] font-bold text-ink">{x.l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* library tiles */}
      <section className="mt-5">
        <div className="mt-2.5 grid grid-cols-2 gap-3">
        <Link
          href="/videos"
          className="relative flex aspect-square flex-col justify-between overflow-hidden rounded-3xl bg-ink p-4 text-white shadow-lift transition active:scale-[0.98]"
        >
          <div className="relative flex items-center justify-between">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10 backdrop-blur"><PlayIcon size={14} className="text-white" /></span>
            <span className="font-bold text-white/80">›</span>
          </div>
          <div className="relative">
            <p className="text-base font-extrabold">Your analyses</p>
            <p className="mt-0.5 text-[11px] font-semibold text-white/70">
              {sessions.length} {sessions.length === 1 ? "analysis" : "analyses"}
            </p>
          </div>
        </Link>

        <Link
          href="/activities"
          className="relative flex aspect-square flex-col justify-between overflow-hidden rounded-3xl p-4 shadow-lift transition active:scale-[0.98]"
        >
          {/* deep-night sky with the earth slowly turning */}
          <div className="absolute inset-0 bg-[#0E2F45]" />
          <Globe className="absolute inset-0 m-auto h-[82%] w-[82%]" />
          <div className="relative flex items-center justify-between">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/90 shadow-soft"><MapPinIcon className="text-volt-deep" /></span>
            <span className="rounded-full bg-white/90 px-1.5 font-bold text-ink shadow-soft">›</span>
          </div>
          <div className="relative rounded-2xl bg-white/90 p-2.5 shadow-soft backdrop-blur">
            <p className="text-sm font-extrabold text-ink">Your activities</p>
            <p className="mt-0.5 text-[11px] font-semibold text-ink-muted">
              {acts} {acts === 1 ? "workout" : "workouts"}
            </p>
          </div>
        </Link>
        </div>
      </section>

      {/* this week */}
      <section className="mt-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-golden text-xl leading-none text-ink">THIS WEEK</h2>
          <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink">
            {weekDays.size} {weekDays.size === 1 ? "day" : "days"} active
          </span>
        </div>
        <div className="mt-2.5 rounded-3xl bg-white p-5 shadow-soft">
        <div className="flex gap-1.5">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
              <span className={`h-9 w-full rounded-lg ${weekDays.has(i) ? "bg-volt" : "bg-black/[0.05]"}`} />
              <span className="text-[10px] font-bold text-ink-muted">{d}</span>
            </div>
          ))}
        </div>
        </div>
      </section>

      {/* MEDALS — moved off Home so the first screen stays about TODAY */}
      <section className="mb-2 mt-5">
        {(() => {
          const badges: { icon: React.ReactNode; name: string; earned: boolean }[] = [
            { icon: <ClapperIcon size={26} />, name: "First analysis", earned: medalStats.total >= 1 },
            { icon: <RocketIcon size={26} />, name: "Score 75+", earned: medalStats.bestScore >= 75 },
            { icon: <FlameIcon size={26} />, name: "3-day streak", earned: medalStats.streakDays >= 3 },
            { icon: <MedalIcon size={26} />, name: "5 sessions", earned: medalStats.total >= 5 },
            { icon: <DiamondIcon size={26} />, name: "Score 90+", earned: medalStats.bestScore >= 90 },
            { icon: <TrophyIcon size={26} />, name: "20 sessions", earned: medalStats.total >= 20 },
          ];
          const earnedCount = badges.filter((b) => b.earned).length;
          return (
            <div className="rounded-3xl bg-white p-5 shadow-soft">
              <div className="relative">
                <h2 className="text-center font-golden text-2xl leading-none text-ink">MEDALS</h2>
                <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[11px] font-bold text-ink-muted">
                  {earnedCount} / {badges.length}
                </span>
              </div>
              <div className="-mx-5 mt-2.5 flex gap-4 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {badges.map((b) => (
                  <div key={b.name} className="flex w-[76px] shrink-0 flex-col items-center gap-2">
                    <span
                      className={`grid h-16 w-16 place-items-center rounded-full ${
                        b.earned ? "bg-volt-mist text-volt-deep shadow-soft" : "bg-black/[0.04] text-ink-muted/60"
                      }`}
                    >
                      {b.icon}
                    </span>
                    <span className={`text-center text-[10px] font-semibold leading-tight ${b.earned ? "text-ink" : "text-ink-muted"}`}>
                      {b.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </section>

    </div>
  );
}

