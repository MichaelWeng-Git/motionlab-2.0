"use client";

// Streak — Whoop-style detail page behind the flame chip.
// A day counts when you OPEN the app (same login streak as the top-bar flame —
// one source of truth, lib/streak). The flame LEVELS UP every 10 days
// (hotter colors + glow, see components/Flame).

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Flame, flameLevel } from "@/components/Flame";
import { getStreakInfo } from "@/lib/streak";
import { dayKey } from "@/lib/date";

// milestone timeline — grows forever: base nodes, +10 days at a time once
// you pass the end, and always ONE faded "ghost" target below to chase
const BASE_NODES = [
  { n: 1, label: "First spark" },
  { n: 10, label: "10 days" },
  { n: 20, label: "20 days" },
  { n: 30, label: "30 days" },
];

function buildNodes(best: number) {
  const nodes = [...BASE_NODES];
  while (best >= nodes[nodes.length - 1].n) {
    const n = nodes[nodes.length - 1].n + 10;
    nodes.push({ n, label: `${n} days` });
  }
  return nodes;
}

export default function Streak() {
  const router = useRouter();
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [days, setDays] = useState<{ label: string; key: string; active: boolean; today: boolean }[]>([]);

  useEffect(() => {
    localStorage.setItem("ml_seen_flame", "1"); // they found the flame themselves
    const info = getStreakInfo();
    setStreak(info.count);
    setBest(info.max);

    // last 7 days, oldest → today — lit iff that day is part of the streak
    const out: { label: string; key: string; active: boolean; today: boolean }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dayKey(d);
      out.push({ label: "SMTWTFS"[d.getDay()], key, active: info.litDays.has(key), today: i === 0 });
    }
    setDays(out);
  }, []);

  const nodes = buildNodes(best);
  const ghost = { n: nodes[nodes.length - 1].n + 10 }; // the faded next target
  const reachedCount = nodes.filter((m) => best >= m.n).length;

  return (
    <div className="stagger px-5 pb-8 pt-8">
      <div className="flex items-center gap-3">
        <button
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          className="grid h-9 w-9 place-items-center rounded-full bg-white text-ink shadow-soft"
        >
          ←
        </button>
        <h1 className="font-golden text-[26px] leading-none">STREAK</h1>
      </div>

      {/* hero — consistency, framed like a training status rather than a toy counter */}
      <div className="relative mt-5 overflow-hidden rounded-3xl bg-graphite p-5 text-white shadow-lift">
        <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-[#FF6A16]/15 blur-3xl" />
        <p className="relative font-golden text-[13px] leading-none text-[#FFB44D]">SHOW-UP STREAK</p>
        <div className="relative mt-3 flex items-center justify-between">
          <div><p className="font-golden text-7xl leading-none tabular-nums">{streak}</p><p className="mt-1 text-xs font-bold text-white/50">{streak === 1 ? "day in a row" : "days in a row"}</p></div>
          <Flame size={92} lit={streak > 0} level={flameLevel(streak)} />
        </div>
        <div className="relative mt-5 flex items-center justify-between border-t border-white/15 pt-3"><span className="text-[11px] font-bold text-white/65">PERSONAL BEST</span><span className="font-golden text-lg text-white">{best} {best === 1 ? "DAY" : "DAYS"}</span></div>
      </div>

      {/* last 7 days */}
      <div className="mt-4 rounded-2xl bg-white p-4 shadow-soft">
        <div className="flex items-end justify-between"><h2 className="font-golden text-xl leading-none text-ink">LAST 7 DAYS</h2><span className="text-[11px] font-bold text-ink-muted">APP CHECK-IN</span></div>
        <div className="relative mt-4 grid grid-cols-7 before:absolute before:left-[7%] before:right-[7%] before:top-5 before:h-px before:bg-black/10">
          {days.map((d) => (
            <div key={d.key} className="flex flex-col items-center gap-1.5">
              <span
                className={`relative z-10 grid h-10 w-10 place-items-center rounded-full ${
                  d.active ? "bg-[#FFF1DC]" : "bg-black/[0.04]"
                } ${d.today ? "ring-2 ring-ink/70" : ""}`}
              >
                <Flame size={22} lit={d.active} level={flameLevel(streak)} />
              </span>
              <span className={`text-[11px] text-ink ${d.today ? "font-extrabold" : "font-semibold"}`}>
                {d.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* the tree — tap in to decorate. Big tree left, big words filling the right. */}
      <Link
        href="/tree"
        className="press mt-4 flex items-center gap-5 rounded-3xl bg-white px-6 py-6 shadow-soft"
      >
        <MiniTree size={72} />
        <span className="flex-1 text-right font-golden text-[26px] leading-[1.15] text-ink">
          Decorate my&nbsp;tree
        </span>
        <span className="text-lg font-bold text-ink">›</span>
      </Link>

      {/* milestones — a timeline; the flame burns hotter at every node, and a
          faded ghost target always waits below the last one */}
      <div className="mt-4 rounded-2xl bg-white p-5 shadow-soft">
        <p className="text-[11px] font-bold text-ink-muted">CONSISTENCY PATH</p>
        <h2 className="mt-1 font-golden text-2xl leading-none text-ink">MILESTONES</h2>
        <div className="relative mt-4">
          {/* spine + progress fill */}
          <span className="absolute bottom-6 left-[22px] top-1 w-[3px] rounded-full bg-black/[0.07]" />
          {reachedCount > 0 && (
            <span
              className="absolute left-[22px] top-1 w-[3px] rounded-full bg-gradient-to-b from-[#FFB93D] to-[#FF5A1F]"
              style={{ height: `${Math.min(100, ((reachedCount - 0.5) / (nodes.length + 1)) * 100)}%` }}
            />
          )}
          <div className="space-y-5">
            {nodes.map((m, i) => {
              const reached = best >= m.n;
              const next = !reached && (i === 0 || best >= nodes[i - 1].n);
              return (
                <div key={m.n} className="relative flex items-center gap-4">
                  <span
                    className={`relative z-10 grid h-12 w-12 shrink-0 place-items-center rounded-full border ${
                      reached
                        ? "border-[#F5B23D]/50 bg-[#FFF1DC] shadow-soft"
                        : "border-black/5 bg-paper"
                    }`}
                  >
                    <MilestoneMark index={i} reached={reached} />
                  </span>
                  <p className="flex-1 text-[15px] font-extrabold text-ink">{m.label}</p>
                  {reached ? (
                    <span className="rounded-full bg-[#FFF1DC] px-2.5 py-1 text-[11px] font-bold text-[#C25A12]">
                      Reached
                    </span>
                  ) : next ? (
                    <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-bold text-ink">
                      {m.n - best} to go
                    </span>
                  ) : null}
                </div>
              );
            })}
            {/* the ghost — a faded glimpse of what comes next */}
            <div className="relative flex items-center gap-4 opacity-40">
              <span className="relative z-10 grid h-12 w-12 shrink-0 place-items-center rounded-full border border-dashed border-black/20 bg-paper">
                <MilestoneMark index={nodes.length} reached={false} />
              </span>
              <p className="flex-1 text-[15px] font-extrabold text-ink">{ghost.n} days</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MilestoneMark({ index, reached }: { index: number; reached: boolean }) {
  const color = reached ? "#D66A18" : "#87928B";
  const kind = Math.min(3, index);
  return <svg width="27" height="27" viewBox="0 0 32 32" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    {kind === 0 && <><path d="M7 23c5-1 7-5 8-12 4 5 6 8 10 9-2 5-7 7-12 7H7z" /><path d="M8 22h7M13 17l4 2" /></>}
    {kind === 1 && <><circle cx="16" cy="16" r="10" /><path d="M16 9v14M12 12l4-3 4 3" /></>}
    {kind === 2 && <><path d="M8 24V11l8-5 8 5v13z" /><path d="m11 18 3 3 7-8" /></>}
    {kind === 3 && <><path d="m6 12 5 4 5-8 5 8 5-4-2 13H8z" /><path d="M9 25h14" /></>}
  </svg>;
}

// a real little Christmas tree — colored tiers, star, ornaments
function MiniTree({ size = 46 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * (52 / 46))} viewBox="0 0 46 52">
      <path d="M23 2.5l1.9 3.9 4.3.6-3.1 3 .7 4.2-3.8-2-3.8 2 .7-4.2-3.1-3 4.3-.6L23 2.5z" fill="#F5B23D" />
      <path d="M23 12 13 26h20L23 12z" fill="#4FA372" />
      <path d="M23 19 9 36h28L23 19z" fill="#35855A" />
      <path d="M23 27 5 46h36L23 27z" fill="#2A6B48" />
      <rect x="20" y="46" width="6" height="5" rx="1.5" fill="#6B4A2E" />
      <circle cx="19" cy="24" r="2.2" fill="#FF5A5F" />
      <circle cx="27" cy="30" r="2.2" fill="#12C6D4" />
      <circle cx="15" cy="38" r="2.2" fill="#F5B23D" />
      <circle cx="24" cy="41" r="2.2" fill="#FF8AB3" />
      <circle cx="31" cy="39" r="2.2" fill="#FFF6DC" />
    </svg>
  );
}
