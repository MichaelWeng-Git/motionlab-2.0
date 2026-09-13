# MotionLab 2.0 — working checklist

Two lists merged into one order of work:

- the owner's **24-point "make it a real app"** list (2026-09-04)
- the **P0/P1 correctness backlog** (2026-09-10)

P0 items come first because several 24-point items sit on top of them: there is
no point polishing the FORM card while its number has two sources.

**Working method.** Codex implements, top to bottom. A later review pass fixes
what needs it, using the *Review pass* note under each item.

**One item = one commit. This is not optional.** The review pass has to be able
to revert a single bad item without losing the good ones around it. A commit
touching three items cannot be unpicked. Message format:
`P0-2: one RecoveryState selector`.

Before starting an item, read the code it names — this document describes the
problem, but the code is the source of truth and may have moved.

### Stop and ask instead of guessing

If an item cannot be done without inventing a number, a default, or a data
source that does not exist — stop and say so in the commit message or a note.
A missing feature is recoverable; a fabricated measurement destroys the owner's
trust in every other number on the screen, and that has already happened more
than once in this project.

### Rules that apply to every item

1. **Never fabricate data.** No placeholder numbers, no silent defaults. An
   assumption the user can see and change in one tap is fine; a silent one is
   not. Showing *nothing* can be as false as showing a wrong number.
2. **One number, one source.** A card and the page it opens must show the same
   value, from the same function, on the first frame.
3. **Do not change** `REF_SESSION_SCALE`, `WEEK_FULL`, `bodyScale`,
   `computeRecovery`, or the pose cleanup order without real regression
   evidence first.
4. **Do not restore** `/api/muscles` or any sport-name muscle estimation.
5. Run `npx tsc --noEmit`, `npm test` and `npm run build` per item. Only one
   Next process may run against this checkout at a time.

---

## Done

| # | item | commit |
|---|---|---|
| 1 | Logo + app icon set | — |
| 2 | TODAY card redesign (last mini-gauges dropped) | — |
| 3 | TODAY detail page (day intensity, ON THIS DAY) | — |
| 4 | FORM detail/trend page (six capacities) | — |
| 5 | LOAD page (month calendar + 7-day dial) | — |
| — | Data-honesty audit: GPS randomness, fake distance/pace, 70 kg calories, fixed heart rate, biomech failure reasons, cloud-3D gating | `179ebd8` |
| — | Pose: candidate association, foot keypoints, reliability → biomech | `a7b664b` |
| **P0-1** | Unified `Workout` record — LOAD/Recovery/CHARGE count one training once | `78b2085` |
| **P0-2** | One `RecoveryState` selector, four kinds, five surfaces | `53c59bb` |
| **P0-3** | One FORM source on Home | `84ef4c6` |
| **P0-4** | Session length asked before saving an analysis | `ae17f11` |
| **P0-5** | Local `dayKey()`, zero `slice(0,10)` business dates | — |
| **P0-6** | All session writes through `writeSessions()` | — |
| **P1-4** | Vitest — 35 tests across data safety, workouts, recovery, palette | — |

---

## P0 — correctness

### P0-2 · One RecoveryState selector  *(also 24-point #8)*

**Problem.** Home, `/load` and the assistant each decide independently what the
recovery situation *is*. They agree on the number today only because they happen
to call the same function; nothing enforces it, and each re-derives "is this
assumed?" separately.

**Do.** One selector returning one object:

```ts
type RecoveryState =
  | { kind: "known";             pct: number; load: MuscleLoad }
  | { kind: "assumed-duration";  pct: number; load: MuscleLoad; assumedWorkouts: number }
  | { kind: "unmeasured";        unmeasuredWorkouts: number }   // trained, nothing measurable
  | { kind: "empty" }                                           // no training in range
```

Home, `/load` and `app/api/assistant` consume the **same object**. No surface
recomputes `pct` or re-tests `needsLength`.

