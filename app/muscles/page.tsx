"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MuscleSpin } from "@/components/MuscleMap";
import {
  MUSCLE_NAMES, computeMuscleState, getMuscleContributors, getMuscleHistory, getRecoveryState, recoveryStateText, muscleGroupValue,
  type MuscleContributor, type MuscleHistoryDay, type MuscleKey, type MuscleLoad, type MuscleState,
} from "@/lib/muscles";
import { intensityColor } from "@/lib/palette";

const MuscleBody3D = dynamic(() => import("@/components/MuscleBody3D").then((m) => m.MuscleBody3D), { ssr: false });
const GROUPS: MuscleKey[] = ["shoulders", "chest", "arms", "core", "back", "glutes", "quads", "hamstrings", "calves"];
const SHORT: Record<MuscleKey, string> = { shoulders: "Shoulders", chest: "Chest", arms: "Arms", core: "Core", back: "Back", glutes: "Glutes", quads: "Quads", hamstrings: "Hams", calves: "Calves" };
const DAY = ["S", "M", "T", "W", "T", "F", "S"];

export default function MusclesPage() {
  const router = useRouter();
  const [state, setState] = useState<MuscleState | null | undefined>(undefined);
  const [selected, setSelected] = useState<MuscleKey>("quads");
  const [history, setHistory] = useState<MuscleHistoryDay[]>([]);
  const [contributors, setContributors] = useState<MuscleContributor[]>([]);
  const [has3d, setHas3d] = useState(false);

  useEffect(() => {
    const next = computeMuscleState();
    setState(next);
    if (next && Object.keys(next.load).length) {
      const top = GROUPS.reduce((best, g) => muscleGroupValue(next.load, g) > muscleGroupValue(next.load, best) ? g : best, GROUPS[0]);
      setSelected(top);
    }
    fetch("/muscles/body.glb", { method: "HEAD" }).then((r) => setHas3d(r.ok)).catch(() => setHas3d(false));
  }, []);

  useEffect(() => {
    if (state) {
      setHistory(getMuscleHistory(selected));
      setContributors(getMuscleContributors(selected));
    }
  }, [selected, state]);

  const current = state ? muscleGroupValue(state.load, selected) : 0;
  const recovery = getRecoveryState(state);
  const isolated = useMemo<MuscleLoad>(() => {
    if (!state) return {};
    const rec = state.load as Record<string, number>;
    if (selected === "core" || selected === "back") return { [selected]: rec[selected] ?? 0 };
    return { [`${selected}_l`]: rec[`${selected}_l`] ?? rec[selected] ?? 0, [`${selected}_r`]: rec[`${selected}_r`] ?? rec[selected] ?? 0 };
  }, [selected, state]);

  return (
    <div className="stagger px-5 pb-10 pt-3">
      <header className="flex items-center gap-2.5">
        <button onClick={() => router.push("/")} className="flex h-7 w-11 items-center justify-center rounded-full bg-panel text-[13px] text-fg shadow-panel active:scale-95">←</button>
        <h1 className="font-golden text-[24px] leading-none">Muscles</h1>
      </header>

      {state === undefined ? (
        <div className="skel mt-3 h-[560px] rounded-2xl" />
      ) : !state || recovery.kind === "empty" || recovery.kind === "unmeasured" ? (
        <section className="mt-3 overflow-hidden rounded-2xl bg-graphite p-6 text-white shadow-lift">
          <p className="text-[11px] font-black tracking-[0.18em] text-[#7FD9AE]">MEASURED FROM MOVEMENT</p>
          <h2 className="mt-12 font-golden text-3xl leading-none">NO MUSCLE DATA YET</h2>
          <p className="mt-3 text-sm font-semibold leading-relaxed text-white/75">Analyse a clear full-body video to measure which muscle groups carried the session.</p>
          <button onClick={() => router.push("/analyze")} className="btn-press mt-6 w-full rounded-full bg-white py-3 text-sm font-black text-ink">Analyse movement</button>
          <p className="mt-3 text-center text-[11px] font-bold text-white/50">{recoveryStateText(recovery)}</p>
        </section>
      ) : (
        <>
          <section className="relative mt-3 overflow-hidden rounded-2xl bg-panel px-4 pb-4 pt-5 text-fg shadow-panel">
            <div className="flex items-start justify-between px-1">
              <div>
                <p className="text-[11px] font-black tracking-[0.18em] text-fg-muted">CURRENT LOAD</p>
                <h2 className="mt-1 font-golden text-3xl text-fg">{MUSCLE_NAMES[selected].toUpperCase()}</h2>
              </div>
              <div className="text-right">
                <p className="font-golden text-4xl leading-none" style={{ color: intensityColor(current * 100) }}>{Math.round(current * 100)}</p>
                <p className="text-[11px] font-black tracking-wider text-fg-muted">OUT OF 100</p>
              </div>
            </div>
            <div className="mt-1 flex h-[275px] items-center justify-center">
              {has3d ? <MuscleBody3D height={270} dolly={0.95} load={isolated} /> : <MuscleSpin height={255} load={isolated} />}
            </div>
            <p className="text-center text-[11px] font-bold text-fg-muted">Select a body group below</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {GROUPS.map((g) => {
                const value = muscleGroupValue(state.load, g);
                const on = g === selected;
                return <button key={g} onClick={() => setSelected(g)} className={`rounded-xl px-2 py-2.5 text-left transition active:scale-95 ${on ? "bg-action text-on-action" : "bg-inset text-fg"}`}>
                  <span className="block text-[11px] font-black">{SHORT[g]}</span>
                  <span className="mt-1 block font-golden text-[15px]" style={{ color: on ? "#7FD9AE" : value > 0 ? intensityColor(value * 100) : "#9CA69E" }}>{value > 0 ? Math.round(value * 100) : "—"}</span>
                </button>;
              })}
            </div>
          </section>

          <section className="mt-3 rounded-2xl bg-graphite p-5 text-white shadow-lift">
            <div className="flex items-baseline justify-between">
              <h2 className="font-golden text-lg">14-DAY HISTORY</h2>
              <span className="text-[11px] font-black tracking-wider text-white/45">MEASURED SESSION LOAD</span>
            </div>
            <div className="mt-5 grid grid-cols-14 gap-1.5">
              {history.map((d) => {
                const date = new Date(`${d.date}T12:00:00`);
                const h = d.value == null ? 4 : Math.max(8, d.value * 72);
                return <div key={d.date} className="text-center">
                  <div className="flex h-[76px] items-end"><span className="w-full rounded-full" style={{ height: h, background: d.value == null ? "rgba(255,255,255,.12)" : intensityColor(d.value * 100) }} /></div>
                  <span className="mt-2 block font-golden text-[11px] text-white/40">{DAY[date.getDay()]}</span>
                </div>;
              })}
            </div>
            {!history.some((d) => d.value != null) && <p className="mt-4 text-center text-xs font-bold text-white/55">No measured sessions for this muscle in the last 14 days</p>}
          </section>

          <section className="mt-3 rounded-2xl bg-panel p-5 text-fg shadow-panel">
            <div className="flex items-baseline justify-between">
              <h2 className="font-golden text-lg text-fg">WHAT LOADED IT</h2>
              <span className="text-[11px] font-black tracking-wider text-fg-muted">LAST 14 DAYS</span>
            </div>
            {contributors.length ? (
              <div className="mt-3 divide-y divide-hair">
                {contributors.slice(0, 6).map((item) => {
                  const duration = item.durationS ? `${Math.round(item.durationS / 60)} min` : "30 min assumed";
                  const row = (
                    <div className="flex items-center gap-3 py-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-inset font-golden text-lg" style={{ color: intensityColor(item.value * 100) }}>{Math.round(item.value * 100)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-extrabold text-fg">{item.sport}{item.action ? ` · ${item.action}` : ""}</span>
                        <span className="mt-0.5 block text-[11px] font-bold text-fg-muted">{new Date(item.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {duration}</span>
                      </span>
                      {item.reportId && <span className="font-golden text-lg text-fg-muted">›</span>}
                    </div>
                  );
                  return item.reportId ? <button key={item.id} onClick={() => router.push(`/report/${item.reportId}`)} className="block w-full text-left">{row}</button> : <div key={item.id}>{row}</div>;
                })}
              </div>
            ) : (
              <p className="mt-4 rounded-xl bg-inset px-4 py-5 text-center text-[12px] font-bold text-fg-muted">No measured {MUSCLE_NAMES[selected].toLowerCase()} load in the last 14 days.</p>
            )}
          </section>

          <section className="mt-3 rounded-2xl bg-panel p-4 text-fg shadow-panel">
            <div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold text-fg-soft">{recoveryStateText(recovery)}</span><span className="font-golden text-lg text-fg">{recovery.kind === "known" || recovery.kind === "assumed-duration" ? `${recovery.pct}%` : "—"}</span></div>
            <div className="flex items-center justify-between"><span className="text-xs font-bold text-fg-soft">Measured workouts</span><span className="font-golden text-lg text-fg">{state.measured}</span></div>
            {state.unmeasured > 0 && <div className="mt-3 flex items-center justify-between"><span className="text-xs font-bold text-fg-soft">Without muscle measurement</span><span className="font-golden text-lg text-fg-muted">{state.unmeasured}</span></div>}
            {recovery.kind === "assumed-duration" && <p className="mt-3 rounded-xl bg-award-gold-wash px-3 py-2 text-center text-[11px] font-bold text-[#8A6217]">{recoveryStateText(recovery)} for {recovery.assumedWorkouts} measured {recovery.assumedWorkouts === 1 ? "workout" : "workouts"}</p>}
          </section>
        </>
      )}
    </div>
  );
}
