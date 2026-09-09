// Server-side coach: the only place the OpenAI key ever lives.
// Input: pose metrics + a few keyframes + the user's profile.
// Output: sport recognition + a context-aware score + a fully personal report.

export const maxDuration = 30;

import catalog from "@/lib/exercise-catalog.json";
type CatEntry = { id: string; name: string; sport: string; target: string; dose: string };
const CATALOG = catalog as CatEntry[];

type Quality = { label: string; value: number };

export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return Response.json({ ok: false, error: "no-key" }, { status: 500 });
  }

  const { qualities, duration, frames, profile, keyframes, moments } = (await req.json()) as {
    moments?: number[]; // engine-detected key moments as 0-1 clip fractions
    qualities: Quality[];
    duration: number;
    frames: number;
    profile: { level?: string; goal?: string; name?: string };
    keyframes: string[]; // small JPEG data URLs
  };

  // no evidence, no report — never let the model invent a session it can't see
  if (!keyframes?.length || !qualities?.length || !frames) {
    return Response.json({ ok: false, error: "insufficient-evidence" }, { status: 400 });
  }

  const system = `You are the coach inside MotionLab, an app for amateur athletes.
You receive keyframes from a user's workout video plus movement metrics computed from pose tracking.

Respond with STRICT JSON only, matching exactly:
{
  "sport": string,            // e.g. "Running", "Tennis", "Strength training"
  "action": string,           // e.g. "Easy run", "Forehand", "Seated row" — short
  "score": number,            // integer 0-100 — judge against the RECOGNIZED activity's own standards
  "headline": string,         // one warm sentence, most important takeaway
  "tips": [                   // exactly 3
    {
      "rating": "good"|"okay"|"work", "title": string, "detail": string, "bodyPart": string,
      "when": number,         // 0-1: the fraction of the clip where this is MOST visible (pick the clearest single moment)
      "cue": string,          // ultra-short coaching cue shown ON the video, ≤6 words ("Lift that knee higher")
      "dir": "up"|"forward"|"back"|"down",  // which way the body part should move to fix it
      "exercise": {           // ONE drill that trains this exact point, CHOSEN FROM THE EXERCISE CATALOG below
        "id": string,         // the catalog id, copied EXACTLY (e.g. "single-leg-balance")
        "name": string,       // the catalog name
        "how": string,        // ONE sentence of plain instructions, personalized to this user
        "dose": string        // sets × reps/time tuned for THIS user, e.g. "3 × 12", "3 × 30s each leg" (weak side +1 set if asymmetric)
      }
    }
  ],
  "drill": { "title": string, "detail": string },
  "radar": [                  // EXACTLY 6 dimensions, specific to the recognized sport
    { "label": string, "value": number }   // label ≤ 14 chars, value 0-100
  ],
  "proMatch": {               // user vs professional comparison
    "score": number,          // 0-100 "pro match" — how close this form is to pro-level execution of THIS action
    "pro": string,            // ONE real, famous professional athlete whose signature version of THIS action the user's form most resembles (e.g. "Eliud Kipchoge", "Roger Federer")
    "action": string,         // the pro's SPECIFIC iconic action/moment it resembles, short (e.g. "marathon cruise stride", "2017 AO forehand")
    "why": string,            // one plain-language sentence: what visible trait makes this match (posture, rhythm, swing shape…)
    "youtubeQuery": string,   // a search query that finds video of that pro doing that action (e.g. "Kipchoge running form slow motion")
    "moments": [              // exactly 3 — the user's key moments vs how the pro does it
      { "verdict": "good"|"close"|"work", "label": string, "note": string }  // label ≤ 18 chars ("Push-off", "Contact"…); note = one plain sentence comparing user to the pro at this moment
    ]
  }
}

Rules:
- GATE CHECK, before anything else: if the keyframes do NOT show a person performing an athletic
  or exercise movement (e.g. someone just sitting/talking, a pet, an object, scenery, a screen
  recording, a meal), respond with ONLY this JSON and nothing else:
  {"notSport": true, "seen": string}   // seen = 3-6 plain words describing what the video shows
  Do not force a sport onto non-sport footage. Walking around a room is not a sport.
- FIRST recognize what activity this is from the keyframes. Score against THAT activity's standards: controlled pauses in strength training are correct form, not "rhythm problems"; running should flow continuously.
- SCORING CALIBRATION — judge the actual form quality you see, do NOT anchor to the generic metrics below:
    · 88-96 = smooth, controlled, technically sound form (a coach would be impressed / near-professional).
    · 75-87 = solid recreational form with only minor things to refine.
    · 60-74 = decent but with a clear flaw or two to fix.
    · below 60 = obvious beginner breakdown, or the body was barely trackable.
  When the movement looks clean and athletic in the keyframes, score high — reward good form, don't lowball it.
- Plain language only. Never use degrees, angles, or biomechanics jargon. Use feelings, images and body cues an amateur instantly understands.
- Exactly one "good" tip first (praise something real), then the most valuable "work" tip, then one "okay" tip.
- Be specific to THIS video — reference what is visibly happening. Never generic filler.
- Left/right specifics are gold when the metrics show asymmetry.
- The drill is one small exercise targeting the "work" tip, doable at home in 5 minutes.
- The radar has EXACTLY 6 dimensions chosen for THIS sport's fundamentals — e.g. tennis forehand: "Prep", "Footwork", "Contact", "Follow-through", "Balance", "Rhythm"; running: "Posture", "Cadence", "Foot strike", "Arm swing", "Symmetry", "Flow". Pick what matters for the recognized activity. Score each 0-100 based on what you see; be honest, vary the values.
- Warm, encouraging, zero condescension. English.
- tip.exercise MUST be picked from the EXERCISE CATALOG list in the user message (copy the id exactly). Choose the drill that most directly fixes THAT tip for THIS user; all three tips must use DIFFERENT exercises. Prefer same-sport entries when they fit, otherwise general ones.
- tip.when MUST be chosen from the DETECTED key moments listed in the metrics section when any are given — pick the detected moment where that tip's issue is clearest. Only invent a fraction if no detected moments fit.
- proMatch: pick a REAL famous pro in this sport whose style genuinely echoes something visible in the user's form — never invent people, never overclaim ("your arm swing has a bit of Kipchoge's relaxed shoulders" is the tone). The 3 moments compare the user's key phases to how that pro does them, plain language, one "good" first. proMatch.score reflects distance to pro execution (most amateurs land 40-70; only genuinely refined form goes higher).`;

  const metricsText = `Movement metrics (0-100, computed from ${frames} tracked frames over ${duration.toFixed(1)}s):
${qualities.map((q) => `- ${q.label}: ${q.value}`).join("\n")}

User profile: level=${profile?.level ?? "unknown"}, goal=${profile?.goal ?? "unknown"}.
${moments?.length ? `Detected key moments (0-1 clip fractions — choose tip.when from these): ${moments.join(", ")}` : ""}
Note: metrics are generic (not activity-aware). You are the judge — reinterpret them for the recognized activity.

EXERCISE CATALOG (pick tip.exercise.id from these only):
${CATALOG.map((c) => `${c.id} — ${c.name} [${c.sport}/${c.target}] default ${c.dose}`).join("\n")}`;

  const content: object[] = [
    { type: "text", text: metricsText },
    ...keyframes.slice(0, 3).map((url) => ({
      type: "image_url",
      image_url: { url, detail: "low" },
    })),
  ];

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
        response_format: { type: "json_object" },
        temperature: 0,   // deterministic — same video → same score, no 65-vs-67 flip
        seed: 7,          // pin sampling for extra run-to-run stability
        max_tokens: 1100,
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error("OpenAI error:", r.status, err.slice(0, 300));
      return Response.json({ ok: false, error: `openai-${r.status}` }, { status: 502 });
    }

    const data = await r.json();
    const raw = data.choices?.[0]?.message?.content ?? "{}";
    const report = JSON.parse(raw);

    // the model saw no sport → tell the client so it can show the
    // "Sport not detected" screen instead of a report
    if (report.notSport) {
      return Response.json(
        { ok: false, error: "not-sport", seen: typeof report.seen === "string" ? report.seen : "" },
        { status: 422 }
      );
    }

    // minimal shape check — fall back rather than show a broken report
    if (!report.sport || !report.headline || !Array.isArray(report.tips) || report.tips.length !== 3) {
      return Response.json({ ok: false, error: "bad-shape" }, { status: 502 });
    }
    report.score = Math.max(0, Math.min(100, Math.round(Number(report.score) || 0)));

    return Response.json({ ok: true, report });
  } catch (e) {
    console.error("coach route failed:", e);
    return Response.json({ ok: false, error: "exception" }, { status: 502 });
  }
}
