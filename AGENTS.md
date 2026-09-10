# AGENTS.md — MotionLab 2.0

A map of this repository for coding agents. Read this first; the code is the
source of truth for anything not covered here.

**The plan of work lives in [docs/CHECKLIST.md](docs/CHECKLIST.md)** — merged
P0/P1 backlog and the owner's 24-point list, one item per commit, each with the
review prompt to run after it ships.

---

## What this is

**MotionLab 2.0** — a mobile-first web app that turns a phone video of someone
training into measured biomechanics: which muscles the session loaded, how
recovered the body is, and how movement quality is trending.

**Product goal:** an AI movement coach that behaves like a real, polished app —
not a demo. The owner's standing bar is "every page should feel like a proper
large app, with no bugs."

### The one non-negotiable rule

**Never fabricate data.** No placeholder numbers, no plausible-looking defaults
presented as measurements, no LLM-generated metrics. If a value cannot be
measured, show an empty state or an explicitly labelled assumption the user can
correct in one tap — never a silent substitute. Several past bugs were exactly
this, and they are the fastest way to lose the owner's trust.

Two corollaries that are easy to get wrong:

- Showing *nothing* can be as false as showing a wrong number. Crediting only
  the 6.5 filmed seconds of a run made recovery read "100% recovered" for a
  session that definitely happened. Both directions were rejected.
- An assumption the user can **see and change** (`DEFAULT_SESSION_MIN`, labelled
  in the UI) is acceptable. An assumption applied silently is not.

### Second rule: one number, one source

A Home card and the page it opens must show the same number, in the same unit,
from the same function, on the first frame. Divergence reads as fabrication even
when both values are individually correct. Card surface colour counts too — the
3D body reads differently on cream than on white.

---

## Stack

| | |
|---|---|
| Framework | Next.js 14.2 (App Router), React 18.3.1, TypeScript 5.5 |
| Styling | Tailwind 3.4 + `app/globals.css` |
| 3D | three.js + @react-three/fiber + drei |
| On-device ML | onnxruntime-web, @mediapipe/tasks-vision, @tensorflow-models/pose-detection |
| Auth | NextAuth (Google) + Supabase email OTP |
| Server data | Supabase (`profiles`, `friendships` only) |
| Cloud AI | OpenAI (coach/assistant/fuel), fal.ai (SAM 3D Body) |

Dev server runs on **port 3100**. Layout is a phone frame, `max-w-[430px]`.

```bash
npm install
npm run dev      # localhost:3100
npm run build
npm run lint     # NOTE: ESLint is not configured yet — this prompts for setup
npx tsc --noEmit # the de-facto check; there is no test suite
```

`npx tsc --noEmit` is clean as of `179ebd8`. (It previously carried standing
errors in `lib/ensemble.ts`; those are fixed — do not re-add a filter for them.)

**There is no test suite yet** (P1-4 adds Vitest). Verification is done by
running the dev server and inspecting the actual pages, plus compiling `lib/`
to ESM and exercising it under node — see Current Development State.

**Only ONE Next process may run against this checkout at a time.** Everything
writes to the same `.next`, so a second one silently breaks the first:

- `npm run build` while `npm run dev` is running → the production output
  overwrites the dev chunks, and the app loads as unstyled HTML with 404s on
  `main-app.js`, `app-pages-internals.js` and `layout.css`
- two `npm run dev` at once → the second takes the next free port (3001, 3002…)
  and clobbers the first, which starts returning 404

Recovery is the same both ways: kill every Next process, `rm -rf .next`, start
one server. `npm run dev` is pinned to port 3100 in `package.json`; if the app
answers on any other port, more than one server is running.

**If two agents share this checkout, only one of them may run Next at all.**

**node is not on the default PATH.** It lives under
`~/.local/node/node-v22.14.0-darwin-arm64/bin`, which only a login shell that
sources the profile ever sees. A bare `npm` fails with `command not found`, and
an absolute path to `npm` still fails with `env: node: No such file or
directory`, because npm is itself a `#!/usr/bin/env node` script. Either export
the PATH first:

```bash
export PATH="$HOME/.local/node/node-v22.14.0-darwin-arm64/bin:$PATH"
```

or call node by absolute path on next's own bin, which is what
`.claude/launch.json` does:

