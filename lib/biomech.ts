"use client";

// BIOMECHANICS LAYER — deterministic, on-device, built on the MotionBERT 3D
// skeleton (H36M-17, optional SAM feet 17-20). No LLM anywhere in here.
//
// What it computes from the 3D pose sequence:
//   · joint angles (knee/hip/elbow/shoulder L+R, trunk lean, ankle when feet exist)
//   · ROM per joint (clip-wide and per rep)
//   · rep segmentation with phases (start → turn → end, eccentric/concentric durations)
//   · tempo (rep duration, ecc:con ratio)
//   · per-muscle MECHANICAL DEMAND → relative load 0-1, LEFT/RIGHT separated,
//     mass-weighted with standard anthropometric segment fractions (de Leva)
//     and personalized by the user's height (metric scaling) and weight.
//
// HONESTY / LIMITATIONS (also emitted in the report):
//   · single camera, no ground-reaction forces → this is a mechanical-demand
//     PROXY (mass-weighted angular work with velocity emphasis), not inverse
//     dynamics. Values are RELATIVE (0-1 vs a hard-session reference).
//   · the clip samples the session; total session volume is unknown.
//   · external load (barbells, backpacks) is invisible to the camera.

import { frameReliability } from "./pose-post";
import type { Frame } from "./analysis";

// ——— H36M-17 indices (matches lib/lift3d) + optional SAM feet ———
const J = {
  pelvis: 0, rHip: 1, rKnee: 2, rAnkle: 3, lHip: 4, lKnee: 5, lAnkle: 6,
  spine: 7, thorax: 8, neck: 9, head: 10,
  lSh: 11, lEl: 12, lWr: 13, rSh: 14, rEl: 15, rWr: 16,
  lHeel: 17, lToe: 18, rHeel: 19, rToe: 20,
} as const;

// de Leva body-segment mass fractions (male, symmetric halves where sided)
const MASS = {
  thigh: 0.1416, shank: 0.0433, foot: 0.0137,
  upperArm: 0.0271, forearm: 0.0162, hand: 0.0061,
  trunk: 0.4346, head: 0.0694,
};

export type SideKey =
  | "quads_l" | "quads_r" | "hamstrings_l" | "hamstrings_r"
  | "glutes_l" | "glutes_r" | "calves_l" | "calves_r"
  | "arms_l" | "arms_r" | "shoulders_l" | "shoulders_r"
  | "chest_l" | "chest_r" | "core" | "back";

export const SIDE_KEYS: SideKey[] = [
  "quads_l", "quads_r", "hamstrings_l", "hamstrings_r", "glutes_l", "glutes_r",
  "calves_l", "calves_r", "arms_l", "arms_r", "shoulders_l", "shoulders_r",
  "chest_l", "chest_r", "core", "back",
];

export type JointName =
  | "knee_l" | "knee_r" | "hip_l" | "hip_r" | "elbow_l" | "elbow_r"
  | "shoulder_l" | "shoulder_r" | "ankle_l" | "ankle_r" | "trunk";

export type JointSummary = {
  romDeg: number; minDeg: number; maxDeg: number;
  peakVelDegS: number; avgVelDegS: number;
};

export type RepPhase = {
  start: number; turn: number; end: number; // seconds in the clip
  durS: number; eccS: number; conS: number;
  primaryJoint: JointName;
  romDeg: number; // primary joint excursion within this rep
};

export type BiomechReport = {
  metricScale: number | null;       // model units → meters (from user height)
  // The body this report was computed against, SNAPSHOTTED here: editing your
  // profile later must never silently rewrite what a past session measured.
  // null on both when the user has not given them — see `bodyKnown`.
  weightKg: number | null; heightCm: number | null;
  bodyKnown: boolean;               // false → muscleLoad is intentionally empty
  joints: Partial<Record<JointName, JointSummary>>;
  reps: RepPhase[];
  tempo: { avgRepS: number | null; eccConRatio: number | null };
  muscleLoad: Partial<Record<SideKey, number>>; // 0-1 relative demand, at the body below
  // Body-independent accumulated demand. muscleLoad is derived from this, so a
  // profile edit can rescale every past session instead of leaving them frozen
  // at whatever body was known on the day they were analysed.
  demandRaw?: Record<SideKey, number>;
  // seconds of movement the clip actually covers — the denominator when the
  // sample is extrapolated to a full session
  observedS?: number;
  confidence: "high" | "medium" | "low";
  reliability: number;      // mean per-frame reliability 0-1
  repairedFrames: number;   // frames that needed keypoint repair
  limitations: string[];
};

