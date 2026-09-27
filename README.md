# MotionLab 2.0

> AI movement coach — film yourself training on a phone, get measured biomechanics: which muscles the session loaded, how recovered your body is, and how your movement quality is trending.

**Live:** [motionlab-2-0.vercel.app](https://motionlab-2-0.vercel.app)

---

## What makes it different

The pose models run **in your browser**, not on a server. Your video file is
never uploaded — only three small still frames go to the AI coach so it can
recognise the activity and write the coaching notes.

And one rule the whole codebase is built around: **no number is ever invented.**
Muscle load, recovery, FORM and LOAD are computed by deterministic
biomechanics — the language model names exercises and writes prose, it never
produces a metric. If a value cannot be measured, the app shows an empty state
or an assumption you can see and correct, never a plausible-looking substitute.

## Features

| Feature | Description |
|---------|-------------|
| Video analysis | Six-stage on-device pose pipeline turns a phone clip into 3D joint positions |
| Muscle load | Per-muscle demand from de Leva segment masses, joint angles and ROM — scaled by your real height and weight |
| Recovery | Saturating fatigue stack with per-muscle-group half-lives (quads 44 h, arms 24 h) |
| FORM | Six sport-agnostic movement capacities, tracked over time |
| LOAD | Rolling 7-day training load and a month calendar |
| CHARGE | Acute vs chronic readiness |
| Activity recording | GPS route, distance, pace, splits, auto-pause, elevation |
| FUEL | Meal photo → macro estimate, and a protein target from your body weight |
| Social | Friends, leaderboard, streaks, goals and collectibles |

## The analysis pipeline

All on-device except one optional cloud step.

```
stage 0   load models + video
stage 1   YOLOv8s + ByteTrack person lock
          MediaPipe Heavy + MoveNet Thunder ensemble
stage 2   ViTPose-H/L + RTMPose-X + Sapiens consensus refinement
          candidate association → cleanup chain → swap correction
stage 3   MotionBERT 2D→3D lift  [1,243,17,3]  H36M-17
stage 4   SAM 3D Body cloud anchors (opt-in, off by default)
stage 4.5 deterministic biomechanics
stage 5   the coach writes the report
```

## Tech stack

- **Framework:** Next.js 14.2 (App Router), React 18.3, TypeScript 5.5
- **Styling:** Tailwind 3.4
- **3D:** three.js + React Three Fiber + drei
- **On-device ML:** onnxruntime-web (WebGPU/WASM), MediaPipe Tasks Vision, TensorFlow pose-detection
- **Auth:** NextAuth (Google) + Supabase email OTP
- **Data:** Supabase — profiles, friendships, and a private per-account snapshot
- **Cloud AI:** OpenAI (coach, assistant, meal scanner), fal.ai (SAM 3D Body)

## Local development

```bash
npm install
cp .env.example .env.local   # fill in keys
npm run dev                  # localhost:3100
```

```bash
npm run build      # production build
npx tsc --noEmit   # types
npm test           # vitest
```

**The model weights are not in this repository.** `public/models/` is 4.9 GB
across 12 ONNX and MediaPipe files, far past GitHub's limits, so a fresh clone
can run the app but not the analysis. Serve them from object storage and point
`NEXT_PUBLIC_MODEL_BASE` at it — see [docs/DEPLOY.md](docs/DEPLOY.md). Unset, the
app looks in `public/models/`, which is what local development uses.

The dev server is pinned to **port 3100**: the Google OAuth callback is
registered against that exact port, so a floating port breaks Google sign-in.

### Environment variables

| Variable | Source |
| --- | --- |
| `OPENAI_API_KEY` | platform.openai.com (server-only) |
| `FAL_KEY` | fal.ai (server-only) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console |
| `NEXTAUTH_SECRET` | any random string; required in production |
| `NEXTAUTH_URL` | the deployed origin |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings (server-only) |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | optional; without it the map uses OpenStreetMap |
| `NEXT_PUBLIC_MODEL_BASE` | where the model weights are served from |

## Project layout

```
app/          routes (App Router) + app/api/* server routes
components/   presentational + 3D components
lib/          all business logic — the substance of the app
public/       icons, muscles, exercise art, onnxruntime, MediaPipe wasm
scripts/      model upload + deploy verification
tests/        vitest — data safety, workouts, recovery, the API guard
docs/         design system, checklist, deploy guide
```

`lib/` is where the real work lives: `biomech.ts` (deterministic
biomechanics), `muscles.ts` (fatigue and recovery), `workouts.ts` (the training
record), `pose-associate.ts` and `pose-post.ts` (keypoint association and
cleanup), `palette.ts` (the single colour source).

## Privacy

Your video never leaves your device. Per analysis, three 384 px still frames go
to the coach; the meal scanner sends one photo which is read and dropped, never
stored; the optional cloud 3D step sends 4–12 more frames and is off unless you
turn it on. There are no ad or analytics trackers. The in-app privacy page lists
all of it.

## Documentation

- [AGENTS.md](AGENTS.md) — architecture, decisions, and the rules that matter
- [docs/DEPLOY.md](docs/DEPLOY.md) — shipping it, including the model weights
- [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) — radius, type, elevation, colour
- [docs/CHECKLIST.md](docs/CHECKLIST.md) — the plan of work
