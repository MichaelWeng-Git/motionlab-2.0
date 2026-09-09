// Daily login streak — the flame. Opening the app on a calendar day keeps it
// alive (Duolingo-style); it does NOT require a workout or analysis. Miss a
// full day and it resets to 1 on the next open. This is THE one streak — the
// top-bar chip and the /streak page both read it, so they can never disagree.
import { dayKey } from "@/lib/coins";

type S = { last: string; count: number; max?: number };
const KEY = "ml_streak";

function read(): S | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; }
}

const shiftKey = (base: string, days: number) => {
  const d = new Date(base + "T00:00:00");
  d.setDate(d.getDate() + days);
  return dayKey(d);
};

const yesterdayKey = () => {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return dayKey(y);
};

// read-only: the streak as it stands (0 if it has lapsed and not yet reopened)
export function getDailyStreak(): number {
  const s = read();
  if (!s) return 0;
  return s.last === dayKey() || s.last === yesterdayKey() ? s.count : 0;
}

// full picture for the /streak page: current run, best ever, and which of the
// last 7 calendar days (oldest → today) were part of the streak
export function getStreakInfo(): { count: number; max: number; litDays: Set<string> } {
  const s = read();
  const count = getDailyStreak();
  const lit = new Set<string>();
  if (s && count > 0) {
    for (let i = 0; i < count; i++) lit.add(shiftKey(s.last, -i));
  }
  return { count, max: Math.max(s?.max ?? 0, s?.count ?? 0), litDays: lit };
}

// call once when the app opens: advances the streak the first time each day,
// tells the caller whether THIS open bumped it (→ play the flame animation)
export function touchDailyStreak(): { count: number; bumped: boolean } {
  const today = dayKey();
  const s = read();
  if (s && s.last === today) return { count: s.count, bumped: false };
  const count = s && s.last === yesterdayKey() ? s.count + 1 : 1;
  const max = Math.max(s?.max ?? 0, s?.count ?? 0, count);
  try { localStorage.setItem(KEY, JSON.stringify({ last: today, count, max })); } catch {}
  return { count, bumped: true };
}
