// The anti-jitter stack — every offline technique we can run on-device, chained:
//
//   raw detections (heavy model, frame-stepped)
//     → 1. median filter        (kills single-frame spikes)
//     → 2. occlusion recovery   (low-confidence gaps interpolated, marked `est` — never hidden)
//     → 3. bone-length clamp    (this user's own anatomy as a constraint)
//     → 4. zero-phase smoothing (One-Euro forward + backward)
//
// This is the same philosophy the pro pipelines use; theirs just adds more
// cameras and bigger models on top.

import { makeSmoother, smoothBackward, VIS_MIN, type Frame } from "./analysis";
import { associateLowerLimb } from "./pose-associate";

type LM = { x: number; y: number; visibility?: number; est?: boolean; fix?: FixNote };

// limb segments used for bone-length constraints (parent → child)
const BONES: [number, number][] = [
  [11, 13], [13, 15], // left arm
  [12, 14], [14, 16], // right arm
  [23, 25], [25, 27], // left leg
  [24, 26], [26, 28], // right leg
];

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

// 1 — sliding median (window 5) per joint coordinate
function medianFilter(frames: Frame[]): Frame[] {
  const N = frames.length;
  if (N < 5) return frames;
  return frames.map((f, i) => {
    if (!f.lm.length) return f;
    const lm = f.lm.map((p, j) => {
      const xs: number[] = [], ys: number[] = [];
      for (let k = Math.max(0, i - 2); k <= Math.min(N - 1, i + 2); k++) {
        const q = frames[k].lm[j];
        if (q) { xs.push(q.x); ys.push(q.y); }
      }
      return { ...p, x: median(xs), y: median(ys) };
    });
    return { ...f, lm };
  });
}

// 2 — occlusion recovery: interpolate through low-confidence stretches, flag as estimated
function recoverOcclusions(frames: Frame[]): Frame[] {
  const N = frames.length;
  if (N < 3) return frames;
  const out = frames.map((f) => ({ ...f, lm: f.lm.map((p) => ({ ...p })) as LM[] }));
  const J = out[0]?.lm.length ?? 0;

  for (let j = 0; j < J; j++) {
    let i = 0;
    while (i < N) {
      const bad = (k: number) => (out[k].lm[j]?.visibility ?? 0) < VIS_MIN;
      if (!bad(i)) { i++; continue; }
      // gap [gs, ge)
      const gs = i;
      let ge = i;
      while (ge < N && bad(ge)) ge++;
      const before = gs - 1 >= 0 ? out[gs - 1].lm[j] : null;
      const after = ge < N ? out[ge].lm[j] : null;
      for (let k = gs; k < ge; k++) {
        const p = out[k].lm[j];
        if (!p) continue;
        const ox = p.x, oy = p.y;
        if (before && after) {
          const t = (k - (gs - 1)) / (ge - (gs - 1));
          p.x = before.x + (after.x - before.x) * t;
          p.y = before.y + (after.y - before.y) * t;
        } else if (before) {
          p.x = before.x; p.y = before.y; // hold last known
        } else if (after) {
          p.x = after.x; p.y = after.y;
        }
        note(p, "LOW_CONFIDENCE_OCCLUSION", before && after ? "interpolate" : "hold",
             { x: ox, y: oy });
        p.est = true;            // honest flag: this point is inferred
        p.visibility = VIS_MIN;  // include in metrics, but marked
      }
      i = ge;
    }
  }
  return out;
}

// 3 — clamp limb bones to this user's median length (±25% tolerance)
function boneClamp(frames: Frame[]): Frame[] {
  // median length per bone, from confident frames only
  const lengths = new Map<string, number>();
  for (const [a, b] of BONES) {
    const ls: number[] = [];
    for (const f of frames) {
      const p = f.lm[a] as LM, q = f.lm[b] as LM;
      if (!p || !q || p.est || q.est) continue;
      if ((p.visibility ?? 0) < VIS_MIN || (q.visibility ?? 0) < VIS_MIN) continue;
      ls.push(Math.hypot(p.x - q.x, p.y - q.y));
    }
    if (ls.length > 8) lengths.set(`${a}-${b}`, median(ls));
  }

  for (const f of frames) {
    for (const [a, b] of BONES) {
      const L = lengths.get(`${a}-${b}`);
      const p = f.lm[a] as LM, q = f.lm[b] as LM;
      if (!L || !p || !q) continue;
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < 1e-6) continue;
      if (d > L * 1.25 || d < L * 0.75) {
        // pull the child joint back onto the anatomically possible sphere
        const s = L / d;
        q.x = p.x + (q.x - p.x) * s;
        q.y = p.y + (q.y - p.y) * s;
        q.est = true;
      }
    }
  }
  return frames;
}

