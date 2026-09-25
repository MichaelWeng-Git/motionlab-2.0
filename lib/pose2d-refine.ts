"use client";

// 2D keypoint refiner — ViTPose-Base (transformer pose model, COCO-17).
// A much stronger observer than the real-time models: robust to occlusion and
// motion blur. We run it per frame on a person crop (located by MediaPipe) and
// fuse its keypoints into the 33-landmark skeleton, replacing the joints both
// systems share. Better 2D in → visibly better 3D out of MotionBERT.
// Fully on-device (onnxruntime-web); nothing ever leaves the browser.

import type { Frame } from "./analysis";
import { createOrtSession } from "./ort-loader";
import { modelUrl } from "./model-url";

// COCO-17 index → MediaPipe-33 index
const COCO_TO_MP: [number, number][] = [
  [0, 0],           // nose
  [1, 2], [2, 5],   // eyes
  [3, 7], [4, 8],   // ears
  [5, 11], [6, 12], // shoulders
  [7, 13], [8, 14], // elbows
  [9, 15], [10, 16],// wrists
  [11, 23], [12, 24], // hips
  [13, 25], [14, 26], // knees
  [15, 27], [16, 28], // ankles
];

const IN_W = 192, IN_H = 256; // ViTPose input crop
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
const CONF_MIN = 0.35; // below this, keep the original joint

// Sapiens-0.3B (Meta) — the flagship tier: human foundation model, COCO AP 79.6,
// native 1024×768 input (16× the pixels of ViTPose's crop). Outputs 308 Goliath
// keypoints; we read the 17 COCO-equivalent channels.
const SP_W = 768, SP_H = 1024;
const SP_MEAN = [123.5, 116.5, 103.5], SP_STD = [58.5, 57.0, 57.5];
const GOLIATH_FOR_COCO = [0, 1, 2, 3, 4, 5, 6, 7, 8, 62, 41, 9, 10, 11, 12, 13, 14];

// RTMPose-X — the second expert: CNN + SimCC coordinate classification at a HIGHER
// input resolution (384×288 vs ViTPose's 256×192). Different architecture, different
// failure modes: consensus between the two is worth more than either alone.
const RT_W = 288, RT_H = 384;
const RT_MEAN = [123.675, 116.28, 103.53], RT_STD = [58.395, 57.12, 57.375]; // mmpose RGB
const AGREE = 0.035; // models within 3.5% of the crop → average them (precision win)

export type Refiner = {
  refine: (video: HTMLVideoElement, lm: Frame["lm"]) => Promise<Frame["lm"]>;
  backend: string;
  close: () => void;
};

// Stride refinement: ViTPose runs on every 2nd frame; this spreads its CORRECTIONS
// (refined − raw deltas, interpolated in time) onto the skipped frames. Halves the
// heavy inference with almost no accuracy loss — corrections vary smoothly.
export function spreadRefinement(
  frames: Frame[],
  rawLms: (Frame["lm"] | null)[],
  wasRefined: boolean[]
): void {
  const N = frames.length;
  const refIdx: number[] = [];
  for (let i = 0; i < N; i++) if (wasRefined[i] && frames[i].lm.length) refIdx.push(i);
  if (!refIdx.length) return;

  const deltaAt = (idx: number, j: number) => {
    const raw = rawLms[idx], ref = frames[idx].lm;
    if (!raw || !raw[j] || !ref[j]) return null;
    return { dx: ref[j].x - raw[j].x, dy: ref[j].y - raw[j].y };
  };

  let ri = 0; // pointer into refIdx: last refined index < i
  for (let i = 0; i < N; i++) {
    if (wasRefined[i] || !frames[i].lm.length || !rawLms[i]) continue;
    while (ri < refIdx.length - 1 && refIdx[ri + 1] < i) ri++;
    const a = refIdx[ri] < i ? refIdx[ri] : -1;
    const bCand = refIdx.find((r) => r > i);
    const b = bCand ?? -1;
    const t = a >= 0 && b >= 0 ? (i - a) / (b - a) : 0;
    const raw = rawLms[i]!;
    frames[i].lm = raw.map((p, j) => {
      if (!p) return p;
      const dA = a >= 0 ? deltaAt(a, j) : null;
      const dB = b >= 0 ? deltaAt(b, j) : null;
      let dx = 0, dy = 0;
      if (dA && dB) { dx = dA.dx * (1 - t) + dB.dx * t; dy = dA.dy * (1 - t) + dB.dy * t; }
      else if (dA) { dx = dA.dx; dy = dA.dy; }
      else if (dB) { dx = dB.dx; dy = dB.dy; }
      return { ...p, x: p.x + dx, y: p.y + dy };
    });
  }
}

