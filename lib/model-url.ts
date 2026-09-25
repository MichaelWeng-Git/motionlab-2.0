// Where the on-device model weights are served from — one answer, one place.
//
// public/models/ is 4.9 GB across 12 files and is git-ignored, so it exists on
// this machine and nowhere else. Every path below used to be the hard-coded
// string "/models/…", which works in dev and 404s in production: the analysis
// pipeline would fail on every single video, with no build error to warn anyone.
//
// So the base is configurable. Unset, it stays "/models" and dev is unchanged;
// in production it points at object storage + CDN, e.g.
//
//   NEXT_PUBLIC_MODEL_BASE=https://models.example.com/v1
//
// Two requirements on whatever serves it:
//   · CORS — onnxruntime-web and MediaPipe both FETCH these URLs, so the bucket
//     needs Access-Control-Allow-Origin for the app's origin. Without it the
//     browser blocks the response and the model looks missing.
//   · Immutable, versioned paths — a weight file's bytes define the model. Put a
//     version in the base (…/v1) and never overwrite a file in place, or a cached
//     client and a fresh one will silently be running different models.
//
// The 12 files, by size: sapiens_06b_fp16 1.2G, vitpose_h_fp16 1.2G,
// vitpose_l_fp32 1.1G, sapiens_03b_fp16 629M, rtmpose_x 189M, vitpose_fp16 164M,
// motionbert_3d_243 162M, vitpose_int8 83M, yolov8s 43M, and the three
// pose_landmarker .task files (29M / 9M / 5.5M).
//
// public/ort and public/mediapipe/wasm stay same-origin on purpose: they are
// tracked in git, small enough to ship with the app, and the ORT loader depends
// on a same-origin import.meta.url to spawn its workers (see lib/ort-loader.ts).

const BASE = (process.env.NEXT_PUBLIC_MODEL_BASE || "/models").replace(/\/+$/, "");

/** True when weights come from somewhere other than this app's own /public. */
export const MODELS_ARE_REMOTE = !BASE.startsWith("/");

export function modelUrl(file: string): string {
  return `${BASE}/${file}`;
}

/**
 * Raised when the backbone weights cannot be fetched. Distinct from a bad video
 * or a pipeline bug: the fix is a connection or a deploy, not another clip. The
 * analyze screen shows `message`; the console carries the URL for whoever
 * deployed it.
 */
export class ModelsUnavailableError extends Error {
  constructor(readonly cause?: unknown) {
    super("Couldn’t load the analysis models. Check your connection and try again.");
    this.name = "ModelsUnavailableError";
  }
}