// 4 — zero-phase smoothing: forward One-Euro, then the existing backward pass
function smoothZeroPhase(frames: Frame[]): Frame[] {
  const fwd = makeSmoother();
  const forward = frames.map((f) => (f.lm.length ? { ...f, lm: fwd(f.lm, f.t) } : f));
  return smoothBackward(forward);
}

// 0 — left/right identity consistency. Two failure modes, two signals:
//  · mid-clip SWAPS ("left foot suddenly becomes right foot") → temporal continuity
//  · back-view CROSSED LEGS (left hip wired to the right foot — the X-leg artifact;
//    detectors flip chirality on people facing away) → ANATOMY: the crossed wiring
//    always yields longer hip→knee→ankle bones, so total bone length is the referee.
// Per frame the leg chain picks the assignment minimizing continuity + anatomy cost;
// arms keep the continuity check only (arms cross legitimately all the time).
// ——— correction provenance ———
// Every repair records WHAT it changed and WHY. `est` alone only said "this
// point is inferred"; it could not say a left ankle had been un-swapped from
// the right knee. The debug overlay and the biomech reliability weighting both
// read this, and it is the only way to check the system is not quietly
// inventing poses.
export type FixReason =
  | "LEFT_RIGHT_SWAP"
  | "TEMPORAL_SPIKE"
  | "BONE_LENGTH_VIOLATION"
  | "ANATOMICAL_VIOLATION"
  | "LOW_CONFIDENCE_OCCLUSION";

export type FixMethod = "swap" | "interpolate" | "hold" | "trajectory";

export type FixNote = {
  r: FixReason;
  m: FixMethod;
  ox: number; oy: number;      // where the model originally put it
  oc?: number;                 // original confidence
};

function note(p: LM, r: FixReason, m: FixMethod, from?: { x: number; y: number }) {
  if (p.fix) return;           // keep the FIRST diagnosis, not the last pass's
  p.fix = { r, m, ox: from?.x ?? p.x, oy: from?.y ?? p.y, oc: p.visibility };
}

// median bone length across the clip, from confident frames only. Used ONLY to
// SCORE competing left/right assignments — never to move a joint. Moving joints
// toward a median bone length is exactly what the old boneClamp did, and the
// bench showed it destroying fast-limb accuracy (2D bone length legitimately
// changes with perspective foreshortening).
function medianBones(frames: Frame[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [a, b] of BONES) {
    const lens: number[] = [];
    for (const f of frames) {
      const p = f.lm[a] as LM | undefined, q = f.lm[b] as LM | undefined;
      if (!p || !q || p.est || q.est) continue;
      if ((p.visibility ?? 1) < VIS_MIN || (q.visibility ?? 1) < VIS_MIN) continue;
      lens.push(Math.hypot(p.x - q.x, p.y - q.y));
    }
    if (lens.length >= 8) out.set(`${a}-${b}`, median(lens));
  }
  return out;
}

// 0a — LEFT/RIGHT IDENTITY, over a SYMMETRIC time window.
//
// The failure this exists for: during a running stride the legs cross, and the
// detector wires the left ankle to the right knee for a frame or several,
// throwing a long diagonal line across the body.
//
// The previous version scored continuity against the PREVIOUS FRAME ONLY. That
// works for a single bad frame and fails for a run of them: by frame two the
// previous frame is itself swapped, so continuity actively defends the error.
// This version scores against a robust estimate built from BOTH sides of the
// current frame (t-3..t-1, t+1..t+3), so a stretch of bad frames is outvoted by
// the good frames surrounding it.
//
// Evaluated PER SEGMENT (knees independently of ankles): detectors often swap
// only one segment, which a whole-limb test is blind to. A candidate must beat
// the current assignment by a clear margin, so genuine crossings are left alone.
const SWAP_WIN = 3;