export type BiomechFailure = {
  code: "insufficient-3d-frames" | "low-reliability" | "processing-error";
  message: string;
};

type V3 = { x: number; y: number; z: number };
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: V3) => Math.sqrt(dot(a, a)) || 1e-9;
const norm = (a: V3): V3 => { const l = len(a); return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const angleDeg = (a: V3, b: V3) =>
  (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b))))) * 180) / Math.PI;

// angle AT joint b formed by segments b→a and b→c (180 = straight)
const jointAngle = (a: V3, b: V3, c: V3) => angleDeg(sub(a, b), sub(c, b));

const smooth5 = (xs: (number | null)[]): (number | null)[] =>
  xs.map((_, i) => {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(xs.length - 1, i + 2); k++) {
      const v = xs[k];
      if (v != null) { s += v; n++; }
    }
    return n >= 2 ? s / n : xs[i];
  });

// ——— THE VOLUME PROBLEM, and how the scale is anchored ———
// `demand` accumulates over the OBSERVED clip. A clip is a SAMPLE of a session,
// not the session: filming 6.5s of a 45-minute run and crediting only 6.5s of
// work is as wrong as crediting the whole run. So the caller supplies a volume
// factor (sessionSeconds / observedSeconds) and REF is calibrated at
// FULL-SESSION scale rather than clip scale.
//
// Anchor, measured from real footage at the reference body: easy running costs
// ~61 demand units per second for quads. REF_SESSION_SCALE is set so that
//     20 min easy run → 0.25      45 min easy run → 0.47
//     45 min hard run → 0.72      90 min easy run → 0.72
// and, deliberately, an unpaired 6.5s clip with no session length → ~0.00.
// Six seconds of running is not a training dose, and the old scale calling it
// 0.70 is what made one easy run drop recovery by 34 points.
const REF_SESSION_SCALE = 800;

// Assumed session length when the athlete has not set one. Lives here (not in
// lib/muscles) because computeBiomech has to store muscleLoad at the SAME
// volume the app later displays — storing it at the raw clip length wrote an
// empty map for every short clip, which then read as "no muscle data".
export const DEFAULT_SESSION_MIN = 30;
const REF_WEIGHT_KG = 70;
const REF_HEIGHT_CM = 172;
const REF: Record<SideKey, number> = Object.fromEntries(
  SIDE_KEYS.map((k) => {
    const base =
      k.startsWith("quads") ? 320 :
      k.startsWith("hamstrings") ? 170 :
      k.startsWith("glutes") ? 200 :
      k.startsWith("calves") ? 170 :
      k.startsWith("shoulders") ? 100 :
      k.startsWith("arms") ? 100 :
      k.startsWith("chest") ? 80 :
      k === "core" ? 180 : 130; // back
    return [k, base * REF_SESSION_SCALE];
  })
) as Record<SideKey, number>;

// Body size genuinely changes the mechanical work a movement costs, and it was
// barely doing so before: de Leva's MASS values are FRACTIONS of body mass, and
// were being used as bare constants. Segment mass is linear in body mass;
// moment of inertia goes with segment length squared, and segment length scales
// with stature. Hence weight¹ × height². At the reference body this is exactly
// 1.0, so the calibrated REF table above still holds.
export function bodyScale(body: { heightCm?: number | null; weightKg?: number | null }): number | null {
  const h = body.heightCm, w = body.weightKg;
  if (h == null || w == null) return null;
  return (w / REF_WEIGHT_KG) * Math.pow(h / REF_HEIGHT_CM, 2);
}

