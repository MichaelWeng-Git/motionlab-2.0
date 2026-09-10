"use client";

// THE TRAINING RECORD — one Workout per training session, built once.
//
// Why this exists (P0-1, docs/P0-1-workout-model.md): one training can leave
// two records — a GPS recording in `ml_activities` and one or more analysed
// clips in `ml_sessions`. Every consumer used to read both stores directly and
// each got it wrong differently:
//
//   LOAD     added the clip's dose AND the recording's minutes for the same day
//   Recovery grouped clips as "running|easy run" and recordings as
//            "workout|running", so the same-session merge could never fire
//   CHARGE   read recordings only, so a video-only athlete had no CHARGE at all
//
// The pairing rule already existed inside sessionSecondsOf(); it just was not
// the model. Here it is the model: a recording and its clips are EVIDENCE about
// one Workout, never workouts themselves, so the double count disappears
// structurally rather than by subtracting somewhere.
//
// Formulas are untouched: REF_SESSION_SCALE, WEEK_FULL, bodyScale and
// computeRecovery all keep their current definitions. What changes is how many
// times they are applied.

import { DEFAULT_SESSION_MIN, legacyDemand, loadFromDemand } from "./biomech";

export { DEFAULT_SESSION_MIN };

// clips of one workout within this many hours are ONE session; also the slack
// allowed when matching a clip to a recording that brackets it
export const SESSION_WINDOW_H = 3;

export type SessionLike = {
  id: string; sport?: string; action?: string; date: string;
  // set by the athlete on the report — the only thing that turns a clip into a
  // session-sized dose when no recording is paired with it
  sessionSeconds?: number;
  report?: {
    duration?: number;
    biomech?: {
      muscleLoad?: Record<string, number>;
      demandRaw?: Record<string, number>;
      observedS?: number;
      weightKg?: number | null;
    };
  };
};
export type ActLike = { sport?: string; seconds?: number; date: string; meters?: number; demo?: boolean };

export type DurationSource = "recorded" | "stated" | "assumed" | "unknown";

export type Workout = {
  id: string;
  startedAt: string;
  sport: string;
  action?: string;
  hoursAgo: number;

  durationS: number | null;
  durationSource: DurationSource;

  recording?: ActLike;
  clips: SessionLike[];
};

export function readBody(): { heightCm: number | null; weightKg: number | null } {
  try {
    const p = JSON.parse(localStorage.getItem("ml_profile") ?? "{}") as { height?: number; weight?: number };
    return { heightCm: p.height ?? null, weightKg: p.weight ?? null };
  } catch { return { heightCm: null, weightKg: null }; }
}

// seconds of movement the camera actually saw
export function observedOf(s: SessionLike): number {
  return s.report?.biomech?.observedS ?? s.report?.duration ?? 0;
}

const lower = (v?: string) => (v ?? "").toLowerCase();

// ——— the pairing rule, in ONE place ———
// A clip belongs to a recording when the sport matches and the clip was filmed
// inside the recording's interval, give or take SESSION_WINDOW_H. Ties go to
// the longer recording — the same tie-break sessionSecondsOf used before.
function recordingFor(s: SessionLike, acts: ActLike[]): ActLike | undefined {
  const t = new Date(s.date).getTime();
  const sport = lower(s.sport);
  let best: ActLike | undefined;
  for (const a of acts) {
    if (!a.seconds || a.seconds <= 0) continue;
    if (lower(a.sport) !== sport) continue;
    const end = new Date(a.date).getTime();
    const start = end - a.seconds * 1000;
    const slack = SESSION_WINDOW_H * 3600e3;
    if (t < start - slack || t > end + slack) continue;
    if (!best || a.seconds > best.seconds!) best = a;
  }
  return best;
}

// ——— duration resolution, in ONE place ———
// stated > recorded > unknown. The athlete's own answer outranks the recording
// on purpose: a 45-minute GPS track can cover a session they only trained 30
// minutes of, and they are the authority on that.
export function resolveDuration(w: { clips: SessionLike[]; recording?: ActLike }): {
  durationS: number | null; durationSource: DurationSource;
} {
  for (const c of w.clips) {
    if (typeof c.sessionSeconds === "number" && c.sessionSeconds > 0) {
      return { durationS: c.sessionSeconds, durationSource: "stated" };
    }
  }
  if (w.recording?.seconds && w.recording.seconds > 0) {
    return { durationS: w.recording.seconds, durationSource: "recorded" };
  }
  return { durationS: null, durationSource: "unknown" };
}

