// MUSCLES — measured physiology, two layers, no model in either:
//  1. ATTRIBUTION: each session's per-muscle load comes from lib/biomech's
//     deterministic read of its 3D pose, rescaled to the user's CURRENT body
//     (weight¹ × height²) on every read. A session biomech could not measure
//     contributes nothing — nothing estimates muscles from a sport name.
//  2. AGGREGATION (pure math, every read): current load = Σ impacts decayed
//     exponentially by hours (big muscles recover slower), protein speeds it.
// Consequence: every new workout STACKS — soreness always rises after a
// session and recovery always drops, then heals with time.

import { buildWorkouts, DEFAULT_SESSION_MIN, readBody, workoutMuscleLoad, type Workout } from "./workouts";
import { dayKey } from "./date";

// These moved to lib/workouts (the pairing rule and the duration resolution now
// live with the model they belong to). Re-exported so app/ callers are unaffected.
export {
  DEFAULT_SESSION_MIN, readBody, observedOf, sessionSecondsOf, volumeOf,
  SESSION_WINDOW_H, type SessionLike, type ActLike,
} from "./workouts";

export type MuscleKey =
  | "shoulders" | "chest" | "arms" | "core" | "back"
  | "glutes" | "quads" | "hamstrings" | "calves";

// LEFT/RIGHT-separated keys (core & back stay midline-single). This is the
// canonical load format now; legacy 9-key maps are still understood everywhere.
export type MuscleKeyLR =
  | "quads_l" | "quads_r" | "hamstrings_l" | "hamstrings_r"
  | "glutes_l" | "glutes_r" | "calves_l" | "calves_r"
  | "arms_l" | "arms_r" | "shoulders_l" | "shoulders_r"
  | "chest_l" | "chest_r" | "core" | "back";

export const LR_KEYS: MuscleKeyLR[] = [
  "quads_l", "quads_r", "hamstrings_l", "hamstrings_r", "glutes_l", "glutes_r",
  "calves_l", "calves_r", "arms_l", "arms_r", "shoulders_l", "shoulders_r",
  "chest_l", "chest_r", "core", "back",
];

export type MuscleLoad = Partial<Record<MuscleKeyLR | MuscleKey, number>>; // 0..1 = how red

// legacy 9-key map → LR (same value both sides — the old data had no sides)
export function toLR(load: MuscleLoad): Partial<Record<MuscleKeyLR, number>> {
  const out: Partial<Record<MuscleKeyLR, number>> = {};
  for (const k of LR_KEYS) {
    const base = k.replace(/_[lr]$/, "") as MuscleKey;
    const v = (load as Record<string, number>)[k] ?? (load as Record<string, number>)[base];
    if (v != null && v > 0) out[k] = v;
  }
  return out;
}

export type MuscleState = {
  load: MuscleLoad;
  fueled: number;
  headline: string;
  // provenance, so the UI can never present a guess as a measurement
  measured: number;    // sessions whose muscle load came from the 3D pose
  unmeasured: number;  // sessions in range that could NOT be measured
  // Measured sessions still missing their length. A clip is a sample: with no
  // session length the dose is unknown, and reporting "100% recovered" for a
  // session that definitely happened is as false as over-crediting it was.
  // While this is > 0, recovery is UNKNOWN, not full.
  needsLength: number;
};

// How much each muscle counts toward WHOLE-BODY readiness — proportional to
// its share of body mass / role in big movements (de Leva-derived, same source
// as lib/biomech). Trashed quads matter far more than trashed calves.
const MUSCLE_WEIGHT: Record<MuscleKeyLR, number> = {
  quads_l: 0.115, quads_r: 0.115,
  hamstrings_l: 0.085, hamstrings_r: 0.085,
  glutes_l: 0.085, glutes_r: 0.085,
  calves_l: 0.045, calves_r: 0.045,
  core: 0.10, back: 0.10,
  chest_l: 0.04, chest_r: 0.04,
  shoulders_l: 0.035, shoulders_r: 0.035,
  arms_l: 0.03, arms_r: 0.03,
};

