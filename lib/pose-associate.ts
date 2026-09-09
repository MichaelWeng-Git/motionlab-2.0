// KEYPOINT ASSOCIATION — "which detected point actually IS this joint?"
//
// This runs BEFORE any smoothing or interpolation, and it exists because the
// failure it targets is not coordinate noise. When a runner's legs cross, the
// detector can attach a knee to a foot candidate belonging to the other leg (or
// to nothing at all), producing a shin twice its real length: an anatomically
// impossible limb that the model reports with high confidence. Smoothing such a
// skeleton only makes a wrong answer look tidy, so association has to be settled
// first, on candidates, not on a single fused coordinate.
//
// Downstream (lib/pose-post) still handles left/right swaps, hinge glitches and
// occlusion repair. This layer only decides identity.

import { VIS_MIN, type Frame } from "./analysis";

type LM = Frame["lm"][number];
type Cand = { x: number; y: number; c: number; src: string };

// MediaPipe-33 indices. The lower limb is tracked as two CHAINS, because a leg
// is not four independent points — hip→knee→ankle→foot moves as one object, and
// identity has to be preserved along the whole chain.
const LEG = {
  l: { hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
  r: { hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 },
} as const;
type Side = keyof typeof LEG;

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

// ——— robust bone statistics ———
// Median + MAD rather than mean + SD: a handful of catastrophically wrong
// frames is exactly the situation a mean cannot survive, and those frames are
// the ones we are here to find. The threshold adapts to how steady THIS clip's
// measurements are instead of being a single hard-coded ratio.
function robustStats(vals: number[]): { med: number; mad: number } | null {
  const v = vals.filter((x) => Number.isFinite(x) && x > 1e-6).sort((a, b) => a - b);
  if (v.length < 8) return null;
  const med = v[v.length >> 1];
  const dev = v.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
  // 1.4826 makes MAD a consistent estimator of sigma for normal data
  const mad = Math.max(dev[dev.length >> 1] * 1.4826, med * 0.04);
  return { med, mad };
}

export type BoneStats = { thigh: { med: number; mad: number } | null; shin: { med: number; mad: number } | null };

export function legBoneStats(frames: Frame[], side: Side): BoneStats {
  const J = LEG[side];
  const thighs: number[] = [], shins: number[] = [];
  for (const f of frames) {
    const h = f.lm[J.hip], k = f.lm[J.knee], a = f.lm[J.ankle];
    const ok = (p?: LM) => !!p && !p.est && (p.visibility ?? 1) >= VIS_MIN;
    if (ok(h) && ok(k)) thighs.push(dist(h!, k!));
    if (ok(k) && ok(a)) shins.push(dist(k!, a!));
  }
  return { thigh: robustStats(thighs), shin: robustStats(shins) };
}

// How many robust deviations this bone sits from the athlete's own median.
// A ratio alone cannot tell a genuinely variable clip from a stable one.
function boneZ(len: number, s: { med: number; mad: number } | null): number {
  if (!s) return 0;
  return Math.abs(len - s.med) / s.mad;
}

// A bone is IMPOSSIBLE, not merely unusual, when it is both far outside this
// athlete's own distribution and long in absolute ratio terms. 2D bone length
// legitimately shortens with perspective, so only the LONG side is hard-gated;
// a foreshortened shin is normal, a shin 1.4× its own median is not.
const Z_HARD = 3.5;
const RATIO_HARD = 1.38;

export function shinImpossible(len: number, s: { med: number; mad: number } | null): boolean {
  if (!s) return false;
  return len > s.med * RATIO_HARD && boneZ(len, s) > Z_HARD;
}

// ——— candidate generation ———
// Never fewer than the model's own answer; the point is to give the scorer
// something to compare it against.
function candidatesFor(
  frames: Frame[], i: number, j: number, cur: LM | undefined
): Cand[] {
  const out: Cand[] = [];
  if (cur) out.push({ x: cur.x, y: cur.y, c: cur.visibility ?? 1, src: "model" });

  // A — the rival model's answer, preserved by lib/pose2d-refine when the two
  // disagreed. This is the "other keypoint near the real foot".
  for (const q of cur?.cand ?? []) out.push({ ...q });

  // B — temporal prediction from each side independently. Two one-sided
  // predictions beat one symmetric average: through a stride crossing the
  // symmetric estimate lands between the legs, where it cannot discriminate.
  const pred = (dir: -1 | 1): Cand | null => {
    const a = frames[i + dir]?.lm[j], b = frames[i + 2 * dir]?.lm[j];
    if (!a || (a.visibility ?? 1) < VIS_MIN) return null;
    if (!b || (b.visibility ?? 1) < VIS_MIN) return { x: a.x, y: a.y, c: 0.5, src: `hold${dir < 0 ? "-" : "+"}` };
    return { x: a.x + (a.x - b.x), y: a.y + (a.y - b.y), c: 0.6, src: `pred${dir < 0 ? "-" : "+"}` };
  };
  const back = pred(-1), fwd = pred(1);
  if (back) out.push(back);
  if (fwd) out.push(fwd);
  if (back && fwd) out.push({ x: (back.x + fwd.x) / 2, y: (back.y + fwd.y) / 2, c: 0.7, src: "interp" });

  return out;
}

// ——— scoring ———
// Deliberately NOT "highest model confidence wins": the whole failure mode is a
// confidently reported, anatomically impossible joint. Confidence is one term
// among several, and anatomy can veto it.
export type Score = {
  cand: Cand;
  total: number;
  tier: 0 | 1;   // 0 = a real detection, 1 = something we reconstructed
  parts: { conf: number; temporal: number; bone: number; orient: number; chain: number };
};

// A real detection that is plausible always beats a reconstruction that is
// merely plausible-looking, because it is EVIDENCE and the reconstruction is
// an inference. Expressed as a tier rather than folded into the weights: the
// repair priority is a stated rule, not something to be tuned away.
//   tier 0 — an actual pose model saw a point there
//   tier 1 — we predicted it from the trajectory
// A detection that fails the plausibility floor drops to tier 1, so a bad
// observation never outranks a good inference.
const OBSERVED = new Set(["model", "vitpose", "rtmpose"]);
const PLAUSIBLE = 0.55;

function scoreAnkle(
  frames: Frame[], i: number, side: Side, cand: Cand, stats: BoneStats
): Score {
  const J = LEG[side];
  const f = frames[i];
  const knee = f.lm[J.knee], hip = f.lm[J.hip];

  // 1 — model confidence (weakest term by design)
  const conf = cand.c;

  // 2 — distance from where the trajectory says this joint should be
  const prev = frames[i - 1]?.lm[J.ankle], next = frames[i + 1]?.lm[J.ankle];
  let temporal = 0.5;
  const anchors = [prev, next].filter((p): p is LM => !!p && (p.visibility ?? 1) >= VIS_MIN && !p.est);
  if (anchors.length) {
    const d = anchors.reduce((s, p) => s + dist(cand, p), 0) / anchors.length;
    const scale = stats.shin?.med ?? 0.15;
    temporal = Math.exp(-((d / (scale * 0.55)) ** 2));
  }

  // 3 — expected tibia length
  let bone = 0.5;
  if (knee && stats.shin) {
    const len = dist(knee, cand);
    bone = Math.exp(-(((len - stats.shin.med) / (stats.shin.mad * 2.2)) ** 2));
    if (shinImpossible(len, stats.shin)) bone = 0; // hard veto, whatever the model says
  }

  // 4 — knee→ankle orientation continuity: shins swing, they do not teleport
  let orient = 0.5;
  const pk = frames[i - 1]?.lm[J.knee], pa = frames[i - 1]?.lm[J.ankle];
  if (knee && pk && pa) {
    const ang = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.atan2(b.y - a.y, b.x - a.x);
    let dA = Math.abs(ang(knee, cand) - ang(pk, pa));
    if (dA > Math.PI) dA = 2 * Math.PI - dA;
    orient = Math.exp(-((dA / 0.9) ** 2));
  }

  // 5 — hip→knee→ankle chain: the ankle must be reachable from the hip. A foot
  // borrowed from the other leg fails this even when the shin length happens to
  // look plausible.
  let chain = 0.5;
  if (hip && stats.thigh && stats.shin) {
    const reach = dist(hip, cand);
    const maxReach = stats.thigh.med + stats.shin.med;
    chain = reach > maxReach * 1.05 ? Math.max(0, 1 - (reach / maxReach - 1.05) * 6) : 1;
  }

  const total =
    0.20 * conf + 0.28 * temporal + 0.28 * bone + 0.12 * orient + 0.12 * chain;
  const tier: 0 | 1 = OBSERVED.has(cand.src) && total >= PLAUSIBLE ? 0 : 1;
  return { cand, total, tier, parts: { conf, temporal, bone, orient, chain } };
}

export type AssocReport = {
  frame: number; side: Side; joint: "ankle";
  before: { x: number; y: number; c: number; shin: number };
  candidates: Score[];
  after: { x: number; y: number; c: number; shin: number; src: string };
  reason: string;
};

// ——— the pass ———
// Only frames whose shin is anatomically impossible are re-associated. A joint
// the model got right is never second-guessed: association is a repair for a
// detected failure, not a blanket re-decision.
export function associateLowerLimb(frames: Frame[], report?: AssocReport[]): Frame[] {
  for (const side of ["l", "r"] as Side[]) {
    const J = LEG[side];
    const stats = legBoneStats(frames, side);
    if (!stats.shin) continue;

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const knee = f.lm[J.knee], ankle = f.lm[J.ankle];
      if (!knee || !ankle) continue;

      const lenBefore = dist(knee, ankle);
      if (!shinImpossible(lenBefore, stats.shin)) continue;

      const cands = candidatesFor(frames, i, J.ankle, ankle);
      const scored = cands.map((c) => scoreAnkle(frames, i, side, c, stats))
        .sort((a, b) => (a.tier - b.tier) || (b.total - a.total));
      const best = scored[0];
      // nothing scored above the floor → leave it for the repair passes rather
      // than swapping one bad answer for another
      if (!best || best.total < 0.35 || best.cand.src === "model") continue;

      const before = { x: ankle.x, y: ankle.y, c: ankle.visibility ?? 1, shin: lenBefore };
      const fromModel = best.tier === 0;

      ankle.x = best.cand.x;
      ankle.y = best.cand.y;
      // a re-associated joint is a real observation with a corrected identity;
      // a reconstructed one is a guess and must be marked as such
      ankle.est = !fromModel;
      ankle.visibility = fromModel
        ? Math.max(VIS_MIN, best.cand.c)
        : Math.min(ankle.visibility ?? 1, VIS_MIN);
      ankle.fix = {
        r: "BONE_LENGTH_VIOLATION",
        m: fromModel ? "swap" : "trajectory",
        ox: before.x, oy: before.y, oc: before.c,
      };

      // the foot rides with the ankle it belongs to
      const shift = { dx: ankle.x - before.x, dy: ankle.y - before.y };
      for (const fj of [J.heel, J.toe]) {
        const p = f.lm[fj];
        if (!p) continue;
        const ox = p.x, oy = p.y;
        p.x += shift.dx; p.y += shift.dy;
        p.est = ankle.est;
        p.fix ??= { r: "BONE_LENGTH_VIOLATION", m: "trajectory", ox, oy, oc: p.visibility };
      }

      report?.push({
        frame: i, side, joint: "ankle", before, candidates: scored,
        after: {
          x: ankle.x, y: ankle.y, c: ankle.visibility ?? 1,
          shin: dist(knee, ankle), src: best.cand.src,
        },
        reason: fromModel
          ? `BONE_LENGTH_VIOLATION → re-associated to the ${best.cand.src} candidate`
          : `BONE_LENGTH_VIOLATION → reconstructed from trajectory (marked uncertain)`,
      });
    }
  }
  return frames;
}
