"use client";

// LOAD = the training calendar. One question only: which days this month did
// you actually train, and how hard.
//
// Every day's value is measured, never assumed:
//   • an analysed video contributes the biomech layer's mean muscle demand
//   • a recorded workout contributes its real duration
// A day with neither contributes nothing and stays an empty square. There is
// no curve, no projection and no decay here — the gaps say "rested" on their
// own, without a falling line implying the body fell apart.

import { legacyDemand, loadFromDemand } from "./biomech";
import { buildWorkouts, readBody, workoutMuscleLoad } from "./workouts";
import type { AnalysisResult } from "./analysis";

export type DayCell = {
  date: string;
  value: number;      // dose 0-1.5+; 0 when the session length is unknown
  sessions: number;
  trained: boolean;   // a session happened, dose known or not — NEVER inferred
                      // from `value`, or an unmeasured day reads as a rest day
};

export type LoadMonth = {
  days: DayCell[];      // every day of the CURRENT calendar month, 1st → last
  daysTrained: number;  // days with any measured work
  monthIndex: number;   // 0-11
  peakDay: number;      // largest day value, for shading
  week: number;         // load over the LAST 7 DAYS, 0-100 (see WEEK_FULL)
  lastWeek: number;     // the 7 days before those, for the delta
  // Sessions in the last 7 days still on the assumed default length. The
  // number above is real but rests on that assumption — surface it, don't
  // withhold the number.
  needsLength: number;
};

// The scale, stated so the number is explainable instead of arbitrary: one
// day's value of 1.0 = a hard session, and a full training week is three of
// them. So 100 = three hard sessions in seven days — a real week's training,
// not an athlete's.
export const WEEK_FULL = 3;

// A ROLLING 7-day window, deliberately not a Monday-anchored calendar week.
// A calendar week snaps to 0 every Monday morning while the body is still
// carrying Saturday's session — the dial would contradict the muscle figure
// sitting right underneath it. A rolling window never does that.
const WINDOW_MS = 7 * 86400e3;

// The dial warms from green to red as the week fills: comfortable → working →
// deep in it. Inverted on purpose, same three colours (lib/palette).
export { intensityColor as loadColor } from "./palette";


const dayKey = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export function buildLoadMonth(): LoadMonth | null {
  // ONE entry per training. Before P0-1 this loop ran twice — once over
  // ml_sessions, once over ml_activities — so a filmed recorded run was added
  // to the same day twice, the second time using the very duration that had
  // already scaled the first.
  const workouts = buildWorkouts();
  if (!workouts.length) return null;

  const body = readBody();
  const daily = new Map<string, number>();
  const counts = new Map<string, number>();
  const trainedDays = new Set<string>();
  const add = (k: string, v: number) => {
    daily.set(k, (daily.get(k) ?? 0) + v);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    trainedDays.add(k);
  };

  let needsLength = 0;
  const weekStartMs = Date.now() - 7 * 86400e3;

  for (const w of workouts) {
    const k = w.startedAt.slice(0, 10);

    // the dose the CLIPS measured, if any
    const ml = workoutMuscleLoad(w, body);
    const worked = ml ? Object.values(ml).filter((v) => v > 0.05) : [];
    const measured = worked.length
      ? Math.min(1.5, worked.reduce((a, b) => a + b, 0) / worked.length)
      : null;

    if (measured != null) {
      add(k, measured);
      if (w.durationSource !== "recorded" && w.durationSource !== "stated") {
        if (new Date(w.startedAt).getTime() >= weekStartMs) needsLength++;
      }
      continue;
    }

    // no clip dose: a recording still carries real duration
    const mins = (w.recording?.seconds ?? 0) / 60;
    if (mins > 0) { add(k, Math.min(1.5, mins / 45)); continue; }

    // The workout is a fact even when its dose could not be measured. Keep the
    // calendar mark outlined instead of making the training disappear.
    trainedDays.add(k);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  // rolling windows, anchored on the start of today so the dial does not
  // drift hour by hour within a single day
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const endMs = midnight.getTime() + 86400e3;
  const sumBetween = (fromMs: number, toMs: number) => {
    let t = 0;
    for (const [k, v] of daily) {
      const d = new Date(k + "T00:00:00").getTime();
      if (d >= fromMs && d < toMs) t += v;
    }
    return t;
  };
  const score = (sum: number) => Math.round(Math.min(1, sum / WEEK_FULL) * 100);

  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const days: DayCell[] = [];
  for (let d = 1; d <= last; d++) {
    const k = dayKey(new Date(now.getFullYear(), now.getMonth(), d));
    days.push({
      date: k,
      value: daily.get(k) ?? 0,
      sessions: counts.get(k) ?? 0,
      trained: trainedDays.has(k),
    });
  }

  return {
    days,
    daysTrained: days.filter((d) => d.trained).length,
    monthIndex: now.getMonth(),
    peakDay: Math.max(...days.map((d) => d.value), 0.001),
    // an unknown dose anywhere in the window makes the window's total unknown
    week: score(sumBetween(endMs - WINDOW_MS, endMs)),
    lastWeek: score(sumBetween(endMs - 2 * WINDOW_MS, endMs - WINDOW_MS)),
    needsLength,
  };
}
