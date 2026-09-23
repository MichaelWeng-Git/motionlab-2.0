"use client";

// Daily activity history in the same data language as the TODAY card on Home:
// big numbers + thin electric-green progress bars — no abstract ring marks.
// One week at a time (arrows), history starts at your signup week, tap a day
// to inspect it, goals editable from the bubble in the day card.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSessions, type Session } from "@/lib/stats";
import { getGoals, getGoalsHistory, resolveGoals, saveGoals, DEFAULT_GOALS, type GoalHistory, type Goals } from "@/lib/goals";
import { GOAL_ARCS, GoalCardShell, GoalRing, GoalRows } from "@/components/GoalRing";
import { Gauge } from "@/components/Gauge";
import dynamic from "next/dynamic";
import { getDayIntensity, getDayMuscleLoad, MUSCLE_NAMES, type MuscleKey, type MuscleLoad } from "@/lib/muscles";
import { dayKey } from "@/lib/coins";

// the 3D body ships only on demand (heavy three.js + model)
// the 3D body ships on demand, but its SLOT is reserved from the first paint —
// otherwise the card grows when the chunk lands and the shadow visibly jumps
const MuscleBody3D = dynamic(() => import("@/components/MuscleBody3D").then((m) => m.MuscleBody3D), {
  ssr: false,
  loading: () => <span className="block" style={{ width: 176 * 0.66, height: 176 }} />,
});
import { TriBar } from "@/components/TriBar";


type Act = { name?: string; sport?: string; seconds?: number; meters?: number; date: string };

const keyOf = dayKey;
function mondayOf(d: Date) {
  const m = new Date(d);
  m.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  m.setHours(0, 0, 0, 0);
  return m;
}
const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
const fmtShort = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

function Chevron({ left = false }: { left?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      {left ? <path d="m14.5 6-6 6 6 6" /> : <path d="m9.5 6 6 6-6 6" />}
    </svg>
  );
}

