"use client";

// SAM 3D Body fusion — the cloud accuracy layer.
//
// Strategy: our on-device backbone (MotionBERT @30fps) supplies SMOOTH MOTION;
// SAM 3D Body (via /api/pose3d) supplies ACCURATE ANATOMY at ~5fps anchor frames
// (it's a per-image model — the strongest single-frame human reconstruction, with
// real feet: heel + toe tips). We align each anchor's SAM skeleton onto the
// backbone via a body-basis transform, take per-joint corrections, interpolate
// them across all frames, and re-ground. Feet are fully replaced (weight 1);
// body joints are nudged (weight 0.5).
//
// Only small JPEG anchor frames leave the device; the video itself never does.

import type { Frame } from "./analysis";
import { apiPost } from "@/lib/api-client";

type J3 = { x: number; y: number; z: number };
type V3 = [number, number, number];

// SAM-70 keypoint indices (from metadata.keypoint_names)
const S = {
  nose: 0, earL: 3, earR: 4,
  shL: 5, shR: 6, elL: 7, elR: 8,
  hipL: 9, hipR: 10, knL: 11, knR: 12, anL: 13, anR: 14,
  toeL: 15, heelL: 17, toeR: 18, heelR: 20,
  wrR: 41, wrL: 62,
};

// our 21-joint rig index → how to read it from a SAM person (null = composite)
const RIG_FROM_SAM: (number | null)[] = [
  null,      // 0 pelvis  = mid(hipL, hipR)
  S.hipR, S.knR, S.anR,
  S.hipL, S.knL, S.anL,
  null,      // 7 spine   = mid(pelvis, thorax)
  null,      // 8 thorax  = mid(shL, shR)
  S.nose,    // 9
  null,      // 10 head   = mid(earL, earR)
  S.shL, S.elL, S.wrL,
  S.shR, S.elR, S.wrR,
  S.heelL, S.toeL, S.heelR, S.toeR,
];

// SAM anchors are SPARSE (1.5fps) — interpolating corrections onto fast-moving
// joints aliases the motion: legs get dragged crooked, arm/leg swing amplitude gets
// flattened. So the cloud may only correct SLOW joints (posture: torso, head,
// shoulders, hips) — every limb joint belongs 100% to the 30fps local backbone,
// which is already pinned to the ViTPose observation.
const SLOW_JOINTS = new Set([0, 1, 4, 7, 8, 9, 10, 11, 14]); // pelvis hips spine thorax nose head shoulders
const W_SLOW = 0.5;

// The cloud layer only nudges slowly-varying body-joint bias now (legs' depth and
// the feet are fully local), so sparse anchors are enough — big cost win.
const MAX_ANCHORS = 12; // Stage ③: use the API's full 12-frame cap (≈ $0.24/analysis)
const ANCHOR_FPS = 1.5;

