"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CoinIcon } from "@/components/Icons";
import { DAILY_COIN, RING_COIN, getCoinBalance, getCoinHistory, type CoinTransaction } from "@/lib/coins";

export default function CoinsPage() {
  const router = useRouter();
  const [balance, setBalance] = useState(0);
  const [history, setHistory] = useState<CoinTransaction[]>([]);
  useEffect(() => { setBalance(getCoinBalance()); setHistory(getCoinHistory()); }, []);
  return <div className="stagger px-5 pb-10 pt-3">
    <header className="flex items-center gap-2.5"><button onClick={() => router.back()} className="flex h-7 w-11 items-center justify-center rounded-full bg-panel text-[13px] text-fg shadow-panel">←</button><h1 className="font-golden text-[24px] leading-none">Coins</h1></header>
    <section className="relative mt-3 overflow-hidden rounded-3xl bg-graphite p-5 text-white shadow-lift">
      <div className="absolute -right-12 -top-14 h-40 w-40 rounded-full bg-[#F5B23D]/20 blur-3xl" />
      <p className="relative text-[11px] font-black tracking-[0.2em] text-[#F5CF69]">SPENDABLE BALANCE</p>
      <div className="relative mt-4 flex items-center gap-3"><CoinIcon size={42} /><span className="font-golden text-6xl leading-none">{balance}</span></div>
      <button onClick={() => router.push("/tree")} className="btn-press relative mt-6 w-full rounded-full bg-white py-3 text-sm font-black text-ink">OPEN PACK SHOP</button>
    </section>
    <section className="mt-3 rounded-2xl bg-panel p-5 text-fg shadow-panel"><p className="text-[11px] font-black tracking-[0.18em] text-fg-muted">ECONOMY RULES</p><h2 className="mt-1 font-golden text-xl text-fg">HOW TO EARN</h2><div className="mt-4 space-y-2"><Rule label="Train on a new day" value={`+${DAILY_COIN}`} note="Once per calendar day" /><Rule label="Complete a daily goal" value={`+${RING_COIN}`} note="Each Move, Analyse or Workout ring" /><Rule label="Claim the daily road" value="+10–20" note="Sunday reward is 20" /></div></section>
    <section className="mt-3 rounded-2xl bg-panel p-5 text-fg shadow-panel"><div className="flex items-end justify-between"><div><p className="text-[11px] font-black tracking-[0.18em] text-fg-muted">AUDIT</p><h2 className="mt-1 font-golden text-xl text-fg">COIN HISTORY</h2></div><span className="text-[11px] font-black text-fg-muted">LATEST 300</span></div>{history.length ? <div className="mt-4 space-y-2">{history.map((row) => <div key={row.id} className="flex items-center gap-3 rounded-xl bg-inset px-3 py-3"><span className={`grid h-8 w-8 place-items-center rounded-full ${row.amount > 0 ? "bg-award-gold-wash text-ink" : "bg-white/[0.06]"}`}><CoinIcon size={17} /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-black text-fg">{row.label}</p><p className="mt-0.5 block text-[11px] font-bold text-fg-muted">{row.date ? new Date(row.date).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Before transaction history"}</p></div><span className="font-golden text-lg text-fg">{row.amount > 0 ? "+" : ""}{row.amount}</span></div>)}</div> : <div className="mt-4 rounded-xl border border-dashed border-white/15 py-8 text-center"><p className="font-golden text-lg text-fg">NO COIN ACTIVITY</p></div>}</section>
  </div>;
}

function Rule({ label, value, note }: { label: string; value: string; note: string }) { return <div className="flex items-center rounded-xl bg-inset px-3 py-3"><div className="flex-1"><p className="text-xs font-black text-fg">{label}</p><p className="mt-0.5 text-[11px] font-bold text-fg-muted">{note}</p></div><span className="font-golden text-lg text-fg">{value}</span></div>; }
