"use client";

// 3D lifting engine (layer 2).
// Takes the reliable 2D keypoint sequence (MediaPipe, already refined) and lifts
// it to a temporally-coherent 3D skeleton using MotionBERT — a transformer trained
// on motion-capture data, so it has a learned human-body PRIOR and can infer a
// plausible pose from angles the single camera never saw (fixes the "front looks
// wrong" problem that raw per-frame depth can't).
//
// Everything runs on-device via onnxruntime-web (WASM/WebGPU). Only keypoints ever
// touch the model — the video never leaves the device.

import type { Frame } from "./analysis";
import { createOrtSession } from "./ort-loader";
import { modelUrl } from "./model-url";

const T = 243; // MotionBERT temporal window — the model's default; captures full gait cycles
const STRIDE = 120; // overlapping windows (only used for clips longer than T), averaged

// H36M-17 joint order that MotionBERT expects / returns
// 0 Pelvis 1 RHip 2 RKnee 3 RAnkle 4 LHip 5 LKnee 6 LAnkle 7 Spine 8 Thorax
// 9 Neck 10 Head 11 LShoulder 12 LElbow 13 LWrist 14 RShoulder 15 RElbow 16 RWrist
export const H36M_BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3],       // right leg
  [0, 4], [4, 5], [5, 6],       // left leg
  [0, 7], [7, 8], [8, 10],      // spine → ONE neck stroke → head ball
  // (nose joint 9 is deliberately not drawn: chaining thorax→nose→head made a
  //  kinked "beak" from rotated views; the user wants a neck + a ball, nothing else)
  [8, 11], [11, 12], [12, 13],  // left arm
  [8, 14], [14, 15], [15, 16],  // right arm
  // no feet — legs end at the ankles (user call: every foot variant read as wrong)
];
export const H36M_TORSO = [11, 14, 1, 4]; // LShoulder, RShoulder, RHip, LHip

// MediaPipe-33 landmark index → H36M-17, for mapping the "focus" joint onto the 3D figure
export const MP_TO_H36M: Record<number, number> = {
  0: 9, 15: 13, 16: 16, 13: 12, 14: 15, 11: 11, 12: 14,
  23: 4, 24: 1, 25: 5, 26: 2, 27: 6, 28: 3,
};

type XY = { x: number; y: number; v: number };

// Build the 17 H36M joints (image-normalized x,y in [0,1] + confidence) from MediaPipe's 33.
// Joints MediaPipe doesn't have directly (pelvis, spine, thorax, head) are synthesized.
// Occlusion handling (key): joints our pipeline had to GUESS (est flag — interpolated
// through occlusion or bone-clamped) get their confidence slashed, so MotionBERT leans
// on its learned body prior there instead of trusting our linear guesses.
// MotionBERT outputs H36M-17, which has NO feet — so ankle angle was never
// computable and calf demand fell back to vertical bounce. MediaPipe does
// detect heel and toe (29/30 heel, 31/32 foot index); those detections are
// real, they were simply dropped in the 17-joint conversion. We append them as
// joints 17-20 so the biomech layer can use them.
export const MP_FEET = [
  { mp: 29, at: 17, ankle: 6 },  // left heel  → lHeel, from left ankle
  { mp: 31, at: 18, ankle: 6 },  // left toe   → lToe
  { mp: 30, at: 19, ankle: 3 },  // right heel → rHeel, from right ankle
  { mp: 32, at: 20, ankle: 3 },  // right toe  → rToe
] as const;

function mpFeet(lm: Frame["lm"]): (XY | null)[] {
  return MP_FEET.map(({ mp }) => {
    const p = lm[mp];
    if (!p) return null;
    const v = p.est ? Math.min(p.visibility ?? 1, 0.15) : (p.visibility ?? 1);
    if (v < 0.5) return null;    // a guessed foot is worse than no foot
    return { x: p.x, y: p.y, v };
  });
}