// THE one recovery formula for the whole app (bar, assistant context, anywhere).
// fatigue = 0.35·worst muscle + 0.65·mass-weighted average.
//   · the max term keeps one wrecked muscle honest (you are not "fresh")
//   · the weighted average carries most of the signal, so recovery actually
//     MOVES as muscles heal instead of being pinned to the slowest one
// Missing muscles count as 0 (fresh). Returns 0-100.
export function computeRecovery(load: MuscleLoad | null | undefined): number {
  if (!load) return 100;
  const rec = load as Record<string, number>;
  let worst = 0, sum = 0, wsum = 0, any = false;
  for (const k of LR_KEYS) {
    const v = Math.max(0, Math.min(1, rec[k] ?? rec[k.replace(/_[lr]$/, "")] ?? 0));
    if (v > 0) any = true;
    if (v > worst) worst = v;
    sum += v * MUSCLE_WEIGHT[k];
    wsum += MUSCLE_WEIGHT[k];
  }
  if (!any) return 100;
  const weightedAvg = wsum > 0 ? sum / wsum : 0;
  const fatigue = Math.min(1, 0.35 * worst + 0.65 * weightedAvg);
  return Math.round((1 - fatigue) * 100);
}

// The one interpretation of current recovery for every surface. Consumers do
// not inspect MuscleState counters or call computeRecovery themselves.
export type RecoveryState =
  | { kind: "known"; pct: number; load: MuscleLoad }
  | { kind: "assumed-duration"; pct: number; load: MuscleLoad; assumedWorkouts: number }
  | { kind: "unmeasured"; unmeasuredWorkouts: number }
  | { kind: "empty" };

export function getRecoveryState(state: MuscleState | null | undefined = computeMuscleState()): RecoveryState {
  if (!state) return { kind: "empty" };
  if (state.measured === 0) {
    return state.unmeasured > 0
      ? { kind: "unmeasured", unmeasuredWorkouts: state.unmeasured }
      : { kind: "empty" };
  }
  const pct = computeRecovery(state.load);
  return state.needsLength > 0
    ? { kind: "assumed-duration", pct, load: state.load, assumedWorkouts: state.needsLength }
    : { kind: "known", pct, load: state.load };
}

/** Identical athlete-facing state copy everywhere, including assistant context. */
export function recoveryStateText(state: RecoveryState): string {
  switch (state.kind) {
    case "known": return "Recovery";
    case "assumed-duration": return `Recovery · ${DEFAULT_SESSION_MIN} min assumed`;
    case "unmeasured": return `${state.unmeasuredWorkouts} recent ${state.unmeasuredWorkouts === 1 ? "workout has" : "workouts have"} no measurable muscle data`;
    case "empty": return "No recent training";
  }
}

export const MUSCLE_NAMES: Record<MuscleKey, string> = {
  shoulders: "Shoulders", chest: "Chest", arms: "Arms", core: "Core", back: "Back",
  glutes: "Glutes", quads: "Quads", hamstrings: "Hamstrings", calves: "Calves",
};

export function muscleGroupValue(load: MuscleLoad, group: MuscleKey): number {
  const rec = load as Record<string, number>;
  if (group === "core" || group === "back") return Math.max(0, Math.min(1, rec[group] ?? 0));
  return Math.max(0, Math.min(1, Math.max(rec[`${group}_l`] ?? rec[group] ?? 0, rec[`${group}_r`] ?? rec[group] ?? 0)));
}

export type MuscleHistoryDay = {
  date: string;
  value: number | null;
  measuredWorkouts: number;
};

export type MuscleContributor = {
  id: string;
  reportId: string | null;
  date: string;
  sport: string;
  action?: string;
  value: number;
  durationS: number | null;
  durationSource: Workout["durationSource"];
};