```
<abs node> node_modules/next/dist/bin/next dev -p 3100
```

`autoPort` is deliberately `false` there: **3100 is not a preference.** The
Google OAuth callback is registered against that exact port, so a floating port
silently breaks Google sign-in.

---

## Layout

```
app/          routes (App Router) + app/api/* server routes
components/   presentational + 3D components
lib/          ALL business logic — the real substance of the app
public/models on-device ONNX/MediaPipe weights (~5 GB, git-ignored territory)
public/       avatars, brand, exercises, icons, muscles, ort, pros
scripts/      one-off asset generators (brand-logo, cutout-muscles, gen3d)
design-assets/, exercise-images-inbox/   raw art, not shipped code
```

### `lib/` — read these before touching anything

| File | Owns |
|---|---|
| `analysis.ts` | `Frame` type, smoothing primitives, scoring. Imports nothing local — keep it that way |
| `track.ts` | Stage ①: YOLOv8s + ByteTrack person lock |
| `ensemble.ts` | Stage ①: MediaPipe Heavy + MoveNet Thunder fusion |
| `pose2d-refine.ts` | Stage ②: ViTPose-H/L + RTMPose-X + Sapiens consensus refinement |
| `pose-associate.ts` | Stage ③a: **candidate-level keypoint association** — runs before everything else |
| `pose-post.ts` | Stage ③b: the cleanup chain, swap correction, `frameReliability()` |
| `lift3d.ts` | Stage ④: MotionBERT 2D→3D lift, plus foot joints |
| `sam3d.ts` | Stage ⑤: optional fal.ai cloud shape anchors |
| `biomech.ts` | Deterministic biomechanics. `demandRaw`, `loadFromDemand`, `bodyScale` |
| `workouts.ts` | **THE training record.** `buildWorkouts()` pairs recordings with clips — LOAD, Recovery and CHARGE all count `Workout[]`, never the raw stores |
| `muscles.ts` | Per-muscle load, decay, recovery |
| `fitness.ts` | LOAD: the month calendar and the rolling 7-day dial |
| `form.ts` | FORM: six sport-agnostic capacities |
| `charge.ts` | CHARGE: acute vs chronic readiness |
| `fuel.ts` | Protein logging and target |
| `palette.ts` | **The** signal colour scale — see Design |
| `stats.ts` | Session storage (`getSessions`, `recordSession`, `updateSession`) |
| `goals.ts`, `streak.ts`, `coins.ts` | Gamification |
| `friends.ts`, `supabase-*.ts`, `auth.ts` | Identity and social |
| `mock.ts` | **Demo data. Reachable only from `/report/demo`. Never widen its use** |

---

## Frontend

`app/layout.tsx` → `components/AppShell.tsx` wraps everything and owns:

- the **auth gate** (magic-link callbacks are forwarded to `/login` with the URL
  hash intact — stripping it silently breaks every email login)
- the app's **only scroll container** (`#ml-scroll`)
- immersive mode (recording hides all chrome), the welcome veil, bottom nav

Key routes: `/` (Home), `/analyze` (upload + pipeline), `/report/[id]`,
`/load`, `/form`, `/weeks`, `/activity` (GPS recorder), `/fuel`, `/tree`,
`/streak`, `/friends`, `/leaderboard`, `/account/*`, `/onboarding`, `/login`.

**All training data is browser-local.** Supabase stores only `profiles` and
`friendships`. Nothing else survives clearing site data — see Known gaps.

### localStorage keys (never clear these casually)

Training data: `ml_sessions`, `ml_sessions_backup`, `ml_activities`, `ml_fuel`,
`ml_profile`, `ml_goals`, `ml_goals_history`, `ml_muscle_attr`.

A past bug wiped these during login because a returning user was misdetected.
`afterLogin()` in `app/login/page.tsx` now checks five separate signals before
treating anyone as new, and resets **only** gamification keys.

---

## Backend

Thin by design — the heavy work is on-device.

| Route | Purpose |
|---|---|
| `POST /api/coach` | GPT writes the coaching report. **Server-only OpenAI key** |
| `POST /api/assistant` | In-app help assistant |
| `POST /api/fuel` | Meal photo → macro estimate |
| `POST /api/pose3d` | Proxy to fal.ai SAM 3D Body (**server-only FAL key**) |
| `GET/POST /api/friends` | Friends state; identity from the Google session |
| `/api/auth/[...nextauth]` | Google sign-in; config in `lib/auth.ts` |

