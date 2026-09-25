"use client";

// Two independent pose models, fused per frame.
//   · MediaPipe Pose (heavy)  — Google, 33 landmarks, our backbone
//   · MoveNet Thunder         — TensorFlow, 17 keypoints, different architecture
// Each model has its own failure modes; averaging the joints they BOTH see
// cancels model-specific jitter. If MoveNet can't load (offline), we fall
// back to MediaPipe alone — the pipeline never breaks.

import { modelUrl } from "./model-url";

type LM = { x: number; y: number; z?: number; visibility?: number };

// MoveNet (COCO-17) index → MediaPipe-33 index, for the joints both models share
const COCO_TO_MP: [number, number][] = [
  [5, 11], [6, 12],   // shoulders
  [7, 13], [8, 14],   // elbows
  [9, 15], [10, 16],  // wrists
  [11, 23], [12, 24], // hips
  [13, 25], [14, 26], // knees
  [15, 27], [16, 28], // ankles
];

const MP_WEIGHT = 0.65; // MediaPipe stays primary; MoveNet refines

export type PersonSeed = { x: number; y: number; diag: number; t?: number };
export type ProbedPerson = { x: number; y: number; diag: number };

// Quick people scan for the "who are we watching?" picker: detect on a few
// timestamps, return the timestamp with the MOST people found plus everyone's
// center/size. Uses its own throwaway landmarker (IMAGE mode) and closes it.
export async function probePeople(
  video: HTMLVideoElement,
  times: number[]
): Promise<{ t: number; people: ProbedPerson[] }> {
  // MoveNet MULTIPOSE is the right tool here — MediaPipe's multi-person support
  // NMS-es away small/far people (validated: it maxed at 1 person on a clip with 3).
  const tf = await import("@tensorflow/tfjs-core");
  await import("@tensorflow/tfjs-backend-webgl");
  await tf.setBackend("webgl");
  await tf.ready();
  const poseDetection = await import("@tensorflow-models/pose-detection");
  const det = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
    modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
    enableTracking: false,
  });
  const seekTo = (t: number) =>
    new Promise<void>((res) => {
      const timer = setTimeout(res, 2000);
      video.addEventListener("seeked", () => { clearTimeout(timer); res(); }, { once: true });
      video.currentTime = t;
    });

  // one detect pass over a region (sx/sy/sw/sh in source pixels), coords mapped
  // back to full-frame units. Tiling is how far-away people get found at all —
  // a 60px runner is a speck to the full-frame pass but full-size in a tile.
  const tileCanvas = document.createElement("canvas");
  tileCanvas.width = 512; tileCanvas.height = 512;
  const tileCtx = tileCanvas.getContext("2d", { willReadFrequently: false })!;
  const detectRegion = async (sx: number, sy: number, sw: number, sh: number): Promise<ProbedPerson[]> => {
    tileCtx.drawImage(video, sx, sy, sw, sh, 0, 0, 512, 512);
    const poses = await det.estimatePoses(tileCanvas, { maxPoses: 6 });
    const out: ProbedPerson[] = [];
    const vw = video.videoWidth, vh = video.videoHeight;
    for (const pose of poses ?? []) {
      const kps = (pose.keypoints ?? []).filter((k) => (k.score ?? 0) >= 0.3);
      if (kps.length < 8) continue;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, cx = 0, cy = 0;
      for (const k of kps) {
        minX = Math.min(minX, k.x); maxX = Math.max(maxX, k.x);
        minY = Math.min(minY, k.y); maxY = Math.max(maxY, k.y);
        cx += k.x; cy += k.y;
      }
      cx /= kps.length; cy /= kps.length;
      const fx = (sx + (cx / 512) * sw) / vw, fy = (sy + (cy / 512) * sh) / vh;
      const diag = Math.hypot(((maxX - minX) / 512) * sw / vw, ((maxY - minY) / 512) * sh / vh);
      if (diag < 0.02 || diag > 1.2) continue;
      out.push({ x: fx, y: fy, diag });
    }
    return out;
  };

  let best: { t: number; people: ProbedPerson[] } = { t: times[0] ?? 0, people: [] };
  try {
    for (const t of times) {
      await seekTo(Math.min(t, Math.max(0, video.duration - 0.01)));
      const vw = video.videoWidth, vh = video.videoHeight;
      // full frame + overlapping 2×2 tiles
      const found: ProbedPerson[] = [...(await detectRegion(0, 0, vw, vh))];
      const tw = vw * 0.6, th = vh * 0.6;
      for (const [fx, fy] of [[0, 0], [0.4, 0], [0, 0.4], [0.4, 0.4]] as const) {
        try { found.push(...(await detectRegion(vw * fx, vh * fy, tw, th))); } catch { /* tile is best-effort */ }
      }
      // dedupe by BODY WIDTH, not diagonal (people are tall — a half-diagonal
      // radius merges two separate runners that are merely approaching each other)
      const people: ProbedPerson[] = [];
      for (const cand of found.sort((a, b) => b.diag - a.diag)) {
        if (people.some((p) => {
          const m = Math.max(p.diag, cand.diag);
          return Math.abs(p.x - cand.x) < m * 0.25 && Math.abs(p.y - cand.y) < m * 0.45;
        })) continue;
        people.push(cand);
      }
      console.log("[probe]", { t: +t.toFixed(2), raw: found.length, deduped: people.length, people: people.map((p) => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2), d: +p.diag.toFixed(2) })) });
      if (people.length > best.people.length) best = { t, people };
      if (best.people.length >= 3) break;
    }
  } finally {
    det.dispose();
  }
  return best;
}