function fixIdentitySwaps(frames: Frame[]): Frame[] {
  const N = frames.length;
  const d = (a?: { x: number; y: number }, b?: { x: number; y: number }) =>
    a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  const swapPair = (lm: LM[], a: number, b: number) => {
    if (lm[a] && lm[b]) {
      const t = lm[a]; lm[a] = lm[b]; lm[b] = t;
      note(lm[a], "LEFT_RIGHT_SWAP", "swap");
      note(lm[b], "LEFT_RIGHT_SWAP", "swap");
    }
  };

  // Where joint j SHOULD be at frame i, from the surrounding frames only — the
  // frame under test never votes on itself.
  //
  // Deliberately a linear EXTRAPOLATION from each side rather than a median of
  // the window: during a stride the legs cross, so a median over t-3..t+3 mixes
  // the before-crossing and after-crossing positions into a blur sitting right
  // between the two legs, which is precisely where it cannot tell them apart.
  // Extrapolating carries the direction of travel through the crossing.
  const predict = (i: number, j: number, dir: -1 | 1) => {
    const a = frames[i + dir]?.lm[j] as LM | undefined;
    const b = frames[i + 2 * dir]?.lm[j] as LM | undefined;
    if (!a || (a.visibility ?? 1) < VIS_MIN) return null;
    const w = a.est ? 0.35 : 1;
    if (!b || (b.visibility ?? 1) < VIS_MIN) return { x: a.x, y: a.y, w: w * 0.6 };
    // a is one step from i, b is two: step back toward i by one interval
    return { x: a.x + (a.x - b.x), y: a.y + (a.y - b.y), w: w * (b.est ? 0.6 : 1) };
  };
  const refAt = (i: number, j: number): { x: number; y: number; w: number } | null => {
    const back = predict(i, j, -1), fwd = predict(i, j, 1);
    if (!back && !fwd) return null;
    if (!back) return { ...fwd!, w: fwd!.w * 0.7 };
    if (!fwd) return { ...back, w: back.w * 0.7 };
    // both sides agreeing is strong evidence; disagreement means the joint is
    // moving fast or the neighbours are themselves wrong — trust it less
    const gap = Math.hypot(back.x - fwd.x, back.y - fwd.y);
    return {
      x: (back.x + fwd.x) / 2,
      y: (back.y + fwd.y) / 2,
      w: Math.min(back.w, fwd.w) * Math.max(0.25, 1 - gap * 8),
    };
  };

  const med = medianBones(frames);
  const boneCost = (a: number, b: number, p?: LM, q?: LM) => {
    const m = med.get(`${a}-${b}`);
    if (!m || !p || !q) return 0;
    // deviation beyond ±35% is what a cross-body mis-wire looks like; normal
    // foreshortening lives well inside that
    const len = Math.hypot(p.x - q.x, p.y - q.y);
    return Math.max(0, Math.abs(len - m) - 0.35 * m);
  };

  // two passes: the first fixes frames whose neighbours are already clean, the
  // second lets those corrections vote on what is left
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const cur = frames[i].lm as LM[];
      if (!cur.length) continue;

      const solve = (
        anchorL: number, anchorR: number,
        midL: number, midR: number,
        endL: number, endR: number,
        endExtras: [number, number][],
        margin: number
      ) => {
        const refs = new Map<number, { x: number; y: number; w: number } | null>();
        for (const j of [midL, midR, endL, endR]) refs.set(j, refAt(i, j));

        const cost = (sm: boolean, se: boolean) => {
          const mL = cur[sm ? midR : midL], mR = cur[sm ? midL : midR];
          const eL = cur[se ? endR : endL], eR = cur[se ? endL : endR];

          // anatomy: limbs should chain hip→knee→ankle, short over long
          let c = d(cur[anchorL], mL) + d(cur[anchorR], mR) + d(mL, eL) + d(mR, eR);

          // bone plausibility — SCORING only, no coordinates are moved
          c += 2 * (boneCost(anchorL, midL, cur[anchorL], mL) + boneCost(anchorR, midR, cur[anchorR], mR)
                  + boneCost(midL, endL, mL, eL) + boneCost(midR, endR, mR, eR));

          // temporal: how far each joint lands from where its own neighbours
          // say it should be, weighted by how much confidence that joint and
          // its neighbours carry
          for (const [j, pt] of [[midL, mL], [midR, mR], [endL, eL], [endR, eR]] as const) {
            const r = refs.get(j as number);
            if (!r || !pt) continue;
            const conf = (pt as LM).visibility ?? 1;
            c += 1.5 * r.w * conf * d(r, pt);
          }
          return c;
        };

        // AMBIGUITY GATE. Mid-stride the two legs genuinely overlap, and there
        // the two hypotheses are near-indistinguishable — swapping on a
        // coin-flip margin invents a crossing that never happened. Require a
        // much bigger win when left and right are close relative to the limb.
        const sep = (a: number, b: number) => d(cur[a], cur[b]);
        const limb = med.get(`${anchorL}-${midL}`) ?? med.get(`${anchorR}-${midR}`) ?? 0;
        const close = limb > 0 && Math.min(sep(midL, midR), sep(endL, endR)) < 0.45 * limb;
        const m = close ? margin * 0.72 : margin;

        let bestSm = false, bestSe = false;
        let bestC = cost(false, false) * m;
        for (const sm of [false, true]) {
          for (const se of [false, true]) {
            if (!sm && !se) continue;
            const c = cost(sm, se);
            if (c < bestC) { bestC = c; bestSm = sm; bestSe = se; }
          }
        }
        if (bestSm) swapPair(cur, midL, midR);
        if (bestSe) {
          swapPair(cur, endL, endR);
          for (const [a, b] of endExtras) swapPair(cur, a, b);
        }
      };

      // legs: hips → knees → ankles (heels/toes ride with ankles)
      solve(23, 24, 25, 26, 27, 28, [[29, 30], [31, 32]], 0.92);
      // arms: shoulders → elbows → wrists (hand points ride with wrists)
      solve(11, 12, 13, 14, 15, 16, [[17, 18], [19, 20], [21, 22]], 0.9);
    }
  }
  return frames;
}

