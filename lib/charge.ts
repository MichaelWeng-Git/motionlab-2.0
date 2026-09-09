// CHARGE — MotionLab's third invented metric (with FORM and LOAD): how much
// training your body can absorb TODAY. WHOOP answers this with overnight HRV;
// with no wearable we answer it with the classic ACWR / Banister family that
// Strava and TrainingPeaks use — acute (7d EWMA) vs chronic (28d EWMA)
// training minutes. Updates every morning by itself, drains when you hammer
// for days, recharges when you rest. FORM = how well, LOAD = how much,
// CHARGE = how ready.

export type ChargeState = "primed" | "steady" | "drained";
export type Charge = { value: number; state: ChargeState; why: string };

import { SIGNAL } from "./palette";

export const CHARGE_META: Record<ChargeState, { word: string; action: string; color: string }> = {
  primed: { word: "PRIMED", action: "PUSH TODAY", color: SIGNAL.good },
  steady: { word: "STEADY", action: "TRAIN AS PLANNED", color: SIGNAL.okay },
  drained: { word: "DRAINED", action: "GO EASY TODAY", color: SIGNAL.work },
};

const SEEDED: Charge = { value: 80, state: "primed", why: "Building your baseline" }; // fresh account

const stateOf = (v: number): ChargeState => (v >= 67 ? "primed" : v >= 34 ? "steady" : "drained");

// minutes trained per day, [0] = today … [span-1]
function dailyMinutes(span: number): number[] | null {
  const acts = JSON.parse(localStorage.getItem("ml_activities") ?? "[]") as { date: string; seconds?: number }[];
  if (!acts.length) return null;
  const mins = new Array<number>(span).fill(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const a of acts) {
    const d = new Date(a.date);
    d.setHours(0, 0, 0, 0);
    const i = Math.round((today.getTime() - d.getTime()) / 86400000);
    if (i >= 0 && i < span) mins[i] += (a.seconds ?? 0) / 60;
  }
  return mins;
}

// the model itself, over a 28-day window ([0] = "today" of that window)
function compute(mins: number[]): Charge {
  // EWMAs walked oldest → newest (τ=7 acute, τ=28 chronic)
  let acute = 0;
  let chronic = 0;
  for (let i = mins.length - 1; i >= 0; i--) {
    acute += (mins[i] - acute) / 7;
    chronic += (mins[i] - chronic) / 28;
  }

  let v: number;
  const ratio = chronic >= 3 ? acute / chronic : null;
  if (ratio === null) {
    // barely any history: fresh — unless the last days were suddenly heavy
    v = 85 - Math.min(35, acute * 2);
  } else {
    // ratio 0.8 → fully charged, 1.6 → the sports-science danger zone
    v = 100 - 70 * Math.min(1, Math.max(0, (ratio - 0.8) / 0.8));
  }

  // ≥4 straight training days drain extra; a rest day yesterday recharges
  let consec = 0;
  for (let i = mins[0] > 0 ? 0 : 1; i < mins.length && mins[i] > 0; i++) consec++;
  if (consec >= 4) v -= Math.min(4, consec - 3) * 5;
  const rested = mins[1] === 0 && chronic >= 3;
  if (rested) v += 8;

  // one short human reason — the card's context line
  const why =
    consec >= 4
      ? `${consec} days straight — rest recharges`
      : ratio === null
      ? "Plenty in the tank"
      : ratio >= 1.3
      ? "Heavy week vs your usual"
      : rested
      ? "Recharged by yesterday's rest"
      : ratio <= 0.9
      ? "Fresh — room to push"
      : "Right on your usual rhythm";

  const value = Math.round(Math.min(100, Math.max(5, v)));
  return { value, state: stateOf(value), why };
}

// null when there is NO training history at all — the card stays hidden
// rather than showing an invented number (owner's no-fake-data rule)
export function getCharge(): Charge | null {
  try {
    const mins = dailyMinutes(28);
    return mins ? compute(mins) : null;
  } catch {
    return null;
  }
}

// the last `days` days of CHARGE, oldest → newest (today last) — the week strip
export function getChargeSeries(days = 7): Charge[] {
  try {
    const all = dailyMinutes(28 + days - 1);
    if (!all) return new Array<Charge>(days).fill(SEEDED);
    return Array.from({ length: days }, (_, k) => {
      const off = days - 1 - k;
      return compute(all.slice(off, off + 28));
    });
  } catch {
    return new Array<Charge>(days).fill(SEEDED);
  }
}
