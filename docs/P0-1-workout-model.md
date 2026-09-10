# P0-1 — Unified Workout model + migration design

**Status: design only. No data is migrated and no store is written by this
document.** Implementation is a separate, revertible commit.

---

## 1. The problem, as it exists in the code today

One training session can produce **two independent records**:

| store | written by | holds |
|---|---|---|
| `ml_activities` | `/activity` recorder | duration, distance, path, splits, kcal |
| `ml_sessions` | `/analyze` pipeline | score, `biomech.demandRaw`, `observedS` |

Film a 6.5 s clip during a 45-minute recorded run and you get one of each. Every
downstream reader then handles that pair differently, and all three are wrong in
a different direction:

**LOAD — counts it twice** (`lib/fitness.ts` `buildLoadMonth`)

```ts
for (const s of sessions) { ... add(k, d); }        // dose from biomech, volume = 2700/6.5 = 415×
for (const a of acts)     { ... add(k, mins/45); }  // + 1.00 for the same training
```

The second `add()` uses the very duration that scaled the first one. The day is
credited with the run twice over.

**Recovery — counts it twice** (`lib/muscles.ts` `collectItems`)

Same-session collapse merges items whose `group` matches, but the two paths
build incompatible keys:

```ts
group: `${sport}|${action}`   // "running|easy run"    ← the clip
group: `workout|${sport}`     // "workout|running"     ← the recording
```

The merge can never fire across the pair, so two items decay in parallel and the
body reads sorer than it is.

**CHARGE — cannot see video training at all** (`lib/charge.ts`)

```ts
const acts = JSON.parse(localStorage.getItem("ml_activities") ?? "[]");
if (!acts.length) return null;
```

An athlete who only films clips has no CHARGE, permanently.

### The pairing logic already exists — it is just not shared

`sessionSecondsOf()` in `lib/muscles.ts` already pairs a clip to a recording:
same sport, clip timestamp inside `[activityStart − 3h, activityEnd + 3h]`. It
uses that pairing **only** to fetch a session length, and no other reader knows
about it. So the app already contains the correct relation and still
double-counts, because the relation is not the model.

---

## 2. The model

One record per **training session**. A recording and any clips are *evidence
about* that session, never sessions themselves.

```ts
// lib/workouts.ts  (new)

export type DurationSource = "recorded" | "stated" | "assumed" | "unknown";

export type WorkoutClip = {
  sessionId: string;        // ml_sessions[].id
  observedS: number;        // seconds of movement the camera actually saw
  demandRaw?: Record<string, number>;   // biomech, reference body
  bodyKnown: boolean;
  score?: number;
  reliability?: number;
};

export type WorkoutRecording = {
  seconds: number;
  meters?: number;
  path?: [number, number][] | null;
  demo?: boolean;           // simulated route — must stay visible
  kcal?: number | null;
};

export type Workout = {
  id: string;               // stable: see §4
  startedAt: string;        // ISO
  dayKey: string;           // LOCAL calendar day — see P0-5, not date.slice(0,10)
  sport: string;
  action?: string;

  durationS: number | null;
  durationSource: DurationSource;

  recording?: WorkoutRecording;
  clips: WorkoutClip[];     // may be empty (recorded-only workout)
};
```

**Invariants**

1. A `Workout` is the only unit LOAD, Recovery and CHARGE may count. Reading
   `ml_sessions` or `ml_activities` directly from those modules becomes a bug.
2. `clips` and `recording` are *evidence*, so a workout with both is still one
   workout. This is what removes the double count structurally rather than by
   subtracting somewhere.
3. `durationS` has exactly one resolution order, in one function:
   `recording.seconds` → user-stated → `DEFAULT_SESSION_MIN` (`assumed`) →
   `null` (`unknown`). `durationSource` travels with the number so every surface
   can label it (P0-4 requires the assumption to stay visible and editable).
4. Muscle dose comes **only** from `clips[].demandRaw`. A recording contributes
   duration and distance; it never contributes a muscle map. This preserves the
   existing rule that nothing estimates muscles from a sport name.

---

## 3. What each consumer changes to

