"use client";

// Progress — real sessions only. No mock rows, ever.
// Only the latest report is stored (privacy), so only the newest row opens one.

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSessions, getStats, type Session } from "@/lib/stats";
import { MapPinIcon, PlayIcon } from "@/components/Icons";
import { MedalArt } from "@/components/MedalArt";
import { earnedMedalIds, medalCollection } from "@/lib/medals";
import { personalBests, progressHeatmap, type HeatDay, type PersonalBest } from "@/lib/progress";

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
  const [heatmap, setHeatmap] = useState<HeatDay[][]>([]);
  const [pbs, setPbs] = useState<PersonalBest[]>([]);
  const [medalStats, setMedalStats] = useState({ total: 0, bestScore: 0, streakDays: 0 });

  useEffect(() => {
    const savedSessions = getSessions().sort((a, b) => b.date.localeCompare(a.date));
    setSessions(savedSessions);
    setHeatmap(progressHeatmap());
    setPbs(personalBests(savedSessions));
    try {
      const s = getStats();
      setMedalStats({ total: s.total, bestScore: s.bestScore, streakDays: s.streakDays });
    } catch {}
    try {
      const a = JSON.parse(localStorage.getItem("ml_activities") ?? "[]") as { date: string; thumb?: string }[];
      setActs(a.length);
    } catch {}
  }, []);

  const best = sessions.reduce((m, x) => Math.max(m, x.score), 0);


  return (
    <div className="stagger min-h-full bg-graphite px-5 pb-8 pt-8 text-white">
      <h1 className="font-golden text-[26px] leading-none">PROGRESS</h1>

      {/* all-time at a glance — ONE bordered block, three bold columns */}
      <div className="mt-4 overflow-hidden rounded-3xl bg-inset ring-1 ring-inset ring-hair">
        <div className="grid grid-cols-3 divide-x divide-white/10 py-4">
          {[
            { v: sessions.length, l: "Analyses" },
            { v: acts, l: "Workouts" },
            { v: sessions.length ? best : "—", l: "Best score" },
          ].map((x) => (
            <div key={x.l} className="text-center">
              <p className="font-golden text-2xl tabular-nums text-white">{x.v}</p>
              <p className="mt-0.5 text-[11px] font-bold text-fg-muted">{x.l}</p>
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
            <span className="grid h-9 w-9 place-items-center rounded-full bg-track backdrop-blur"><PlayIcon size={14} className="text-white" /></span>
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

      {/* Twelve-week training consistency — each dot comes from a real Workout. */}
      <section className="mt-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-golden text-xl leading-none text-white">12-WEEK RHYTHM</h2>
          <span className="text-[11px] font-black tracking-[0.14em] text-fg-muted">TRAINING DAYS</span>
        </div>
        <div className="mt-2.5 overflow-hidden rounded-2xl bg-panel p-5 text-white ring-1 ring-inset ring-hair">
          <div className="flex gap-2">
            <div className="grid grid-rows-7 gap-1.5 pt-px text-[11px] font-black text-white/60">
              {["M", "", "W", "", "F", "", "S"].map((d, i) => <span key={i} className="flex h-3 items-center">{d}</span>)}
            </div>
            <div className="grid min-w-0 flex-1 grid-cols-12 gap-1.5">
              {heatmap.map((week, wi) => (
                <div key={wi} className="grid grid-rows-7 gap-1.5">
                  {week.map((d) => (
                    <span
                      key={d.date}
                      title={`${new Date(d.date).toLocaleDateString()} · ${d.future ? "upcoming" : d.count ? `${d.count} workout${d.count === 1 ? "" : "s"}${d.minutes == null ? " · duration unknown" : ` · ${d.minutes} min`}` : "rest"}`}
                      className={`h-3 rounded-[3px] ring-1 ring-inset ring-hair ${d.future ? "bg-transparent" : d.level === 4 ? "bg-heat-4" : d.level === 3 ? "bg-heat-3" : d.level === 2 ? "bg-heat-2" : d.level === 1 ? (d.minutes == null ? "border border-heat-2 bg-transparent" : "bg-heat-1") : "bg-track"}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
            <span className="text-[11px] font-black tracking-[0.13em] text-fg-muted">OLDER</span>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-white/50"><span>MINUTES</span>{["bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-volt"].map((c) => <i key={c} className={`h-2.5 w-2.5 rounded-[3px] ${c}`} />)}</div>
            <span className="text-[11px] font-black tracking-[0.13em] text-fg-muted">NOW</span>
          </div>
        </div>
      </section>

      <section className="mt-5">
        <div className="flex items-baseline justify-between"><h2 className="font-golden text-xl leading-none text-white">PERSONAL BESTS</h2><span className="text-[11px] font-black tracking-[0.14em] text-fg-muted">MEASURED ONLY</span></div>
        {pbs.length ? (
          <div className="-mx-5 mt-2.5 flex snap-x gap-3 overflow-x-auto px-5 pb-2 no-scrollbar">
            {pbs.map((pb) => (
              <Link key={pb.id} href={pb.href ?? "#"} className="min-w-[180px] snap-start overflow-hidden rounded-2xl bg-inset p-4 ring-1 ring-inset ring-hair active:scale-[0.98]">
                <div className="flex items-center justify-between"><span className={`rounded-full px-2 py-1 text-[11px] font-black tracking-[0.13em] ${pb.kind === "score" ? "bg-volt text-ink" : "bg-sky text-ink"}`}>{pb.kind === "score" ? "FORM SCORE" : "GPS DISTANCE"}</span><span className="text-sm font-black">›</span></div>
                <p className="mt-5 font-golden text-4xl leading-none tabular-nums text-white">{pb.value}<span className="ml-1 text-xs">{pb.unit}</span></p>
                <p className="mt-2 truncate text-sm font-extrabold text-white">{pb.sport}</p>
                <p className="mt-0.5 text-[11px] font-bold text-fg-muted">{new Date(pb.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</p>
              </Link>
            ))}
          </div>
        ) : (
          <Link href="/analyze" className="mt-2.5 flex items-center justify-between rounded-2xl bg-inset p-5 ring-1 ring-inset ring-hair"><div><p className="font-extrabold text-white">Your first PB starts here</p><p className="mt-1 text-xs font-bold text-fg-muted">Analyze a movement or record a GPS workout.</p></div><span className="font-golden text-2xl">›</span></Link>
        )}
      </section>

      {/* MEDALS — moved off Home so the first screen stays about TODAY */}
      <section className="mb-2 mt-5">
        {(() => {
          const families = medalCollection({ analyses: medalStats.total, bestScore: medalStats.bestScore, streakDays: medalStats.streakDays, recordedWorkouts: acts });
          const earnedCount = earnedMedalIds(families).length;
          return (
            <Link href="/medals" className="block overflow-hidden rounded-2xl bg-graphite p-5 text-white shadow-lift transition active:scale-[0.99]">
              <div className="flex items-start justify-between">
                <div><p className="text-[11px] font-black tracking-[0.18em] text-award-gold-light">PERFORMANCE CABINET</p><h2 className="mt-1 font-golden text-2xl leading-none">MEDALS</h2></div>
                <span className="font-golden text-lg text-white/60">{earnedCount} / 12 ›</span>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {families.map((family) => <div key={family.key} className="text-center"><MedalArt family={family.key} tier={family.current ?? "bronze"} earned={!!family.current} size={68} /><p className="mt-1 truncate text-[11px] font-black text-white/55">{family.name.toUpperCase()}</p></div>)}
              </div>
            </Link>
          );
        })()}
      </section>

    </div>
  );
}
