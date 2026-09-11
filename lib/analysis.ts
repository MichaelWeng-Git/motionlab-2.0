// The analysis engine.
// Layer 1 (professional): objective metrics computed from MediaPipe's 33 pose
// landmarks across every frame. Layer 2 (translation): those numbers become
// plain-language coaching — praise first, then one thing to fix.
// No jargon ever reaches the user.

export type Frame = {
  t: number; // seconds
  // 33 landmarks; z = depth (for the 3D view); est = inferred through occlusion.
  // `fix` records a repair the cleanup chain made — what it changed and why —
  // so nothing is corrected silently (lib/pose-post FixNote).
  lm: {
    x: number; y: number; z?: number; visibility?: number; est?: boolean;
    fix?: {
      r: "LEFT_RIGHT_SWAP" | "TEMPORAL_SPIKE" | "BONE_LENGTH_VIOLATION"
        | "ANATOMICAL_VIOLATION" | "LOW_CONFIDENCE_OCCLUSION";
      m: "swap" | "interpolate" | "hold" | "trajectory";
      ox: number; oy: number; oc?: number;
    };
    // Rival detections for this joint kept from the OTHER pose model when the
    // two disagreed. lib/pose-associate scores these against anatomy and
    // trajectory instead of trusting the leader by default.
    cand?: { x: number; y: number; c: number; src: string }[];
  }[];
  world?: { x: number; y: number; z?: number; visibility?: number }[]; // metric 3D skeleton (meters, hip-centered) — raw fallback
  pose3d?: { x: number; y: number; z: number }[]; // 17 H36M joints lifted by MotionBERT — drives the 3D view
};

export type Quality = { label: string; value: number };
export type TipOut = {
  rating: "good" | "okay" | "work";
  title: string;
  detail: string;
  bodyPart: string;
  // video-native coaching overlay bindings (AI-written; optional for old reports)
  when?: number;                              // 0-1 fraction of the clip: the clearest moment of this issue
  cue?: string;                               // ultra-short cue shown on the video ("Lift that knee higher")
  dir?: "up" | "forward" | "back" | "down";   // direction the body part should move
  exercise?: { id?: string; name: string; how: string; dose: string }; // ONE drill for this exact point (id = catalog id)
};
export type KeyMoment = { t: number; kind: "peak" | "stutter"; label: string };

export type AnalysisResult = {
  sport?: string;   // recognized by the AI coach
  action?: string;
  ai?: boolean;     // true when the report text came from the LLM
  // Legacy only. New reports visualise the deterministic `qualities` below;
  // LLM-authored radar numbers are never presented as measurements.
  radar?: { label: string; value: number }[];
  proMatch?: {
    score: number;
    pro: string;
    action: string;
    why: string;
    youtubeQuery: string;
    moments: { verdict: "good" | "close" | "work"; label: string; note: string }[];
  }; // user-vs-professional comparison, written by the AI coach
  score: number;
  headline: string;
  qualities: Quality[];
  tips: TipOut[];
  drill: { title: string; detail: string };
  keyMoments: KeyMoment[];
  frames: number;
  duration: number;
  date: string;
  // deterministic biomechanics computed from the 3D pose (lib/biomech) —
  // joint angles/ROM/tempo/rep phases + left/right muscle demand
  biomech?: import("./biomech").BiomechReport;
  biomechFailure?: import("./biomech").BiomechFailure;
};

// Body-only skeleton — no face points, no finger detail. Less ink, clearer read.
export const CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], // arms
  [11, 23], [12, 24], [23, 24],                     // torso
  [23, 25], [25, 27], [24, 26], [26, 28],           // legs
  [27, 31], [28, 32],                               // feet
];
export const BODY_JOINTS = [...new Set(CONNECTIONS.flat())];

export type Snapshot = { t: number; kind: KeyMoment["kind"]; label: string; img: string };

// ——— replay store (in-memory: survives client-side navigation, not refresh) ———
let replay: { videoUrl: string; frames: Frame[]; snapshots: Snapshot[] } | null = null;
export function setReplay(r: { videoUrl: string; frames: Frame[]; snapshots: Snapshot[] }) {
  replay = r;
}
export function getReplay() {
  return replay;
}

// starting a NEW analysis wipes the old one — a fresh run is a fresh start
export function clearAnalysis() {
  replay = null;
  try {
    localStorage.removeItem("ml_last_analysis");
  } catch {}
}

