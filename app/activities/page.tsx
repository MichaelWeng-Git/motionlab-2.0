"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { SIcon, type SIconName } from "@/components/SIcon";
import type { LatLng } from "@/components/LiveMap";
import { distanceUnit, distanceValue, getPreferences, type UnitSystem } from "@/lib/preferences";
import { activityId, deleteActivity, readActivities, type StoredActivity } from "@/lib/activities";

const LeafletMap = dynamic(() => import("@/components/LiveMap").then((m) => m.LiveMap), { ssr: false });

const SPORT_ICON: Record<string, SIconName> = {
  Run: "run", Running: "run", Walk: "run", Walking: "run", Ride: "ride", Cycling: "ride",
  Tennis: "tennis", Swim: "swim", Swimming: "swim", Basketball: "basketball", Golf: "golf",
  Strength: "strength",
};
const iconFor = (sport: string): SIconName =>
  SPORT_ICON[sport] ?? SPORT_ICON[Object.keys(SPORT_ICON).find((k) => sport.includes(k)) ?? ""] ?? "run";

type Act = StoredActivity & {
  emoji?: string;
  stats?: { v: string; l: string }[];
};

export default function Activities() {
  const [acts, setActs] = useState<Act[]>([]);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [confirmFor, setConfirmFor] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null); // raw index mid-animation
  const [units, setUnits] = useState<UnitSystem>("metric");

  useEffect(() => {
    try {
      setActs(readActivities<Act>());
      setUnits(getPreferences().units);
    } catch {}
  }, []);

  function reallyDelete(idx: number) {
    setConfirmFor(null);
    setRemoving(idx);
    // let the collapse animation play, then commit
    setTimeout(() => {
      setActs((prev) => {
        const next = prev.filter((_, i) => i !== idx);
        deleteActivity(idx);
        return next;
      });
      setRemoving(null);
    }, 340);
  }

  const display = acts.map((a, i) => ({ a, i })).sort((x, y) => y.a.date.localeCompare(x.a.date));

  return (
    <div className="px-5 pt-8">
      <div className="flex items-center gap-3">
        <Link
          href="/history"
          className="grid h-9 w-9 place-items-center rounded-full bg-panel text-fg shadow-panel"
        >
          ←
        </Link>
        <h1 className="font-golden text-[26px] leading-none">Your activities</h1>
      </div>

      {display.length === 0 ? (
        <div className="mt-10 flex flex-col items-center text-center">
          <div className="grid h-40 w-full max-w-[260px] place-items-center overflow-hidden rounded-3xl bg-ink shadow-soft">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11z" />
              <circle cx="12" cy="10" r="2.6" />
            </svg>
          </div>
          <p className="mt-5 text-base font-bold">No activities yet</p>
          <Link
            href="/activity"
            className="mt-5 rounded-full bg-action px-6 py-3 text-sm font-bold text-on-action shadow-panel transition active:scale-95"
          >
            Record an activity
          </Link>
        </div>
      ) : (
        <div className="mt-5 space-y-4 pb-6">
          {display.map(({ a, i }) => {
            const mm = String(Math.floor(a.seconds / 60)).padStart(2, "0");
            const ss = String(a.seconds % 60).padStart(2, "0");
            const storedStats = a.stats ?? [];
            const stats = [
              { v: `${mm}:${ss}`, l: "Time" },
              { v: distanceValue(a.meters ?? 0, units).toFixed(2), l: distanceUnit(units) },
              storedStats[2] ?? { v: "—", l: "Measured metric" },
            ];
            const isGps = (a.mode ?? "gps") === "gps";
            return (
              <div
                key={i}
                className={`rounded-3xl bg-panel text-fg shadow-panel ${removing === i ? "card-removing" : ""}`}
              >
                {/* header — NOT clipped, so the ⋯ menu can overflow the card */}
                <div className="relative flex items-center gap-3 px-4 pt-4">
                  <SIcon name={iconFor(a.sport)} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold">{a.name ?? a.sport}</p>
                    <p className="text-xs font-semibold text-fg-muted">{a.sport} · {timeAgo(a.date)}</p>
                    {a.demo && (
                      <span className="mt-1 inline-block rounded-full bg-signal-work/12 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-signal-work">
                        Simulated route
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setMenuFor(menuFor === i ? null : i)}
                    aria-label="More options"
                    className="grid h-8 w-8 place-items-center rounded-full text-fg-muted transition active:bg-inset"
                  >
                    <DotsIcon />
                  </button>
                  {menuFor === i && (
                    <div className="menu-pop absolute right-3 top-12 z-40 w-40 overflow-hidden rounded-2xl bg-sheet text-fg shadow-lift ring-1 ring-inset ring-hair">
                      <button
                        onClick={() => { setMenuFor(null); setConfirmFor(i); }}
                        className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-semibold text-signal-work transition active:bg-signal-work/5"
                      >
                        <TrashIcon /> Delete
                      </button>
                    </div>
                  )}
                </div>

                {/* route + measured summary open the full activity record */}
                <Link href={`/activities/${activityId(a, i)}`} className="mt-3 block h-40 overflow-hidden">
                  {isGps && a.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.thumb} alt="Route" className="h-full w-full object-cover" />
                  ) : isGps && a.path && a.path.length > 1 ? (
                    <LeafletMap center={a.path[0]} path={a.path} fit interactive={false} className="h-full w-full" />
                  ) : isGps ? (
                    <div className="relative grid h-full place-items-center bg-ink">
                      <div className="absolute inset-0 bg-ink" />
                      <span className="relative text-xs font-semibold text-fg-muted">No route recorded</span>
                    </div>
                  ) : (
                    <div className="relative grid h-full place-items-center bg-ink">
                      <div className="absolute inset-0 bg-ink" />
                      <SIcon name={iconFor(a.sport)} size={44} className="relative" />
                    </div>
                  )}
                </Link>

                <Link href={`/activities/${activityId(a, i)}`} className="grid grid-cols-3 divide-x divide-hair py-3.5">
                  {stats.slice(0, 3).map((s) => (
                    <div key={s.l} className="text-center">
                      <p className="text-lg font-extrabold tabular-nums">{s.v}</p>
                      <p className="mt-0.5 text-[11px] font-bold uppercase tracking-widest text-fg-muted">{s.l}</p>
                    </div>
                  ))}
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {/* click-away for the ⋯ popover */}
      {menuFor !== null && (
        <button aria-label="Close" onClick={() => setMenuFor(null)} className="fixed inset-0 z-30 cursor-default" />
      )}

      {/* delete confirm — dead center */}
      {confirmFor !== null && (
        <>
          <div className="fixed inset-0 z-[60] bg-graphite/75 backdrop-blur-[2px]" onClick={() => setConfirmFor(null)} />
          <div className="fixed inset-0 z-[61] grid place-items-center px-10">
            <div className="w-full max-w-[340px] animate-pop rounded-3xl bg-sheet p-6 text-center text-fg shadow-lift ring-1 ring-inset ring-hair">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-signal-work/12 text-signal-work">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
              </span>
              <p className="mt-3 text-base font-extrabold">Delete &ldquo;{acts[confirmFor]?.name ?? acts[confirmFor]?.sport}&rdquo;?</p>
              <div className="mt-5 space-y-2.5">
                <button
                  onClick={() => reallyDelete(confirmFor)}
                  className="btn-press-work w-full rounded-full bg-signal-work py-3.5 text-[15px] font-extrabold text-white transition"
                >
                  Yes, delete
                </button>
                <button
                  onClick={() => setConfirmFor(null)}
                  className="w-full rounded-full bg-inset py-3.5 text-[15px] font-bold text-fg transition active:scale-[0.98]"
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
function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}