There is **no `/api/muscles`** — it was deleted deliberately. See Decisions.

### Supabase

Two tables only:

- `profiles` — `id`, `email`, `name`, plus avatar fields. Upserted on `email`.
- `friendships` — `requester`, `addressee`, status.

Browser code never queries Supabase directly for friends data; it goes through
`/api/friends` so identity is always server-verified. `lib/supabase-client.ts`
is used only for email-OTP auth (PKCE, `detectSessionInUrl: true`).

### Environment variables (names only)

```
OPENAI_API_KEY            server-only
FAL_KEY                   server-only
HF_TOKEN                  server-only
GOOGLE_CLIENT_ID          server-only
GOOGLE_CLIENT_SECRET      server-only
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_GOOGLE_MAPS_KEY
```

---

## The video analysis pipeline

Driven by `app/analyze/page.tsx`, stages 0–5, all on-device except stage ④.

```
stage 0  load models + video
stage 1  offline frame-by-frame scan (never real-time)
           YOLOv8s + ByteTrack person lock          lib/track.ts
           MediaPipe Heavy + MoveNet ensemble       lib/ensemble.ts
stage 2  refinement + cleanup
           ViTPose-H/L + RTMPose-X + Sapiens        lib/pose2d-refine.ts
           cleanup chain + swap correction          lib/pose-post.ts
stage 3  MotionBERT 3D lift  [1,243,17,3] H36M-17   lib/lift3d.ts
stage 4  SAM 3D Body cloud anchors (opt-in)         lib/sam3d.ts
stage 4.5 deterministic biomechanics                 lib/biomech.ts
stage 5  GPT writes the report                       /api/coach
```

### Models in `public/models/`

`yolov8s`, `pose_landmarker_{lite,full,heavy}`, `vitpose_{int8,fp16,l_fp32,h_fp16}`,
`rtmpose_x`, `sapiens_{03b,06b}_fp16`, `motionbert_3d_243`. The refiner picks a
tier by device capability (WebGPU → heavy, otherwise int8).

### Cleanup — `lib/pose-associate.ts` then `lib/pose-post.ts`

Order matters, and this is the order (`refinePose()`):

```
bridgeGaps
  → associateLowerLimb        ← association, BEFORE anything else
  → fixLegTangles → fixBoneSpikes
  → fixIdentitySwaps
  → fixHingeGlitches → recoverOcclusions → smoothZeroPhase
```

**Association comes first on purpose.** The headline failure is not coordinate
noise: during a stride the detector can attach a knee to a foot candidate that
belongs to the other leg, producing a shin 1.6× its real length that the model
reports at 0.88 confidence. Smoothing that only makes a wrong answer tidy, and
interpolating it spreads the error into its neighbours. `associateLowerLimb`
answers "which detected point actually IS this joint" from candidates, scored
against this athlete's own anatomy:

- candidates = the model's answer, **the rival model's answer** (see below),
  bidirectional trajectory prediction, and their interpolation
- robust bone stats use **median + MAD**, not mean + SD — the catastrophic
  frames we are hunting are exactly what a mean cannot survive
- a shin that is both `> 1.38×` its own median **and** `> 3.5 MAD` out is
  hard-vetoed (`bone = 0`) no matter what confidence the model reports
- scoring: confidence 20%, temporal 28%, bone 28%, orientation 12%, chain 12%
- **tiers, not weights**: a plausible real detection (tier 0) always beats a
  reconstruction (tier 1); a detection below the plausibility floor drops to
  tier 1, so a bad observation never outranks a good inference
- tier 1 results are marked `est` with confidence clamped to `VIS_MIN`

`lib/pose2d-refine.ts` makes this possible: when ViTPose and RTMPose disagree it
now keeps the loser as a **candidate** on the landmark (`lm[i].cand`) instead of
discarding it. Discarding it was the original bug — the correct foot was
detected, then thrown away, leaving nothing downstream to correct against.

