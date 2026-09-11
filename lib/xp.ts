// XP progression — one deterministic source for totals, levels and progress.
// This is a reward system, not a performance measurement: every earning rule
// is listed in the UI and derives only from saved user activity.

export const XP_REWARDS = {
  analysis: 50,
  recordedWorkout: 25,
  activeDay: 10,
} as const;

export function xpFromCounts(analyses: number, workouts: number, activeDays: number): number {
  return Math.max(0, analyses) * XP_REWARDS.analysis
    + Math.max(0, workouts) * XP_REWARDS.recordedWorkout
    + Math.max(0, activeDays) * XP_REWARDS.activeDay;
}

// Level 1 starts at 0. Each next level costs 100 XP more than the last:
// 100, 200, 300… This stays legible early and gives long-term progression.
export function xpForLevel(level: number): number {
  const n = Math.max(1, Math.floor(level)) - 1;
  return 50 * n * (n + 1);
}

const TIERS = [
  { at: 1, name: "Rookie", color: "#7A8C82" },
  { at: 5, name: "Mover", color: "#2D8B62" },
  { at: 10, name: "Athlete", color: "#2675C8" },
  { at: 15, name: "Competitor", color: "#7354B7" },
  { at: 20, name: "Elite", color: "#C9821B" },
] as const;

export type XpLevel = {
  level: number; name: string; color: string; xp: number;
  currentFloor: number; nextFloor: number; intoLevel: number; levelCost: number; progress: number;
};

export function levelForXp(input: number): XpLevel {
  const xp = Math.max(0, Math.floor(input));
  let level = 1;
  while (xpForLevel(level + 1) <= xp && level < 99) level++;
  const currentFloor = xpForLevel(level);
  const nextFloor = xpForLevel(level + 1);
  const tier = [...TIERS].reverse().find((t) => level >= t.at) ?? TIERS[0];
  return {
    level, name: tier.name, color: tier.color, xp, currentFloor, nextFloor,
    intoLevel: xp - currentFloor,
    levelCost: nextFloor - currentFloor,
    progress: (xp - currentFloor) / Math.max(1, nextFloor - currentFloor),
  };
}

export function nextTier(level: number) {
  return TIERS.find((tier) => tier.at > level) ?? null;
}

export const XP_TIERS = TIERS;
