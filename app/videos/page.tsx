"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { deleteSession, getSessions, type Session } from "@/lib/stats";
import { ClapperIcon } from "@/components/Icons";
import { SIcon, type SIconName } from "@/components/SIcon";

const SPORT_ICON: Record<string, SIconName> = {
  Running: "run", Tennis: "tennis", Swimming: "swim", Basketball: "basketball",
  Golf: "golf", Cycling: "ride", Strength: "strength", Practice: "clapper",
};
const iconFor = (sport: string): SIconName =>
  SPORT_ICON[sport] ?? SPORT_ICON[Object.keys(SPORT_ICON).find((k) => sport.includes(k)) ?? ""] ?? "clapper";

export default function Videos() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    setSessions(getSessions().sort((a, b) => b.date.localeCompare(a.date)));
  }, []);

  function reallyDelete(id: string) {
    setConfirmFor(null);
    setRemoving(id);
    setTimeout(() => {
      deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setRemoving(null);
    }, 340);
  }

  const confirmSession = sessions.find((s) => s.id === confirmFor);

  return (
    <div className="px-5 pt-8">
      <div className="flex items-center gap-3">
        <Link href="/history" className="grid h-9 w-9 place-items-center rounded-full bg-white text-ink shadow-soft">
          ←
        </Link>
        <h1 className="font-golden text-[26px] leading-none">Your analyses</h1>
      </div>

      {sessions.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-3xl bg-white p-8 text-center shadow-soft">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-paper"><ClapperIcon className="text-volt-deep" /></span>
          <p className="mt-3 text-sm font-bold">No analyses yet</p>
          <Link href="/analyze" className="btn-press mt-5 w-full rounded-full bg-ink py-3 text-sm font-bold text-white transition">
            Analyze a video
          </Link>
        </div>
      ) : (
        <div className="mt-5 space-y-3 pb-6">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`relative flex items-center gap-3.5 rounded-3xl bg-white p-3 shadow-soft ${
                removing === s.id ? "card-removing" : ""
              }`}
            >
              {/* the WHOLE row opens the report — only the ⋯ menu is separate */}
              <Link href={`/report/${s.id}`} className="flex min-w-0 flex-1 items-center gap-3.5">
                <span className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-ink">
                  {s.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.cover} alt={s.action} className="h-full w-full object-cover" />
                  ) : (
                    <span className="grid h-full place-items-center bg-ink">
                      <SIcon name={iconFor(s.sport)} size={26} />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold">{s.sport} · {s.action}</p>
                  <p className="text-xs font-semibold text-ink-muted">{timeAgo(s.date)}</p>
                </span>
                <span className="text-right">
                  <p className="font-golden text-lg">{s.score}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">score</p>
                </span>
              </Link>

              {/* ⋯ menu */}
              <button
                onClick={() => setMenuFor(menuFor === s.id ? null : s.id)}
                aria-label="More options"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted transition active:bg-black/[0.05]"
              >
                <DotsIcon />
              </button>
              {menuFor === s.id && (
                <div className="menu-pop absolute right-3 top-14 z-40 w-40 overflow-hidden rounded-2xl bg-white shadow-lift">
                  <button
                    onClick={() => { setMenuFor(null); router.push(`/report/${s.id}`); }}
                    className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-semibold transition active:bg-black/[0.04]"
                  >
                    <OpenIcon /> Open report
                  </button>
                  <button
                    onClick={() => { setMenuFor(null); setConfirmFor(s.id); }}
                    className="flex w-full items-center gap-2.5 border-t border-black/5 px-4 py-3 text-left text-sm font-semibold text-signal-work transition active:bg-signal-work/5"
                  >
                    <TrashIcon /> Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* click-away */}
      {menuFor !== null && (
        <button aria-label="Close" onClick={() => setMenuFor(null)} className="fixed inset-0 z-30 cursor-default" />
      )}

      {/* delete confirm — dead center */}
      {confirmSession && (
        <>
          <div className="fixed inset-0 z-[60] bg-ink/50 backdrop-blur-[2px]" onClick={() => setConfirmFor(null)} />
          <div className="fixed inset-0 z-[61] grid place-items-center px-10">
            <div className="w-full max-w-[340px] animate-pop rounded-3xl bg-paper p-6 text-center shadow-lift">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-signal-work/12 text-signal-work">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
              </span>
              <p className="mt-3 text-base font-extrabold">Delete &ldquo;{confirmSession.sport} · {confirmSession.action}&rdquo;?</p>
              <div className="mt-5 space-y-2.5">
                <button
                  onClick={() => reallyDelete(confirmSession.id)}
                  className="btn-press-work w-full rounded-full bg-signal-work py-3.5 text-[15px] font-extrabold text-white transition"
                >
                  Yes, delete
                </button>
                <button
                  onClick={() => setConfirmFor(null)}
                  className="w-full rounded-full bg-white py-3.5 text-[15px] font-bold text-ink transition active:scale-[0.98]"
                >
                  Keep it
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function DotsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}
function OpenIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}