`fixIdentitySwaps` is the important one: during running the legs cross and the
detector wires an ankle to the wrong knee, throwing a diagonal line across the
body. It scores four hypotheses (swap mid / end / both / neither) per **segment**
using anatomy, bone plausibility and **bidirectional temporal prediction**
(t−3…t−1 and t+1…t+3, linear extrapolation — *not* a median, which blurs the two
legs together exactly at the crossing). An ambiguity gate refuses to swap when
left and right are closer than 45% of limb length, so genuine crossings survive.

Every repair records provenance on the landmark:

```ts
fix: { r: FixReason, m: FixMethod, ox, oy, oc }
// LEFT_RIGHT_SWAP | TEMPORAL_SPIKE | BONE_LENGTH_VIOLATION
// ANATOMICAL_VIOLATION | LOW_CONFIDENCE_OCCLUSION
```

`frameReliability(lm)` turns that into a 0–1 score per frame, which flows into
biomechanics. `lib/draw.ts` exposes `drawPoseDebug()` (green = accepted,
yellow = corrected with an arrow from the original position, red = rebuilt) and
`poseDebugLog()`.

---

## Biomechanics — `lib/biomech.ts`

Pure deterministic maths. **No model produces these numbers.**

- de Leva segment mass fractions, joint angles from 3D vectors, ROM,
  rep segmentation with eccentric/concentric phases
- Muscle demand accumulates per frame, weighted by `frameReliability` — a clip
  carried by reconstructed joints yields a smaller, not an equally confident,
  number

```
load = 1 − exp( −(demandRaw × bodyScale × volume) / REF )
```

| Term | Rule |
|---|---|
| `demandRaw` | accumulated at the reference body, **stored on the report** so it can be rescaled later. `legacyDemand()` reconstructs it exactly for older sessions (the old map is invertible — this recovers a computed number, it does not re-estimate one) |
| `bodyScale` | `(weight/70) × (height/172)²`. Segment mass is linear in body mass; moment of inertia goes with segment length². Applied at **read** time, so editing your profile rescales every past session |
| `volume` | `sessionSeconds / observedSeconds`. A clip is a *sample* of a session. Sources: what the athlete set on the report → an overlapping recorded workout → `DEFAULT_SESSION_MIN` (30), labelled |
| `REF` | calibrated at **full-session** scale (`REF_SESSION_SCALE = 800`). Anchored on real footage: 20 min easy → 0.25, 45 min easy → 0.47, 45 min hard → 0.72 |

Without height *and* weight, `bodyKnown` is false: angles and ROM still compute
(pure geometry), muscle load is withheld with a stated reason.

---

## Recovery / fatigue — `lib/muscles.ts`

Saturating stack with per-group decay:

```
load = 1 − Π( 1 − min(0.85, impact · 0.5^(effectiveHours / halfLife)) )
```

Half-lives: quads/glutes 44 h, hams/back/chest 42 h, calves 30 h, core 28 h,
shoulders 26 h, arms 24 h. `SESSION_WINDOW_H = 3` collapses several clips of one
workout into a single training.

`computeRecovery()` = `100 · (1 − (0.35·worst + 0.65·mass-weighted avg))` and is
**the** recovery formula — Home, LOAD and the assistant all call it. There is no
cached snapshot; the computation is local and synchronous so every surface
agrees on the first frame.

Protein modulates recovery *speed* only: `fuelFactor` 1.15 → 0.87 across 0.25→1.0
of a 1.6 g/kg/day target. Eating past the target buys nothing; not logging is
neutral (1.0), never a penalty.

---

## Nutrition — `lib/fuel.ts`, `/fuel`

Meal photo → `/api/fuel` → macro estimate. Photos are analysed and dropped,
never stored. `proteinTarget()` returns **null** without a body weight rather
than assuming one.

---

## Design system

- **Colour:** `lib/palette.ts` is the single source. `qualityColor(v)` for
  higher-is-better (≥70 green, ≥50 amber, else red), `intensityColor(v)` for
  higher-is-more. The same three hexes exist as Tailwind `signal.*` tokens and
  are kept byte-identical — Tailwind classes and inline styles must not drift. Do not invent local thresholds; four divergent scales
  used to exist and produced a "73 shows amber here, green there" bug.
- **Type:** body text on the system stack; headings and **all numbers** use
  `.font-golden` (Lilita One).
