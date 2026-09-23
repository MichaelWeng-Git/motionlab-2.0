"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { findActivity, type StoredActivity } from "@/lib/activities";
import { distanceUnit, distanceValue, getPreferences, type UnitSystem } from "@/lib/preferences";

const RouteMap = dynamic(() => import("@/components/LiveMap").then((module) => module.LiveMap), { ssr: false });

export default function ActivityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [activity, setActivity] = useState<StoredActivity | null | undefined>(undefined);
  const [units, setUnits] = useState<UnitSystem>("metric");

  useEffect(() => {
    setActivity(findActivity(id)?.activity ?? null);
    setUnits(getPreferences().units);
  }, [id]);

  if (activity === undefined) return <div className="px-5 pt-6"><div className="skel h-[520px] rounded-2xl" /></div>;
  if (!activity) return <div className="px-5 pt-8"><Link href="/activities" className="grid h-9 w-9 place-items-center rounded-full bg-panel text-fg shadow-panel">←</Link><section className="mt-6 rounded-2xl bg-panel p-6 text-center text-fg shadow-panel"><h1 className="font-golden text-[24px] leading-none">ACTIVITY NOT FOUND</h1><Link href="/activities" className="mt-5 inline-flex rounded-full bg-action px-5 py-3 text-sm font-bold text-on-action">Back to activities</Link></section></div>;

  const isGps = activity.mode === "gps" || (!activity.mode && (!!activity.path?.length || (activity.meters ?? 0) > 0));
  const hasMeasuredElevation = activity.elevMeasured === true || (activity.elevGain ?? 0) > 0;
  const hasRoute = isGps && !!activity.path && activity.path.length > 1;
  const distance = distanceValue(activity.meters ?? 0, units);
  const unit = distanceUnit(units);
  const paceSeconds = activity.meters && activity.meters > 0 ? activity.seconds / distance : null;
  const pace = paceSeconds != null && Number.isFinite(paceSeconds) ? `${Math.floor(paceSeconds / 60)}:${String(Math.round(paceSeconds % 60)).padStart(2, "0")}` : null;
  const isRide = activity.sport === "Ride" || activity.sport === "Cycling";
  const averageSpeed = activity.meters && activity.seconds > 0
    ? ((activity.meters / activity.seconds) * (units === "imperial" ? 2.23694 : 3.6)).toFixed(1)
    : null;
  const duration = `${Math.floor(activity.seconds / 60)}:${String(activity.seconds % 60).padStart(2, "0")}`;

  return <div className="stagger pb-10">
    <header className="flex items-center gap-3 px-5 pt-6"><Link href="/activities" className="grid h-9 w-9 place-items-center rounded-full bg-panel text-fg shadow-panel">←</Link><div className="min-w-0"><p className="text-[11px] font-black uppercase tracking-[0.16em] text-fg-muted">{activity.sport}</p><h1 className="truncate font-golden text-[24px] leading-none">{activity.name ?? activity.sport}</h1></div></header>

    <section className="mt-4 overflow-hidden bg-graphite text-white shadow-lift">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {activity.thumb ? <img src={activity.thumb} alt="Recorded route" className="h-64 w-full object-cover" /> : hasRoute ? <RouteMap center={activity.path![0]} path={activity.path!} fit interactive={false} className="h-64 w-full" /> : <div className="grid h-40 place-items-center"><p className="text-sm font-bold text-white/60">{isGps ? "No GPS route was recorded" : "Timed activity"}</p></div>}
      <div className="px-5 py-5"><p className="text-sm font-semibold text-white/65">{new Date(activity.date).toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })}</p><div className={`mt-5 grid ${isGps ? "grid-cols-3" : "grid-cols-1"}`}>
        <Metric value={duration} label="TIME" />
        {isGps && <Metric value={(activity.meters ?? 0) > 0 ? distance.toFixed(2) : "—"} unit={unit.toUpperCase()} label="DISTANCE" />}
        {isGps && <Metric value={isRide ? averageSpeed ?? "—" : pace ?? "—"} unit={isRide ? `${unit}/H` : `/${unit}`} label={isRide ? "AVG SPEED" : "AVG PACE"} />}
      </div></div>
    </section>

    {(activity.exertion != null || hasMeasuredElevation || activity.kcal != null) && <section className="mx-5 mt-4 rounded-2xl bg-panel p-5 text-fg shadow-panel"><h2 className="font-golden text-[18px] leading-none">SESSION DETAILS</h2><div className="mt-4 grid grid-cols-3 gap-2">
      {activity.exertion != null && <SmallMetric value={`${activity.exertion}/10`} label="Effort" />}
      {hasMeasuredElevation && isGps && <SmallMetric value={`${Math.round(activity.elevGain ?? 0)} m`} label="Elevation" />}
      {activity.kcal != null && <SmallMetric value={`${Math.round(activity.kcal)}`} label="Est. kcal" />}
    </div></section>}

    {activity.splits && activity.splits.length > 0 && <section className="mx-5 mt-4 rounded-2xl bg-panel p-5 text-fg shadow-panel"><h2 className="font-golden text-[18px] leading-none">SPLITS</h2><div className="mt-3 divide-y divide-hair">{activity.splits.map((split, index) => { const n = split.n ?? split.km ?? index + 1; const splitUnit = split.unit ?? "km"; return <div key={`${splitUnit}-${n}`} className="flex items-center justify-between py-3"><span className="text-sm font-bold uppercase text-fg">{splitUnit} {n}</span><span className="font-golden text-lg text-fg">{Math.floor(split.seconds / 60)}:{String(split.seconds % 60).padStart(2, "0")}</span></div>; })}</div></section>}

    {activity.description && <section className="mx-5 mt-4 rounded-2xl bg-panel p-5 text-fg"><h2 className="font-golden text-[18px] leading-none">NOTES</h2><p className="mt-3 text-[13px] font-semibold leading-relaxed text-fg">{activity.description}</p></section>}
  </div>;
}

function Metric({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return <div className="text-center"><p className="font-golden text-[28px] leading-none">{value}{unit && <span className="ml-1 font-sans text-[11px] font-bold text-white/55">{unit}</span>}</p><p className="mt-2 text-[11px] font-black tracking-[0.12em] text-fg-muted">{label}</p></div>;
}

function SmallMetric({ value, label }: { value: string; label: string }) {
  return <div className="rounded-xl bg-inset px-2 py-3 text-center"><p className="font-golden text-xl leading-none text-fg">{value}</p><p className="mt-1 text-[11px] font-bold text-fg-muted">{label}</p></div>;
}
