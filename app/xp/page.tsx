"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSessions } from "@/lib/stats";
import { XP_REWARDS, levelForXp, nextTier, xpForLevel, xpFromCounts } from "@/lib/xp";
import { dayKey } from "@/lib/date";

type XpData = { xp: number; analyses: number; workouts: number; activeDays: number };

export default function XpPage() {
  const router = useRouter();
  const [data, setData] = useState<XpData | null>(null);
  useEffect(() => {
    const sessions = getSessions();
    let activities: { date: string }[] = [];
    try { activities = JSON.parse(localStorage.getItem("ml_activities") ?? "[]"); } catch {}
    const activeDays = new Set([...sessions.map((s) => s.date), ...activities.map((a) => a.date)].map((d) => dayKey(d))).size;
    const xp = xpFromCounts(sessions.length, activities.length, activeDays);
    setData({ xp, analyses: sessions.length, workouts: activities.length, activeDays });
  }, []);
  if (!data) return <div className="px-5 pt-5"><div className="skel h-[500px] rounded-2xl" /></div>;
  const level = levelForXp(data.xp), upcomingTier = nextTier(level.level);
  const levels = Array.from({ length: 5 }, (_, i) => level.level + i);
  return <div className="stagger px-5 pb-10 pt-3">
    <header className="flex items-center gap-2.5"><button onClick={() => router.back()} className="flex h-7 w-11 items-center justify-center rounded-full bg-panel text-[13px] text-fg shadow-panel">←</button><h1 className="font-golden text-[24px] leading-none">XP</h1></header>
    <section className="relative mt-3 overflow-hidden rounded-3xl bg-graphite ring-1 ring-inset ring-hair p-5 text-white">
      <div className="absolute -right-20 -top-24 h-60 w-60 rounded-full opacity-35 blur-3xl" style={{ background: level.color }} />
      <p className="relative text-[11px] font-black tracking-[0.2em] text-fg-muted">ATHLETE LEVEL</p>
      <div className="relative mt-2 flex items-end justify-between"><div><p className="font-golden text-6xl leading-none">{level.level}</p><p className="mt-1 font-golden text-2xl" style={{ color: level.color }}>{level.name.toUpperCase()}</p></div><p className="font-golden text-2xl">{data.xp}<span className="ml-1 text-sm text-fg-muted">XP</span></p></div>
      <div className="relative mt-6 h-2 overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full" style={{ width: `${level.progress * 100}%`, background: level.color }} /></div>
      <div className="relative mt-2 flex justify-between text-[11px] font-bold text-fg-muted"><span>{level.intoLevel} earned</span><span>{level.levelCost - level.intoLevel} to Level {level.level + 1}</span></div>
    </section>
    <section className="mt-3 rounded-2xl bg-panel p-5 text-fg shadow-panel"><p className="text-[11px] font-black tracking-[0.18em] text-fg-muted">HOW YOU EARNED IT</p><h2 className="mt-1 font-golden text-xl text-fg">XP BREAKDOWN</h2><div className="mt-4 space-y-2"><EarnRow label="Video analyses" count={data.analyses} each={XP_REWARDS.analysis} /><EarnRow label="Recorded workouts" count={data.workouts} each={XP_REWARDS.recordedWorkout} /><EarnRow label="Active days" count={data.activeDays} each={XP_REWARDS.activeDay} /></div></section>
    <section className="mt-3 rounded-2xl bg-panel p-5 text-fg shadow-panel"><div className="flex items-end justify-between"><div><p className="text-[11px] font-black tracking-[0.18em] text-fg-muted">LEVEL CURVE</p><h2 className="mt-1 font-golden text-xl text-fg">WHAT’S NEXT</h2></div>{upcomingTier && <span className="text-[11px] font-black text-fg-muted">{upcomingTier.name.toUpperCase()} AT L{upcomingTier.at}</span>}</div><div className="mt-5 space-y-4">{levels.map((n) => { const at = xpForLevel(n), reached = data.xp >= at; return <div key={n} className="flex items-center gap-3"><span className={`grid h-10 w-10 place-items-center rounded-full font-golden text-sm ${reached ? "text-white" : "bg-inset text-fg-muted"}`} style={reached ? { background: level.color } : undefined}>{n}</span><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full" style={{ width: reached ? "100%" : "0%", background: level.color }} /></span><span className="w-16 text-right font-golden text-sm text-fg">{at} XP</span></div>; })}</div></section>
  </div>;
}

function EarnRow({ label, count, each }: { label: string; count: number; each: number }) { return <div className="flex items-center rounded-xl bg-inset px-3 py-3"><div className="flex-1"><p className="text-xs font-black text-fg">{label}</p><p className="mt-0.5 text-[11px] font-bold text-fg-muted">{count} × {each} XP</p></div><span className="font-golden text-lg text-fg">+{count * each}</span></div>; }