const sub = (a: J3, b: J3): V3 => [a.x - b.x, a.y - b.y, a.z - b.z];
const norm = (v: V3): V3 => { const l = Math.hypot(...v) || 1e-9; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mid = (a: J3, b: J3): J3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

// orthonormal body basis (right, up, forward) + pelvis + torso scale
function bodyFrame(hipL: J3, hipR: J3, shL: J3, shR: J3) {
  const pelvis = mid(hipL, hipR);
  const thorax = mid(shL, shR);
  const r = norm(sub(hipR, hipL));
  const u0 = norm(sub(thorax, pelvis));
  const f = norm(cross(r, u0));
  const u = norm(cross(f, r));
  const torso = Math.hypot(...sub(thorax, pelvis));
  return { pelvis, r, u, f, torso };
}

export async function sam3dFuse(video: HTMLVideoElement, frames: Frame[]): Promise<boolean> {
  const usable = frames.filter((f) => f.lm.length > 0 && f.pose3d && f.pose3d.length >= 17);
  if (usable.length < 4) return false;

  // — pick anchor frames evenly across the clip —
  const duration = usable[usable.length - 1].t - usable[0].t;
  const nA = Math.max(4, Math.min(MAX_ANCHORS, Math.round(Math.max(1, duration) * ANCHOR_FPS)));
  const anchorIdx = [...new Set(Array.from({ length: nA }, (_, k) => Math.round((k * (usable.length - 1)) / (nA - 1))))];

  // — render each anchor frame to a small JPEG —
  const CW = 480;
  const canvas = document.createElement("canvas");
  canvas.width = CW;
  canvas.height = Math.max(2, Math.round((CW * video.videoHeight) / video.videoWidth));
  const ctx = canvas.getContext("2d")!;
  // seek that can NEVER hang: resolves immediately if already at the target,
  // and gives up after 2s (frame gets skipped, analysis continues)
  const seekTo = (t: number) =>
    new Promise<void>((res) => {
      if (Math.abs(video.currentTime - t) < 0.002) return res();
      const timer = setTimeout(res, 2000);
      video.addEventListener("seeked", () => { clearTimeout(timer); res(); }, { once: true });
      video.currentTime = t;
    });
  const uris: string[] = [];
  for (const i of anchorIdx) {
    await seekTo(Math.min(usable[i].t, video.duration - 0.01));
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    uris.push(canvas.toDataURL("image/jpeg", 0.7));
  }

  // — cloud call (server proxy holds the key); hard 75s timeout — a slow cloud
  // must degrade to "local result stands", never hang the analysis —
  let payload: { ok: boolean; frames: ({ people: { bbox: number[]; keypoints_2d: number[][]; keypoints_3d: number[][] }[] } | null)[] };
  try {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 75_000);
    const resp = await apiPost("/api/pose3d", { frames: uris }, { signal: ac.signal });
    clearTimeout(to);
    if (!resp.ok) return false;
    payload = await resp.json();
    if (!payload.ok) return false;
  } catch {
    return false;
  }

  // — per anchor: pick OUR person, map to rig, compute per-joint corrections —
  // (feet are NOT taken from SAM: they get re-synthesized from body facing after
  // the corrections — detection-based foot direction was unreliable on side views)
  type Anchor = { t: number; delta: (V3 | null)[] };
  const anchors: Anchor[] = [];
  anchorIdx.forEach((fi, k) => {
    const fr = payload.frames[k];
    const f = usable[fi];
    if (!fr?.people?.length || !f.pose3d) return;

    // our person's center in the sent image's pixel space (from MediaPipe box)
    let cx = 0, cy = 0, n = 0;
    for (const p of f.lm) {
      if (!p || (p.visibility ?? 0) < 0.4) continue;
      cx += p.x * canvas.width; cy += p.y * canvas.height; n++;
    }
    if (!n) return;
    cx /= n; cy /= n;
    let best = fr.people[0], bd = Infinity;
    for (const person of fr.people) {
      const [x1, y1, x2, y2] = person.bbox;
      const d = Math.hypot((x1 + x2) / 2 - cx, (y1 + y2) / 2 - cy);
      if (d < bd) { bd = d; best = person; }
    }

    const kp = best.keypoints_3d;
    if (!kp || kp.length < 63) return;
    const g = (i: number): J3 => ({ x: kp[i][0], y: kp[i][1], z: kp[i][2] });

    // basis alignment: SAM camera space → backbone (cleaned) space
    const bb = f.pose3d;
    const B = bodyFrame(bb[4], bb[1], bb[11], bb[14]);
    const A = bodyFrame(g(S.hipL), g(S.hipR), g(S.shL), g(S.shR));
    if (!(A.torso > 1e-6) || !(B.torso > 1e-6)) return;
    const s = B.torso / A.torso;
    const toB = (p: J3): J3 => {
      const d: V3 = sub(p, A.pelvis);
      // coords of d in A's basis
      const la = d[0] * A.r[0] + d[1] * A.r[1] + d[2] * A.r[2];
      const lu = d[0] * A.u[0] + d[1] * A.u[1] + d[2] * A.u[2];
      const lf = d[0] * A.f[0] + d[1] * A.f[1] + d[2] * A.f[2];
      return {
        x: B.pelvis.x + s * (la * B.r[0] + lu * B.u[0] + lf * B.f[0]),
        y: B.pelvis.y + s * (la * B.r[1] + lu * B.u[1] + lf * B.f[1]),
        z: B.pelvis.z + s * (la * B.r[2] + lu * B.u[2] + lf * B.f[2]),
      };
    };

    const delta: (V3 | null)[] = RIG_FROM_SAM.slice(0, 17).map((samIdx, j) => {
      let samP: J3;
      if (samIdx != null) samP = toB(g(samIdx));
      else if (j === 0) samP = toB(mid(g(S.hipL), g(S.hipR)));
      else if (j === 7) samP = toB(mid(mid(g(S.hipL), g(S.hipR)), mid(g(S.shL), g(S.shR))));
      else if (j === 8) samP = toB(mid(g(S.shL), g(S.shR)));
      else if (j === 10) samP = toB(mid(g(S.earL), g(S.earR)));
      else return null;
      const b = bb[j];
      if (!b) return null;
      return [samP.x - b.x, samP.y - b.y, samP.z - b.z];
    });

    anchors.push({ t: f.t, delta });
  });
  if (anchors.length < 2) return false;
  anchors.sort((a, b) => a.t - b.t);

  // — interpolate corrections over every frame and apply —
  const lerp3 = (a: V3 | null, b: V3 | null, u: number): V3 | null =>
    a && b ? [a[0] * (1 - u) + b[0] * u, a[1] * (1 - u) + b[1] * u, a[2] * (1 - u) + b[2] * u] : a ?? b;
  for (const f of usable) {
    const p = f.pose3d!;
    let hi = 0;
    while (hi < anchors.length - 1 && anchors[hi + 1].t < f.t) hi++;
    const a0 = anchors[hi], a1 = anchors[Math.min(hi + 1, anchors.length - 1)];
    const span = a1.t - a0.t;
    const u = span > 1e-6 ? Math.max(0, Math.min(1, (f.t - a0.t) / span)) : 0;

    // slow (posture) joints, DEPTH ONLY — x/y are camera-true (pinned to the video's
    // 2D skeleton) and must never be touched; the cloud may only polish z posture.
    for (const j of SLOW_JOINTS) {
      const d = lerp3(a0.delta[j], a1.delta[j], u);
      if (!d || !p[j]) continue;
      p[j] = { x: p[j].x, y: p[j].y, z: p[j].z + d[2] * W_SLOW };
    }
  }

  // — feet moved → re-anchor the ground (smoothed support-foot floor) —
  const seq = usable.map((f) => f.pose3d!);
  const floorRaw = seq.map((p) =>
    Math.min(p[3].y, p[6].y, p[17]?.y ?? Infinity, p[18]?.y ?? Infinity, p[19]?.y ?? Infinity, p[20]?.y ?? Infinity)
  );
  const M = floorRaw.length;
  for (let i = 0; i < M; i++) {
    let sum = 0, n = 0;
    for (let w = Math.max(0, i - 4); w <= Math.min(M - 1, i + 4); w++) { sum += floorRaw[w]; n++; }
    const off = sum / n;
    for (const j of seq[i]) if (j) j.y -= off;
  }
  return true;
}
