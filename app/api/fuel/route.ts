// Server-side fuel scanner: one meal photo in, macro estimate out.
// Same key/channel as the coach; the photo is analyzed and dropped, never stored.

import { parseFuelModelOutput, readFuelRequest } from "@/lib/fuel-api";

export const maxDuration = 30;

export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ ok: false, error: "no-key" }, { status: 500 });

  const request = await readFuelRequest(req);
  if (!request.ok) return Response.json({ ok: false, error: request.error }, { status: request.status });

  const system = `You are the fuel scanner inside MotionLab, an app for amateur athletes.
You get ONE photo of a meal. Estimate what an athlete needs to know about it.
Respond with STRICT JSON only, matching exactly:
{
  "isFood": boolean,        // false if the photo clearly isn't food
  "dish": string,           // short dish name, e.g. "Chicken rice", <= 24 chars
  "protein": number,        // grams, integer — the estimate that matters most
  "carbs": number,          // grams, integer
  "fat": number,            // grams, integer
  "kcal": number,           // integer
  "confidence": "high"|"medium"|"low"
}
Estimate for the WHOLE portion visible. Round sensibly. If unsure between two
dishes, pick the closer one and lower the confidence.`;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        max_tokens: 200,
        messages: [
          { role: "system", content: system },
          { role: "user", content: [{ type: "image_url", image_url: { url: request.image, detail: "low" } }] },
        ],
      }),
    });
    if (!r.ok) return Response.json({ ok: false, error: "upstream" }, { status: 502 });
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return Response.json({ ok: false, error: "invalid-model-output" }, { status: 502 });
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      return Response.json({ ok: false, error: "invalid-model-output" }, { status: 502 });
    }

    const out = parseFuelModelOutput(raw);
    if (!out) return Response.json({ ok: false, error: "invalid-model-output" }, { status: 502 });
    return Response.json({ ok: true, ...out });
  } catch {
    return Response.json({ ok: false, error: "failed" }, { status: 500 });
  }
}
