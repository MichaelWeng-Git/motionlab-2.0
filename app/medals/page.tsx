"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MedalArt } from "@/components/MedalArt";
import { getStats } from "@/lib/stats";
import { earnedMedalIds, medalCollection, type MedalFamily, type MedalMilestone } from "@/lib/medals";

export default function MedalsPage() {
  const router = useRouter();
  const [families, setFamilies] = useState<MedalFamily[]>([]);
  const [reveal, setReveal] = useState<{ family: MedalFamily; medal: MedalMilestone } | null>(null);
  useEffect(() => {
    const stats = getStats();
    let workouts = 0;
    try { workouts = (JSON.parse(localStorage.getItem("ml_activities") ?? "[]") as unknown[]).length; } catch {}
    const next = medalCollection({ analyses: stats.total, bestScore: stats.bestScore, streakDays: stats.streakDays, workouts });
    setFamilies(next);
    const earned = earnedMedalIds(next);
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem("ml_medals_seen") ?? "[]"); } catch {}
    const newest = earned.filter((id) => !seen.includes(id)).at(-1);
    if (newest) {
      const family = next.find((f) => f.milestones.some((m) => m.id === newest));
      const medal = family?.milestones.find((m) => m.id === newest);
      if (family && medal) setReveal({ family, medal });
    }
    localStorage.setItem("ml_medals_seen", JSON.stringify(earned));
  }, []);
  const earned = earnedMedalIds(families).length;
  return <div className="stagger px-5 pb-10 pt-3">
    <header className="flex items-center gap-2.5"><button onClick={() => router.back()} className="flex h-7 w-11 items-center justify-center rounded-full bg-white text-[13px] text-ink shadow-soft">←</button><h1 className="font-golden text-[24px] leading-none">Medals</h1></header>
    <section className="relative mt-3 overflow-hidden rounded-3xl bg-graphite p-5 text-white shadow-lift"><div className="absolute -right-20 -top-24 h-60 w-60 rounded-full bg-award-gold/15 blur-3xl" /><p className="relative text-[11px] font-black tracking-[0.2em] text-award-gold-light">PERFORMANCE CABINET</p><div className="relative mt-3 flex items-end justify-between"><div><p className="font-golden text-6xl leading-none">{earned}</p><p className="mt-1 text-xs font-bold text-white/50">of 12 medals earned</p></div><MedalArt family={families[0]?.key ?? "analyst"} tier={earned >= 12 ? "gold" : earned >= 5 ? "silver" : "bronze"} size={88} /></div></section>
    <div className="mt-3 space-y-3">{families.map((family) => <section key={family.key} className="rounded-2xl bg-white p-5 shadow-soft"><div className="flex items-start justify-between"><div><p className="text-[11px] font-black tracking-[0.16em] text-ink-muted">{family.unit.toUpperCase()}</p><h2 className="mt-1 font-golden text-xl text-ink">{family.name.toUpperCase()}</h2></div><span className="font-golden text-2xl text-ink">{family.value}</span></div><div className="mt-4 grid grid-cols-3 gap-2">{family.milestones.map((medal) => <div key={medal.id} className={`rounded-2xl p-2 text-center ${medal.earned ? "bg-[#F5F0E2]" : "bg-paper"}`}><MedalArt family={family.key} tier={medal.tier} earned={medal.earned} size={66} /><p className="-mt-1 font-golden text-[11px] text-ink">{medal.tier.toUpperCase()}</p><p className="mt-0.5 text-[11px] font-black text-ink-muted">{medal.target} {family.unit}</p></div>)}</div>{family.next && <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-black/[0.06]"><span className="block h-full rounded-full bg-signal-good" style={{ width: `${Math.min(100, family.value / family.next.target * 100)}%` }} /></div>}</section>)}</div>
    {reveal && <div className="fixed inset-0 z-[90] grid place-items-center bg-graphite/90 px-6 backdrop-blur-md"><div className="medal-unlock text-center"><p className="text-[11px] font-black tracking-[0.25em] text-award-gold-light">MEDAL UNLOCKED</p><div className="mt-5 flex justify-center"><MedalArt family={reveal.family.key} tier={reveal.medal.tier} size={170} /></div><p className="mt-3 font-golden text-3xl text-white">{reveal.family.name.toUpperCase()}</p><p className="mt-1 font-golden text-lg text-award-gold-light">{reveal.medal.tier.toUpperCase()}</p><button onClick={() => setReveal(null)} className="btn-press mt-8 w-full rounded-full bg-white py-3.5 text-sm font-black text-ink">ADD TO CABINET</button></div></div>}
  </div>;
}