export default function Weeks() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [acts, setActs] = useState<Act[]>([]);
  const [weekOffset, setWeekOffset] = useState(0); // 0 = this week
  // Empty until mounted. Reading the clock DURING render makes the server's
  // markup depend on the server's timezone and the client's on the browser's —
  // near a date boundary they disagree and React throws a hydration error.
  const [selectedKey, setSelectedKey] = useState("");
  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);
  // full goal history, loaded client-side; every day resolves its OWN target
  const [goalHist, setGoalHist] = useState<GoalHistory | null>(null);
  const [editGoals, setEditGoals] = useState(false);
  const [joined, setJoined] = useState<Date | null>(null);

  useEffect(() => {
    setSelectedKey(keyOf(new Date()));   // the client's today, after mount
    const ss = getSessions();
    setSessions(ss);
    let a: Act[] = [];
    try { a = JSON.parse(localStorage.getItem("ml_activities") ?? "[]"); } catch {}
    setActs(a);
    setGoals(getGoals());
    setGoalHist(getGoalsHistory());
    // history begins the week you joined — nothing before that exists
    let j = localStorage.getItem("ml_joined");
    if (!j) {
      const firsts = [...ss.map((s) => s.date), ...a.map((x) => x.date)].sort();
      j = dayKey(firsts[0] ?? new Date());
      localStorage.setItem("ml_joined", j);
    }
    setJoined(new Date(j + "T00:00:00"));
    // goals edited anywhere → re-read here too (no stale targets)
    const onGoals = () => { setGoals(getGoals()); setGoalHist(getGoalsHistory()); };
    window.addEventListener("ml:goals", onGoals);
    return () => window.removeEventListener("ml:goals", onGoals);
  }, []);

  const byDay = useMemo(() => {
    const m = new Map<string, { minutes: number; ana: number; wo: number; items: { kind: "ana" | "wo"; title: string; detail?: string; sub: string }[] }>();
    const get = (k: string) => {
      if (!m.has(k)) m.set(k, { minutes: 0, ana: 0, wo: 0, items: [] });
      return m.get(k)!;
    };
    for (const s of sessions) {
      const d = get(dayKey(new Date(s.date)));
      d.ana += 1;
      d.items.push({ kind: "ana", title: s.sport ?? "Practice", detail: s.action ?? undefined, sub: `Score ${s.score}` });
    }
    for (const a of acts) {
      const d = get(dayKey(new Date(a.date)));
      d.wo += 1;
      const mins = Math.round((a.seconds ?? 0) / 60);
      d.minutes += mins;
      d.items.push({ kind: "wo", title: a.name ?? a.sport ?? "Workout", sub: mins > 0 ? `${mins} min` : "Workout" });
    }
    return m;
  }, [sessions, acts]);

  const now = new Date();
  const thisMonday = mondayOf(now);
  const maxOffset = joined ? Math.max(0, Math.round((thisMonday.getTime() - mondayOf(joined).getTime()) / 604800000)) : 0;

  const weekMonday = new Date(thisMonday);
  weekMonday.setDate(weekMonday.getDate() - 7 * weekOffset);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekMonday);
    date.setDate(date.getDate() + i);
    const k = keyOf(date);
    const d = byDay.get(k);
    // days before you joined don't exist yet — grayed like future days;
    // days since joining with no activity keep the normal empty tracks
    const off = date > now || (joined !== null && date < joined);
    return {
      date, k,
      label: "MTWTFSS"[i],
      off,
      // each day's bar is scored against ITS OWN historical goal
      pcts: (() => {
        const g = resolveGoals(goalHist, k);
        return [
          (d?.minutes ?? 0) / g.minutes,
          Math.min(1, (d?.ana ?? 0) / g.dayAnalyses),
          Math.min(1, (d?.wo ?? 0) / g.dayWorkouts),
        ] as [number, number, number];
      })(),
    };
  });

  // keep the selected day inside the visible week
  useEffect(() => {
    if (!weekDays.some((d) => d.k === selectedKey)) {
      const candidate = weekOffset === 0 ? keyOf(now) : weekDays[0].k;
      setSelectedKey(candidate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset]);

  const sel = weekDays.find((d) => d.k === selectedKey) ?? weekDays[0];
  const selData = byDay.get(sel.k);
  // Apple-style: a past day is judged against the goal you had THAT day —
  // editing today never rewrites yesterday's rings
  const selGoals = resolveGoals(goalHist, sel.k);
  // what THAT day actually worked — its own sessions, undecayed (a past day
  // doesn't heal retroactively). Different question from the home body.
  // computed DURING the same render that has the day's data — an effect here
  // meant the card appeared (shadow and all) a frame late, which reads as a pop
  const dayLoad: MuscleLoad = useMemo(() => {
    if (typeof window === "undefined") return {};
    try { return getDayMuscleLoad(sel.k); } catch { return {}; }
  }, [sel.k, sessions, acts]);
  const dayIntensity = getDayIntensity(dayLoad);
  const topMuscles = (Object.entries(dayLoad) as [string, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => {
      const base = k.replace(/_[lr]$/, "") as MuscleKey;
      const side = k.endsWith("_l") ? "L " : k.endsWith("_r") ? "R " : "";
      return `${side}${MUSCLE_NAMES[base]}`;
    });

  const dayPcts = [
    Math.min(1, (selData?.minutes ?? 0) / Math.max(1, selGoals.minutes)),
    Math.min(1, (selData?.ana ?? 0) / Math.max(1, selGoals.dayAnalyses)),
    Math.min(1, (selData?.wo ?? 0) / Math.max(1, selGoals.dayWorkouts)),
  ];
  const weekLabel = weekOffset === 0 ? "This Week" : weekOffset === 1 ? "Last Week" : `${fmtShort(weekMonday)} – ${fmtShort(weekDays[6].date)}`;

  const twelveWeekStart = mondayOf(new Date(now));
  twelveWeekStart.setDate(twelveWeekStart.getDate() - 11 * 7);
  const twelveWeeks = Array.from({ length: 12 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => {
      const date = new Date(twelveWeekStart);
      date.setDate(date.getDate() + week * 7 + day);
      const k = dayKey(date);
      const data = byDay.get(k);
      const target = resolveGoals(goalHist, k);
      const completion = Math.min(1, (
        Math.min(1, (data?.minutes ?? 0) / Math.max(1, target.minutes)) +
        Math.min(1, (data?.ana ?? 0) / Math.max(1, target.dayAnalyses)) +
        Math.min(1, (data?.wo ?? 0) / Math.max(1, target.dayWorkouts))
      ) / 3);
      return { date, k, completion, active: Boolean(data?.items.length), future: date > now };
    })
  );
  const activeDays12 = twelveWeeks.flat().filter((d) => d.active).length;
  const heatClass = (v: number) => v >= 0.85 ? "bg-heat-4" : v >= 0.55 ? "bg-heat-3" : v >= 0.25 ? "bg-heat-2" : "bg-heat-1";

  function setGoal<K extends keyof Goals>(k: K, v: number) {
    // build from what is CURRENTLY stored, never from possibly-stale state —
    // otherwise editing one field writes back an old value for the others
    const g = { ...getGoals(), [k]: v };
    setGoals(g);
    saveGoals(g);
    setGoalHist(getGoalsHistory());
  }

  const goalRows: { label: string; key: keyof Goals; step: number; min: number; max: number; unit: string }[] = [
    { label: "Daily exercise", key: "minutes", step: 5, min: 10, max: 180, unit: "min" },
    { label: "Analyses / day", key: "dayAnalyses", step: 1, min: 1, max: 10, unit: "" },
    { label: "Workouts / day", key: "dayWorkouts", step: 1, min: 1, max: 10, unit: "" },
  ];

  // Everything below is derived from the CLOCK (which week, which day is
  // today, which days are still in the future). Rendering that on the server
  // bakes in the server's timezone, and the browser then disagrees — that was
  // the hydration error on this page. Hold the first paint until mount; the
  // effect above sets selectedKey and the real render follows immediately.
  if (!selectedKey) {
    return (
      <div className="stagger px-5 pb-8 pt-3">
        <div className="flex items-center gap-2.5">
          <span className="skel h-7 w-11 rounded-full" />
          <span className="skel h-6 w-24 rounded-lg" />
        </div>
        <div className="skel mt-4 h-[70px] rounded-2xl" />
        <div className="skel mt-3 h-[150px] rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="stagger px-5 pb-8 pt-3">
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => router.back()}
          className="flex h-7 w-11 items-center justify-center rounded-full bg-panel text-[13px] leading-none text-fg shadow-panel transition active:scale-95"
        >
          ←
        </button>
        <h1 className="font-golden text-[24px] leading-none">12 WEEKS</h1>
      </div>

      <section className="mt-4 overflow-hidden rounded-3xl bg-graphite p-5 shadow-lift">
        <div className="flex items-end justify-between">
          <div>
            <p className="font-golden text-[34px] leading-none text-white">{activeDays12}</p>
            <p className="mt-1 text-[12px] font-bold text-white/60">ACTIVE DAYS</p>
          </div>
          <p className="text-right text-[12px] font-bold leading-snug text-white/55">Your training rhythm<br />at a glance</p>
        </div>
        <div className="mt-5 grid grid-cols-12 gap-1.5" aria-label={`${activeDays12} active days in the last 12 weeks`}>
          {twelveWeeks.map((week, wi) => (
            <div key={wi} className="grid gap-1.5">
              {week.map((day) => (
                <span
                  key={day.k}
                  title={`${fmtDay(day.date)}${day.active ? " · active" : ""}`}
                  className={`aspect-square rounded-[4px] ${day.future ? "bg-inset" : day.active ? heatClass(day.completion) : "bg-track"}`}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-between text-[11px] font-bold text-fg-muted">
          <span>12 WEEKS AGO</span><span>NOW</span>
        </div>
      </section>

      {/* week pager — flat, low-profile: it steers, it shouldn't take height */}
      <div className="mt-3 flex items-center justify-center gap-1">
        <button
          onClick={() => setWeekOffset((o) => Math.min(maxOffset, o + 1))}
          disabled={weekOffset >= maxOffset}
          className={`grid h-8 w-8 place-items-center rounded-full text-fg-muted transition active:scale-90 ${
            weekOffset >= maxOffset ? "opacity-25" : "hover:text-fg"
          }`}
        >
          <Chevron left />
        </button>
        <span className="min-w-[128px] text-center font-golden text-[17px] leading-none text-fg">{weekLabel.toUpperCase()}</span>
        <button
          onClick={() => setWeekOffset((o) => Math.max(0, o - 1))}
          disabled={weekOffset <= 0}
          className={`grid h-8 w-8 place-items-center rounded-full text-fg-muted transition active:scale-90 ${
            weekOffset <= 0 ? "opacity-25" : "hover:text-fg"
          }`}
        >
          <Chevron />
        </button>
      </div>

      {/* 7-day strip — tap a day to enlarge it and inspect it below */}
      <div className="mt-3 rounded-3xl bg-panel p-2.5 text-fg shadow-panel">
        <div className="flex justify-between">
          {weekDays.map((d) => {
            const active = d.k === sel.k;
            return (
              <button
                key={d.k}
                onClick={() => !d.off && setSelectedKey(d.k)}
                disabled={d.off}
                className={`flex flex-col items-center gap-1.5 rounded-2xl px-2 py-2 transition-all duration-200 ${
                  active ? "scale-110 bg-signal-good/15" : d.off ? "opacity-40" : "active:scale-95"
                }`}
              >
                <span className={`text-[15px] leading-none ${active ? "font-extrabold text-fg" : "font-bold text-fg-muted"}`}>
                  {d.label}
                </span>
                {/* the day's tri-color bar: ⅓ Move · ⅓ Analyze · ⅓ Workout,
                    each third fills in its own color */}
                <span className="block w-8">
                  <TriBar pcts={[Math.min(1, d.pcts[0]), d.pcts[1], d.pcts[2]]} height={4} track="var(--track)" />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* the selected day — the SAME object as the home TODAY card (one ring,
          three arcs, graphite ground), so the two screens speak one language */}
      <div className="mt-4">
        <GoalCardShell>
          <div className="flex items-baseline justify-between">
            <p className="font-golden text-[12px] leading-none text-white/55">{fmtDay(sel.date)}</p>
            <button
              onClick={() => setEditGoals(true)}
              className="press inline-flex h-7 items-center gap-1 rounded-full bg-track px-2.5 text-[11px] font-bold text-white/85"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16.5 3.9a2.1 2.1 0 0 1 3 3L7 19.4l-4 1 1-4L16.5 3.9z" />
              </svg>
              Goals
            </button>
          </div>
          <div className="mt-3 flex items-center gap-5">
            <div className="relative shrink-0">
              <GoalRing pcts={dayPcts} />
              <div className="absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <p className="font-golden text-[34px] leading-none">
                    {Math.round(((dayPcts[0] + dayPcts[1] + dayPcts[2]) / 3) * 100)}
                  </p>
                  <p className="-mt-0.5 font-golden text-[11px] leading-none text-fg-muted">/100</p>
                </div>
              </div>
            </div>
            <GoalRows
              values={[selData?.minutes ?? 0, selData?.ana ?? 0, selData?.wo ?? 0]}
              targets={[selGoals.minutes, selGoals.dayAnalyses, selGoals.dayWorkouts]}
            />
          </div>
        </GoalCardShell>
      </div>

      {/* what that day trained — the body lit by THAT DAY's work only (never
          decayed), on the same raised surface as the rest of the dark shell */}
      {dayIntensity && (
        <div className="mt-4 overflow-hidden rounded-2xl bg-panel px-5 py-4 text-fg">
          <p className="font-golden text-[13px] leading-none text-fg">
            {sel.k === keyOf(new Date()) ? "TODAY" : fmtDay(sel.date).split(",")[0].toUpperCase()}&rsquo;S INTENSITY
          </p>
          <div className="mt-1 flex items-center gap-3">
            <MuscleBody3D height={176} load={dayLoad} />
            <div className="flex-1">
              <Gauge
                pct={dayIntensity.score}
                value={dayIntensity.level}
                color={dayIntensity.color}
                track="var(--track)"
                valueColor={dayIntensity.color}
                big
              />
            </div>
          </div>
        </div>
      )}

      {/* that day's records — only when there are any */}
      {selData?.items.length ? (
        <div className="mt-4 rounded-3xl bg-panel p-4 text-fg shadow-panel">
          <h2 className="font-golden text-xl leading-none text-fg">ON THIS DAY</h2>
          <div className="mt-2 space-y-1.5">
            {selData.items.map((it, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl bg-inset px-3.5 py-2.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: it.kind === "ana" ? GOAL_ARCS[1] : GOAL_ARCS[2] }}
                />
                <span className="flex flex-1 items-baseline gap-2">
                  <span className="font-golden text-[15px] leading-none text-fg">{it.title}</span>
                  {it.detail && <span className="font-golden text-[12px] leading-none text-fg-muted">{it.detail}</span>}
                </span>
                <span className="text-xs font-semibold text-fg-muted">{it.sub}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {editGoals && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-graphite/75 px-6 backdrop-blur-[2px]" onClick={() => setEditGoals(false)}>
          <div className="w-full max-w-[340px] animate-pop rounded-3xl bg-sheet p-6 text-fg shadow-lift ring-1 ring-inset ring-hair" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-center text-lg font-extrabold">Goals</h2>
            <div className="mt-4 space-y-3">
              {goalRows.map((g) => (
                <div key={g.key} className="flex items-center justify-between rounded-2xl bg-panel px-4 py-3 shadow-panel">
                  <span className="text-sm font-bold">{g.label}</span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setGoal(g.key, Math.max(g.min, goals[g.key] - g.step))}
                      className="grid h-8 w-8 place-items-center rounded-full bg-inset text-base font-bold text-fg transition active:scale-95"
                    >
                      −
                    </button>
                    <span className="w-14 text-center text-lg font-extrabold tabular-nums">
                      {goals[g.key]}
                      {g.unit && <span className="ml-0.5 text-[11px] font-bold text-fg-muted">{g.unit}</span>}
                    </span>
                    <button
                      onClick={() => setGoal(g.key, Math.min(g.max, goals[g.key] + g.step))}
                      className="grid h-8 w-8 place-items-center rounded-full bg-inset text-base font-bold text-fg transition active:scale-95"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setEditGoals(false)}
              className="mt-5 w-full rounded-full bg-action py-3 text-sm font-bold text-on-action transition active:scale-[0.98]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