// volume = how many times the observed clip the whole session was
// (sessionSeconds / observedSeconds). 1 = credit only what the camera saw.
// Extrapolating a sample assumes the rest of the session resembled the clip —
// stated in every report's limitations, never hidden.
export function loadFromDemand(
  demandRaw: Record<SideKey, number> | undefined,
  body: { heightCm?: number | null; weightKg?: number | null },
  volume = 1
): Partial<Record<SideKey, number>> {
  const scale = bodyScale(body);
  if (!demandRaw || scale == null) return {};
  const v0 = Number.isFinite(volume) && volume > 0 ? volume : 1;
  const out: Partial<Record<SideKey, number>> = {};
  for (const k of SIDE_KEYS) {
    const v = 1 - Math.exp(-((demandRaw[k] ?? 0) * scale * v0) / REF[k]);
    if (v > 0.03) out[k] = +Math.min(1, v).toFixed(3);
  }
  return out;
}

// ——— MIGRATION for sessions analysed before demandRaw existed ———
// Those reports stored only the finished muscleLoad, computed as
//     load = 1 - exp(-(demand * lowerScale) / REF_old)
// with REF_old = REF / REF_SESSION_SCALE, and lowerScale = sqrt(w/70) applied
// to the four lower-body groups ONLY. That map is invertible, so the original
// demand is recoverable exactly — this recovers a number that was already
// computed, it does not invent one. Without it those sessions would keep
// driving recovery from the old clip-scale calibration, where six seconds of
// running counted as 70% of maximal quad demand.
const LEGACY_LOWER = ["quads", "hamstrings", "glutes", "calves"];

export function legacyDemand(bm: {
  muscleLoad?: Partial<Record<SideKey, number>>;
  weightKg?: number | null;
  demandRaw?: Record<SideKey, number>;
}): Record<SideKey, number> | null {
  if (bm.demandRaw) return bm.demandRaw;
  const ml = bm.muscleLoad;
  if (!ml || !Object.keys(ml).length) return null;
  // reports predating the body gate stored the 65 kg fallback they actually used
  const w = typeof bm.weightKg === "number" && bm.weightKg > 0 ? bm.weightKg : 65;
  const lowerScale = Math.sqrt(w / 70);
  const out = Object.fromEntries(SIDE_KEYS.map((k) => [k, 0])) as Record<SideKey, number>;
  for (const k of SIDE_KEYS) {
    const load = ml[k];
    if (typeof load !== "number" || load <= 0) continue;
    // a saturated 1.0 lost its magnitude on the way in; 0.999 is the most it
    // can honestly be read back as
    const clamped = Math.min(0.999, load);
    const refOld = REF[k] / REF_SESSION_SCALE;
    const scale = LEGACY_LOWER.some((b) => k.startsWith(b)) ? lowerScale : 1;
    out[k] = (-refOld * Math.log(1 - clamped)) / scale;
  }
  return out;
}

// The span the clip actually covers, in seconds — the denominator of the
// volume factor. Never zero: callers divide by it.
export function observedSeconds(report: { observedS?: number } | undefined): number {
  const v = report?.observedS;
  return typeof v === "number" && v > 0.5 ? v : 0;
}

