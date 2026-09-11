import type { Session } from "./stats";
import { buildWorkouts } from "./workouts";

export type HeatDay = {
  date: string;
  day: number;
  trained: boolean;
  future: boolean;
  minutes: number | null;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
};

export type PersonalBest = {
  id: string;
  kind: "score" | "distance";
  sport: string;
  value: number;
  unit: "PTS" | "KM";
  date: string;
  href?: string;
};

const dateKey = (value: Date | string) => {
  const d = typeof value === "string" ? new Date(value) : value;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** Twelve complete Monday–Sunday columns ending in the current week. */
export function progressHeatmap(): HeatDay[][] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) - 11 * 7);

  const byDay = new Map<string, { count: number; seconds: number; hasDuration: boolean }>();
  for (const workout of buildWorkouts()) {
    const key = dateKey(workout.startedAt);
    const current = byDay.get(key) ?? { count: 0, seconds: 0, hasDuration: false };
    current.count += 1;
    if (workout.durationS != null) {
      current.seconds += workout.durationS;
      current.hasDuration = true;
    }
    byDay.set(key, current);
  }

  return Array.from({ length: 12 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + week * 7 + day);
      const future = d > today;
      const entry = future ? undefined : byDay.get(dateKey(d));
      const minutes = entry?.hasDuration ? Math.round(entry.seconds / 60) : null;
      const level: HeatDay["level"] = !entry ? 0 : minutes == null ? 1 : minutes >= 60 ? 4 : minutes >= 40 ? 3 : minutes >= 20 ? 2 : 1;
      return { date: d.toISOString(), day, trained: !!entry, future, minutes, count: entry?.count ?? 0, level };
    })
  );
}

type Activity = { sport?: string; meters?: number; date: string; demo?: boolean };

/** PBs only use measured fields. Demo GPS routes are deliberately excluded. */
export function personalBests(sessions: Session[]): PersonalBest[] {
  let activities: Activity[] = [];
  try { activities = JSON.parse(localStorage.getItem("ml_activities") ?? "[]"); } catch {}

  const scoreBySport = new Map<string, Session>();
  for (const session of sessions) {
    if (!Number.isFinite(session.score)) continue;
    const key = session.sport || "Movement";
    const current = scoreBySport.get(key);
    if (!current || session.score > current.score) scoreBySport.set(key, session);
  }

  const distanceBySport = new Map<string, Activity>();
  for (const activity of activities) {
    if (activity.demo || !(activity.meters && activity.meters > 0)) continue;
    const key = activity.sport || "Workout";
    const current = distanceBySport.get(key);
    if (!current || activity.meters > (current.meters ?? 0)) distanceBySport.set(key, activity);
  }

  return [
    ...Array.from(scoreBySport.entries()).map(([sport, s]): PersonalBest => ({
      id: `score:${sport}`,
      kind: "score",
      sport,
      value: Math.round(s.score),
      unit: "PTS",
      date: s.date,
      href: `/report/${s.id}`,
    })),
    ...Array.from(distanceBySport.entries()).map(([sport, a]): PersonalBest => ({
      id: `distance:${sport}`,
      kind: "distance",
      sport,
      value: Math.round((a.meters! / 1000) * 100) / 100,
      unit: "KM",
      date: a.date,
      href: "/activities",
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
}