// joints below this confidence are hidden instead of drawn as jittery guesses
export const VIS_MIN = 0.55;

// Offline second pass: run the smoother backwards over the finished recording.
// Combined with the forward pass at capture time ≈ zero-phase filtering — the
// pro-tool trick that real-time processing can't do.
export function smoothBackward(frames: Frame[]): Frame[] {
  if (frames.length < 3) return frames;
  const sm = makeSmoother();
  const rev = [...frames].reverse();
  const t0 = rev[0].t;
  const out = rev.map((f) => (f.lm.length ? { ...f, lm: sm(f.lm, t0 - f.t) } : f));
  return out.reverse();
}

// One-Euro-style temporal smoothing: kills jitter when still, stays responsive when fast.
// (The same trick professional mocap pipelines use.)
export function makeSmoother() {
  let prev: { x: number; y: number }[] | null = null;
  let prevT = 0;
  const FC_MIN = 1.2; // baseline smoothing strength
  const BETA = 40;    // how quickly smoothing releases as speed rises
  return (lm: { x: number; y: number; visibility?: number }[], t: number) => {
    if (!prev) {
      prev = lm.map((p) => ({ x: p.x, y: p.y }));
      prevT = t;
      return lm;
    }
    const dt = Math.min(Math.max(t - prevT, 1 / 120), 0.1);
    prevT = t;
    return lm.map((p, i) => {
      const pr = prev![i];
      const speed = Math.hypot(p.x - pr.x, p.y - pr.y) / dt;
      const fc = FC_MIN + BETA * speed;
      const a = 1 / (1 + 1 / (2 * Math.PI * fc * dt));
      const x = a * p.x + (1 - a) * pr.x;
      const y = a * p.y + (1 - a) * pr.y;
      prev![i] = { x, y };
      return { ...p, x, y };
    });
  };
}