// 0b — hinge-glitch rejection. Elbows and knees are HINGE joints: a "backward-bent,
// broken-looking arm" is a detector glitch, not anatomy. Genuine swings change the
// joint angle FAST but CONTINUOUSLY; glitches jump ±55°+ against the local median
// and jump back. Those frames get their mid+end joints rebuilt by interpolation.
const HINGES: [number, number, number][] = [
  [11, 13, 15], [12, 14, 16], // shoulder→elbow→wrist
  [23, 25, 27], [24, 26, 28], // hip→knee→ankle
];
function fixHingeGlitches(frames: Frame[]): Frame[] {
  const N = frames.length;
  const angleAt = (lm: Frame["lm"], a: number, b: number, c: number): number | null => {
    const A = lm[a], B = lm[b], C = lm[c];
    if (!A || !B || !C) return null;
    const v1x = A.x - B.x, v1y = A.y - B.y, v2x = C.x - B.x, v2y = C.y - B.y;
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-6 || l2 < 1e-6) return null;
    return (Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)))) * 180) / Math.PI;
  };
  const med = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return s[s.length >> 1]; };

  for (const [a, b, c] of HINGES) {
    const ang = frames.map((f) => (f.lm.length ? angleAt(f.lm, a, b, c) : null));
    const bad: boolean[] = ang.map((v, i) => {
      if (v == null) return false;
      const win: number[] = [];
      for (let w = Math.max(0, i - 3); w <= Math.min(N - 1, i + 3); w++) {
        if (w !== i && ang[w] != null) win.push(ang[w]!);
      }
      return win.length >= 3 && Math.abs(v - med(win)) > 55;
    });
    // rebuild short glitch runs (≤4 frames) from clean neighbors
    let i = 0;
    while (i < N) {
      if (!bad[i]) { i++; continue; }
      let e = i;
      while (e < N && bad[e]) e++;
      const s = i - 1, t = e; // clean anchors
      if (e - i <= 4 && s >= 0 && t < N && frames[s].lm.length && frames[t].lm.length) {
        for (let k = i; k < e; k++) {
          const u = (k - s) / (t - s);
          for (const j of [b, c]) {
            const P = frames[s].lm[j], Q = frames[t].lm[j], cur = frames[k].lm[j];
            if (!P || !Q || !cur) continue;
            const nx = { ...cur, x: P.x + (Q.x - P.x) * u, y: P.y + (Q.y - P.y) * u, est: true };
            note(nx, "ANATOMICAL_VIOLATION", "interpolate", cur);
            frames[k].lm[j] = nx;
          }
        }
      }
      i = e;
    }
  }
  return frames;
}

