// Real (local) data layer for the prototype.
// Every number in the UI derives from recorded analysis sessions.
// No sessions yet → everything is 0 / locked / empty.
// Later this moves to the backend — same shapes, different storage.

export type Session = {
  id: string;
  sport: string;
  action: string;
  score: number;
  date: string; // ISO
  cover?: string; // small JPEG data URL — a real frame from the video
  // How long the whole SESSION was, in seconds — set by the athlete on the
  // report. A clip is a sample; without this the muscle load only ever counts
  // the seconds the camera saw (lib/muscles volumeOf).
  sessionSeconds?: number;
  // the full report is stored per-session, so EVERY analysis can be reopened later.
  // (Text + numbers only — tiny. The video replay is separate and only kept for the latest.)
  report?: unknown;
};

const KEY = "ml_sessions";

// The sessions blob carries per-session covers (JPEG data URLs) and full
// reports, so it can be several MB — parsing it on EVERY page visit was the
// "profile opens slowly" lag. Parse once, keep it, and drop the cache on any
// write (all writes go through this module) or on cross-tab changes.
let cache: Session[] | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) cache = null;
  });
}

export function getSessions(): Session[] {
  if (!cache) {
    try {
      cache = JSON.parse(localStorage.getItem(KEY) ?? "null");
      // primary gone but the mirror survives → restore from it
      if (!cache) {
        cache = JSON.parse(localStorage.getItem(KEY + "_backup") ?? "[]");
        if (cache!.length) try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
      }
    } catch {
      cache = [];
    }
  }
  // shallow copy: callers sort the result in place, which must not reorder the cache
  return [...cache!];
}

export function getSession(id: string): Session | null {
  return getSessions().find((s) => s.id === id) ?? null;
}

// Patch one stored session in place (session length, etc). Returns false when
// the id is gone, so callers can tell the difference from a silent no-op.
export function updateSession(id: string, patch: Partial<Session>): boolean {
  const all = getSessions();
  const i = all.findIndex((s) => s.id === id);
  if (i < 0) return false;
  all[i] = { ...all[i], ...patch };
  const json = JSON.stringify(all);
  localStorage.setItem(KEY, json);
  try { localStorage.setItem(KEY + "_backup", json); } catch {}
  cache = null;
  window.dispatchEvent(new Event("ml:sessions"));
  return true;
}

export function deleteSession(id: string) {
  localStorage.setItem(KEY, JSON.stringify(getSessions().filter((s) => s.id !== id)));
  cache = null;
}

// returns the new session's id
export function recordSession(s: Omit<Session, "id" | "date">): string {
  const all = getSessions();
  const id = `s${Date.now()}`;
  all.push({ ...s, id, date: new Date().toISOString() });
  // keep storage lean — only the newest ~20 sessions retain heavy covers
  const trimmed = all.map((x, i) => (i < all.length - 20 ? { ...x, cover: undefined } : x));
  const json = JSON.stringify(trimmed);
  localStorage.setItem(KEY, json);
  // mirror copy — a session must survive the primary key being wiped by
  // accident; getSessions falls back to this if the primary is missing
  try { localStorage.setItem(KEY + "_backup", json); } catch {}
  cache = null;
  return id;
}

export type Stats = {
  total: number;
  latestScore: number; // 0 when no sessions
  bestScore: number;
  weekCount: number;
  daysActiveThisWeek: number;
  streakDays: number;
  xp: number;
  latestSport: string | null;
  latestAction: string | null;
  monthDelta: number; // score change vs ~a month ago
};

function getActivityDates(): string[] {
  try {
    const acts = JSON.parse(localStorage.getItem("ml_activities") ?? "[]") as { date: string }[];
    return acts.map((a) => a.date);
  } catch {
    return [];
  }
}

export function getStats(): Stats {
  const sessions = getSessions().sort((a, b) => a.date.localeCompare(b.date));
  const activityDates = getActivityDates();
  const now = new Date();

  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
  startOfWeek.setHours(0, 0, 0, 0);

  const thisWeek = sessions.filter((s) => new Date(s.date) >= startOfWeek);
  // analyses AND recorded workouts both count as "being active"
  const dayKeys = new Set([
    ...sessions.map((s) => s.date.slice(0, 10)),
    ...activityDates.map((d) => d.slice(0, 10)),
  ]);

  // streak: consecutive days ending today/yesterday with >=1 session
  let streak = 0;
  const d = new Date(now);
  if (!dayKeys.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1); // allow "yesterday" start
  while (dayKeys.has(d.toISOString().slice(0, 10))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }

  const latest = sessions[sessions.length - 1] ?? null;
  const monthAgo = new Date(now);
  monthAgo.setDate(now.getDate() - 30);
  const older = sessions.filter((s) => new Date(s.date) < monthAgo);
  const baseline = older.length ? older[older.length - 1].score : sessions[0]?.score ?? 0;

  return {
    total: sessions.length,
    latestScore: latest?.score ?? 0,
    bestScore: sessions.reduce((m, s) => Math.max(m, s.score), 0),
    weekCount: thisWeek.length,
    daysActiveThisWeek: new Set(
      [...thisWeek.map((s) => s.date), ...activityDates.filter((d) => new Date(d) >= startOfWeek)].map((d) =>
        d.slice(0, 10)
      )
    ).size,
    streakDays: streak,
    // XP mechanism (mirrored in the in-app assistant's knowledge):
    // +50 per video analysis, +25 per recorded workout, +10 first activity of each day
    xp: sessions.length * 50 + activityDates.length * 25 + dayKeys.size * 10,
    latestSport: latest?.sport ?? null,
    latestAction: latest?.action ?? null,
    monthDelta: latest ? latest.score - baseline : 0,
  };
}