**Files.** `lib/muscles.ts` (or a new `lib/recovery.ts`), `app/page.tsx`,
`app/load/page.tsx`, `app/account/help/page.tsx`.

**Accept.** Grep shows exactly one `computeRecovery()` call site. All three
surfaces render identical text for each of the four kinds.

> **Review pass.** Check the four states each have a *designed* empty/assumed
> presentation, not a bare string. Check the assistant's wording matches what
> the screen says. Check nothing reintroduces a second `computeRecovery()` call.

---

### P0-3 · FORM: one source on the home card

**Problem.** The home FORM card's number, trend arrow, link condition and
hexagon do not all come from `buildFormProfile()`.

**Do.** Every one of those four reads the profile object. Delete any parallel
score/spark computation on the home page.

**Files.** `app/page.tsx`, `lib/form.ts`.

**Accept.** Home number === `/form` number on first frame. Trend arrow sign
matches the profile's own delta. Card links to `/form` iff the profile exists.

> **Review pass.** The mini hexagon should be visually consistent with the
> `/form` hero (same axis order, same locked-axis treatment). Check the ▼/▲
> chip colour uses `lib/palette`.

---

### P0-4 · Session length in the analyze/report flow

**Problem.** `DEFAULT_SESSION_MIN` (30) applies before the athlete is ever
asked. It is labelled, but the ask comes late.

**Do.** Put the length control in the first-completion flow so Recovery and LOAD
use the real value from the first frame. The 30-minute default stays visible and
editable everywhere it is used — never hidden, never silently applied.

**Files.** `app/analyze/page.tsx`, `app/report/[id]/page.tsx`, `lib/workouts.ts`
(`resolveDuration`).

**Accept.** A new analysis asks once; answering updates Home/LOAD without a
reload. Skipping keeps the labelled assumption. A workout paired to a recording
never asks — it already knows.

> **Review pass.** Make the ask feel like part of finishing the analysis, not a
> form. Check it does not block reading the report.

---

### P0-5 · Local date logic

**Problem.** `date.slice(0, 10)` takes the **UTC** day off an ISO string. For
Asia timezones an evening session lands on the next day, so it falls into the
wrong calendar square and the wrong week.

**Do.** One `dayKey(date)` helper using local time. Ban `slice(0, 10)` from
business-date use.

**Files.** `lib/workouts.ts`, `lib/fitness.ts`, `lib/muscles.ts`,
`app/weeks/page.tsx`, `lib/charge.ts`, `lib/streak.ts`.

**Accept.** A session at 23:30 local appears on that local day in the LOAD
calendar, `/weeks`, streak and CHARGE. Add fixtures at UTC−5, UTC+0, UTC+9.

> **Review pass.** Grep for any remaining `slice(0, 10)` on a date. Check the
> streak cannot be broken or extended by a timezone change.

---

### P0-6 · Session write path + storage migration

**Problem.** `deleteSession()` writes `ml_sessions` but not `ml_sessions_backup`,
so a deleted session can come back from the mirror.

**Do.** All session writes through one function that updates both. Then design
(not yet ship) the IndexedDB move — this is Stage C of
[P0-1](P0-1-workout-model.md).

**Files.** `lib/stats.ts`.

**Accept.** Delete a session, reload, it stays deleted. `recordSession`,
`updateSession`, `deleteSession` share one writer.

> **Review pass.** Check no caller mutates `ml_sessions` directly. Check the
> IndexedDB design includes a downgrade path before any code is written.

---

## P1 — hardening

### P1-1 · Mechanics + limitations on the report, debug overlay

Restore a MECHANICS block (ROM, tempo, reps) and surface
`biomech.limitations` — they are computed and currently never shown. Wire
`drawPoseDebug()` into `VideoReplay` behind a toggle so corrections can be
inspected on real footage (green = accepted, yellow = corrected with an arrow
from the original position, red = rebuilt).

**Files.** `app/report/[id]/page.tsx`, `components/VideoReplay.tsx`,
`lib/draw.ts`.