// 0a — bridge SHORT whole-frame dropouts (tracker occlusion, pose-miss): a gap of
// up to ~0.5s bounded by real frames is filled by interpolating the full skeleton,
// every joint flagged `est` so the overlay renders it honestly (dashed/faded).
// Long dropouts stay empty — inventing a skeleton nobody saw is worse than a gap.
function bridgeGaps(frames: Frame[]): Frame[] {
  const N = frames.length;
  const MAX_GAP = 15;
  let i = 0;
  while (i < N) {
    if (frames[i].lm.length) { i++; continue; }
    const gs = i;
    let ge = i;
    while (ge < N && !frames[ge].lm.length) ge++;
    const before = gs - 1 >= 0 ? frames[gs - 1] : null;
    const after = ge < N ? frames[ge] : null;
    if (before && after && ge - gs <= MAX_GAP && before.lm.length === after.lm.length) {
      for (let k = gs; k < ge; k++) {
        const u = (k - (gs - 1)) / (ge - (gs - 1));
        frames[k] = {
          ...frames[k],
          lm: before.lm.map((p, j) => {
            const q = after.lm[j];
            if (!p || !q) return p;
            const nx = { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u, z: p.z, visibility: VIS_MIN, est: true };
            note(nx, "LOW_CONFIDENCE_OCCLUSION", "interpolate", p);
            return nx;
          }),
          world: before.world,
        };
      }
    }
    i = ge;
  }
  return frames;
}

