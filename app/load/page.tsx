"use client";

// LOAD — two honest halves:
//   1. the month's training calendar (which days, how hard) — measured
//   2. the body RIGHT NOW, from the exact same source the Home MUSCLES card
//      reads (lib/muscles). Same numbers, same decay: open Home and open this
//      page and the two figures always agree.
// Tap a muscle row to isolate it on the figure.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { buildLoadMonth, loadColor, type LoadMonth } from "@/lib/fitness";
import { Gauge } from "@/components/Gauge";
import {
  fetchMuscleState, getCachedMuscleState, getRecoveryState, recoveryStateText,
  recoveryColor, toLR, type MuscleState,
} from "@/lib/muscles";
import { SURFACE } from "@/lib/palette";

const MuscleBody3D = dynamic(() => import("@/components/MuscleBody3D").then((m) => m.MuscleBody3D), {
  ssr: false,
  loading: () => <span className="block" style={{ width: 210 * 0.66, height: 210 }} />,
});

// the app's one graphite ground — lib/palette SURFACE.graphite
const MINT = "#7FD9AE";

// Plain words, written out in full — "Right Arm", never "arms_r" or "Arms R".
// Sided groups use the singular so the side reads naturally in front of it.
const PLAIN: Record<string, string> = {
  quads: "Front Thigh", hamstrings: "Back Thigh", glutes: "Glute", calves: "Calf",
  arms: "Arm", shoulders: "Shoulder", chest: "Chest", core: "Core", back: "Back",
};
const niceName = (k: string) => {
  const base = k.replace(/_[lr]$/, "");
  const side = k.endsWith("_l") ? "Left " : k.endsWith("_r") ? "Right " : "";
  return side + (PLAIN[base] ?? base);
};