// How many times the clip the whole session was. When the length is unknown we
// still have to show something: the clip measures WHICH muscles worked and in
// what proportion perfectly well, it just cannot know the total volume. One
// stated default, surfaced wherever a number derived from it appears, and one
// tap to correct it — an assumption the user can see and fix is not the same
// thing as an invented measurement.
export function volumeOfWorkout(w: Workout, clip: SessionLike): number {
  const obs = observedOf(clip);
  if (!(obs > 0.5)) return 1;
  const sess = w.durationS ?? DEFAULT_SESSION_MIN * 60;
  return Math.max(1, sess / obs);
}

// The workout's measured muscle load, or null when nothing about it could be
// measured. Recordings contribute duration and distance; they NEVER contribute
// a muscle map — nothing estimates muscles from a sport name.
export function workoutMuscleLoad(
  w: Workout, body: { heightCm: number | null; weightKg: number | null }
): Record<string, number> | null {
  let out: Record<string, number> | null = null;
  for (const c of w.clips) {
    const raw = legacyDemand((c.report?.biomech ?? {}) as never);
    if (!raw) continue;
    const load = loadFromDemand(raw as never, body, volumeOfWorkout(w, c)) as Record<string, number>;
    if (!Object.keys(load).length) continue;
    if (!out) { out = { ...load }; continue; }
    // several clips of ONE workout: keep the strongest reading per muscle
    for (const [k, v] of Object.entries(load)) if (v > (out[k] ?? 0)) out[k] = v;
  }
  return out;
}

export function buildWorkouts(): Workout[] {
  let sessions: SessionLike[] = [];
  let acts: ActLike[] = [];
  try { sessions = JSON.parse(localStorage.getItem("ml_sessions") ?? "[]"); } catch {}
  try { acts = JSON.parse(localStorage.getItem("ml_activities") ?? "[]"); } catch {}

  const now = Date.now();
  const hoursAgo = (d: string) => Math.max(0, (now - new Date(d).getTime()) / 3600e3);

  const byRecording = new Map<ActLike, SessionLike[]>();
  const loose: SessionLike[] = [];
  for (const s of sessions) {
    const rec = recordingFor(s, acts);
    if (rec) {
      const list = byRecording.get(rec) ?? [];
      list.push(s);
      byRecording.set(rec, list);
    } else loose.push(s);
  }

  const out: Workout[] = [];
  const mk = (clips: SessionLike[], recording?: ActLike): Workout => {
    const startedAt = recording?.date ?? clips[0].date;
    const base = { clips, recording };
    const { durationS, durationSource } = resolveDuration(base);
    return {
      // stable across rebuilds so a stated duration and any future server sync
      // can key off it
      id: recording ? `w:a:${recording.date}` : `w:s:${clips[0].id}`,
      startedAt,
      sport: recording?.sport ?? clips[0].sport ?? "Workout",
      action: clips[0]?.action,
      hoursAgo: hoursAgo(startedAt),
      durationS, durationSource,
      recording, clips,
    };
  };

  for (const [rec, clips] of byRecording) out.push(mk(clips, rec));
  for (const a of acts) if (!byRecording.has(a)) out.push(mk([], a));

  // clips with no recording: collapse several clips of ONE workout (three
  // videos of the same run, minutes apart) into a single training
  loose.sort((a, b) => a.date.localeCompare(b.date));
  const groups: SessionLike[][] = [];
  for (const s of loose) {
    const key = `${lower(s.sport)}|${lower(s.action)}`;
    const t = new Date(s.date).getTime();
    const g = groups.find(
      (x) => `${lower(x[0].sport)}|${lower(x[0].action)}` === key &&
        Math.abs(new Date(x[x.length - 1].date).getTime() - t) <= SESSION_WINDOW_H * 3600e3
    );
    if (g) g.push(s); else groups.push([s]);
  }
  for (const g of groups) out.push(mk(g));

  out.sort((a, b) => a.hoursAgo - b.hoursAgo); // newest first
  return out;
}

// ——— compatibility shims ———
// Kept so callers that still think in "one session" terms keep working while
// the consumers migrate. Both route through the same pairing rule above.
export function sessionSecondsOf(s: SessionLike, acts: ActLike[]): number | null {
  if (typeof s.sessionSeconds === "number" && s.sessionSeconds > 0) return s.sessionSeconds;
  return recordingFor(s, acts)?.seconds ?? null;
}

export function volumeOf(s: SessionLike, acts: ActLike[]): number {
  const obs = observedOf(s);
  if (!(obs > 0.5)) return 1;
  const sess = sessionSecondsOf(s, acts) ?? DEFAULT_SESSION_MIN * 60;
  return Math.max(1, sess / obs);
}