// 0c — "spider-web" leg glitch: for a frame or three the detector tangles the legs
// (left/right shin or thigh segments literally CROSS in 2D while neighbors are
// clean). Genuine leg crossings persist; a 1-3 frame X that appears and vanishes
// is a glitch — rebuild both legs from the clean neighbors.
function fixLegTangles(frames: Frame[]): Frame[] {
  const N = frames.length;
  const segsCross = (a?: LM, b?: LM, c?: LM, d?: LM) => {
    if (!a || !b || !c || !d) return false;
    const o = (p: LM, q: LM, r: LM) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  const tangled = frames.map((f) => {
    if (!f.lm.length) return false;
    const lm = f.lm as LM[];
    return segsCross(lm[23], lm[25], lm[24], lm[26]) || segsCross(lm[25], lm[27], lm[26], lm[28]);
  });
  const LEG = [25, 26, 27, 28, 29, 30, 31, 32];
  let i = 0;
  while (i < N) {
    if (!tangled[i]) { i++; continue; }
    let e = i;
    while (e < N && tangled[e]) e++;
    const s = i - 1, t = e;
    if (e - i <= 3 && s >= 0 && t < N && !tangled[s] && frames[s].lm.length && frames[t].lm.length) {
      for (let k = i; k < e; k++) {
        const u = (k - s) / (t - s);
        for (const j of LEG) {
          const P = frames[s].lm[j], Q = frames[t].lm[j], cur = frames[k].lm[j];
          if (!P || !Q || !cur) continue;
          const nx = { ...cur, x: P.x + (Q.x - P.x) * u, y: P.y + (Q.y - P.y) * u, est: true };
          note(nx, "ANATOMICAL_VIOLATION", "interpolate", cur);
          frames[k].lm[j] = nx;
        }
      }
    }
    i = e;
  }
  return frames;
}

// 0d — bone-length SPIKE rejection (Stage ④). Unlike the removed boneClamp (which
// "fixed" normal perspective foreshortening every frame and wrecked accuracy), this
// only fires on a 1-2 frame EXPLOSION: a limb bone suddenly ≥45% off its clip
// median and back — a detector glitch, not anatomy. The child joint is rebuilt
// from clean neighbors, est-flagged.
function fixBoneSpikes(frames: Frame[]): Frame[] {
  const N = frames.length;
  for (const [a, b] of BONES) {
    const lens = frames.map((f) => {
      const p = f.lm[a], q = f.lm[b];
      return p && q ? Math.hypot(p.x - q.x, p.y - q.y) : null;
    });
    const clean = lens.filter((v): v is number => v != null).sort((x, y) => x - y);
    if (clean.length < 12) continue;
    const medL = clean[clean.length >> 1];
    const bad = lens.map((v) => v != null && Math.abs(v - medL) > 0.45 * medL);
    let i = 0;
    while (i < N) {
      if (!bad[i]) { i++; continue; }
      let e = i;
      while (e < N && bad[e]) e++;
      const s = i - 1, t = e;
      if (e - i <= 2 && s >= 0 && t < N && frames[s].lm[b] && frames[t].lm[b]) {
        for (let k = i; k < e; k++) {
          const P = frames[s].lm[b], Q = frames[t].lm[b], cur = frames[k].lm[b];
          if (!P || !Q || !cur) continue;
          const u = (k - s) / (t - s);
          const nx = { ...cur, x: P.x + (Q.x - P.x) * u, y: P.y + (Q.y - P.y) * u, est: true };
          note(nx, "BONE_LENGTH_VIOLATION", "interpolate", cur);
          frames[k].lm[b] = nx;
        }
      }
      i = e;
    }
  }
  return frames;
}

// ——— PER-FRAME RELIABILITY, 0..1 ———
// How much of this frame is genuinely observed, over the joints biomech
// actually reads. A frame rebuilt through occlusion, or one whose legs had to
// be un-swapped, is real evidence — but weaker evidence — and the metrics
// downstream have to know that instead of treating every frame alike.
const SCORED = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export function frameReliability(lm: Frame["lm"]): number {
  if (!lm.length) return 0;
  let sum = 0, n = 0;
  for (const j of SCORED) {
    const p = lm[j] as LM | undefined;
    if (!p) { n++; continue; }
    const vis = Math.max(0, Math.min(1, p.visibility ?? 1));
    // an interpolated point is a guess between two observations; a swap
    // correction kept a real observation and only re-labelled which leg it
    // belongs to, so it costs far less
    const repaired = p.est ? 0.45 : p.fix?.r === "LEFT_RIGHT_SWAP" ? 0.9 : 1;
    sum += vis * repaired;
    n++;
  }
  return n ? +(sum / n).toFixed(3) : 0;
}

export function refinePose(frames: Frame[]): Frame[] {
  const nonEmpty = bridgeGaps(frames).filter((f) => f.lm.length > 0);
  if (nonEmpty.length < 5) return nonEmpty;

  // ORDER MATTERS, and this is the order:
  //
  //   association → anatomical validation → left/right → temporal → repair → smoothing
  //
  // Association comes FIRST because everything after it assumes the points it
  // is working on are the right points. Smoothing an anatomically impossible
  // skeleton only makes a wrong answer look tidy; interpolating one spreads the
  // error into its neighbours. So before any of that runs, lib/pose-associate
  // asks the only question that matters at this stage — which detected point
  // actually IS this joint — and answers it from candidates (both pose models,
  // trajectory prediction) scored against this athlete's own anatomy.
  const associated = associateLowerLimb(nonEmpty);

  // anatomical validation: impossible topology and bone explosions
  const valid = fixBoneSpikes(fixLegTangles(associated));

  // identity: which leg each segment belongs to, over a symmetric time window
  const identified = fixIdentitySwaps(valid);

  // Expert-era chain: CORRECTION passes only (hinge glitches, occlusion) +
  // light zero-phase smoothing. The old medianFilter and boneClamp are GONE —
  // bench data (Sapiens ground truth) showed them DESTROYING accuracy on fast
  // limbs: experts scored 84% PCK@5 before the old chain, 76% after
  // (arms 84→69). Median dragged fast joints toward mid-trajectory; boneClamp
  // "fixed" the normal perspective changes of 2D bone length as if they were
  // errors.
  return smoothZeroPhase(recoverOcclusions(fixHingeGlitches(identified)));
}
