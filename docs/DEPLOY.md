# Deploying MotionLab 2.0

The app deploys like any Next app. The weights do not — they are 4.9 GB and
git-ignored, so they go up separately and the app is told where they are.

## 1. Upload the model weights

```bash
BLOB_READ_WRITE_TOKEN=… node scripts/upload-models.mjs
```

The token is in the Vercel dashboard under Storage → your Blob store →
`.env.local`. Ten files, 4.9 GB, largest first; multipart above 100 MB. An
interrupted run resumes — it checks what is already there by size. `--dry-run`
prints the plan without sending anything.

The two `pose_landmarker_{full,lite}.task` files are skipped: nothing loads
them. `--all` includes them anyway.

Uploads land at `models/v1/<name>` and are **never overwritten**. A weight
file's bytes *are* the model, so replacing one in place would leave cached
clients and fresh ones silently running different models against the same
calibration. A new model means `MODEL_VERSION=v2` and a matching
`NEXT_PUBLIC_MODEL_BASE`.

## 2. Set the environment variables

The upload script prints the base URL. In Vercel → Settings → Environment
Variables:

```
NEXT_PUBLIC_MODEL_BASE=https://<store>.public.blob.vercel-storage.com/models/v1
```

`NEXT_PUBLIC_*` is inlined at **build** time, so this must be set *before* the
build that ships it. Setting it afterwards changes nothing until a redeploy.

The rest, from `.env.example`:

| | |
|---|---|
| `OPENAI_API_KEY`, `FAL_KEY` | the paid upstreams. Server-only |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in |
| `NEXTAUTH_SECRET` | required in production; NextAuth refuses to start without it |
| `NEXTAUTH_URL` | the deployed origin, not localhost |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client auth |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only. Never prefix with `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | optional; without it the map falls back to OSM |

The Google OAuth callback must list the deployed origin, not just
`localhost:3100`, or Google sign-in fails in production only.

## 3. Verify what a browser will actually see

```bash
node scripts/verify-models.mjs https://<store>.public.blob.vercel-storage.com/models/v1
```

Checks each file for presence, exact byte size (a truncated multi-GB upload
answers 200 with short content and fails much later inside onnxruntime with an
opaque error), CORS, and cache lifetime. It reports per device tier, because a
tier is unusable unless every file it reaches for is there.

## What a first analysis costs in bandwidth

Measured, not estimated:

| Device | First analysis downloads |
|---|---|
| No WebGPU | 506 MB |
| WebGPU, default quality | **2229 MB** |
| WebGPU, `ml_quality = "best"` | 2900 MB |

Per **browser**, not per analysis — the files are served with a one-year cache
and immutable paths. If the verify script warns about `cache-control`, that
guarantee is gone and the same gigabytes are paid on every analysis.

Shrinking this means running a smaller refiner, which changes every number the
app displays. It is a product decision with a measurement attached, not a
cleanup — see AGENTS.md.

## Known, deliberate, and worth deciding before real users

- `/report/demo` is reachable in production and reads `lib/mock.ts`. It is kept
  as a showcase on purpose; anyone who lands on it sees sample data.
- `/analyze` accepts a video of any size or length. A long 4K clip will scan
  every frame and take a very long time rather than refusing.
- The rate limiter in `lib/api-guard.ts` is per server instance. On serverless
  the effective ceiling is the limit times the number of warm instances.
- `app/globals.css` loads the display font from Google Fonts, so Google sees
  each visitor's request. Self-hosting Lilita One removes that.
- Deleting an *account* (as opposed to its training data) has no button; the
  privacy page says to ask instead of implying one exists.