// Daily measured dose for one group. null means there was no measurable
// muscle evidence that day; it is deliberately different from a measured 0.
export function getMuscleHistory(group: MuscleKey, days = 14): MuscleHistoryDay[] {
  const body = readBody();
  const workouts = buildWorkouts();
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (days - 1 - index));
    const date = dayKey(d);
    const measured = workouts
      .filter((w) => dayKey(w.startedAt) === date)
      .map((w) => workoutMuscleLoad(w, body) as MuscleLoad | null)
      .filter((load): load is MuscleLoad => !!load && Object.keys(load).length > 0);
    if (!measured.length) return { date, value: null, measuredWorkouts: 0 };
    let fresh = 1;
    for (const load of measured) fresh *= 1 - Math.min(0.85, muscleGroupValue(load, group));
    return { date, value: +(1 - fresh).toFixed(3), measuredWorkouts: measured.length };
  });
}

export function getMuscleContributors(group: MuscleKey, days = 14): MuscleContributor[] {
  const body = readBody();
  const cutoff = Date.now() - days * 86400e3;
  return buildWorkouts()
    .filter((workout) => new Date(workout.startedAt).getTime() >= cutoff)
    .map((workout) => {
      const load = workoutMuscleLoad(workout, body) as MuscleLoad | null;
      const value = load ? muscleGroupValue(load, group) : 0;
      return {
        id: workout.id,
        reportId: workout.clips[0]?.id ?? null,
        date: workout.startedAt,
        sport: workout.sport,
        action: workout.action,
        value,
        durationS: workout.durationS,
        durationSource: workout.durationSource,
      };
    })
    .filter((item) => item.value > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
}

const ATTR_KEY = "ml_muscle_attr";  // per-session measured loads (diagnostics)

// recovery half-life in hours — big movers repair slower than small groups
const BASE_HALF_LIFE: Record<MuscleKey, number> = {
  shoulders: 26, chest: 42, arms: 24, core: 28, back: 42,
  glutes: 44, quads: 44, hamstrings: 42, calves: 30,
};
const HALF_LIFE: Record<MuscleKeyLR, number> = Object.fromEntries(
  LR_KEYS.map((k) => [k, BASE_HALF_LIFE[k.replace(/_[lr]$/, "") as MuscleKey]])
) as Record<MuscleKeyLR, number>;

type Item = {
  key: string;
  hoursAgo: number;
  group?: string;  // sport|action — merge key for same-session clips
  dupes?: number;  // how many clips were folded in (diagnostics)
  // deterministic L/R loads computed by lib/biomech at analysis time — when
  // present, this session NEVER goes to the LLM
  bio?: Partial<Record<MuscleKeyLR, number>>;
};

// ONE item per WORKOUT, not per record. Before P0-1 this walked ml_sessions and
// ml_activities separately, so a filmed recorded run produced two items whose
// merge keys ("running|easy run" vs "workout|running") could never match — the
// same training decayed twice and the body read sorer than it was. buildWorkouts
// has already done the pairing; here we only decay.
function collectItems(): { items: Item[]; protein48: number; weightKg: number; needsLength: number } | null {
  const items: Item[] = [];
  let needsLength = 0;

  // Body size is applied HERE, not frozen at analysis time: entering your
  // height and weight rescales every past session, which is the only way the
  // profile inputs actually mean anything.
  const body = readBody();
  const workouts = buildWorkouts().filter((w: Workout) => w.hoursAgo <= 7 * 24);

  for (const w of workouts) {
    const bio = workoutMuscleLoad(w, body) as Partial<Record<MuscleKeyLR, number>> | null;
    // a workout whose dose rests on the visible 30-minute assumption
    if (bio && w.durationSource !== "recorded" && w.durationSource !== "stated") needsLength++;
    items.push({
      key: w.id,
      hoursAgo: w.hoursAgo,
      bio: bio && Object.keys(bio).length ? { ...bio } : undefined,
    });
  }

  if (!items.length) return null; // nothing real to analyze

  const hoursAgo = (d: string) => Math.max(0, (Date.now() - new Date(d).getTime()) / 3600e3);
  let protein48 = 0;
  try {
    const meals = JSON.parse(localStorage.getItem("ml_fuel") ?? "[]") as { protein: number; date: string }[];
    protein48 = meals.filter((m) => hoursAgo(m.date) < 48).reduce((a, m) => a + (m.protein || 0), 0);
  } catch {}

  // 0 = unknown. Protein adequacy is a ratio against body weight, so with no
  // weight there is no ratio — fuelFactor stays exactly neutral rather than
  // being scored against an assumed body.
  let weightKg = 0;
  try {
    const p = JSON.parse(localStorage.getItem("ml_profile") ?? "{}") as { weight?: number };
    if (p.weight) weightKg = p.weight;
  } catch {}

  return { items, protein48, weightKg, needsLength };
}

// Instant paint AND the real value — they are the same thing now. Attribution
// is measured-only local math (no network), so there is nothing to wait for; a
// stored snapshot would only be stale, because the loads decay by elapsed
// hours. Every surface calling this on mount gets the identical number.
export function getCachedMuscleState(): MuscleState | null {
  return computeMuscleState();
}

// kept async for callers that already await it — the work itself is synchronous
export async function fetchMuscleState(): Promise<MuscleState | null> {
  return computeMuscleState();
}

export function computeMuscleState(): MuscleState | null {
  const col = collectItems();
  if (!col) return null;

  // 1. attribution — MEASURED ONLY. Every muscle number here comes from
  // lib/biomech's deterministic read of that session's 3D pose. A session the
  // biomech layer could not measure (clip too short, tracking too sparse, or a
  // recorded workout with no video at all) contributes NOTHING. There is no
  // model estimating muscles from a sport name: a guess dressed as a
  // measurement is exactly the thing this app must never ship.
  const attr: Record<string, MuscleLoad> = {};
  let measured = 0, unmeasured = 0;
  for (const it of col.items) {
    if (it.bio && Object.keys(it.bio).length) { attr[it.key] = it.bio; measured++; }
    else unmeasured++;
  }
  try { localStorage.setItem(ATTR_KEY, JSON.stringify(attr)); } catch {}

  // nothing measurable in range → an honestly empty body, not a stale one
  if (!measured) {
    const empty: MuscleState = {
      load: {}, fueled: 0, headline: "No measured sessions yet",
      measured: 0, unmeasured, needsLength: col.needsLength,
    };
    return empty;
  }

  // 2. aggregation — pure decay math, monotone in sessions
  // ——— PROTEIN → RECOVERY SPEED (evidence-shaped, deliberately modest) ———
  // What the literature supports: being UNDER-fuelled slows repair; hitting the
  // ~1.6 g/kg/day target is the normal baseline; eating far MORE than the target
  // buys essentially nothing extra for short-term recovery. So this is a small
  // band around 1.0, not a multiplier you can farm.
  //   no meals logged  → 1.00 (unknown ≠ deficient — never punish not logging)
  //   ≥ target         → 0.87 (≈15% faster, capped — excess adds nothing)
  //   half of target   → 1.00
  //   ≪ target         → 1.15 (≈15% slower, under-fuelled)
  const gPerKgDay = col.weightKg > 0 ? col.protein48 / 2 / col.weightKg : 0;
  const TARGET_G_PER_KG = 1.6;
  const logged = col.protein48 > 0;
  const ratio = gPerKgDay / TARGET_G_PER_KG;
  const fueled = Math.min(1, Math.max(0, ratio)); // 0-1 adequacy, shown in the UI/AI
  // clamp(ratio, 0.25..1) → speed factor 1.15 … 0.87, linear through 1.0 at half target
  const clamped = Math.min(1, Math.max(0.25, ratio));
  const fuelFactor = logged ? 1.15 - (clamped - 0.25) * ((1.15 - 0.87) / 0.75) : 1;
  const load: MuscleLoad = {};
  let any = false;
  for (const k of LR_KEYS) {
    const base = k.replace(/_[lr]$/, "") as MuscleKey;
    // SATURATING stack (1 - Π(1-c)): every extra session adds soreness, but
    // with diminishing returns — three hard leg days ≈ 0.86, never a flat 1.0
    let fresh = 1;
    for (const it of col.items) {
      const m = attr[it.key] as Record<string, number> | undefined;
      const imp = m?.[k] ?? m?.[base] ?? 0; // legacy 9-key attrs apply to both sides
      if (imp <= 0) continue;
      // Elapsed time is what heals, so fuelling scales EFFECTIVE hours:
      // well fed (fuelFactor 0.87) → 1.15× hours → repairs ~15% faster;
      // under-fed (1.15) → 0.87× hours → ~15% slower. Unknown → exactly 1×.
      const effHours = it.hoursAgo / fuelFactor;
      fresh *= 1 - Math.min(0.85, imp * Math.pow(0.5, effHours / HALF_LIFE[k]));
    }
    const v = +(1 - fresh).toFixed(3);
    if (v > 0.02) { load[k] = v; any = true; }
  }

  let headline = "All muscles fresh";
  if (any) {
    const top = (Object.entries(load) as [string, number][]).sort((a, b) => b[1] - a[1])[0];
    const base = top[0].replace(/_[lr]$/, "") as MuscleKey;
    const side = top[0].endsWith("_l") ? "Left " : top[0].endsWith("_r") ? "Right " : "";
    const name = `${side}${side ? MUSCLE_NAMES[base].toLowerCase() : MUSCLE_NAMES[base]}`;
    headline = top[1] >= 0.55 ? `${name} worked hard — repairing` : `${name} carrying some load`;
  }

  const state: MuscleState = {
    load, fueled, headline, measured, unmeasured, needsLength: col.needsLength,
  };
  return state;
}

// Recovery is a "higher is better" number like any other — one shared scale.
export { qualityColor as recoveryColor } from "./palette";
import { SIGNAL } from "./palette";

// ——— ONE DAY's training, as it happened ———
// Different question from fetchMuscleState(): that one answers "how loaded is
// the body RIGHT NOW" (everything recent, decayed by elapsed hours). This one
// answers "what did I work on THAT day" — only that calendar day's sessions,
// with NO time decay, because the day doesn't heal retroactively.
export function getDayMuscleLoad(dayISO: string): MuscleLoad {
  const body = readBody();
  // Same Workout model as the live reader, so the two views of one session can
  // never disagree — and a filmed recorded run counts once here too.
  const day = buildWorkouts().filter((w: Workout) => dayKey(w.startedAt) === dayISO);
  if (!day.length) return {};

  const load: MuscleLoad = {};
  for (const k of LR_KEYS) {
    let fresh = 1;
    for (const w of day) {
      const m = workoutMuscleLoad(w, body) as Record<string, number> | null; // measured only
      const imp = m?.[k] ?? m?.[k.replace(/_[lr]$/, "")] ?? 0;
      if (imp > 0) fresh *= 1 - Math.min(0.85, imp);
    }
    const v = +(1 - fresh).toFixed(3);
    if (v > 0.02) load[k] = v;
  }
  return load;
}

export type DayIntensity = { level: "Easy" | "Moderate" | "Hard"; color: string; score: number };

// How hard was that day? Deterministic, from the same mass weighting the
// recovery formula uses — the hardest muscle matters, but so does how much of
// the body was involved.
export function getDayIntensity(load: MuscleLoad): DayIntensity | null {
  const rec = load as Record<string, number>;
  let worst = 0, sum = 0, wsum = 0, any = false;
  for (const k of LR_KEYS) {
    const v = Math.max(0, Math.min(1, rec[k] ?? rec[k.replace(/_[lr]$/, "")] ?? 0));
    if (v > 0) any = true;
    if (v > worst) worst = v;
    sum += v * MUSCLE_WEIGHT[k];
    wsum += MUSCLE_WEIGHT[k];
  }
  if (!any) return null;
  const score = 0.5 * worst + 0.5 * (wsum > 0 ? sum / wsum : 0);
  if (score < 0.3) return { level: "Easy", color: SIGNAL.good, score };
  if (score < 0.55) return { level: "Moderate", color: SIGNAL.okay, score };
  return { level: "Hard", color: SIGNAL.work, score };
}