> **Review pass.** The debug toggle is a developer affordance — keep it out of
> the athlete's default reading path.

---

### P1-2 · Privacy copy + a real Cloud 3D setting

State plainly: the full video never leaves the device, **the coach receives
three still frames**, and Cloud 3D sends additional sampled frames when enabled.
Give Cloud 3D a real settings entry rather than a hidden flag.

**Files.** `app/account/*`, `app/analyze/page.tsx`, `lib/sam3d.ts`.

> **Review pass.** Copy must be specific — "three screenshots", not "some data".

---

### P1-3 · API hardening

Auth, rate limiting, body-size limits and Zod validation on `/api/coach`,
`/api/assistant`, `/api/fuel`, `/api/pose3d`. Fix the wide-open Supabase RLS.
Move XP to server-side computation.

**Files.** `app/api/*/route.ts`, Supabase policies, `lib/coins.ts`.

> **Review pass.** Check no route trusts a client-supplied identity. Check the
> RLS change cannot lock the user out of their own profile row.

---

### P1-4 · Vitest + CI

Cover `biomech`, `muscles`, `FORM`, `LOAD`, `CHARGE`, date boundaries and the
storage migration. Seed with the P0-1 acceptance cases (§6 of the design doc).

> **Review pass.** Tests must assert *behaviour*, not restate constants. A test
> that hard-codes `REF_SESSION_SCALE` proves nothing.

---

## The remaining 24-point items

Unblocked once P0 is clear. Each still obeys the rules at the top.

| # | item |
|---|---|
| 6 | CHARGE detail/explainer page |
| 7 | Muscle detail page — tap a body group → its load + history |
| 9 | Analyze redesign (stronger upload entry, clear stages, cancel/retry, big-file handling) |
| 10 | Report page hierarchy (score hero, radar, drills) |
| 11 | FUEL / Food redesign (recognition entry, result confirmation, protein target, meal history, delete) |
| 12 | XP structure (level curve, badge, avatar ring) |
| 13 | Coins economy loop (earn audit, spend, history) |
| 14 | Medals redesign (stroke-SVG art, tiers, unlock anim) |
| 15 | Pack packaging (shop art, tear-open, Christmas pack) |
| 16 | Streak page milestone art |
| 17 | Friends (search, invite link, empty states, badges) |
| 18 | Leaderboard podium + weekly countdown + rival line |
| 19 | Progress calendar heatmap + PB cards |
| 20 | Activity record polish (GPS status, autopause, summary) |
| 21 | Settings completeness (units, notifications, export/delete) |
| 22 | Empty states everywhere — designed, never fake data |
| 23 | Loading skeletons + route transition audit |
| 24 | PWA (manifest, icons, splash, offline shell, install) |

### Design handoff notes — 2026-09-11

- **Analyze (#9):** the pipeline exists, but the current page feels visually
  thin and unfinished. Redesign the whole first-use journey, not just its
  colours: give the upload/capture decision a clear hero, make progress feel
  substantial, keep the current measured stage status visible, and provide
  obvious cancel/retry/recovery states. Do not alter the analysis pipeline or
  pretend an unfinished stage has completed.
- **FUEL / Food (#11):** food-photo recognition and stored meal history exist,
  but the current presentation is not the target design. Rework the capture
  entry, editable recognition result, daily protein progress and history as one
  understandable flow. Estimates must stay labelled as estimates; missing
  body weight must keep the protein target empty rather than inventing one.
- **Pack shop (#15):** functional purchase, truthful drop rates, inventory,
  tear-open sequence and tree placement exist. The remaining work is a genuine
  GameKit-quality packaging and reveal redesign, not another flat shop card.
- **Account records:** `lib/cloud-data.ts`, `components/CloudSync.tsx` and
  `/api/account-data` now implement account-owned JSON snapshot sync. Deployment
  still depends on `SUPABASE_SERVICE_ROLE_KEY` and the `account_data` table from
  `supabase-setup.sql`; verify cross-browser restore before calling it complete.
