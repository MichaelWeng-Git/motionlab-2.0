"use client";

// Stage-① tracking layer: YOLOv8s person detection + ByteTrack-style association.
// This replaces the hand-rolled "person lock" heuristics: a real detector gives
// clean per-person boxes every frame, and ByteTrack's two-stage IoU matching with
// per-track motion prediction keeps identities apart through crossings — the exact
// scenario (two runners passing) that broke center-distance locking.

import { createOrtSession } from "./ort-loader";

export type TrackBox = {
  id: number;
  // normalized [0..1] frame coords
  cx: number; cy: number; w: number; h: number;
  score: number;
  missed: number; // frames since last real detection (0 = seen this frame)
  vx: number; vy: number; // per-frame center velocity (smoothed)
};

const IN = 640;
const PERSON = 0; // COCO class 0
const SCORE_HI = 0.5;
const SCORE_LO = 0.1;
const IOU_MATCH = 0.2;
const MAX_MISSED = 60;

type Det = { cx: number; cy: number; w: number; h: number; score: number };

const iou = (a: { cx: number; cy: number; w: number; h: number }, b: { cx: number; cy: number; w: number; h: number }) => {
  const ax0 = a.cx - a.w / 2, ay0 = a.cy - a.h / 2, ax1 = a.cx + a.w / 2, ay1 = a.cy + a.h / 2;
  const bx0 = b.cx - b.w / 2, by0 = b.cy - b.h / 2, bx1 = b.cx + b.w / 2, by1 = b.cy + b.h / 2;
  const ix = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
  const iy = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));
  const inter = ix * iy;
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
};

export async function createPersonTracker() {
  const bundle = await createOrtSession("/models/yolov8s.onnx", { forceWasm: true });
  const { ort, session } = bundle;
  const canvas = document.createElement("canvas");
  canvas.width = IN; canvas.height = IN;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  type Track = TrackBox & { vx: number; vy: number };
  let tracks: Track[] = [];
  let nextId = 1;

  const detect = async (video: HTMLVideoElement): Promise<Det[]> => {
    const vw = video.videoWidth, vh = video.videoHeight;
    // letterbox into 640×640
    const scale = Math.min(IN / vw, IN / vh);
    const dw = vw * scale, dh = vh * scale;
    const ox = (IN - dw) / 2, oy = (IN - dh) / 2;
    ctx.fillStyle = "#727272";
    ctx.fillRect(0, 0, IN, IN);
    ctx.drawImage(video, ox, oy, dw, dh);
    const img = ctx.getImageData(0, 0, IN, IN).data;
    const plane = IN * IN;
    const input = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      input[i] = img[i * 4] / 255;
      input[plane + i] = img[i * 4 + 1] / 255;
      input[2 * plane + i] = img[i * 4 + 2] / 255;
    }
    const res = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, IN, IN]) });
    const out = res[session.outputNames[0]].data as Float32Array; // [1, 84, 8400]
    const N = 8400;
    const dets: Det[] = [];
    for (let i = 0; i < N; i++) {
      const score = out[(4 + PERSON) * N + i];
      if (score < SCORE_LO) continue;
      const cx = (out[i] - ox) / dw;
      const cy = (out[N + i] - oy) / dh;
      const w = out[2 * N + i] / dw;
      const h = out[3 * N + i] / dh;
      if (w <= 0 || h <= 0 || cx < -0.1 || cx > 1.1 || cy < -0.1 || cy > 1.1) continue;
      dets.push({ cx, cy, w, h, score });
    }
    // NMS
    dets.sort((a, b) => b.score - a.score);
    const kept: Det[] = [];
    for (const d of dets) {
      if (kept.length >= 12) break;
      if (kept.some((k) => iou(k, d) > 0.45)) continue;
      kept.push(d);
    }
    return kept;
  };

  return {
    /** advance one frame: returns the live track list (id → stable across frames) */
    async step(video: HTMLVideoElement): Promise<TrackBox[]> {
      const dets = await detect(video);
      // predict all tracks forward
      for (const t of tracks) { t.cx += t.vx; t.cy += t.vy; }

      const hi = dets.filter((d) => d.score >= SCORE_HI);
      const lo = dets.filter((d) => d.score < SCORE_HI);
      const usedDet = new Set<Det>();
      const matched = new Set<Track>();

      // ByteTrack two-stage greedy IoU association: confident detections first,
      // then let low-score (partially occluded) detections keep tracks alive
      const associate = (pool: Det[], minIou: number) => {
        const pairs: { t: Track; d: Det; v: number }[] = [];
        for (const t of tracks) {
          if (matched.has(t)) continue;
          for (const d of pool) {
            if (usedDet.has(d)) continue;
            const v = iou(t, d);
            if (v >= minIou) pairs.push({ t, d, v });
          }
        }
        pairs.sort((a, b) => b.v - a.v);
        for (const p of pairs) {
          if (matched.has(p.t) || usedDet.has(p.d)) continue;
          matched.add(p.t); usedDet.add(p.d);
          const px = p.t.cx, py = p.t.cy;
          p.t.vx = p.t.vx * 0.5 + (p.d.cx - (px - p.t.vx)) * 0.5 * 0.5; // half-weight toward observed step
          p.t.vy = p.t.vy * 0.5 + (p.d.cy - (py - p.t.vy)) * 0.5 * 0.5;
          p.t.cx = p.d.cx; p.t.cy = p.d.cy;
          p.t.w = p.t.w * 0.5 + p.d.w * 0.5;
          p.t.h = p.t.h * 0.5 + p.d.h * 0.5;
          p.t.score = p.d.score;
          p.t.missed = 0;
        }
      };
      associate(hi, IOU_MATCH);
      associate(lo, 0.3);

      for (const t of tracks) if (!matched.has(t)) t.missed++;
      tracks = tracks.filter((t) => t.missed <= MAX_MISSED);

      // fresh confident detections become new tracks
      for (const d of hi) {
        if (usedDet.has(d)) continue;
        tracks.push({ id: nextId++, cx: d.cx, cy: d.cy, w: d.w, h: d.h, score: d.score, missed: 0, vx: 0, vy: 0 });
      }
      return tracks.map(({ id, cx, cy, w, h, score, missed, vx, vy }) => ({ id, cx, cy, w, h, score, missed, vx, vy }));
    },

    /** cheap in-between frame: advance predictions only, no detector run.
     *  missed is NOT incremented — it counts detector-backed steps only. */
    predictOnly(): TrackBox[] {
      for (const t of tracks) { t.cx += t.vx; t.cy += t.vy; }
      return tracks.map(({ id, cx, cy, w, h, score, missed, vx, vy }) => ({ id, cx, cy, w, h, score, missed, vx, vy }));
    },

    reset() { tracks = []; nextId = 1; },
    close() { try { bundle.session.release?.(); } catch { /* session GC'd with page */ } },
  };
}
