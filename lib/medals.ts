export type MedalTier = "bronze" | "silver" | "gold";
export type MedalFamilyKey = "analyst" | "form" | "streak" | "training";
export type MedalMilestone = { id: string; tier: MedalTier; target: number; earned: boolean };
export type MedalFamily = {
  key: MedalFamilyKey; name: string; unit: string; value: number; milestones: MedalMilestone[];
  current: MedalTier | null; next: MedalMilestone | null;
};

const RULES: Record<MedalFamilyKey, { name: string; unit: string; targets: [number, number, number] }> = {
  analyst: { name: "Motion Analyst", unit: "analyses", targets: [1, 5, 20] },
  form: { name: "Form Standard", unit: "best score", targets: [70, 80, 90] },
  streak: { name: "Consistency", unit: "streak days", targets: [3, 10, 30] },
  // "recorded workouts", not "workouts": lib/workouts counts a filmed-only
  // session as a Workout too, so the bare word would promise a video-only
  // athlete progress this family cannot give them.
  training: { name: "Training Miles", unit: "recorded workouts", targets: [1, 10, 50] },
};
const TIERS: MedalTier[] = ["bronze", "silver", "gold"];

export function medalCollection(input: { analyses: number; bestScore: number; streakDays: number; recordedWorkouts: number }): MedalFamily[] {
  const values: Record<MedalFamilyKey, number> = { analyst: input.analyses, form: input.bestScore, streak: input.streakDays, training: input.recordedWorkouts };
  return (Object.keys(RULES) as MedalFamilyKey[]).map((key) => {
    const rule = RULES[key], value = Math.max(0, values[key]);
    const milestones = rule.targets.map((target, i) => ({ id: `${key}:${TIERS[i]}`, tier: TIERS[i], target, earned: value >= target }));
    const earned = milestones.filter((m) => m.earned);
    return { key, name: rule.name, unit: rule.unit, value, milestones, current: earned.at(-1)?.tier ?? null, next: milestones.find((m) => !m.earned) ?? null };
  });
}

export function earnedMedalIds(families: MedalFamily[]) { return families.flatMap((f) => f.milestones.filter((m) => m.earned).map((m) => m.id)); }