function mpToH36M(lm: Frame["lm"]): XY[] {
  const P = (i: number): XY => {
    const p = lm[i];
    if (!p) return { x: 0.5, y: 0.5, v: 0 };
    const v = p.visibility ?? 1;
    return { x: p.x, y: p.y, v: p.est ? Math.min(v, 0.15) : v };
  };
  const mid = (a: XY, b: XY): XY => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) });

  const rHip = P(24), lHip = P(23), rSh = P(12), lSh = P(11);
  const pelvis = mid(lHip, rHip);
  const thorax = mid(lSh, rSh);
  const spine = mid(pelvis, thorax);
  const nose = P(0);
  const head = mid(P(7), P(8)); // between the ears ≈ head

  const out: XY[] = new Array(17);
  out[0] = pelvis;
  out[1] = rHip; out[2] = P(26); out[3] = P(28);
  out[4] = lHip; out[5] = P(25); out[6] = P(27);
  out[7] = spine; out[8] = thorax; out[9] = nose; out[10] = head;
  out[11] = lSh; out[12] = P(13); out[13] = P(15);
  out[14] = rSh; out[15] = P(14); out[16] = P(16);
  return out;
}

export type Lifter = {
  lift: (frames: Frame[], vidW: number, vidH: number) => Promise<({ x: number; y: number; z: number }[] | null)[]>;
  close: () => void;
};

type J3 = { x: number; y: number; z: number };


