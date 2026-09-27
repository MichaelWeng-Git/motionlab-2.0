"use client";

import { useMemo, useState } from "react";
import { CoinIcon } from "@/components/Icons";
import { dayKey } from "@/lib/coins";

type NodeState = "claimed" | "today" | "grace" | "missed" | "future";
type Node = { k: string; label: string; state: NodeState; amount: number };

function weekNodes(claims: string[], offset: number): Node[] {
  const today = dayKey();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = dayKey(yesterdayDate);
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + offset * 7);
  return ["M", "T", "W", "T", "F", "S", "S"].map((label, i) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + i);
    const k = dayKey(date);
    const state: NodeState = claims.includes(k) ? "claimed" : k === today ? "today" : k === yesterday ? "grace" : k < today ? "missed" : "future";
    return { k, label, state, amount: i === 6 ? 20 : 10 };
  });
}

export function DailyCoinsTrack({ claims, onClaim }: { claims: string[]; onClaim: (k: string, amount: number) => void }) {
  const [week, setWeek] = useState(0);
  const [claimedNow, setClaimedNow] = useState<string | null>(null);
  const nodes = useMemo(() => weekNodes(claims, week), [claims, week]);
  const claimed = nodes.filter((n) => n.state === "claimed");
  const reward = nodes.find((n) => n.state === "today") ?? nodes.find((n) => n.state === "grace");
  const earned = claimed.reduce((sum, n) => sum + n.amount, 0);

  function claim(node: Node) {
    if (node.state !== "today" && node.state !== "grace") return;
    onClaim(node.k, node.amount);
    setClaimedNow(node.k);
    window.setTimeout(() => setClaimedNow(null), 650);
  }

  return (
    <section className="relative mt-4 overflow-hidden rounded-3xl bg-panel p-5 text-fg shadow-panel">
      <header className="flex items-center justify-between">
        <div>
          <p className="font-golden text-2xl leading-none text-fg">DAILY COINS</p>
          <p className="mt-1 text-[12px] font-bold text-fg-muted">Show up. Claim once.</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-inset px-3 py-2">
          <CoinIcon size={16} />
          <span className="font-golden text-lg leading-none tabular-nums text-fg">{earned}</span>
        </div>
      </header>

      <div className="mt-5 grid grid-cols-7 gap-2">
        {nodes.map((node) => {
          const claimable = week === 0 && (node.state === "today" || node.state === "grace");
          const complete = node.state === "claimed" || claimedNow === node.k;
          return (
            <button
              key={node.k}
              disabled={!claimable}
              onClick={() => claim(node)}
              aria-label={claimable ? `Claim ${node.amount} coins` : node.label}
              className={`flex min-w-0 flex-col items-center gap-2 rounded-xl py-2.5 transition active:scale-95 ${claimable ? "bg-award-gold/15 text-fg" : node.state === "missed" ? "opacity-35" : ""}`}
            >
              <span className={`grid h-9 w-9 place-items-center rounded-full border-2 ${complete ? "border-award-gold bg-award-gold" : claimable ? "border-award-gold bg-inset" : "border-hair bg-inset"}`}>
                {/* dark tick: white on award-gold is ~1.9:1, the same mistake as the pack label */}
                {complete ? (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#14181B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4 10-10" /></svg>
                ) : (
                  <span className="font-golden text-[13px] text-fg-soft">{node.amount}</span>
                )}
              </span>
              <span className="text-[11px] font-extrabold text-fg-muted">{node.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3 border-t border-hair pt-4">
        <button onClick={() => setWeek((value) => value === 0 ? -1 : 0)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-inset text-lg font-bold text-fg transition active:scale-95" aria-label={week === 0 ? "Show last week" : "Show this week"}>
          {week === 0 ? "‹" : "›"}
        </button>
        {week === 0 && reward ? (
          <button onClick={() => claim(reward)} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-action text-sm font-extrabold text-on-action active:scale-[0.98]">
            <CoinIcon size={17} /> Claim {reward.amount}
          </button>
        ) : (
          <div className="flex h-11 flex-1 items-center justify-center rounded-full bg-inset text-[12px] font-extrabold text-fg-muted">
            {week === 0 ? "TODAY CLAIMED" : "LAST WEEK"}
          </div>
        )}
      </div>
    </section>
  );
}