// landmark indices (MediaPipe Pose)
const L = {
  nose: 0,
  lShoulder: 11, rShoulder: 12,
  lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24,
  lAnkle: 27, rAnkle: 28,
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function mid(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function mean(xs: number[]) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
function std(xs: number[]) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function computeAnalysis(frames: Frame[], duration: number): AnalysisResult | null {
  // keep only frames where the body is actually visible
  const good = frames.filter((f) => {
    const vis = [L.lShoulder, L.rShoulder, L.lHip, L.rHip].map((i) => f.lm[i]?.visibility ?? 0);
    return mean(vis) > 0.5;
  });
  if (good.length < 20 || good.length / Math.max(1, frames.length) < 0.25) return null;

  // body scale: torso length, used to normalize everything (camera-distance invariant)
  const torso = mean(
    good.map((f) => dist(mid(f.lm[L.lShoulder], f.lm[L.rShoulder]), mid(f.lm[L.lHip], f.lm[L.rHip])))
  );
  const scale = Math.max(torso, 0.05);

  // per-frame motion of hands + feet (the "doing" parts)
  const speeds: number[] = [];
  const wristSpeeds: number[] = [];
  for (let i = 1; i < good.length; i++) {
    const dt = Math.max(good[i].t - good[i - 1].t, 1 / 60);
    const pts = [L.lWrist, L.rWrist, L.lAnkle, L.rAnkle];
    const v = mean(pts.map((p) => dist(good[i].lm[p], good[i - 1].lm[p]) / dt)) / scale;
    speeds.push(v);
    const wv = Math.max(
      dist(good[i].lm[L.lWrist], good[i - 1].lm[L.lWrist]) / dt,
      dist(good[i].lm[L.rWrist], good[i - 1].lm[L.rWrist]) / dt
    ) / scale;
    wristSpeeds.push(wv);
  }

  // — smoothness: how jerky the accelerations are, relative to how fast you move
  const accels: number[] = [];
  for (let i = 1; i < speeds.length; i++) accels.push(Math.abs(speeds[i] - speeds[i - 1]));
  const jerkRatio = mean(accels) / (mean(speeds) + 0.01);
  const smoothness = Math.round(clamp(96 - jerkRatio * 55, 35, 96));

  // — balance: how much the hips sway sideways, relative to torso size
  const hipXs = good.map((f) => mid(f.lm[L.lHip], f.lm[L.rHip]).x);
  const sway = std(hipXs) / scale;
  const balance = Math.round(clamp(96 - sway * 220, 35, 96));

  // — rhythm: consistency of motion energy over time
  const cv = std(speeds) / (mean(speeds) + 0.01);
  const rhythm = Math.round(clamp(97 - cv * 34, 35, 96));

  // — power flow: peak hand speed (torso-lengths per second)
  const peak = wristSpeeds.length ? Math.max(...wristSpeeds) : 0;
  const power = Math.round(clamp(34 + peak * 7.5, 35, 96));

  const qualities: Quality[] = [
    { label: "Smoothness", value: smoothness },
    { label: "Balance", value: balance },
    { label: "Rhythm", value: rhythm },
    { label: "Power flow", value: power },
  ];

  const score = Math.round(smoothness * 0.3 + balance * 0.25 + rhythm * 0.25 + power * 0.2);

  // ——— translation layer: praise first, then coach ———
  const sorted = [...qualities].sort((a, b) => b.value - a.value);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const second = sorted[sorted.length - 2];

  const PRAISE: Record<string, TipOut> = {
    Smoothness: { rating: "good", title: "Really fluid movement", detail: "Your motion flows without hitches — that's something a lot of people struggle with. Keep it.", bodyPart: "Whole body" },
    Balance: { rating: "good", title: "Rock-solid balance", detail: "Your body stays centered while you move — that's a great base to build on.", bodyPart: "Core / hips" },
    Rhythm: { rating: "good", title: "Great rhythm", detail: "Your pace is steady and controlled — movements repeat consistently. Nice.", bodyPart: "Timing" },
    "Power flow": { rating: "good", title: "Real snap in your movement", detail: "You generate genuine speed — the power is there, we just shape it.", bodyPart: "Arms / hands" },
  };

  const COACH: Record<string, TipOut> = {
    Smoothness: { rating: "work", title: "The motion has little stutters", detail: "It starts and stops in small bursts instead of one flow. Try doing it slower but without stopping — slow and connected beats fast and choppy.", bodyPart: "Whole body" },
    Balance: { rating: "work", title: "Your body drifts sideways", detail: "Your hips shift around while you move, which leaks power and tires you out. Imagine a cup of water on your head — keep it from spilling.", bodyPart: "Core / hips" },
    Rhythm: { rating: "work", title: "The pacing jumps around", detail: "Some moments rush, some stall. Try counting a steady beat in your head — same speed in, same speed out.", bodyPart: "Timing" },
    "Power flow": { rating: "work", title: "The power stays locked up", detail: "Your movement is careful but quiet — there's more speed in you. Finish each move like you mean it, then relax.", bodyPart: "Arms / hands" },
  };

  const OKAY: Record<string, TipOut> = {
    Smoothness: { rating: "okay", title: "Flow is close", detail: "Mostly fluid with a few catches. One notch slower and it'll feel silky.", bodyPart: "Whole body" },
    Balance: { rating: "okay", title: "Balance is nearly there", detail: "Just a touch of sway under effort. Plant your feet a little wider and it locks in.", bodyPart: "Core / hips" },
    Rhythm: { rating: "okay", title: "Rhythm is close", detail: "The beat is mostly there — it drifts when you push harder. Stay on the count.", bodyPart: "Timing" },
    "Power flow": { rating: "okay", title: "More speed available", detail: "Good control — now let it out a bit. Accelerate through the middle of the move.", bodyPart: "Arms / hands" },
  };

  // ——— body check: concrete, side-specific observations an amateur can act on ———
  const shoulderTilt = mean(good.map((f) => f.lm[L.lShoulder].y - f.lm[L.rShoulder].y)) / scale; // + = left lower
  const hipTilt = mean(good.map((f) => f.lm[L.lHip].y - f.lm[L.rHip].y)) / scale;
  const lean = mean(good.map((f) => mid(f.lm[L.lShoulder], f.lm[L.rShoulder]).x - mid(f.lm[L.lHip], f.lm[L.rHip]).x)) / scale;

  const bodyObs: { mag: number; tip: TipOut }[] = [];
  if (Math.abs(shoulderTilt) > 0.07) {
    const rightHigh = shoulderTilt > 0;
    bodyObs.push({
      mag: Math.abs(shoulderTilt),
      tip: {
        rating: Math.abs(shoulderTilt) > 0.13 ? "work" : "okay",
        title: rightHigh ? "Your right shoulder rides higher than your left" : "Your left shoulder rides higher than your right",
        detail: `Through the whole clip, your ${rightHigh ? "right" : "left"} shoulder stays lifted. Let it relax down so both shoulders sit level — one mirror check before you start usually fixes it.`,
        bodyPart: rightHigh ? "Right shoulder" : "Left shoulder",
      },
    });
  }
  if (Math.abs(hipTilt) > 0.06) {
    const rightHigh = hipTilt > 0;
    bodyObs.push({
      mag: Math.abs(hipTilt),
      tip: {
        rating: Math.abs(hipTilt) > 0.11 ? "work" : "okay",
        title: `Your hips tilt — the ${rightHigh ? "right" : "left"} side sits higher`,
        detail: `Your ${rightHigh ? "right" : "left"} hip stays higher through the movement, which usually means one side is doing extra work. Try evening out the weight between both feet.`,
        bodyPart: rightHigh ? "Right hip" : "Left hip",
      },
    });
  }
  if (Math.abs(lean) > 0.10) {
    bodyObs.push({
      mag: Math.abs(lean) * 0.8,
      tip: {
        rating: "okay",
        title: "Your upper body drifts off your base",
        detail: "Your chest doesn't stay stacked over your hips — it drifts to one side. Think 'chest over hips' and the whole movement gets more stable.",
        bodyPart: "Torso",
      },
    });
  }
  bodyObs.sort((a, b) => b.mag - a.mag);

  // 3 tips: praise the best thing, coach the weakest metric, then the top body observation
  const tips: TipOut[] = [PRAISE[best.label], COACH[worst.label], bodyObs[0]?.tip ?? OKAY[second.label]];

  const DRILLS: Record<string, { title: string; detail: string }> = {
    Smoothness: { title: "Slow-flow reps", detail: "10 reps at half speed with zero pauses — the only rule is the movement never stops." },
    Balance: { title: "Still-hips drill", detail: "10 slow reps with your hips as quiet as possible. Film from the front to check the drift." },
    Rhythm: { title: "Metronome reps", detail: "10 reps counting '1-and-2' out loud — every rep on exactly the same beat." },
    "Power flow": { title: "Snap finish drill", detail: "10 reps where the last third is fast — slow start, quick finish, full relax." },
  };

  // ——— key moments: auto-found highlights the replay can jump to ———
  const keyMoments: KeyMoment[] = [];
  if (wristSpeeds.length) {
    const peakIdx = wristSpeeds.indexOf(Math.max(...wristSpeeds));
    keyMoments.push({ t: good[Math.min(peakIdx + 1, good.length - 1)].t, kind: "peak", label: "Peak power" });
  }
  // the two roughest patches (biggest accel spikes), kept apart from each other & the peak
  const spikes = accels
    .map((a, i) => ({ a, t: good[Math.min(i + 2, good.length - 1)].t }))
    .sort((x, y) => y.a - x.a);
  for (const s of spikes) {
    if (keyMoments.length >= 3) break;
    if (s.t < 0.5 || s.t > duration - 0.5) continue; // skip scan-edge artifacts
    if (keyMoments.every((k) => Math.abs(k.t - s.t) > 1.5)) {
      keyMoments.push({ t: s.t, kind: "stutter", label: "Flow breaks here" });
    }
  }
  keyMoments.sort((x, y) => x.t - y.t);

  const headline =
    score >= 80
      ? `Strong session! ${best.label} is your superpower — one tweak on ${worst.label.toLowerCase()} and you level up.`
      : score >= 60
      ? `Solid work! Your ${best.label.toLowerCase()} stands out. Focus on ${worst.label.toLowerCase()} next and the score jumps.`
      : `Good starting point. Everyone begins somewhere — ${worst.label.toLowerCase()} is the fastest win from here.`;

  return {
    score,
    headline,
    qualities,
    tips,
    drill: DRILLS[worst.label],
    keyMoments,
    frames: frames.length,
    duration,
    date: new Date().toISOString(),
  };
}

export function saveAnalysis(a: AnalysisResult) {
  localStorage.setItem("ml_last_analysis", JSON.stringify(a));
}

export function getLastAnalysis(): AnalysisResult | null {
  try {
    return JSON.parse(localStorage.getItem("ml_last_analysis") ?? "null");
  } catch {
    return null;
  }
}