export async function createLifter(): Promise<Lifter | null> {
  try {
    const { ort, session } = await createOrtSession(modelUrl("motionbert_3d_243.onnx"));
    const inName = session.inputNames[0];
    const outName = session.outputNames[0];

    return {
      async lift(frames, vidW, vidH) {
        const usable = frames.filter((f) => f.lm.length > 0);
        const N = usable.length;
        if (N < 2) return [];

        // 2D sequence, H36M-17
        const seq = usable.map((f) => mpToH36M(f.lm));

        // ——— person-crop normalization (what MotionBERT was trained on) ———
        // The model expects the PERSON to fill the coordinate space, not the whole
        // frame. A runner small in a wide shot breaks that. So: per-frame square
        // person box (padded 25%), temporally smoothed so it glides with the runner.
        type Box = { cx: number; cy: number; s: number };
        const rawBoxes: (Box | null)[] = seq.map((joints) => {
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
          for (const j of joints) {
            if (j.v < 0.3) continue;
            const x = j.x * vidW, y = j.y * vidH;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            n++;
          }
          if (n < 6) return null; // too little of the body seen — fill from neighbors
          return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, s: Math.max(maxX - minX, maxY - minY) * 1.25 };
        });
        // fill gaps from nearest valid neighbor
        let lastBox: Box | null = null;
        for (let i = 0; i < N; i++) { if (rawBoxes[i]) lastBox = rawBoxes[i]; else rawBoxes[i] = lastBox; }
        for (let i = N - 1; i >= 0; i--) { if (rawBoxes[i]) lastBox = rawBoxes[i]; else rawBoxes[i] = lastBox; }
        if (!rawBoxes[0]) return []; // nothing usable at all
        // temporal smoothing (±7 frames) so the crop never jitters
        const boxes: Box[] = rawBoxes.map((_, i) => {
          let cx = 0, cy = 0, s = 0, n = 0;
          for (let w = Math.max(0, i - 7); w <= Math.min(N - 1, i + 7); w++) {
            const b = rawBoxes[w]!;
            cx += b.cx; cy += b.cy; s += b.s; n++;
          }
          return { cx: cx / n, cy: cy / n, s: s / n };
        });

        const norm = (j: XY, b: Box) =>
          [((j.x * vidW - b.cx) / (b.s / 2)), ((j.y * vidH - b.cy) / (b.s / 2)), j.v] as const;

        // accumulate 3D per frame across overlapping windows.
        // x/y take every pass (incl. mirrored); z takes PRIMARY passes only — averaging
        // mirrored depth collapses leg separation when the model is unsure which leg
        // leads (that's the "feet tripping over each other" artifact).
        const sum = Array.from({ length: N }, () => new Float32Array(17 * 3));
        const cnt = new Int32Array(N);
        const zsum = Array.from({ length: N }, () => new Float32Array(17));
        const zcnt = new Int32Array(N);

        // window "base" = the frame index that window position 0 maps to (can be negative,
        // so a short clip sits CENTERED in the window and both ends edge-pad symmetrically)
        const bases: number[] = [];
        if (N <= T) {
          bases.push(-Math.floor((T - N) / 2));
        } else {
          for (let s = 0; s + T <= N; s += STRIDE) bases.push(s);
          if (bases[bases.length - 1] !== N - T) bases.push(N - T);
        }

        // H36M left/right mirror map, for flip test-time augmentation
        const FLIP = [0, 4, 5, 6, 1, 2, 3, 7, 8, 9, 10, 14, 15, 16, 11, 12, 13];

        const runWindow = async (base: number, mirrored: boolean) => {
          const input = new Float32Array(T * 17 * 3);
          for (let i = 0; i < T; i++) {
            const fi = Math.min(N - 1, Math.max(0, base + i)); // clamp-pad both ends
            const joints = seq[fi];
            const box = boxes[fi];
            for (let j = 0; j < 17; j++) {
              const src = mirrored ? FLIP[j] : j;
              const [nx, ny, nv] = norm(joints[src], box);
              const o = (i * 17 + j) * 3;
              input[o] = mirrored ? -nx : nx;
              input[o + 1] = ny;
              input[o + 2] = nv;
            }
          }
          const tensor = new ort.Tensor("float32", input, [1, T, 17, 3]);
          const res = await session.run({ [inName]: tensor });
          const out = res[outName].data as Float32Array; // [1,T,17,3]
          for (let i = 0; i < T; i++) {
            const fi = base + i;
            if (fi < 0 || fi >= N) continue; // skip padded positions
            for (let j = 0; j < 17; j++) {
              const src = mirrored ? FLIP[j] : j;
              const o = (i * 17 + src) * 3;
              const k = j * 3;
              sum[fi][k] += mirrored ? -out[o] : out[o];
              sum[fi][k + 1] += out[o + 1];
              if (!mirrored) zsum[fi][j] += out[o + 2];
            }
            cnt[fi]++;
            if (!mirrored) zcnt[fi]++;
          }
        };

        for (const base of bases) {
          // flip ensemble (TTA): normal + mirrored runs averaged — measurably more
          // accurate and, crucially, symmetric (kills left/right height bias)
          await runWindow(base, false);
          await runWindow(base, true);
        }

        // average overlaps → per-frame joints, mapped to a y-up model space
        const seq3d: ({ x: number; y: number; z: number }[] | null)[] = usable.map((_, fi) => {
          if (!cnt[fi] || !zcnt[fi]) return null;
          const s = sum[fi], c = cnt[fi], zs = zsum[fi], zc = zcnt[fi];
          const joints: { x: number; y: number; z: number }[] = new Array(17);
          for (let j = 0; j < 17; j++) {
            const o = j * 3;
            // Camera space → renderer space: flip y (down→up) AND z (away→toward camera),
            // so at azimuth 0 the figure matches the video and near limbs draw on top.
            joints[j] = { x: s[o] / c, y: -s[o + 1] / c, z: -zs[j] / zc };
          }
          return joints;
        });

        // ——— CAMERA-TRUE assembly ———
        // The final skeleton makes the VIDEO ANGLE pixel-true: x/y come STRAIGHT from
        // the ViTPose-refined 2D skeleton (the one drawn on the video, which is
        // trusted) in square-crop units — exact leg lines, exact body proportions,
        // exact swing amplitude, exactly as filmed. The lift contributes ONLY depth
        // (z), converted into the same units by a per-frame least-squares scale.
        const med2 = (a: number[]) => { const s2 = [...a].sort((x, y) => x - y); return s2.length ? s2[s2.length >> 1] : 0; };
        const out: (J3[] | null)[] = usable.map((f, fi) => {
          const p = seq3d[fi];
          if (!p) return null;
          const joints2d = seq[fi];
          const box = boxes[fi];
          // fit lifted x/y ≈ sc·(crop 2D) + t → sc converts crop units into lift units
          let ax = 0, ay = 0, bx = 0, by = 0, n = 0;
          const pts: { a: [number, number]; b: [number, number] }[] = [];
          for (let j = 0; j < 17; j++) {
            const [nx2, ny2, v] = norm(joints2d[j], box);
            if (v < 0.3) continue;
            pts.push({ a: [nx2, ny2], b: [p[j].x, -p[j].y] });
            ax += nx2; ay += ny2; bx += p[j].x; by += -p[j].y; n++;
          }
          if (n < 8) return null;
          ax /= n; ay /= n; bx /= n; by /= n;
          let cov = 0, varA = 0;
          for (const q of pts) {
            cov += (q.a[0] - ax) * (q.b[0] - bx) + (q.a[1] - ay) * (q.b[1] - by);
            varA += (q.a[0] - ax) ** 2 + (q.a[1] - ay) ** 2;
          }
          const sc = varA > 1e-9 ? cov / varA : 0;
          if (!(sc > 1e-6)) return null;
          const zPelvis = p[0].z;
          const js = Array.from({ length: 17 }, (_, j): J3 => {
            const [nx2, ny2] = norm(joints2d[j], box);
            return { x: nx2, y: -ny2, z: (p[j].z - zPelvis) / sc };
          });
          // FEET (17-20): x/y are MediaPipe's own detections put through the
          // identical crop transform, so they sit in the same frame as the
          // lifted joints. Depth is inherited from the ankle — the model never
          // predicted a foot, and inventing its depth would be a guess. That
          // makes ankle angle an IMAGE-PLANE angle, which is exactly the right
          // plane for a side-on clip and is declared as such in the report.
          const feetXY = mpFeet(usable[fi].lm);
          for (let k = 0; k < MP_FEET.length; k++) {
            const xy = feetXY[k];
            const { at, ankle } = MP_FEET[k];
            if (!xy) { js[at] = js[ankle]; continue; } // collapse onto the ankle = "no foot"
            const [fx, fy] = norm(xy, box);
            js[at] = { x: fx, y: -fy, z: js[ankle].z };
          }
          // crop units are ~[-1,1]; a briefly-lost person lock collapses the box and
          // explodes coordinates to ±8, which wrecks the avatar auto-fit downstream.
          // Such a frame carries no usable pose — drop it rather than ship garbage.
          for (const q of js) if (Math.abs(q.x) > 2 || Math.abs(q.y) > 2 || Math.abs(q.z) > 3) return null;
          return js;
        });
        const frames3 = out.filter((f): f is J3[] => !!f);
        if (frames3.length >= 2) {
          const N3 = frames3.length;

          // depth-only temporal cleanup (x/y are already zero-phase smoothed upstream):
          // 1) MEDIAN filter on limb depth — kills the single-frame "glitch" jumps
          //    (a mean would only smear them);  2) moving-average smoothing, wider on
          //    limbs (steadies the stance — the "wobbly/out-toed" feel), tighter on torso.
          const LIMBS = new Set([2, 3, 5, 6, 12, 13, 15, 16]);
          for (let j = 0; j < 17; j++) {
            let zs2 = frames3.map((p) => p[j].z);
            if (LIMBS.has(j)) {
              zs2 = zs2.map((_, k) => {
                const win: number[] = [];
                for (let w = Math.max(0, k - 2); w <= Math.min(N3 - 1, k + 2); w++) win.push(zs2[w]);
                win.sort((a, b) => a - b);
                return win[win.length >> 1];
              });
            }
            const half = LIMBS.has(j) ? 3 : 2;
            for (let k = 0; k < N3; k++) {
              let s2 = 0, n2 = 0;
              for (let w = Math.max(0, k - half); w <= Math.min(N3 - 1, k + half); w++) { s2 += zs2[w]; n2++; }
              frames3[k][j] = { ...frames3[k][j], z: s2 / n2 };
            }
          }

          // depth-lean removal (z shear) — PER-FRAME, smoothed. MotionBERT's lean bias
          // along the camera axis DRIFTS over the take, so one global shear leaves a
          // wobble ("still tilts back and forth"). Fit each frame's torso lean
          // (pelvis→thorax/head ONLY — legs excluded so genuine stride depth never
          // leaks into the correction), smooth ~0.8s, shear it out per frame.
          // z-only: the video angle stays pixel-true.
          {
            const lams = frames3.map((p) => {
              let num = 0, den = 0;
              for (const [aJ, bJ] of [[0, 8], [0, 10]] as const) {
                const dy = p[bJ].y - p[aJ].y, dz = p[bJ].z - p[aJ].z;
                num += dy * dz; den += dy * dy;
              }
              return den > 1e-9 ? num / den : 0;
            });
            const lamSm = lams.map((_, i) => {
              let s2 = 0, n2 = 0;
              for (let w = Math.max(0, i - 12); w <= Math.min(N3 - 1, i + 12); w++) { s2 += lams[w]; n2++; }
              return s2 / n2;
            });
            frames3.forEach((p, i) => {
              const y0 = p[0].y, lam = lamSm[i];
              for (let j = 0; j < p.length; j++) p[j] = { ...p[j], z: p[j].z - lam * (p[j].y - y0) };
            });
          }

          // stance de-collapse (z only): each leg's MEAN depth must sit under its own
          // hip — the lift tends to squeeze both legs toward the midline, so shins
          // slant inward into an "A" from rotated views. A constant per-joint offset
          // aligns knee/ankle average depth with the hip; all motion is preserved.
          {
            const meanZ = (j: number) => frames3.reduce((s2, p) => s2 + p[j].z, 0) / N3;
            for (const [hip, knee, ankle] of [[1, 2, 3], [4, 5, 6]] as const) {
              const hz = meanZ(hip);
              for (const j of [knee, ankle]) {
                const off = hz - meanZ(j);
                for (const p of frames3) p[j] = { ...p[j], z: p[j].z + off };
              }
            }
          }

          // gait depth normalization (z only — invisible at the video angle, restores
          // stride/arm swing when the camera hid it along its own axis).
          // SPORT-SAFE GATE: only fires when the legs are actually ALTERNATING
          // periodically (running/walking). Planted stances — tennis ready position,
          // squats, swings — legitimately have static leg depth; amplifying those
          // would fabricate a stride that never happened.
          const hipW = med2(frames3.map((p) => Math.hypot(p[1].x - p[4].x, p[1].y - p[4].y, p[1].z - p[4].z)));
          const dSig = frames3.map((p) => p[6].z - p[3].z);
          let crossings = 0;
          const segPeaks: number[] = [];
          let segMax = 0;
          for (let i = 1; i < N3; i++) {
            segMax = Math.max(segMax, Math.abs(dSig[i]));
            if (dSig[i] > 0 !== dSig[i - 1] > 0) { crossings++; segPeaks.push(segMax); segMax = 0; }
          }
          const isPeriodicGait =
            crossings >= 4 && hipW > 1e-6 && med2(segPeaks) > hipW * 0.2; // real swings, not noise
          const seps = frames3.map((p) => Math.abs(p[6].z - p[3].z)).sort((a, b) => a - b);
          const A = seps[Math.floor(seps.length * 0.9)];
          const target = hipW * 1.1;
          if (isPeriodicGait && A > 1e-6 && A < target * 0.85) {
            const k = Math.min(2, target / A);
            const kArm = Math.min(1.5, k);
            const scaleJ = (js: number[], kk: number) => {
              for (const j of js) {
                const mean = frames3.reduce((s2, p) => s2 + p[j].z, 0) / N3;
                for (const p of frames3) p[j] = { ...p[j], z: mean + (p[j].z - mean) * kk };
              }
            };
            scaleJ([2, 3, 5, 6], k);
            scaleJ([12, 13, 15, 16], kArm);
          }

          // ground anchoring: smoothed support-ankle height → 0 (gentle, keeps the
          // figure planted without fighting the camera-true pose)
          const floorRaw = frames3.map((p) => Math.min(p[3].y, p[6].y));
          for (let i = 0; i < N3; i++) {
            let s2 = 0, n2 = 0;
            for (let w = Math.max(0, i - 4); w <= Math.min(N3 - 1, i + 4); w++) { s2 += floorRaw[w]; n2++; }
            const off = s2 / n2;
            for (let j = 0; j < frames3[i].length; j++) frames3[i][j] = { ...frames3[i][j], y: frames3[i][j].y - off };
          }
          // feet were never predicted by the model — after all depth passes,
          // re-seat each on its own ankle's final depth
          for (const p of frames3) {
            if (p.length < 21) continue;
            for (const { at, ankle } of MP_FEET) p[at] = { ...p[at], z: p[ankle].z };
          }
        }
        return out;
      },
      close() {
        try { session.release(); } catch { /* noop */ }
      },
    };
  } catch (e) {
    console.warn("3D lifter unavailable — falling back to raw depth", e);
    return null;
  }
}
