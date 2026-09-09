// Shared canvas drawing for pose visuals — with confidence gating everywhere.
// Pro insight: draw LESS. Default replay shows a wrist trail + balance point,
// not 33 noisy joints. Full skeleton is an opt-in toggle.

import { BODY_JOINTS, CONNECTIONS, VIS_MIN, type Frame } from "./analysis";

type LM = { x: number; y: number; visibility?: number; est?: boolean; fix?: Frame["lm"][number]["fix"] };

const solid = (p?: LM) => !!p && !p.est && (p.visibility ?? 1) >= VIS_MIN;
const known = (p?: LM) => !!p && ((p.visibility ?? 1) >= VIS_MIN || p.est === true);

// ——— DEBUG OVERLAY ———
// GREEN  = accepted as the model gave it
// YELLOW = corrected, with an arrow from where the model originally put it
// RED    = repaired from nothing (occlusion/gap) — the least trustworthy points
// Nothing here is cosmetic: the point is to be able to SEE that the cleanup
// chain is not quietly inventing poses.
const FIX_COLOR: Record<string, string> = {
  LEFT_RIGHT_SWAP: "#FFC53D",
  TEMPORAL_SPIKE: "#FFC53D",
  BONE_LENGTH_VIOLATION: "#FFC53D",
  ANATOMICAL_VIOLATION: "#FFC53D",
  LOW_CONFIDENCE_OCCLUSION: "#FF6B5A",
};