const MONTH = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY",
  "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export default function LoadPage() {
  const router = useRouter();
  const [month, setMonth] = useState<LoadMonth | null>(null);
  const [muscles, setMuscles] = useState<MuscleState | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    try { setMonth(buildLoadMonth()); } catch { setMonth(null); }
    setMuscles(getCachedMuscleState());          // instant paint
    fetchMuscleState().then((m) => m && setMuscles(m)).catch(() => {});
  }, []);

  const load = muscles?.load ?? null;
  const rows = load
    ? (Object.entries(toLR(load)) as [string, number][]).filter(([, v]) => v > 0.02).sort((a, b) => b[1] - a[1])
    : [];
  const recovery = getRecoveryState(muscles);
  // tapping a row isolates that muscle on the body; tapping again shows all
  const bodyLoad = picked ? { [picked]: load?.[picked as keyof typeof load] ?? 1 } : (load ?? {});

  const today = todayISO();
  // Monday-first calendar: how many blanks before the 1st falls into place
  const lead = month ? (new Date(month.days[0].date + "T00:00:00").getDay() + 6) % 7 : 0;

  return (
    <div className="stagger px-5 pb-10 pt-3">
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => router.push("/")}
          className="flex h-7 w-11 items-center justify-center rounded-full bg-white text-[13px] leading-none text-ink shadow-soft transition active:scale-95"
        >
          ←
        </button>
        <h1 className="font-golden text-[24px] leading-none">Load</h1>
      </div>

      {!month ? (
        <div className="mt-3 rounded-2xl bg-white p-6 text-center shadow-soft">
          <p className="font-golden text-lg text-ink">NOTHING TO SHOW YET</p>
          <p className="mt-2 text-[13px] font-semibold leading-relaxed text-ink-soft">
            Analyse a video or record a workout and the days start filling in.
          </p>
        </div>
      ) : (
        <>
          {/* the SAME dial the Home LOAD tile shows — identical number */}
          <div className="mt-3 rounded-2xl bg-white px-5 pb-4 pt-5 shadow-soft">
            <div className="mx-auto w-full max-w-[220px]">
              <Gauge
                pct={month.week / 100}
                value={String(month.week)}
                label="LAST 7 DAYS"
                big
                color={loadColor(month.week)}
                valueColor="#17271F"
                labelColor="#51604F"
              />
            </div>
            {month.needsLength > 0 && (
              <p className="mt-2 text-center text-[11px] font-bold text-signal-okay">
                {month.needsLength} recent {month.needsLength === 1 ? "session uses" : "sessions use"} the editable 30 min assumption
              </p>
            )}
          </div>

          {/* THIS MONTH — one square per day, greener = harder */}
          <div className="mt-3 rounded-2xl px-5 pb-5 pt-4 text-white shadow-lift" style={{ background: SURFACE.graphite }}>
            <div className="flex items-baseline justify-between">
              <p className="font-golden text-[15px] leading-none">{MONTH[month.monthIndex]}</p>
              <p className="font-golden text-[15px] leading-none" style={{ color: MINT }}>
                {month.daysTrained}
                <span className="ml-1 text-[10px] text-white/40">
                  {month.daysTrained === 1 ? "DAY" : "DAYS"}
                </span>
              </p>
            </div>

            <div className="mt-3.5 grid grid-cols-7 gap-x-1.5 gap-y-2">
              {WEEKDAYS.map((w, i) => (
                <span key={i} className="pb-1 text-center font-golden text-[9px] leading-none text-white/22">{w}</span>
              ))}
              {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
              {month.days.map((d) => {
                // trained is a FACT (a session exists); value is the dose,
                // which may still be unknown. A day never loses its mark for
                // want of a length.
                const trained = d.trained;
                const dosed = d.value > 0;
                const future = d.date > today;
                const isToday = d.date === today;
                return (
                  <div
                    key={d.date}
                    className="grid aspect-square place-items-center rounded-lg"
                    style={{
                      background: trained && dosed
                        ? `rgba(127,217,174,${0.34 + (d.value / month.peakDay) * 0.66})`
                        : future ? "transparent" : "rgba(255,255,255,0.055)",
                      // trained but dose unknown → outlined, not filled
                      boxShadow: trained && !dosed
                        ? `inset 0 0 0 1.5px ${MINT}`
                        : isToday && !trained ? "inset 0 0 0 1.5px rgba(255,255,255,0.35)" : undefined,
                    }}
                  >
                    <span
                      className="font-golden text-[10px] leading-none"
                      style={{ color: trained && dosed ? SURFACE.graphite : trained ? MINT : future ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.3)" }}
                    >
                      {Number(d.date.slice(8, 10))}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* THE BODY RIGHT NOW — identical source to the Home MUSCLES card */}
          {rows.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-2xl bg-white px-5 py-4 shadow-soft">
              <div className="flex items-baseline justify-between">
                <p className="font-golden text-[13px] leading-none text-ink">{recoveryStateText(recovery).toUpperCase()}</p>
                {picked ? (
                  <button onClick={() => setPicked(null)} className="text-[11px] font-bold text-ink-muted underline-offset-2 hover:underline">
                    show all
                  </button>
                ) : recovery.kind === "known" || recovery.kind === "assumed-duration" ? (
                  <p className="font-golden text-[13px] leading-none" style={{ color: recoveryColor(recovery.pct) }}>{recovery.pct}%</p>
                ) : null}
              </div>
              <div className="mt-1 flex justify-center">
                <MuscleBody3D height={210} load={bodyLoad} />
              </div>
              <div className="mt-1 space-y-[3px]">
                {rows.map(([g, v]) => {
                  const on = picked === g;
                  return (
                    <button
                      key={g}
                      onClick={() => setPicked(on ? null : g)}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-[5px] text-left transition active:scale-[0.99] ${
                        on ? "bg-ink" : "bg-black/[0.035]"
                      }`}
                    >
                      <span className={`w-[100px] shrink-0 whitespace-nowrap text-[10.5px] font-bold ${on ? "text-white" : "text-ink"}`}>
                        {niceName(g)}
                      </span>
                      <span className="h-[5px] flex-1 overflow-hidden rounded-full" style={{ background: on ? "rgba(255,255,255,0.15)" : "rgba(20,24,27,0.08)" }}>
                        <span className="block h-full rounded-full" style={{ width: `${Math.round(v * 100)}%`, background: MINT }} />
                      </span>
                      <span className={`w-7 shrink-0 text-right font-golden text-[11px] ${on ? "text-white" : "text-ink-muted"}`}>
                        {Math.round(v * 100)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {rows.length === 0 && muscles && (
            <div className="mt-3 rounded-2xl bg-white p-5 text-center shadow-soft">
              <p className="text-[13px] font-semibold text-ink-soft">{recoveryStateText(recovery)}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
