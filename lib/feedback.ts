// Feedback helpers that power the borrowed "signature" modules:
//  · body-part → landmark (Onform-style video annotation)
//  · rep detection + count (SwingVision auto-recognition / TrackMan per-rep)
//  · target ranges (Sportsbox goal lines on the radar)

import type { Frame } from "./analysis";

// MediaPipe Pose landmark indices
const IDX: Record<string, number> = {
  nose: 0,
  shoulder_l: 11, shoulder_r: 12,
  elbow_l: 13, elbow_r: 14,
  wrist_l: 15, wrist_r: 16,
  hip_l: 23, hip_r: 24,
  knee_l: 25, knee_r: 26,
  ankle_l: 27, ankle_r: 28,
};

// Map the AI coach's free-text body part ("Left elbow", "Core / hips", "Front foot")
// to a single landmark to circle on the video.
export function bodyPartToLandmark(bodyPart?: string): number | null {
  if (!bodyPart) return null;
  const s = bodyPart.toLowerCase();
  const right = /\bright\b/.test(s);
  const left = /\bleft\b/.test(s);
  const side = right ? "_r" : left ? "_l" : "_r"; // default right-ish
  const pick = (base: string) => IDX[`${base}${side}`] ?? null;

  if (/elbow/.test(s)) return pick("elbow");
  if (/wrist|hand|grip|racket|club/.test(s)) return pick("wrist");
  if (/shoulder/.test(s)) return pick("shoulder");
  if (/knee/.test(s)) return pick("knee");
  if (/ankle|foot|feet|toe/.test(s)) return pick("ankle");
  if (/hip|core|pelvis|balance|weight|center/.test(s)) return IDX.hip_r; // hip region
  if (/head|neck|chin|posture/.test(s)) return IDX.nose;
  if (/back|torso|chest|spine|body/.test(s)) return IDX.shoulder_r;
  return null;
}

// Which joint moves the most? That's the "working" joint we track for reps.
function busiestJoint(frames: Frame[]): number {
  const candidates = [IDX.wrist_r, IDX.wrist_l, IDX.ankle_r, IDX.ankle_l];
  let best = IDX.wrist_r, bestVar = -1;
  for (const j of candidates) {
    const ys: number[] = [];
    for (const f of frames) if (f.lm[j]) ys.push(f.lm[j].y);
    if (ys.length < 5) continue;
    const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
    const v = ys.reduce((a, b) => a + (b - mean) ** 2, 0) / ys.length;
    if (v > bestVar) { bestVar = v; best = j; }
  }
  return best;
}

// Detect repetitions from the busiest joint's vertical oscillation.
// Returns the timestamp (s) at the top of each rep, plus the joint used.
export function detectReps(frames: Frame[]): { times: number[]; joint: number } {
  const good = frames.filter((f) => f.lm.length > 0);
  if (good.length < 12) return { times: [], joint: IDX.wrist_r };
  const joint = busiestJoint(good);

  // smooth the y-signal a touch
  const ys = good.map((f) => f.lm[joint]?.y ?? 0.5);
  const sm = ys.map((_, i) => {
    const a = Math.max(0, i - 1), b = Math.min(ys.length - 1, i + 1);
    return (ys[a] + ys[i] + ys[b]) / 3;
  });

  const min = Math.min(...sm), max = Math.max(...sm);
  const amp = max - min;
  if (amp < 0.05) return { times: [], joint }; // barely moving → not rep-based

  // count local minima (joint highest on screen = smallest y) as rep tops,
  // with hysteresis so noise doesn't create phantom reps
  const times: number[] = [];
  const thresh = amp * 0.35;
  let armed = false;
  for (let i = 1; i < sm.length - 1; i++) {
    if (sm[i] > min + amp * 0.6) armed = true; // returned to bottom → ready for next rep
    if (armed && sm[i] < sm[i - 1] && sm[i] <= sm[i + 1] && sm[i] < min + thresh) {
      times.push(good[i].t);
      armed = false;
    }
  }
  return { times, joint };
}

// Default "good amateur" target for each radar axis — the pass-line to beat.
// A flat, encouraging 70 works for our 0-100 scoring across sports.
export const RADAR_TARGET = 70;