- **No Apple emoji** anywhere — stroke SVGs (`components/SIcon.tsx`, `Icons.tsx`).
- **No grey explainer paragraphs.** The owner removes them on sight.
- One deliberate semicircle: `components/Gauge.tsx`. Reuse it rather than
  drawing new arcs. Its `value` is not always a number — callers pass words
  ("Moderate") — so the type scales to the string length; keep that if you
  touch it.
- Shared primitives: `GoalRing`, `ScoreRing`, `Gauge`, `MuscleBody3D`,
  `SaveSuccess` (the "lava" save celebration — mount it wherever a form saves).

---

## Architectural decisions already made

1. **Core metrics are never LLM-generated.** GPT names exercises and writes
   prose. Muscle load, recovery, FORM, LOAD are deterministic. `/api/muscles`,
   which asked GPT to estimate muscles from a sport name, was **deleted** —
   sessions the biomech layer cannot measure now contribute nothing.
2. **Body scale is applied at read time, not frozen at analysis time**, so
   profile edits rescale history.
3. **Rolling 7-day window, not a calendar week.** A Monday-anchored week snaps
   the dial to zero while the body still carries Saturday's session.
4. **`boneClamp` was removed and must not come back.** Clamping 2D bone length
   per frame "fixed" normal perspective foreshortening and destroyed accuracy
   (expert PCK@5 84% → 76%, arms 84 → 69). Bone length may **score** competing
   hypotheses; it must never **move** a joint.
5. **Goals are daily and date-versioned** (`ml_goals_history`); editing today
   never rewrites the past.
6. **Simulated GPS routes are flagged** (`demo: true` on the activity) and
   labelled in the UI.

---

## Removed on purpose — do not "restore" these

**STAMINA.** The LOAD page once had a MUSCLE / STAMINA switch. It was dropped
along with its `sustain` computation in `lib/biomech.ts`. Nothing read it, and
there is no version control here, so the method is recorded rather than kept as
dead code:

> `sustain` compared the first third of a clip to the last third — mean angular
> speed of the primary working joint, plus that joint's ROM, in each third.
> `ratio = min(1.3, lastThirdSpeed / firstThirdSpeed)`, computed only when a
> primary joint existed, the span was ≥ 6 s and ≥ 45 frames were usable.

Why it mattered, if it ever comes back: real VO2max needs heart rate, which a
camera cannot get during motion (rPPG collapses under movement artifacts, and
HRR→VO2max is not valid in young or sedentary populations). The only
video-native endurance signal is **fatigue resistance** — how much form decays
across a session — which is precisely what `sustain` measured and what a watch
cannot. A Cooper 12-minute test over recorded GPS is the one honest path to an
actual VO2max number, and needs no new model.

**`boneClamp`** and **`/api/muscles`** — see Decisions above.

---

## Known gaps / technical debt

- **No server-side sync.** All training data is browser-local. This is the
  blocker before real users; Supabase has no tables for it yet.
- **`app/activity/page.tsx` fabricates GPS movement** when no real fix is
  available (`Math.random()` heading, ~line 508). The result is saved as real
  distance and pace. It is flagged `demo: true` but should stop accumulating
  distance entirely. **Open bug.**
- **`computeBiomech` fails silently.** It returns `null` when frames are too
  sparse (`app/analyze/page.tsx` does `if (bm) ...`) and the user is never told
  why muscle data is missing. **Open bug.**
- MotionBERT is not used to validate 2D assignments (rejected as too expensive:
  it runs after refinement on a 243-frame window, so feedback means a second
  full pass).
- The heavy refinement models run per crop, not per joint, so per-joint
  compute gating is not currently possible.
- ESLint is unconfigured; `npm run lint` prompts for interactive setup.
- `lib/ensemble.ts` has standing `tsc` errors.

---

## Do not change casually

