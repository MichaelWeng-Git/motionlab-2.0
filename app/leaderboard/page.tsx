"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { SIcon, type SIconName } from "@/components/SIcon";
import { FriendsIcon } from "@/components/Icons";
import { LevelBadge } from "@/components/XpLevel";
import { fetchFriends, iconOf, syncMe, type Person } from "@/lib/friends";
import { getProfile, type Profile } from "@/lib/profile";
import { getStats } from "@/lib/stats";

type Row = { id: string; name: string; xp: number; me: boolean; icon?: SIconName; photo?: string | null };

export default function Leaderboard() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>({});
  const [name, setName] = useState("You");
  const [xp, setXp] = useState(0);
  const [friends, setFriends] = useState<Person[]>([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const p = getProfile(); setProfile(p); setName(p.name || (localStorage.getItem("ml_google_name") ?? "").split(" ")[0] || "You"); setXp(getStats().xp);
    try { setFriends(JSON.parse(localStorage.getItem("ml_friends_cache") ?? "[]")); } catch {}
    syncMe(); fetchFriends().then((state) => { if (state) { setFriends(state.friends); localStorage.setItem("ml_friends_cache", JSON.stringify(state.friends)); } });
    const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer);
  }, []);
  const rows = useMemo<Row[]>(() => [{ id: "me", name, xp, me: true }, ...friends.map((f) => ({ id: f.id, name: f.name, xp: f.xp, me: false, icon: iconOf(f), photo: f.photo }))].sort((a, b) => b.xp - a.xp), [friends, name, xp]);
  const myIndex = rows.findIndex((r) => r.me);
  const rival = myIndex > 0 ? { row: rows[myIndex - 1], delta: rows[myIndex - 1].xp - xp, ahead: true } : rows[1] ? { row: rows[1], delta: xp - rows[1].xp, ahead: false } : null;
  const podiumOrder = [rows[1], rows[0], rows[2]].filter(Boolean) as Row[];
  return <div className="stagger px-5 pb-10 pt-3">
    <header className="flex items-center gap-2.5"><button onClick={() => router.back()} className="flex h-7 w-11 items-center justify-center rounded-full bg-panel text-[13px] text-fg shadow-panel">←</button><h1 className="font-golden text-[24px] leading-none">Leaderboard</h1></header>
    <section className="relative mt-3 overflow-hidden rounded-3xl bg-graphite p-5 text-white shadow-lift"><div className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-award-gold/15 blur-3xl" /><div className="relative flex items-start justify-between"><div><p className="text-[11px] font-black tracking-[0.2em] text-award-gold-light">ALL-TIME XP</p><h2 className="mt-1 font-golden text-3xl">TRAINING LEAGUE</h2></div><div className="text-right"><p className="text-[11px] font-black tracking-wider text-white/40">WEEK ENDS IN</p><p className="mt-1 font-golden text-lg">{weekCountdown(now)}</p></div></div>
      {podiumOrder.length ? <div className="relative mt-7 flex items-end justify-center gap-2">{podiumOrder.map((row) => { const rank = rows.indexOf(row) + 1; return <div key={row.id} className={`flex w-[30%] flex-col items-center ${rank === 1 ? "order-2" : rank === 2 ? "order-1" : "order-3"}`}><span className={`mb-2 grid place-items-center overflow-hidden rounded-full bg-white/10 ring-2 ${rank === 1 ? "h-16 w-16 ring-award-gold" : "h-12 w-12 ring-white/25"}`}><RowAvatar row={row} profile={profile} /></span><p className="w-full truncate text-center text-[11px] font-black">{row.name}</p><p className="mt-0.5 font-golden text-sm text-white/60">{row.xp} XP</p><div className={`mt-2 grid w-full place-items-center rounded-t-xl font-golden ${rank === 1 ? "h-16 bg-award-gold text-ink" : rank === 2 ? "h-11 bg-white/20" : "h-8 bg-white/10"}`}>{rank}</div></div>; })}</div> : null}
    </section>
    {rival && <section className="mt-3 rounded-2xl bg-panel p-4 text-fg shadow-panel"><div className="flex items-center justify-between"><div><p className="text-[11px] font-black tracking-[0.16em] text-fg-muted">CLOSEST RIVAL</p><p className="mt-1 text-sm font-black text-fg">{rival.row.name}</p></div><p className="font-golden text-lg text-fg">{rival.ahead ? `${rival.delta} XP AHEAD` : `${rival.delta} XP BEHIND`}</p></div><div className="relative mt-5 h-5"><span className="absolute left-0 right-0 top-2 h-px bg-hair" /><span className="absolute top-0 grid h-5 w-5 -translate-x-1/2 place-items-center rounded-full bg-signal-good text-[11px] font-black text-white" style={{ left: `${Math.max(4, xp / Math.max(xp, rival.row.xp, 1) * 92)}%` }}>Y</span><span className="absolute top-0 grid h-5 w-5 -translate-x-1/2 place-items-center rounded-full bg-award-gold text-[11px] font-black text-ink" style={{ left: `${Math.max(4, rival.row.xp / Math.max(xp, rival.row.xp, 1) * 92)}%` }}>R</span></div></section>}
    <section className="mt-3 overflow-hidden rounded-2xl bg-panel text-fg shadow-panel"><div className="flex items-end justify-between px-5 pb-3 pt-5"><div><p className="text-[11px] font-black tracking-[0.18em] text-fg-muted">FULL TABLE</p><h2 className="mt-1 font-golden text-xl text-fg">XP RANKING</h2></div><span className="text-[11px] font-black text-fg-muted">{rows.length} ATHLETES</span></div>{rows.map((row, i) => <div key={row.id} className={`flex items-center gap-3 px-4 py-3 ${i ? "border-t border-hair" : ""} ${row.me ? "bg-signal-good/10" : ""}`}><span className="w-6 text-center font-golden text-base text-fg-muted">{i + 1}</span><span className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-inset"><RowAvatar row={row} profile={profile} /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-black text-fg">{row.name}{row.me && <span className="ml-1 text-[11px] text-fg-muted">YOU</span>}</p><div className="mt-1"><LevelBadge xp={row.xp} compact /></div></div><span className="font-golden text-base text-fg">{row.xp}</span></div>)}</section>
    <Link href="/friends" className="mt-3 flex items-center justify-center gap-2 rounded-full bg-action py-3.5 text-sm font-black text-on-action shadow-panel"><FriendsIcon size={17} />MANAGE FRIENDS</Link>
  </div>;
}

function RowAvatar({ row, profile }: { row: Row; profile: Profile }) { if (row.me) return <Avatar p={profile} iconSize={28} />; if (row.photo) return <img src={row.photo} alt="" className="h-full w-full object-cover" />; return <SIcon name={row.icon ?? "tennis"} size={28} />; }
function weekCountdown(nowMs: number) { const now = new Date(nowMs), end = new Date(now); end.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7)); end.setHours(0, 0, 0, 0); const mins = Math.max(0, Math.floor((end.getTime() - nowMs) / 60_000)); return `${Math.floor(mins / 1440)}D ${Math.floor((mins % 1440) / 60)}H`; }
