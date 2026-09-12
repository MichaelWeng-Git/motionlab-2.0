// One write path for recorded activities. Activity data changes several
// downstream surfaces (TODAY, LOAD, XP, coins and cloud sync), so a same-tab
// write must announce itself; the browser's native `storage` event only fires
// in other tabs.

const KEY = "ml_activities";

export type StoredActivity = {
  id?: string;
  name?: string;
  sport: string;
  mode?: "gps" | "court" | "pool";
  seconds: number;
  meters?: number;
  description?: string | null;
  exertion?: number;
  privacy?: "everyone" | "followers" | "private";
  splits?: { km: number; seconds: number }[] | null;
  elevGain?: number;
  kcal?: number | null;
  path?: [number, number][] | null;
  thumb?: string;
  demo?: boolean;
  date: string;
};

export function activityId(activity: StoredActivity, index: number): string {
  return activity.id ?? `legacy-${index}`;
}

export function findActivity(id: string): { activity: StoredActivity; index: number } | null {
  const activities = readActivities<StoredActivity>();
  const index = activities.findIndex((activity, itemIndex) => activityId(activity, itemIndex) === id);
  return index >= 0 ? { activity: activities[index], index } : null;
}

export function readActivities<T = Record<string, unknown>>(): T[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value as T[] : [];
  } catch {
    return [];
  }
}

export function writeActivities<T>(activities: T[]): void {
  localStorage.setItem(KEY, JSON.stringify(activities));
  window.dispatchEvent(new Event("ml:activities"));
  // Existing metric surfaces already subscribe to this aggregate data event.
  window.dispatchEvent(new Event("ml:sessions"));
}

export function addActivity<T>(activity: T): void {
  writeActivities([...readActivities<T>(), activity]);
}

export function deleteActivity(index: number): void {
  writeActivities(readActivities().filter((_, itemIndex) => itemIndex !== index));
}
