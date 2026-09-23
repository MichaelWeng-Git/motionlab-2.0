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
    <div className="min-h-full bg-graphite px-5 pt-8 text-white">
      <div className="flex items-center gap-3">
        <Link href="/history" aria-label="Back to progress" className="grid h-10 w-10 place-items-center rounded-full bg-panel text-fg shadow-panel">
          ←
        </Link>
        <h1 className="font-golden text-[26px] leading-none">Your analyses</h1>
      </div>

      {sessions.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-3xl bg-panel p-8 text-center text-fg shadow-panel">
          <span className="grid h-14 w-14 place-items-center rounded-xl bg-inset"><ClapperIcon className="text-signal-good" /></span>
          <p className="mt-3 font-golden text-lg leading-none">NO ANALYSES YET</p>
          <Link href="/analyze" className="btn-press mt-5 w-full rounded-full bg-action py-3 text-sm font-bold text-on-action transition">
            Analyze a video
          </Link>
        </div>
      ) : (
        <div className="mt-5 space-y-3 pb-6">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`relative flex items-center gap-3.5 rounded-2xl bg-panel p-3 text-fg shadow-panel ${
                removing === s.id ? "card-removing" : ""
              }`}
            >
              {/* the WHOLE row opens the report — only the ⋯ menu is separate */}
              <Link href={`/report/${s.id}`} className="flex min-w-0 flex-1 items-center gap-3.5">
                <span className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-well">
                  {s.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.cover} alt={s.action} className="h-full w-full object-cover" />
                  ) : (
                    <span className="grid h-full place-items-center bg-well">
                      <SIcon name={iconFor(s.sport)} size={26} />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold">{s.sport} · {s.action}</p>
                  <p className="text-xs font-semibold text-fg-muted">{timeAgo(s.date)}</p>
                </span>
                <span className="text-right">
                  <p className="font-golden text-lg">{s.score}</p>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-fg-muted">score</p>
                </span>
              </Link>

              {/* ⋯ menu */}
              <button
                onClick={() => setMenuFor(menuFor === s.id ? null : s.id)}
                aria-label="More options"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-fg-muted transition active:bg-inset"
              >
                <DotsIcon />
              </button>
              {menuFor === s.id && (
                <div className="menu-pop absolute right-3 top-14 z-40 w-40 overflow-hidden rounded-2xl bg-sheet text-fg ring-1 ring-inset ring-hair">
                  <button
                    onClick={() => { setMenuFor(null); router.push(`/report/${s.id}`); }}
                    className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-semibold transition active:bg-inset"
                  >
                    <OpenIcon /> Open report
                  </button>
                  <button
                    onClick={() => { setMenuFor(null); setConfirmFor(s.id); }}
                    className="flex w-full items-center gap-2.5 border-t border-hair px-4 py-3 text-left text-sm font-semibold text-signal-work transition active:bg-signal-work/5"
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
          <div className="fixed inset-0 z-[60] bg-graphite/75 backdrop-blur-[2px]" onClick={() => setConfirmFor(null)} />
          <div className="fixed inset-0 z-[61] grid place-items-center px-10">
            <div className="w-full max-w-[340px] animate-pop rounded-3xl bg-sheet p-6 text-center text-fg ring-1 ring-inset ring-hair">
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
                  className="w-full rounded-full bg-track py-3.5 text-[15px] font-bold text-white transition active:scale-[0.98]"
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
