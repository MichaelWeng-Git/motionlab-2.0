// One write path for recorded activities. Activity data changes several
// downstream surfaces (TODAY, LOAD, XP, coins and cloud sync), so a same-tab
// write must announce itself; the browser's native `storage` event only fires
// in other tabs.

const KEY = "ml_activities";

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