export function computeBiomech(
  frames: Frame[],
  profile: { heightCm?: number; weightKg?: number },
  onFailure?: (failure: BiomechFailure) => void
): BiomechReport | null {
  // NO assumed body. Height converts model units to metres (every velocity
  // depends on it) and weight sets the segment masses de Leva works in — a
  // guessed 172cm/65kg does not make muscle load approximate, it makes it
  // wrong. Joint angles and ROM are pure geometry and need neither, so they
  // are still measured; muscle load is withheld until the body is known.
  const heightCm = profile.heightCm ?? null;
  const weightKg = profile.weightKg ?? null;
  const bodyKnown = heightCm != null && weightKg != null;
  const limitations: string[] = [
    "Single-camera estimate: muscle values are relative mechanical demand, not measured force.",
    "External load (weights/bags) is not visible to the camera.",
    "The clip samples the session; total volume is not known.",
  ];
  if (!bodyKnown) {
    limitations.push(
      "Muscle load not computed — add your height and weight in Profile so joint work can be scaled to your body."
    );
  }

  const usable = frames.filter((f) => f.pose3d && f.pose3d.length >= 17 && f.lm.length > 0);
  if (usable.length < 24) {
    onFailure?.({
      code: "insufficient-3d-frames",
      message: "Not enough reliable 3D frames were available to measure mechanics or muscle load.",
    });
    return null;
  }
  const coverage = usable.length / Math.max(1, frames.length);

  // PER-FRAME RELIABILITY (lib/pose-post): a frame rebuilt through occlusion is
  // real evidence but weaker evidence. Muscle demand is accumulated with each
  // frame weighted by it, so a clip carried by reconstructed joints produces a
  // smaller — not an equally confident — number.
  const rel = usable.map((f) => frameReliability(f.lm));
  const meanRel = rel.length ? rel.reduce((a, b) => a + b, 0) / rel.length : 0;
  const repaired = usable.filter((f, i) => rel[i] < 0.85).length;

  // confidence now reflects BOTH how many frames we have and how much of each
  // one was genuinely observed
  const quality = coverage * (0.4 + 0.6 * meanRel);
  const confidence = quality > 0.65 ? "high" : quality > 0.35 ? "medium" : "low";
  if (confidence === "low") {
    onFailure?.({
      code: "low-reliability",
      message: "Too much of the body was hidden or uncertain to report mechanics or muscle load honestly.",
    });
    return null;
  }
  if (repaired > usable.length * 0.25) {
    limitations.push(
      `${Math.round((repaired / usable.length) * 100)}% of frames needed keypoint repair (occlusion, motion blur or a left/right swap) — those frames count for less.`
    );
  }

  const P = (f: Frame, i: number): V3 | null => (f.pose3d![i] as V3 | undefined) ?? null;

  // ——— metric scale from the user's height: leg length ≈ 0.48 × height ———
  const legLens: number[] = [];
  for (const f of usable) {
    const h = P(f, J.rHip), k = P(f, J.rKnee), a = P(f, J.rAnkle);
    const h2 = P(f, J.lHip), k2 = P(f, J.lKnee), a2 = P(f, J.lAnkle);
    if (h && k && a) legLens.push(len(sub(h, k)) + len(sub(k, a)));
    if (h2 && k2 && a2) legLens.push(len(sub(h2, k2)) + len(sub(k2, a2)));
  }
  legLens.sort((x, y) => x - y);
  const legModel = legLens[legLens.length >> 1] ?? 0;
  const metricScale = legModel > 1e-6 && heightCm != null ? (0.48 * heightCm) / 100 / legModel : null;
  if (!metricScale) limitations.push("Metric scaling unavailable — velocities are model-relative.");

  // ——— body up-axis: the average pelvis→thorax direction (convention-free) ———
  let up: V3 = { x: 0, y: 0, z: 0 };
  for (const f of usable) {
    const p = P(f, J.pelvis), t = P(f, J.thorax);
    if (p && t) { const d = sub(t, p); up = { x: up.x + d.x, y: up.y + d.y, z: up.z + d.z }; }
  }
  up = norm(up);

  // ——— per-frame angle series ———
  const hasFeet = usable.some((f) => f.pose3d!.length >= 21 && f.pose3d![J.lHeel] && f.pose3d![J.rToe]);
  if (!hasFeet) limitations.push("Foot joints unavailable in this clip — ankle angle not computed; calf demand uses vertical bounce instead.");

  type Series = { name: JointName; vals: (number | null)[] };
  const mk = (name: JointName): Series => ({ name, vals: [] });
  const S: Record<string, Series> = {
    knee_l: mk("knee_l"), knee_r: mk("knee_r"),
    hip_l: mk("hip_l"), hip_r: mk("hip_r"),
    elbow_l: mk("elbow_l"), elbow_r: mk("elbow_r"),
    shoulder_l: mk("shoulder_l"), shoulder_r: mk("shoulder_r"),
    ankle_l: mk("ankle_l"), ankle_r: mk("ankle_r"),
    trunk: mk("trunk"),
  };
  // extra non-joint signals for muscle demand
  const pelvisVert: (number | null)[] = []; // vertical position (metric)
  const twist: (number | null)[] = [];      // shoulder-line vs hip-line azimuth (deg)
  const addF: Record<"l" | "r", (number | null)[]> = { l: [], r: [] }; // arm-forward adduction proxy
  const times: number[] = [];

  for (const f of usable) {
    times.push(f.t);
    const g = (i: number) => P(f, i);
    const pelvis = g(J.pelvis), thorax = g(J.thorax);

    const push = (s: Series, v: number | null) => s.vals.push(v);
    const tryAngle = (s: Series, a: V3 | null, b: V3 | null, c: V3 | null) =>
      push(s, a && b && c ? jointAngle(a, b, c) : null);

    tryAngle(S.knee_l, g(J.lHip), g(J.lKnee), g(J.lAnkle));
    tryAngle(S.knee_r, g(J.rHip), g(J.rKnee), g(J.rAnkle));
    tryAngle(S.hip_l, thorax, g(J.lHip), g(J.lKnee));
    tryAngle(S.hip_r, thorax, g(J.rHip), g(J.rKnee));
    tryAngle(S.elbow_l, g(J.lSh), g(J.lEl), g(J.lWr));
    tryAngle(S.elbow_r, g(J.rSh), g(J.rEl), g(J.rWr));
    // shoulder elevation: upper arm vs the torso down-vector
    const downV = pelvis && thorax ? sub(pelvis, thorax) : null;
    const shAng = (sh: V3 | null, el: V3 | null) => (sh && el && downV ? angleDeg(sub(el, sh), downV) : null);
    push(S.shoulder_l, shAng(g(J.lSh), g(J.lEl)));
    push(S.shoulder_r, shAng(g(J.rSh), g(J.rEl)));
    // ankle (needs feet): shank vs foot
    const ank = (knee: V3 | null, ankle: V3 | null, heel: V3 | null, toe: V3 | null) =>
      knee && ankle && heel && toe ? angleDeg(sub(knee, ankle), sub(toe, heel)) : null;
    push(S.ankle_l, hasFeet ? ank(g(J.lKnee), g(J.lAnkle), g(J.lHeel), g(J.lToe)) : null);
    push(S.ankle_r, hasFeet ? ank(g(J.rKnee), g(J.rAnkle), g(J.rHeel), g(J.rToe)) : null);
    // trunk lean vs average up-axis
    push(S.trunk, pelvis && thorax ? angleDeg(sub(thorax, pelvis), up) : null);

    pelvisVert.push(pelvis && metricScale ? dot(pelvis, up) * metricScale : null);
    // torso twist: angle between shoulder line and hip line, projected ⊥ up
    const shL = g(J.lSh), shR = g(J.rSh), hipL = g(J.lHip), hipR = g(J.rHip);
    if (shL && shR && hipL && hipR) {
      const proj = (v: V3): V3 => { const k = dot(v, up); return { x: v.x - k * up.x, y: v.y - k * up.y, z: v.z - k * up.z }; };
      twist.push(angleDeg(proj(sub(shL, shR)), proj(sub(hipL, hipR))));
    } else twist.push(null);
    // pec proxy: arm azimuth toward the body's front-midline (signed via forward axis)
    const fwd = shL && shR && pelvis && thorax ? norm(cross(sub(shL, shR), sub(thorax, pelvis))) : null;
    const addOf = (sh: V3 | null, el: V3 | null) => {
      if (!sh || !el || !fwd) return null;
      const arm = norm(sub(el, sh));
      return dot(arm, fwd) * 90; // + = arm in front of torso (pressing zone)
    };
    addF.l.push(addOf(g(J.lSh), g(J.lEl)));
    addF.r.push(addOf(g(J.rSh), g(J.rEl)));
  }
  for (const k of Object.keys(S)) S[k].vals = smooth5(S[k].vals);

  // ——— joint summaries + angular velocities ———
  const joints: BiomechReport["joints"] = {};
  const velOf: Record<string, (number | null)[]> = {};
  for (const key of Object.keys(S)) {
    const vals = S[key].vals;
    const vel: (number | null)[] = [null];
    for (let i = 1; i < vals.length; i++) {
      const dt = Math.min(0.12, Math.max(1 / 60, times[i] - times[i - 1]));
      const a = vals[i], b = vals[i - 1];
      vel.push(a != null && b != null ? (a - b) / dt : null);
    }
    velOf[key] = vel;
    const present = vals.filter((v): v is number => v != null);
    if (present.length < usable.length * 0.5) continue; // not observable enough
    const speeds = vel.filter((v): v is number => v != null).map(Math.abs);
    joints[key as JointName] = {
      romDeg: Math.round(Math.max(...present) - Math.min(...present)),
      minDeg: Math.round(Math.min(...present)),
      maxDeg: Math.round(Math.max(...present)),
      peakVelDegS: Math.round(speeds.length ? Math.max(...speeds) : 0),
      avgVelDegS: Math.round(speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0),
    };
  }

  // ——— rep segmentation on the biggest-ROM working joint ———
  const candidates: JointName[] = ["knee_l", "knee_r", "hip_l", "hip_r", "elbow_l", "elbow_r", "shoulder_l", "shoulder_r"];
  let primary: JointName | null = null, bestRom = 14; // ≥14° excursion to count as "working"
  for (const c of candidates) {
    const js = joints[c];
    if (js && js.romDeg > bestRom) { bestRom = js.romDeg; primary = c; }
  }
  const reps: RepPhase[] = [];
  if (primary) {
    const vals = S[primary].vals;
    const js = joints[primary]!;
    const lo = js.minDeg, amp = js.romDeg;
    // turns = deep-flexion local minima with hysteresis (same guard as detectReps)
    const turnIdx: number[] = [];
    let armed = false;
    for (let i = 1; i < vals.length - 1; i++) {
      const v = vals[i];
      if (v == null) continue;
      if (v > lo + amp * 0.6) armed = true;
      if (armed && v <= (vals[i - 1] ?? Infinity) && v <= (vals[i + 1] ?? Infinity) && v < lo + amp * 0.35) {
        turnIdx.push(i);
        armed = false;
      }
    }
    // boundaries = most-extended point between consecutive turns
    const maxBetween = (a: number, b: number) => {
      let bi = a, bv = -Infinity;
      for (let i = a; i <= b; i++) { const v = vals[i]; if (v != null && v > bv) { bv = v; bi = i; } }
      return bi;
    };
    for (let r = 0; r < turnIdx.length; r++) {
      const t = turnIdx[r];
      const s = r === 0 ? maxBetween(0, t) : maxBetween(turnIdx[r - 1], t);
      const e = r === turnIdx.length - 1 ? maxBetween(t, vals.length - 1) : maxBetween(t, turnIdx[r + 1]);
      if (e <= s) continue;
      const startT = times[s], turnT = times[t], endT = times[e];
      let mn = Infinity, mx = -Infinity;
      for (let i = s; i <= e; i++) { const v = vals[i]; if (v != null) { mn = Math.min(mn, v); mx = Math.max(mx, v); } }
      reps.push({
        start: +startT.toFixed(2), turn: +turnT.toFixed(2), end: +endT.toFixed(2),
        durS: +(endT - startT).toFixed(2),
        eccS: +(turnT - startT).toFixed(2), // extended → flexed: lengthening/loading phase
        conS: +(endT - turnT).toFixed(2),   // flexed → extended: shortening/drive phase
        primaryJoint: primary,
        romDeg: Math.round(mx - mn),
      });
    }
  }
  const goodReps = reps.filter((r) => r.durS > 0.25 && r.durS < 12);
  const avgRepS = goodReps.length ? +(goodReps.reduce((a, r) => a + r.durS, 0) / goodReps.length).toFixed(2) : null;
  const eccSum = goodReps.reduce((a, r) => a + r.eccS, 0);
  const conSum = goodReps.reduce((a, r) => a + r.conS, 0);
  const eccConRatio = conSum > 0.05 && goodReps.length ? +(eccSum / conSum).toFixed(2) : null;

  // ——— muscle demand accumulation (mass-weighted angular travel × velocity emphasis) ———
  // Accumulated for the REFERENCE body (70 kg, 172 cm) and stored raw, so the
  // caller can rescale it to the user's real body — including retroactively,
  // when they finally enter their height and weight.
  const demand: Record<SideKey, number> = Object.fromEntries(SIDE_KEYS.map((k) => [k, 0])) as Record<SideKey, number>;
  const emph = (w: number | null) => (w == null ? 0 : Math.abs(w) * (1 + Math.min(1.5, Math.abs(w) / 180)));

  for (let i = 1; i < usable.length; i++) {
    // reconstructed frames contribute proportionally less work — this is the
    // single line that stops a repaired clip scoring like a clean one
    const dt = Math.min(0.12, Math.max(1 / 60, times[i] - times[i - 1])) * rel[i];
    for (const side of ["l", "r"] as const) {
      const knee = velOf[`knee_${side}`][i];
      const hip = velOf[`hip_${side}`][i];
      const kneeV = S[`knee_${side}`].vals[i];
      // quads: knee extension work + eccentric control of loaded flexion
      const kneeExt = knee != null && knee > 0 ? knee : null;
      const kneeFlex = knee != null && knee < 0 ? knee : null;
      demand[`quads_${side}`] += (emph(kneeExt) + 0.75 * emph(kneeFlex)) * dt * (MASS.thigh + MASS.shank);
      // hamstrings: hip extension + knee flexion (swing/curl)
      const hipExt = hip != null && hip > 0 ? hip : null;
      demand[`hamstrings_${side}`] += (0.5 * emph(hipExt) + 0.35 * emph(kneeFlex)) * dt * MASS.thigh;
      // glutes: hip work, extension-dominant, deeper flexion angles weigh more
      const deep = kneeV != null && kneeV < 120 ? 1.25 : 1;
      demand[`glutes_${side}`] += 0.8 * emph(hip) * deep * dt * MASS.thigh;
      // calves: real ankle work when feet exist; otherwise a documented
      // proportional estimate — plantarflexors work roughly with leg cycling
      if (hasFeet) demand[`calves_${side}`] += emph(velOf[`ankle_${side}`][i]) * dt * (MASS.shank + MASS.foot) * 3;
      else demand[`calves_${side}`] += emph(knee) * dt * (MASS.shank + MASS.foot) * 1.2;
      // shoulders (deltoid): arm elevation work
      demand[`shoulders_${side}`] += emph(velOf[`shoulder_${side}`][i]) * dt * (MASS.upperArm + MASS.forearm) * 2;
      // arms: elbow work
      demand[`arms_${side}`] += emph(velOf[`elbow_${side}`][i]) * dt * (MASS.forearm + MASS.hand) * 4;
      // chest: shoulder work while the arm is in the pressing zone (in front)
      const inFront = (addF[side][i] ?? -1) > 25;
      if (inFront) demand[`chest_${side}`] += emph(velOf[`shoulder_${side}`][i]) * dt * MASS.upperArm * 2;
    }
    // core: trunk sway + torso twist rate
    const twistV = twist[i] != null && twist[i - 1] != null ? (twist[i]! - twist[i - 1]!) / dt : null;
    demand.core += (0.5 * emph(velOf.trunk[i]) + 0.5 * emph(twistV)) * dt * MASS.trunk * 0.28;
    // back: trunk work + pulling (elbow flexion while arm is behind/beside torso)
    let pull = 0;
    for (const side of ["l", "r"] as const) {
      const behind = (addF[side][i] ?? 1) < 10;
      const elFlex = velOf[`elbow_${side}`][i];
      if (behind && elFlex != null && elFlex < 0) pull += Math.abs(elFlex);
    }
    demand.back += (0.6 * emph(velOf.trunk[i]) + 0.4 * pull) * dt * MASS.trunk * 0.2;
  }

  // demand → relative load 0-1 with saturating curve. REF = the demand a hard,
  // full-effort clip of that muscle produces (calibrated on real running/tennis
  // footage); values are RELATIVE by design — see limitations.

  const demandRaw = { ...demand };
  // How much of the session the camera actually saw. The stored muscleLoad
  // below is written at the DEFAULT assumed session length; lib/muscles
  // recomputes it from demandRaw whenever the athlete sets the real one.
  const observedS = +(times[times.length - 1] - times[0]).toFixed(2);
  const defaultVolume = observedS > 0.5 ? Math.max(1, (DEFAULT_SESSION_MIN * 60) / observedS) : 1;
  const muscleLoad = bodyKnown
    ? loadFromDemand(demandRaw, { heightCm, weightKg }, defaultVolume)
    : {};
  if (bodyKnown && observedS > 0) {
    limitations.push(
      `Muscle load extrapolates the ${observedS.toFixed(1)}s clip to an assumed ${DEFAULT_SESSION_MIN}-minute session until the athlete sets the real length.`
    );
  }


  return {
    metricScale, weightKg, heightCm, demandRaw, observedS,
    joints, reps: goodReps,
    tempo: { avgRepS, eccConRatio },
    muscleLoad, confidence, limitations, bodyKnown,
    reliability: +meanRel.toFixed(3), repairedFrames: repaired,
  };
}