export async function createEnsemble(seed?: PersonSeed) {
  const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
  const mp = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelUrl("pose_landmarker_heavy.task"), delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 3, // courts have opponents/bystanders — detect several, then LOCK ONTO ONE
  });
  // second-pass landmarker for ZOOMED-IN redetection (IMAGE mode: crops are stills).
  // Far-away athletes (tennis court scale) are only a handful of pixels to the
  // full-frame pass; re-running on a tight crop is the standard top-down fix.
  const mpCrop = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelUrl("pose_landmarker_heavy.task"), delegate: "GPU" },
    runningMode: "IMAGE",
    numPoses: 2, // a crossing crop can contain two bodies — we pick by crop center
  });
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = 512; cropCanvas.height = 512;
  const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: false })!;

  // second opinion — optional, never fatal
  let movenet: import("@tensorflow-models/pose-detection").PoseDetector | null = null;
  try {
    const tf = await import("@tensorflow/tfjs-core");
    await import("@tensorflow/tfjs-backend-webgl");
    await tf.setBackend("webgl");
    await tf.ready();
    const poseDetection = await import("@tensorflow-models/pose-detection");
    movenet = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
    });
  } catch (e) {
    console.warn("MoveNet unavailable — running MediaPipe only", e);
  }

  // ——— person identity ———
  // SEEDED (user tapped who to analyze): Stage-① architecture — YOLOv8s person
  // detection + ByteTrack association (lib/track.ts) owns identity; MediaPipe only
  // reads the pose INSIDE the tracked box. (The old hand-rolled center-distance
  // lock — velocity coasting, crossing freeze, torso-color — was removed: two
  // runners crossing defeated every variant of it, which is exactly the MOT
  // problem ByteTrack solves.)
  // Un-seeded (single person): legacy largest-person MediaPipe lock.
  let lockedCenter: { x: number; y: number } | null = seed ? { x: seed.x, y: seed.y } : null;
  let tracker: Awaited<ReturnType<typeof import("./track").createPersonTracker>> | null = null;
  let trackId: number | null = null;
  // last emitted position+velocity — lets us REBIND to a fresh track id when
  // ByteTrack fragments the track through a long occlusion (old id orphaned,
  // re-detection spawned a new id): the person re-appears where dead-reckoning
  // from the last good frame says, an impostor doesn't
  let lastGood: { cx: number; cy: number; vx: number; vy: number; age: number } | null = null;
  let trackFrame = 0;
  if (seed) {
    try {
      const { createPersonTracker } = await import("./track");
      tracker = await createPersonTracker();
    } catch (e) {
      console.warn("person tracker unavailable — falling back to MediaPipe lock", e);
    }
  }
  const lkPush = (m: string) => { (window as unknown as { __lkLog?: string[] }).__lkLog?.push(m); };

  return {
    twoModels: !!movenet,

    async detect(video: HTMLVideoElement, tMs: number): Promise<{ lm: LM[]; world: LM[] } | null> {
      // ——— Stage-① tracked path: YOLO+ByteTrack owns WHO, MediaPipe reads the
      // pose inside that person's box. Identity never depends on pose output. ———
      if (seed && tracker) {
        // detector every 2nd frame; in-between frames coast on track velocity —
        // at ~30fps sampling this halves YOLO cost with no association risk
        trackFrame++;
        const tks = trackFrame % 2 === 1 ? await tracker.step(video) : tracker.predictOnly();
        if (trackId === null) {
          let best: (typeof tks)[number] | null = null, bd = 0.3;
          for (const t of tks) {
            const d = Math.hypot(t.cx - seed.x, t.cy - seed.y);
            if (d < bd) { bd = d; best = t; }
          }
          if (!best) { lkPush(`${tMs} SEED-MISS n${tks.length}`); return null; }
          trackId = best.id;
        }
        let tk = tks.find((t) => t.id === trackId) ?? null;
        // a coasting (missed) box is still trustworthy for a short occlusion —
        // beyond that, emit nothing rather than read someone else's pose
        if (!tk || tk.missed > 10) {
          if (lastGood) lastGood.age++;
          // REBIND: our id fragmented — adopt a live track that sits where the
          // dead-reckoned continuation of the last good frames says we should be
          if (lastGood && lastGood.age <= 60) {
            const ex = lastGood.cx + lastGood.vx * lastGood.age;
            const ey = lastGood.cy + lastGood.vy * lastGood.age;
            let best: (typeof tks)[number] | null = null, bd = 0.12;
            for (const t of tks) {
              if (t.missed > 0) continue; // only tracks backed by a real detection now
              const d = Math.hypot(t.cx - ex, t.cy - ey);
              if (d < bd) { bd = d; best = t; }
            }
            if (best) {
              trackId = best.id;
              tk = best;
              lkPush(`${tMs} REBIND id${trackId} d${bd.toFixed(2)}`);
            }
          }
          if (!tk || tk.missed > 10) { lkPush(`${tMs} LOST n${tks.length}`); return null; }
        }
        const vw = video.videoWidth, vh = video.videoHeight;
        let size = Math.max(tk.w * vw, tk.h * vh) * 1.5;
        let sx = tk.cx * vw - size / 2, sy = tk.cy * vh - size / 2;
        cropCtx.drawImage(video, sx, sy, size, size, 0, 0, 512, 512);
        let cropRes = mpCrop.detect(cropCanvas);
        if (!(cropRes.landmarks ?? []).length) {
          // partial occlusion (grass, furniture, another body) starves the tight
          // crop of context — one retry with a much wider view often recovers it
          size *= 2.2;
          sx = tk.cx * vw - size / 2; sy = tk.cy * vh - size / 2;
          cropCtx.drawImage(video, sx, sy, size, size, 0, 0, 512, 512);
          cropRes = mpCrop.detect(cropCanvas);
        }
        const cands = cropRes.landmarks ?? [];
        if (!cands.length) { lkPush(`${tMs} POSE-MISS id${trackId}`); return null; }
        // the tracked person is the one CENTERED in the crop
        let ci = -1, cbest = 0.35;
        for (let i = 0; i < cands.length; i++) {
          let ccx = 0, ccy = 0, n = 0;
          for (const p of cands[i]) { if ((p.visibility ?? 0) >= 0.3) { ccx += p.x; ccy += p.y; n++; } }
          if (!n) continue;
          const d = Math.hypot(ccx / n - 0.5, ccy / n - 0.5);
          if (d < cbest) { cbest = d; ci = i; }
        }
        if (ci < 0) { lkPush(`${tMs} POSE-OFFCENTER id${trackId}`); return null; }
        const lmT = cands[ci].map((p) => ({ x: (sx + p.x * size) / vw, y: (sy + p.y * size) / vh, z: p.z, visibility: p.visibility }));
        const worldT = cropRes.worldLandmarks?.[ci]?.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })) ?? [];
        lastGood = { cx: tk.cx, cy: tk.cy, vx: tk.vx, vy: tk.vy, age: 0 };
        lkPush(`${tMs} TK id${trackId} x${tk.cx.toFixed(2)},${tk.cy.toFixed(2)} m${tk.missed} n${tks.length}`);
        return { lm: lmT, world: worldT };
      }

      const mpRes = mp.detectForVideo(video, tMs);
      const people = mpRes.landmarks ?? [];
      if (!people.length) return null;

      const stats = people.map((lm) => {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, cx = 0, cy = 0, n = 0;
        for (const p of lm) {
          if ((p.visibility ?? 0) < 0.3) continue;
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
          cx += p.x; cy += p.y; n++;
        }
        return n
          ? { cx: cx / n, cy: cy / n, diag: Math.hypot(maxX - minX, maxY - minY), w: maxX - minX, h: maxY - minY, n }
          : null;
      });

      // This path is used for ordinary single-person clips and only as a
      // best-effort fallback when the YOLO/ByteTrack tracker could not load.
      // Keep it deliberately small: the removed crossing-freeze implementation
      // referenced orphaned state and could neither type-check nor run safely.
      let bestIdx = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < people.length; i++) {
        const s = stats[i];
        if (!s) continue;
        const stick = lockedCenter ? -1.5 * Math.hypot(s.cx - lockedCenter.x, s.cy - lockedCenter.y) : 0;
        const seedBias = seed && !lockedCenter ? -2 * Math.hypot(s.cx - seed.x, s.cy - seed.y) : 0;
        const score = s.diag + stick + seedBias;
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
      if (bestIdx < 0) return null;
      const chosen = stats[bestIdx]!;
      lockedCenter = { x: chosen.cx, y: chosen.cy };

      let lm = people[bestIdx].map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility }));
      // metric 3D skeleton (meters, hip-centered) — the good source for the 3D view
      let world = mpRes.worldLandmarks?.[bestIdx]?.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })) ?? [];

      // ——— zoom-in redetection for far-away athletes ———
      // If our person is small in frame, redo the detection on a tight square crop:
      // the model sees a full-size human instead of a speck → dramatically better joints.
      try {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
        for (const p of lm) {
          if ((p.visibility ?? 0) < 0.3) continue;
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
          n++;
        }
        const diag = n ? Math.hypot(maxX - minX, maxY - minY) : 1;
        if (n >= 8 && diag < 0.55) {
          const vw = video.videoWidth, vh = video.videoHeight;
          const cx = ((minX + maxX) / 2) * vw, cy = ((minY + maxY) / 2) * vh;
          const size = Math.max((maxX - minX) * vw, (maxY - minY) * vh) * 1.6;
          const sx = cx - size / 2, sy = cy - size / 2;
          cropCtx.drawImage(video, sx, sy, size, size, 0, 0, 512, 512);
          const cropRes = mpCrop.detect(cropCanvas);
          const cl = cropRes.landmarks?.[0];
          if (cl && cl.length === 33) {
            lm = cl.map((p) => ({
              x: (sx + p.x * size) / vw,
              y: (sy + p.y * size) / vh,
              z: p.z,
              visibility: p.visibility,
            }));
            const cw = cropRes.worldLandmarks?.[0];
            if (cw) world = cw.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility }));
          }
        }
      } catch {
        /* zoom pass is best-effort — full-frame result stands */
      }

      if (movenet) {
        try {
          const poses = await movenet.estimatePoses(video);
          const kp = poses?.[0]?.keypoints;
          if (kp) {
            const w = video.videoWidth, h = video.videoHeight;
            // SAME-PERSON check: MoveNet tracks whoever is most prominent — in a
            // multi-person shot that may not be OUR athlete. Fuse only if its
            // skeleton actually overlaps the one we locked onto.
            let dist = 0, dn = 0;
            for (const [ci, mi] of COCO_TO_MP) {
              const k = kp[ci];
              if (!k || (k.score ?? 0) < 0.35) continue;
              dist += Math.hypot(k.x / w - lm[mi].x, k.y / h - lm[mi].y);
              dn++;
            }
            const samePerson = dn >= 6 && dist / dn < 0.08;
            if (samePerson) {
              for (const [ci, mi] of COCO_TO_MP) {
                const k = kp[ci];
                if (!k || (k.score ?? 0) < 0.35) continue; // only fuse where MoveNet is confident
                const mvx = k.x / w, mvy = k.y / h;
                lm[mi].x = lm[mi].x * MP_WEIGHT + mvx * (1 - MP_WEIGHT);
                lm[mi].y = lm[mi].y * MP_WEIGHT + mvy * (1 - MP_WEIGHT);
              }
            }
          }
        } catch {
          /* one bad frame from the second model never blocks the pipeline */
        }
      }
      return { lm, world };
    },

    close() {
      mp.close();
      mpCrop.close();
      movenet?.dispose();
      tracker?.close();
    },
  };
}