| module | today | after |
|---|---|---|
| `lib/fitness.ts` LOAD | sums sessions **and** activities | sums `Workout[]`; a workout contributes once |
| `lib/muscles.ts` Recovery | two item streams, merge key mismatch | one item per `Workout`; the merge problem disappears with the second stream |
| `lib/charge.ts` CHARGE | `ml_activities` only | `Workout[]`; `durationS` regardless of how it was obtained |
| `/weeks`, `/history` | read both stores | read `Workout[]` |

`SESSION_WINDOW_H` keeps its current job — collapsing several clips of *one*
workout — but now applies at build time, in one place, instead of being
re-implemented per consumer.

**Not changed by this work:** `REF_SESSION_SCALE`, `WEEK_FULL`, `bodyScale`,
`computeRecovery`, the pose cleanup order. The dose *formula* is untouched; only
the question of *how many times it is applied* is.

---

## 4. Pairing rule (one function, used everywhere)

```
A clip belongs to a recording when
  sport matches (case-insensitive), AND
  clipStart ∈ [recordingStart − W, recordingEnd + W],  W = SESSION_WINDOW_H (3h)

Clips with no recording group with each other when
  sport+action match AND they are within W of one another
    → one Workout, strongest per-muscle reading wins (today's behaviour)

A recording with no clips is a Workout with clips: []
```

Ambiguity: a clip matching two recordings takes the one whose interval contains
it; if still tied, the longer recording — the same tie-break `sessionSecondsOf`
already uses today.

**Stable ids.** `id = "w:" + <recording date>` when a recording exists, else
`"w:" + <earliest clip sessionId>`. Stable across rebuilds so user-entered
session lengths and any future server sync can key off it.

---

## 5. Migration design

Deliberately in three stages so each is independently revertible, and so no
stage rewrites a user's data before the derived model has been observed to be
correct on real data.

### Stage A — derive, do not write *(the implementation step after this design)*

`buildWorkouts()` reads `ml_sessions` + `ml_activities` and returns `Workout[]`
in memory. Nothing is persisted; the legacy stores stay authoritative. All four
consumers switch to it in one commit.

Risk: none to stored data — revert = revert the commit. This is the stage that
actually fixes the double count.

### Stage B — persist the *relation* only

Write `ml_workout_links` — `{ workoutId, recordingDate, sessionIds[], durationS,
durationSource }`. Still no copy of the underlying records: if the link file is
lost, Stage A's rules regenerate it. User-stated durations move here so they
survive a clip being re-analysed.

Migration on first read: build from Stage A rules, persist, stamp
`ml_workout_links_v = 1`. Idempotent; a second run produces the same ids.

### Stage C — IndexedDB, together with P0-6

Only once P0-6 has moved session writes behind a single function. `localStorage`
is already near its quota with per-session covers and reports; this stage moves
`sessions`, `activities` and `links` into IndexedDB with a versioned schema, and
`localStorage` keeps only small preferences.

**Rollback for each stage**

| stage | rollback |
|---|---|
| A | revert commit; no data touched |
| B | delete `ml_workout_links`; Stage A rules still work |
| C | export tables back to `localStorage` (needs an explicit downgrade path written *before* C ships) |

### What must NOT happen

- No stage deletes or rewrites `ml_sessions` / `ml_activities` until C, and C
  copies rather than moves until a verified read-back succeeds.
- `ml_sessions_backup` keeps mirroring throughout (see P0-6 — `deleteSession`
  currently fails to update it).
- No stage invents a `durationS`. `unknown` stays `unknown` and the UI says so.

---

## 6. Verification before Stage A is considered done

1. **Double count is gone.** A fixture with one recording + one clip of the same
   sport: LOAD day value equals the clip-derived dose alone, not the sum.
2. **Recovery merge fires.** The same fixture yields `measured: 1`, not 2.
3. **CHARGE sees clips.** A fixture with clips and no recordings produces a
   non-null CHARGE.
4. **No regression on the dose formula.** `REF_SESSION_SCALE`, `WEEK_FULL`,
   `bodyScale` outputs unchanged for a clips-only fixture — the numbers move
   only where a pair used to be counted twice.
5. Unpaired clips and unpaired recordings each still produce exactly one
   workout.

These become the first cases in the P1-4 Vitest suite.