| | Why |
|---|---|
| `lib/analysis.ts` | Imports nothing local. Adding an import risks a cycle across the whole `lib` graph |
| `refinePose()` chain order | Each pass assumes the previous one ran, and association MUST stay ahead of every smoothing/interpolation pass |
| `lm[i].cand` in `pose2d-refine.ts` | The rival model's answer. Dropping it re-creates the original association bug |
| Render-time `new Date()` | Any clock read during render bakes the server's timezone into the markup and throws a hydration error. `app/weeks/page.tsx` holds its first paint until mount for this reason |
| `REF_SESSION_SCALE`, `WEEK_FULL`, `bodyScale` | Calibrated against real footage; changing one silently rewrites every displayed number |
| `computeRecovery()` | Every surface reads it; forking it reintroduces the mismatch bugs |
| `afterLogin()` in `app/login/page.tsx` | Previously deleted real training data |
| `AppShell` auth gate | Stripping the URL hash breaks every magic link |
| `lib/palette.ts` | The single colour source |
| `buildWorkouts()` pairing rule | Reading `ml_sessions`/`ml_activities` directly from LOAD, Recovery or CHARGE re-creates the double count it exists to remove |
| `public/models/*` | Multi-GB weights; the refiner's tier fallback depends on the exact filenames |

---

## Current Development State

Working through a 24-point "make it a real app" checklist. Cleared so far: the
logo, the Home TODAY card, the day-detail page, the FORM page, the LOAD page,
plus roughly 35 bugs found along the way.

### Recently landed

**Data honesty audit.** Removed the GPT muscle-estimation fallback (and deleted
`/api/muscles`); deleted `FakeMap` and labelled simulated GPS routes; removed
the assumed 172 cm / 65 kg body everywhere; gave muscle dose a real volume term
(a 6.5 s clip had been credited as 70% of maximal quad demand, dropping recovery
34 points from one easy run); made height and weight genuinely scale demand
(previously height did nothing and weight touched only the lower body).

**Pose pipeline.** Restored foot keypoints (MediaPipe 29–32) into the 3D
skeleton — they were being dropped in the 17-joint conversion, so ankle angle was
never computable and calf demand fell back to vertical bounce. Rewrote the
left/right swap solver with bidirectional temporal evidence and an ambiguity
gate. Added `lib/pose-associate.ts` for candidate-level association and stopped
`pose2d-refine.ts` discarding the rival model's answer on disagreement.
Propagated per-frame reliability into biomechanics.

**UI consistency.** Unified four divergent score-colour scales into
`lib/palette.ts` (a 73 rendered amber in one place and green in another). Fixed
the `Gauge` overflowing when handed a word instead of a number, a hydration
error on `/weeks` caused by a render-time `new Date()`, and a duplicated
`page-enter` wrapper that played every page transition twice.

### Verification standard used

There is no test suite, so changes to the pose pipeline were checked with a
synthetic side-on running stride compiled out of `lib/` and run under node:

- **repair:** injecting a 3-frame plus one isolated ankle swap — joints off by
  >3% went 8 → 0, worst joint error 0.217 → 0.022, longest drawn shin
  0.246 → 0.194 (the true value)
- **association:** injecting a wrong-candidate ankle at 0.88 confidence with the
  correct foot present as a rival-model candidate — the model's own answer
  scored 0.298 (hard-vetoed on bone length) and the RTMPose candidate was
  selected, shin 1.63× → 0.99× true, error 0.005
- **false positives:** clean input through the same pipeline, 0 of 60 frames
  wrongly swapped, 0 joints off by >3%

Re-use this pattern rather than trusting a visual check alone.

### Known open item

The owner reported a real frame where a knee connects to a wrong foot candidate,
but **that frame was never received** — the association work above was validated
only on synthetic data. If the real clip is available, make it a fixed
regression case; it may exercise a path the synthetic test does not (for
example, an ankle associated to the *other leg's* detection rather than to empty
space).

### Next logical tasks, in order

1. **Stop fabricating GPS distance** (`app/activity/page.tsx`, ~line 508) — show
   "waiting for GPS" instead of accumulating a random walk.
2. **Surface biomech failures** — record why `computeBiomech` returned null and
   tell the user, instead of silently falling through
   (`app/analyze/page.tsx` does `if (bm) ...`).
3. **Ask for session length in the analyze flow**, so `DEFAULT_SESSION_MIN`
   rarely has to apply.
4. **Wire `drawPoseDebug()` into the report's video replay** behind a toggle, so
   corrections can be inspected on real footage rather than synthetic tests.
5. **Server-side sync** (checklist #23) — the prerequisite for real users.
6. Remaining checklist items: CHARGE detail page, muscle detail page, report
   hierarchy, FUEL page, XP levels, coin economy, medals, packs, streak
   milestones, friends, leaderboard, progress calendar, settings, empty states,
   skeletons, PWA.