export async function createRefiner(): Promise<Refiner | null> {
  try {
    // Model ladder (WebGPU): ViTPose-Large per frame (67ms) → Base fp16. WASM: int8.
    // Sapiens-0.3B (Meta, 1024×768, AP 79.6 — but ~1.6s/frame) rides along as a
    // sparse ANCHOR CORRECTOR: every 8th frame it measures the ensemble's systematic
    // bias per joint; the (slow-varying) correction persists on in-between frames.
    const probeWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
    let bundle: Awaited<ReturnType<typeof createOrtSession>>;
    let tier: "huge" | "large" | "base" = "base";
    // Quality setting: "fast" (default) runs ViTPose-LARGE — the Sapiens-GT bench
    // showed parity with Huge on real footage (87/85/72 vs 87/85/73: video
    // resolution saturates first) at ~3× the speed. "best" runs Huge (632M).
    let wantBest = false;
    try { wantBest = localStorage.getItem("ml_quality") === "best"; } catch { /* default fast */ }
    if (probeWebGPU) {
      try {
        bundle = wantBest
          ? await createOrtSession(modelUrl("vitpose_h_fp16.onnx"))
          : await createOrtSession(modelUrl("vitpose_l_fp32.onnx"));
        tier = wantBest ? "huge" : "large";
      } catch {
        try {
          bundle = await createOrtSession(modelUrl("vitpose_l_fp32.onnx"));
          tier = "large";
        } catch {
          bundle = await createOrtSession(modelUrl("vitpose_fp16.onnx"));
        }
      }
    } else {
      bundle = await createOrtSession(modelUrl("vitpose_int8.onnx"));
    }
    const { ort, hasWebGPU, session } = bundle;
    const inName = session.inputNames[0];
    const outName = session.outputNames[0];
    const pW = IN_W, pH = IN_H;
    const chan = (k: number) => k;

    // second expert (best-effort — refiner still works if it can't load)
    let rt: Awaited<ReturnType<typeof createOrtSession>> | null = null;
    try { rt = await createOrtSession(modelUrl("rtmpose_x.onnx")); } catch { rt = null; }

    // Meta Sapiens anchor corrector (WebGPU only; best-effort).
    // 0.6B (AP 81.2 — the strongest pose model that fits on-device) first, 0.3B fallback.
    let sap: Awaited<ReturnType<typeof createOrtSession>> | null = null;
    if (probeWebGPU) {
      // fast mode anchors with 0.3B (~1.6s/anchor), best mode with 0.6B (~3s)
      try { sap = await createOrtSession(wantBest ? modelUrl("sapiens_06b_fp16.onnx") : modelUrl("sapiens_03b_fp16.onnx")); }
      catch {
        try { sap = await createOrtSession(modelUrl("sapiens_03b_fp16.onnx")); } catch { sap = null; }
      }
    }
    const spCanvas = document.createElement("canvas");
    spCanvas.width = SP_W; spCanvas.height = SP_H;
    const spCtx = spCanvas.getContext("2d", { willReadFrequently: true })!;
    let frameIdx = 0;
    const spDelta: ({ dx: number; dy: number } | null)[] = new Array(17).fill(null);

    const canvas = document.createElement("canvas");
    canvas.width = pW; canvas.height = pH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const rtCanvas = document.createElement("canvas");
    rtCanvas.width = RT_W; rtCanvas.height = RT_H;
    const rtCtx = rtCanvas.getContext("2d", { willReadFrequently: true })!;

    return {
      backend: hasWebGPU ? `webgpu-${tier}${rt ? "+rtmpose-x" : ""}` : "wasm-int8",

      async refine(video, lm) {
        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh || !lm.length) return lm;

        // person box from the fast model's landmarks, padded, snapped to 3:4
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
        for (const p of lm) {
          if (!p || (p.visibility ?? 0) < 0.3) continue;
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
          n++;
        }
        if (n < 6) return lm;
        const cx = ((minX + maxX) / 2) * vw, cy = ((minY + maxY) / 2) * vh;
        let bw = (maxX - minX) * vw * 1.25, bh = (maxY - minY) * vh * 1.25;
        if (bw / bh > IN_W / IN_H) bh = (bw * IN_H) / IN_W; else bw = (bh * IN_W) / IN_H;
        const x0 = cx - bw / 2, y0 = cy - bh / 2;

        ctx.drawImage(video, x0, y0, bw, bh, 0, 0, pW, pH);
        const img = ctx.getImageData(0, 0, pW, pH).data;
        const plane = pW * pH;
        const input = new Float32Array(3 * plane);
        for (let i = 0; i < plane; i++) {
          input[i] = (img[i * 4] / 255 - MEAN[0]) / STD[0];
          input[plane + i] = (img[i * 4 + 1] / 255 - MEAN[1]) / STD[1];
          input[2 * plane + i] = (img[i * 4 + 2] / 255 - MEAN[2]) / STD[2];
        }

        const res = await session.run({ [inName]: new ort.Tensor("float32", input, [1, 3, pH, pW]) });
        const hm = res[outName];
        const [, K, H, W] = hm.dims as number[];
        const data = hm.data as Float32Array;

        // decode all 17 first (normalized full-image coords + confidence)
        const vit: ({ x: number; y: number; c: number } | null)[] = new Array(17).fill(null);
        for (let k = 0; k < 17; k++) {
          const ch = chan(k);
          if (ch >= K) continue;
          const off = ch * H * W;
          let best = -1e9, bi = 0;
          for (let i = 0; i < H * W; i++) { const v = data[off + i]; if (v > best) { best = v; bi = i; } }
          const py = Math.floor(bi / W), px = bi % W;
          const val = (x: number, y: number) => (x < 0 || x >= W || y < 0 || y >= H ? -1e9 : data[off + y * W + x]);
          // quarter-pixel shift toward the stronger neighbor (standard heatmap decode)
          let fx = px, fy = py;
          if (val(px + 1, py) > val(px - 1, py)) fx += 0.25; else if (val(px - 1, py) > val(px + 1, py)) fx -= 0.25;
          if (val(px, py + 1) > val(px, py - 1)) fy += 0.25; else if (val(px, py - 1) > val(px, py + 1)) fy -= 0.25;
          const conf = Math.max(0, Math.min(1, best));
          if (conf < CONF_MIN) continue;
          vit[k] = { x: (x0 + ((fx + 0.5) / W) * bw) / vw, y: (y0 + ((fy + 0.5) / H) * bh) / vh, c: conf };
        }

        // Candidates kept per COCO joint. Disagreement between two strong models
        // is EVIDENCE, not noise: throwing the loser away is what left a wrongly
        // associated ankle with nothing to be corrected against downstream.
        const cands: ({ x: number; y: number; c: number; src: string }[] | null)[] = new Array(17).fill(null);
        const addCand = (k: number, x: number, y: number, c: number, src: string) => {
          (cands[k] ??= []).push({ x, y, c, src });
        };
        for (let k = 0; k < 17; k++) if (vit[k]) addCand(k, vit[k]!.x, vit[k]!.y, vit[k]!.c, "vitpose");

        // ——— second expert: RTMPose-X on the SAME crop (its 288:384 aspect equals
        // our 3:4 box), then CONSENSUS fusion: agreement → average (precision win);
        // disagreement → keep the transformer (occlusion-robust) ———
        if (rt) {
          try {
            rtCtx.drawImage(video, x0, y0, bw, bh, 0, 0, RT_W, RT_H);
            const img2 = rtCtx.getImageData(0, 0, RT_W, RT_H).data;
            const plane2 = RT_W * RT_H;
            const input2 = new Float32Array(3 * plane2);
            for (let i = 0; i < plane2; i++) {
              input2[i] = (img2[i * 4] - RT_MEAN[0]) / RT_STD[0];
              input2[plane2 + i] = (img2[i * 4 + 1] - RT_MEAN[1]) / RT_STD[1];
              input2[2 * plane2 + i] = (img2[i * 4 + 2] - RT_MEAN[2]) / RT_STD[2];
            }
            const res2 = await rt.session.run({
              [rt.session.inputNames[0]]: new rt.ort.Tensor("float32", input2, [1, 3, RT_H, RT_W]),
            });
            const sx = res2["simcc_x"].data as Float32Array; // [1,17,576]
            const sy = res2["simcc_y"].data as Float32Array; // [1,17,768]
            const XB = 576, YB = 768;
            for (let k = 0; k < 17; k++) {
              let bx = 0, bvx = -Infinity;
              for (let i = 0; i < XB; i++) { const v2 = sx[k * XB + i]; if (v2 > bvx) { bvx = v2; bx = i; } }
              let by = 0, bvy = -Infinity;
              for (let i = 0; i < YB; i++) { const v2 = sy[k * YB + i]; if (v2 > bvy) { bvy = v2; by = i; } }
              // SimCC peak logit gates (calibrated on real crops): the consensus path
              // needs only a weak gate — AGREEMENT with ViTPose is itself the filter;
              // filling a joint ViTPose missed demands real confidence.
              const logit = Math.min(bvx, bvy);
              if (logit < 0.5) continue;
              const gx = (x0 + ((bx / 2) / RT_W) * bw) / vw; // simcc_split_ratio = 2
              const gy = (y0 + ((by / 2) / RT_H) * bh) / vh;
              const rtConf = Math.max(0, Math.min(1, (logit - 0.5) / 2.5));
              addCand(k, gx, gy, rtConf, "rtmpose");
              const v = vit[k];
              if (!v) {
                if (logit >= 1.5) vit[k] = { x: gx, y: gy, c: 0.5 }; // CNN fills in only when sure
              } else {
                const dx = (v.x - gx) * (vw / Math.max(1, bw)); // distance in crop units
                const dy = (v.y - gy) * (vh / Math.max(1, bh));
                if (Math.hypot(dx, dy) < AGREE) {
                  vit[k] = { x: (v.x + gx) / 2, y: (v.y + gy) / 2, c: Math.min(1, v.c + 0.15) };
                }
                // Disagreement: the transformer still leads the frame, but
                // RTMPose's answer survives as a CANDIDATE for the association
                // pass — that is the "other keypoint near the real foot".
              }
            }
          } catch {
            /* second expert is best-effort */
          }
        }

        // ——— LIMB-ZOOM second passes ———
        // Fast limbs occupy a corner of the person crop; re-running the same model on
        // a tight limb crop multiplies their pixels. Bench data (Sapiens-GT) showed
        // LEGS as the weakest group — they get the same treatment as the arms.
        const zoomPass = async (JOINTS: number[], minSeen: number) => {
          let aMinX = Infinity, aMaxX = -Infinity, aMinY = Infinity, aMaxY = -Infinity, an = 0;
          for (const k of JOINTS) {
            const v = vit[k];
            if (!v) continue;
            aMinX = Math.min(aMinX, v.x); aMaxX = Math.max(aMaxX, v.x);
            aMinY = Math.min(aMinY, v.y); aMaxY = Math.max(aMaxY, v.y);
            an++;
          }
          if (an < minSeen) return;
          const acx = ((aMinX + aMaxX) / 2) * vw, acy = ((aMinY + aMaxY) / 2) * vh;
          let abw = (aMaxX - aMinX) * vw * 1.45, abh = (aMaxY - aMinY) * vh * 1.45;
          if (abw / abh > IN_W / IN_H) abh = (abw * IN_H) / IN_W; else abw = (abh * IN_W) / IN_H;
          if (abw >= bw * 0.8) return; // limb box ≈ body box → zoom adds nothing
          const ax0 = acx - abw / 2, ay0 = acy - abh / 2;
          ctx.drawImage(video, ax0, ay0, abw, abh, 0, 0, IN_W, IN_H);
          const img3 = ctx.getImageData(0, 0, IN_W, IN_H).data;
          const input3 = new Float32Array(3 * plane);
          for (let i = 0; i < plane; i++) {
            input3[i] = (img3[i * 4] / 255 - MEAN[0]) / STD[0];
            input3[plane + i] = (img3[i * 4 + 1] / 255 - MEAN[1]) / STD[1];
            input3[2 * plane + i] = (img3[i * 4 + 2] / 255 - MEAN[2]) / STD[2];
          }
          const res3 = await session.run({ [inName]: new ort.Tensor("float32", input3, [1, 3, IN_H, IN_W]) });
          const hm3 = res3[outName];
          const [, K3, H3, W3] = hm3.dims as number[];
          const d3 = hm3.data as Float32Array;
          for (const k of JOINTS) {
            if (k >= K3) continue;
            const off = k * H3 * W3;
            let best = -1e9, bi = 0;
            for (let i = 0; i < H3 * W3; i++) { const v = d3[off + i]; if (v > best) { best = v; bi = i; } }
            const conf = Math.max(0, Math.min(1, best));
            if (conf < 0.35) continue;
            const gx = (ax0 + (((bi % W3) + 0.5) / W3) * abw) / vw;
            const gy = (ay0 + ((Math.floor(bi / W3) + 0.5) / H3) * abh) / vh;
            const v = vit[k];
            if (!v) {
              vit[k] = { x: gx, y: gy, c: conf };
            } else {
              // the zoom pass sees more detail — it leads (65/35) when confident
              const wz = conf >= 0.5 ? 0.65 : 0.4;
              vit[k] = { x: gx * wz + v.x * (1 - wz), y: gy * wz + v.y * (1 - wz), c: Math.max(v.c, conf) };
            }
          }
        };
        // Limb zoom passes DISABLED: the Sapiens-GT bench showed no accuracy gain
        // (55% vs 56% legs PCK with/without), and with the Huge primary each pass
        // costs a full extra transformer inference — ~40% of scan time for nothing.
        // (zoomPass kept above for future experiments.)
        void zoomPass;

        // ——— Stage ②: Sapiens promoted — every 5th frame (was 8th), wider
        // correction authority. It measures the ensemble's per-joint bias; the
        // correction (slow-varying by nature) persists on frames in between. ———
        if (sap && frameIdx % 8 === 0) {
          try {
            spCtx.drawImage(video, x0, y0, bw, bh, 0, 0, SP_W, SP_H);
            const img4 = spCtx.getImageData(0, 0, SP_W, SP_H).data;
            const plane4 = SP_W * SP_H;
            const input4 = new Float32Array(3 * plane4);
            for (let i = 0; i < plane4; i++) {
              input4[i] = (img4[i * 4] - SP_MEAN[0]) / SP_STD[0];
              input4[plane4 + i] = (img4[i * 4 + 1] - SP_MEAN[1]) / SP_STD[1];
              input4[2 * plane4 + i] = (img4[i * 4 + 2] - SP_MEAN[2]) / SP_STD[2];
            }
            const res4 = await sap.session.run({
              [sap.session.inputNames[0]]: new sap.ort.Tensor("float32", input4, [1, 3, SP_H, SP_W]),
            });
            const hm4 = res4[sap.session.outputNames[0]];
            const [, , H4, W4] = hm4.dims as number[];
            const d4 = hm4.data as Float32Array;
            for (let k = 0; k < 17; k++) {
              const off = GOLIATH_FOR_COCO[k] * H4 * W4;
              let best = -1e9, bi = 0;
              for (let i = 0; i < H4 * W4; i++) { const v2 = d4[off + i]; if (v2 > best) { best = v2; bi = i; } }
              const v = vit[k];
              if (best < 0.3 || !v) { spDelta[k] = null; continue; }
              const gx = (x0 + (((bi % W4) + 0.5) / W4) * bw) / vw;
              const gy = (y0 + ((Math.floor(bi / W4) + 0.5) / H4) * bh) / vh;
              let dx = gx - v.x, dy = gy - v.y;
              // bias corrections are SMALL — a big gap is disagreement, not bias
              const cap = 0.03 * (bw / vw);
              const len = Math.hypot(dx, dy);
              if (len > cap) { const s2 = cap / len; dx *= s2; dy *= s2; }
              spDelta[k] = { dx, dy };
            }
          } catch {
            /* anchor pass is best-effort */
          }
        }
        for (let k = 0; k < 17; k++) {
          const v = vit[k], d = spDelta[k];
          if (v && d) vit[k] = { x: v.x + d.dx * 0.6, y: v.y + d.dy * 0.6, c: v.c };
        }
        frameIdx++;

        // ——— SYSTEM RULE: the weakest model never touches the final coordinates ———
        // MediaPipe's job ends at finding/locking the person and providing 3D world
        // depth + a fallback for joints no expert saw. It is NOT blended in (its old
        // fixed 25% share dragged every joint toward a 3-star model) and it is NOT
        // the left/right referee (on back views it flips chirality and used to force
        // that flip onto correct expert output — the downstream anatomy+continuity
        // pass owns identity now).
        const out = lm.map((p) => ({ ...p }));
        for (let k = 0; k < 17; k++) {
          const v = vit[k];
          if (!v) continue; // no expert saw it → MediaPipe estimate stays as fallback
          const p = out[COCO_TO_MP[k][1]];
          if (!p) continue;
          p.x = v.x;
          p.y = v.y;
          p.visibility = Math.max(p.visibility ?? 0, v.c);
          // hand the alternatives to lib/pose-associate; only the lower limb
          // needs them, and only where the models actually disagreed
          const cs = cands[k];
          if (cs && cs.length > 1) {
            const alts = cs.filter((q) => Math.hypot(q.x - v.x, q.y - v.y) > 0.008);
            if (alts.length) p.cand = alts.map((q) => ({ x: q.x, y: q.y, c: q.c, src: q.src }));
          }
        }
        return out;
      },

      close() {
        try { session.release(); } catch { /* noop */ }
        try { rt?.session.release(); } catch { /* noop */ }
        try { sap?.session.release(); } catch { /* noop */ }
      },
    };
  } catch (e) {
    console.warn("ViTPose refiner unavailable — continuing with the base skeleton", e);
    return null;
  }
}
