// Server-side proxy for SAM 3D Body (fal.ai) — the FAL key lives ONLY here.
// Input:  { frames: string[] }  — JPEG data URIs sampled from the user's video
// Output: { ok, frames: [{ people: [{ bbox, keypoints_2d, keypoints_3d }] } | null] }
//
// Cost guard: hard cap on frames per request. Each frame ≈ $0.02 at fal.

import { guard } from "@/lib/api-guard";

export const maxDuration = 300;

const MAX_FRAMES = 12; // ≈ $0.24 ceiling per analysis
const CONCURRENCY = 12; // one wave — anchor batch resolves in a single round-trip

type FalPerson = {
  person_id: number;
  bbox: number[];
  keypoints_2d: number[][];
  keypoints_3d: number[][];
};

export async function POST(req: Request) {
  const key = process.env.FAL_KEY;
  if (!key) return Response.json({ ok: false, error: "no-key" }, { status: 500 });

  // paid upstream — identity, ceiling and size before anything else
  const gate = await guard<{ frames: string[] }>(
    req, "pose3d", { perMinute: 4, perHour: 20, maxBytes: 16 * 1024 * 1024 }
  );
  if ("error" in gate) return gate.error;

  const { frames } = gate.body;
  if (!Array.isArray(frames) || !frames.length) {
    return Response.json({ ok: false, error: "no-frames" }, { status: 400 });
  }
  const batch = frames.slice(0, MAX_FRAMES);

  const runOne = async (dataUri: string) => {
    try {
      const r = await fetch("https://fal.run/fal-ai/sam-3/3d-body", {
        method: "POST",
        headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(45_000), // one slow frame must not stall the batch
        body: JSON.stringify({
          image_url: dataUri,
          export_meshes: false,        // keypoints only — keeps responses small + fast
          include_3d_keypoints: false, // (this flag is for the visualization render)
          include_mhr_params: false,
        }),
      });
      if (!r.ok) return null;
      const j = await r.json();
      const people: FalPerson[] = j?.metadata?.people ?? [];
      return {
        people: people.map((p) => ({
          bbox: p.bbox,
          keypoints_2d: p.keypoints_2d,
          keypoints_3d: p.keypoints_3d,
        })),
      };
    } catch {
      return null; // one bad frame never sinks the batch
    }
  };

  // limited-concurrency pool
  const out: (Awaited<ReturnType<typeof runOne>> | null)[] = new Array(batch.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batch.length) }, async () => {
      while (next < batch.length) {
        const i = next++;
        out[i] = await runOne(batch[i]);
      }
    })
  );

  return Response.json({ ok: true, frames: out });
}
