// Editable activity goals — ONE semantic everywhere:
// red = exercise minutes, green = analyses, cyan = workouts.
// ALL THREE ARE DAILY, because the three rings are a DAILY card.
//
// GOAL HISTORY (Apple Fitness behaviour): goals are versioned by date. Editing
// today changes TODAY AND FORWARD only — every past day keeps the goal that was
// actually in effect when you lived it, so history can never be rewritten.

import { dayKey } from "./coins";

export type Goals = {
  minutes: number;      // exercise minutes per day
  dayAnalyses: number;  // video analyses per day
  dayWorkouts: number;  // recorded workouts per day
};

export const DEFAULT_GOALS: Goals = { minutes: 30, dayAnalyses: 1, dayWorkouts: 1 };

// one entry per edit: these goals apply from `from` (a YYYY-MM-DD day) onward,
// until the next entry takes over
type Version = Goals & { from: string };
const HKEY = "ml_goals_history";
const LEGACY = "ml_goals";
const EPOCH = "1970-01-01"; // the pre-history baseline covers every past day

const clean = (g: Partial<Goals>): Goals => ({
  minutes: Math.max(1, Math.round(g.minutes ?? DEFAULT_GOALS.minutes)),
  dayAnalyses: Math.max(1, Math.round(g.dayAnalyses ?? DEFAULT_GOALS.dayAnalyses)),
  dayWorkouts: Math.max(1, Math.round(g.dayWorkouts ?? DEFAULT_GOALS.dayWorkouts)),
});

function readHistory(): Version[] {
  let hist: Version[] = [];
  try { hist = JSON.parse(localStorage.getItem(HKEY) ?? "[]"); } catch {}
  if (!Array.isArray(hist) || !hist.length) {
    // migrate the single old goals blob (incl. the even older weekly field
    // names) into the baseline version that covers all history
    let legacy: Partial<Goals> & { weekAnalyses?: number; weekWorkouts?: number } = {};
    try { legacy = JSON.parse(localStorage.getItem(LEGACY) ?? "{}"); } catch {}
    const base = clean({
      minutes: legacy.minutes,
      dayAnalyses: legacy.dayAnalyses ?? legacy.weekAnalyses,
      dayWorkouts: legacy.dayWorkouts ?? legacy.weekWorkouts,
    });
    hist = [{ ...base, from: EPOCH }];
    try { localStorage.setItem(HKEY, JSON.stringify(hist)); } catch {}
  }
  return hist.slice().sort((a, b) => a.from.localeCompare(b.from));
}

export type GoalHistory = Version[];

// SSR-safe: components load this once in an effect, then resolve days from it
// synchronously — never touching localStorage during render (hydration!)
export function getGoalsHistory(): GoalHistory {
  try { return readHistory(); } catch { return [{ ...DEFAULT_GOALS, from: EPOCH }]; }
}

// pure resolver: the goals in effect ON a given day, from an already-loaded
// history (null → the defaults the server rendered with)
export function resolveGoals(hist: GoalHistory | null, day: string): Goals {
  if (!hist || !hist.length) return { ...DEFAULT_GOALS };
  let cur: Version = hist[0];
  for (const v of hist) if (v.from <= day) cur = v;
  return clean(cur);
}

// the goals in effect ON a given day (past days keep their own targets).
// Client-only — call from effects/handlers, not during render.
export function getGoalsFor(day: string): Goals {
  return resolveGoals(getGoalsHistory(), day);
}

// today's goals — what the editor shows and what the daily rings use
export function getGoals(): Goals {
  try { return getGoalsFor(dayKey()); } catch { return { ...DEFAULT_GOALS }; }
}

// saving applies from TODAY forward: replace today's version if it exists,
// otherwise append one. Yesterday and before are never touched.
export function saveGoals(g: Goals) {
  const today = dayKey();
  const next = clean(g);
  const hist = readHistory().filter((v) => v.from !== today);
  hist.push({ ...next, from: today });
  hist.sort((a, b) => a.from.localeCompare(b.from));
  try {
    localStorage.setItem(HKEY, JSON.stringify(hist));
    localStorage.setItem(LEGACY, JSON.stringify(next)); // keep the old key readable
  } catch {}
  // one event, every screen with rings re-reads immediately (no stale targets)
  try { window.dispatchEvent(new Event("ml:goals")); } catch {}
}

// weekly targets derived from the daily ones — minutes use the 5-active-days
// ideal; counts are simply ×7
export const weekMinutesGoal = (g: Goals) => g.minutes * 5;
export const weekAnalysesGoal = (g: Goals) => g.dayAnalyses * 7;
export const weekWorkoutsGoal = (g: Goals) => g.dayWorkouts * 7;

// Apple-rings-grade separation: three LOUD hues that can't be confused,
// even as dim tracks on the dark card
// OUR sporty trio (user-set mapping, deliberately NOT Apple's ring colors):
// violet = Move, emerald = Analyze, sport blue = Workout
export const RING_COLORS = { exercise: "#7C5CFF", analyses: "#16C784", workouts: "#2E86F6" };