export function drawPoseDebug(ctx: CanvasRenderingContext2D, lm: LM[], w: number, h: number) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
  for (const p of lm) {
    if (!p || (p.visibility ?? 1) < VIS_MIN) continue;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    n++;
  }
  if (n < 5) return;
  const diagPx = Math.hypot((maxX - minX) * w, (maxY - minY) * h);
  const r = Math.min(Math.max(2, diagPx / 90), 6);

  for (const j of BODY_JOINTS) {
    const p = lm[j];
    if (!p) continue;
    const color = p.fix ? (FIX_COLOR[p.fix.r] ?? "#FFC53D") : p.est ? "#FF6B5A" : "#3BE07A";

    // where the model originally put it → where it ended up
    if (p.fix && (Math.abs(p.fix.ox - p.x) > 0.002 || Math.abs(p.fix.oy - p.y) > 0.002)) {
      ctx.beginPath();
      ctx.moveTo(p.fix.ox * w, p.fix.oy * h);
      ctx.lineTo(p.x * w, p.y * h);
      ctx.strokeStyle = "rgba(255,197,61,0.75)";
      ctx.lineWidth = Math.max(1, r * 0.4);
      ctx.setLineDash([r, r]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(p.fix.ox * w, p.fix.oy * h, r * 0.55, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,107,90,0.9)";
      ctx.lineWidth = Math.max(1, r * 0.35);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

// One line per repaired joint, for the console — the numbers behind the dots.
export function poseDebugLog(frames: Frame[], names?: Record<number, string>): string[] {
  const out: string[] = [];
  frames.forEach((f, i) => {
    f.lm.forEach((p, j) => {
      const fx = (p as LM).fix;
      if (!fx) return;
      out.push(
        `Frame ${i}  joint ${names?.[j] ?? j}\n` +
        `  original confidence: ${(fx.oc ?? 1).toFixed(2)}\n` +
        `  problem: ${fx.r}\n` +
        `  correction: ${fx.m}\n` +
        `  moved: ${(Math.hypot(fx.ox - p.x, fx.oy - p.y) * 100).toFixed(1)}% of frame`
      );
    });
  });
  return out;
}

export function drawSkeleton(ctx: CanvasRenderingContext2D, lm: LM[], w: number, h: number) {
  // Stroke width follows the PERSON's size, not the canvas — canvas-relative width
  // turns a far-away athlete into a solid green blob (lines thicker than limbs).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
  for (const p of lm) {
    if (!p || (p.visibility ?? 1) < VIS_MIN) continue;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    n++;
  }
  // a collapsed detection (few real joints) draws spaghetti — show nothing
  // for this frame instead; the next good frame takes over
  if (n < 5) return;
  const diagPx = Math.hypot((maxX - minX) * w, (maxY - minY) * h);
  const lw = Math.min(Math.max(1.25, diagPx / 55), Math.max(3, w / 240));
  // no real bone is longer than ~half the body diagonal — anything longer is
  // a bad keypoint (left/right swap, motion blur) and must not be drawn
  const maxBone = diagPx * 0.52;
  ctx.lineCap = "round";
  for (const [a, b] of CONNECTIONS) {
    const p = lm[a], q = lm[b];
    if (!known(p) || !known(q)) continue;
    if (Math.hypot((p!.x - q!.x) * w, (p!.y - q!.y) * h) > maxBone) continue;
    const estimated = !solid(p) || !solid(q);
    ctx.beginPath();
    ctx.moveTo(p!.x * w, p!.y * h);
    ctx.lineTo(q!.x * w, q!.y * h);
    if (estimated) {
      // inferred through occlusion — shown, but honest about it
      ctx.strokeStyle = "rgba(98, 217, 139, 0.45)";
      ctx.setLineDash([lw * 1.6, lw * 1.6]);
    } else {
      ctx.strokeStyle = "#62D98B";
      ctx.setLineDash([]);
    }
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const j of BODY_JOINTS) {
    const p = lm[j];
    if (!known(p)) continue;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, lw * 0.85, 0, Math.PI * 2);
    if (solid(p)) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
    } else {
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = lw * 0.5;
      ctx.stroke(); // hollow ring = estimated joint
    }
  }
}

// pick the more-visible wrist for the trail (16 = right, 15 = left)
export function wristIndex(frames: Frame[]): number {
  let r = 0, l = 0, n = 0;
  for (const f of frames) {
    if (!f.lm.length) continue;
    r += f.lm[16]?.visibility ?? 0;
    l += f.lm[15]?.visibility ?? 0;
    n++;
    if (n > 60) break;
  }
  return r >= l ? 16 : 15;
}

// fading wrist trail over the last ~0.9s + a balance (hip-center) marker
export function drawTrailView(
  ctx: CanvasRenderingContext2D,
  frames: Frame[],
  fromIdx: number,
  toIdx: number,
  wrist: number,
  w: number,
  h: number
) {
  const lw = Math.max(3, w / 200);
  // trail
  let prev: LM | null = null;
  const span = Math.max(1, toIdx - fromIdx);
  for (let i = fromIdx; i <= toIdx; i++) {
    const p = frames[i]?.lm[wrist];
    if (!known(p)) { prev = null; continue; }
    if (prev) {
      const age = (i - fromIdx) / span; // 0 old → 1 now
      const alpha = (0.15 + 0.85 * age) * (p!.est ? 0.45 : 1);
      ctx.strokeStyle = `rgba(98, 217, 139, ${alpha})`;
      ctx.lineWidth = lw * (0.5 + 0.5 * age);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(prev.x * w, prev.y * h);
      ctx.lineTo(p.x * w, p.y * h);
      ctx.stroke();
    }
    prev = p;
  }
  // current wrist dot
  const now = frames[toIdx]?.lm[wrist];
  if (known(now)) {
    ctx.fillStyle = "#62D98B";
    ctx.beginPath();
    ctx.arc(now!.x * w, now!.y * h, lw * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = lw * 0.5;
    ctx.stroke();
  }
  // balance point (hip center)
  const lh = frames[toIdx]?.lm[23], rh = frames[toIdx]?.lm[24];
  if (known(lh) && known(rh)) {
    const cx = ((lh!.x + rh!.x) / 2) * w;
    const cy = ((lh!.y + rh!.y) / 2) * h;
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = lw * 0.7;
    ctx.beginPath();
    ctx.arc(cx, cy, lw * 1.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#0B0F17";
    ctx.beginPath();
    ctx.arc(cx, cy, lw * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
}
