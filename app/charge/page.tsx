"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BoltCell } from "@/components/BoltCell";
import { CHARGE_META, getChargeDetail, type ChargeDetail } from "@/lib/charge";
import { DEFAULT_SESSION_MIN } from "@/lib/workouts";
import { getRecoveryState, recoveryStateText, type RecoveryState } from "@/lib/muscles";

const DAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export default function ChargePage() {
  const router = useRouter();
  const [detail, setDetail] = useState<ChargeDetail | null | undefined>(undefined);
  const [recovery, setRecovery] = useState<RecoveryState | null>(null);

  useEffect(() => { setDetail(getChargeDetail()); setRecovery(getRecoveryState()); }, []);

  if (detail === undefined) {
    return <div className="px-5 pt-5"><div className="skel h-[310px] rounded-2xl" /></div>;
  }

  return (
    <div className="stagger px-5 pb-10 pt-3">
      <header className="flex items-center gap-2.5">
        <button onClick={() => router.push("/")} className="flex h-7 w-11 items-center justify-center rounded-full bg-panel text-[13px] text-fg shadow-panel active:scale-95">←</button>
        <h1 className="font-golden text-[24px] leading-none">Charge</h1>
      </header>

      {!detail ? (
        <section className="mt-3 overflow-hidden rounded-2xl bg-graphite ring-1 ring-inset ring-hair p-6 text-white">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-track">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="#7FD9AE"><path d="M13 2.5 5 13.5h5.5L11 21.5l8-11h-5.5L13 2.5z" /></svg>
          </span>
          <h2 className="mt-10 font-golden text-3xl leading-none">BUILD YOUR BASELINE</h2>
          <p className="mt-3 max-w-[280px] text-sm font-semibold leading-relaxed text-white/75">Record or analyse a workout. Charge appears once there is real training history to compare.</p>
          <button onClick={() => router.push("/analyze")} className="btn-press mt-6 w-full rounded-full bg-white py-3 text-sm font-black text-on-action">Analyse a workout</button>
        </section>
      ) : (
        <>
          <section className="relative mt-3 overflow-hidden rounded-2xl bg-graphite ring-1 ring-inset ring-hair p-5 text-white">
            <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full opacity-25 blur-3xl" style={{ background: CHARGE_META[detail.state].color }} />
            <div className="relative flex items-start justify-between">
              <div>
                <p className="text-[11px] font-black tracking-[0.2em] text-white/50">READY TO TRAIN</p>
                <p className="mt-2 font-golden text-6xl leading-none" style={{ color: CHARGE_META[detail.state].color }}>{detail.value}</p>
                <p className="mt-1 font-golden text-xl" style={{ color: CHARGE_META[detail.state].color }}>{CHARGE_META[detail.state].word}</p>
              </div>
              <BoltCell value={detail.value} color={CHARGE_META[detail.state].color} />
            </div>
            <div className="relative mt-4 flex items-center justify-between border-t border-white/10 pt-4">
              <p className="text-sm font-bold text-white">{detail.why}</p>
              <span className="rounded-full px-3 py-1.5 text-[11px] font-black text-ink" style={{ background: CHARGE_META[detail.state].color }}>{CHARGE_META[detail.state].action}</span>
            </div>
          </section>

          <section className="mt-3 rounded-2xl bg-panel p-5 text-fg shadow-panel">
            <div className="flex items-baseline justify-between">
              <h2 className="font-golden text-lg text-fg">LAST 7 DAYS</h2>
              <span className="text-[11px] font-black tracking-wider text-fg-muted">TRAINING / CHARGE</span>
            </div>
            <div className="mt-5 grid grid-cols-7 gap-2">
              {detail.days.map((d) => {
                const date = new Date(`${d.date}T12:00:00`);
                const height = d.minutes > 0 ? Math.max(12, Math.min(64, d.minutes)) : 4;
                return (
                  <div key={d.date} className="text-center">
                    <div className="flex h-20 items-end justify-center">
                      <span className="w-3 rounded-full" style={{ height, background: d.minutes > 0 ? "var(--fg)" : "var(--track)" }} />
                    </div>
                    <p className="mt-2 font-golden text-[11px] text-fg-muted">{DAY[date.getDay()]}</p>
                    <p className="mt-1 font-golden text-[12px]" style={{ color: d.charge == null ? "#AEB6AF" : CHARGE_META[d.charge >= 67 ? "primed" : d.charge >= 34 ? "steady" : "drained"].color }}>{d.charge ?? "—"}</p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mt-3 grid grid-cols-2 gap-3">
            <Metric label="ACUTE LOAD" value={`${Math.round(detail.acuteMinutes)} min`} sub="7-day response" />
            <Metric label="CHRONIC LOAD" value={`${Math.round(detail.chronicMinutes)} min`} sub="28-day baseline" />
          </section>

          <section className="mt-3 rounded-2xl bg-panel p-5 text-fg shadow-panel">
            <h2 className="font-golden text-lg text-fg">WHAT MOVED IT</h2>
            <div className="mt-4 space-y-3">
              <Signal label="Training rhythm" value={detail.consecutiveDays > 0 ? `${detail.consecutiveDays} days running` : "No active streak"} active={detail.consecutiveDays >= 4} />
              <Signal label="Yesterday" value={detail.restedYesterday ? "Rest day" : detail.days[5]?.minutes ? `${detail.days[5].minutes} min trained` : "No recorded training"} active={detail.restedYesterday} />
              <Signal label="Acute : chronic" value={detail.ratio == null ? "Baseline still forming" : `${detail.ratio.toFixed(2)} ×`} active={detail.ratio != null && detail.ratio >= 1.3} />
            </div>
            {detail.assumedWorkouts > 0 && <p className="mt-4 rounded-xl bg-award-gold-wash px-3 py-2 text-center text-[11px] font-bold text-[#8A6217]">{detail.assumedWorkouts} {detail.assumedWorkouts === 1 ? "session uses" : "sessions use"} the editable {DEFAULT_SESSION_MIN} min assumption</p>}
            {recovery && <p className="mt-3 text-center text-[11px] font-bold text-fg-muted">{recoveryStateText(recovery)}{recovery.kind === "known" || recovery.kind === "assumed-duration" ? ` · ${recovery.pct}%` : ""}</p>}
          </section>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="rounded-2xl bg-panel p-4 text-fg shadow-panel"><p className="text-[11px] font-black tracking-[0.16em] text-fg-muted">{label}</p><p className="mt-2 font-golden text-2xl text-fg">{value}</p><p className="mt-1 text-[11px] font-bold text-fg-soft">{sub}</p></div>;
}

function Signal({ label, value, active }: { label: string; value: string; active: boolean }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold text-fg-soft">{label}</span><span className={`rounded-full px-3 py-1.5 text-[11px] font-black ${active ? "bg-award-gold-wash text-ink" : "bg-inset text-fg"}`}>{value}</span></div>;
}
