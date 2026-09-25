import { describe, expect, it } from "vitest";
import { rateLimit, readJsonLimited } from "@/lib/api-guard";

// These guard the four routes that bill OpenAI and fal.ai. Before them, anyone
// who found a URL could spend the owner's credits without limit.

const body = (value: unknown) =>
  new Request("http://x/y", { method: "POST", body: JSON.stringify(value) });

describe("rateLimit", () => {
  it("allows up to the limit, then refuses", () => {
    const key = `k${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    expect(rateLimit(key, 3, 60_000).ok).toBe(false);
  });

  it("tells the caller how long to wait", () => {
    const key = `k${Math.random()}`;
    rateLimit(key, 1, 60_000);
    const hit = rateLimit(key, 1, 60_000);
    expect(hit.ok).toBe(false);
    expect(hit.retryAfter).toBeGreaterThan(0);
    expect(hit.retryAfter).toBeLessThanOrEqual(60);
  });

  it("counts each caller separately", () => {
    const a = `a${Math.random()}`, b = `b${Math.random()}`;
    expect(rateLimit(a, 1, 60_000).ok).toBe(true);
    expect(rateLimit(a, 1, 60_000).ok).toBe(false);
    // one account exhausting its budget must not lock anyone else out
    expect(rateLimit(b, 1, 60_000).ok).toBe(true);
  });

  it("forgets hits once the window has passed", async () => {
    const key = `k${Math.random()}`;
    expect(rateLimit(key, 1, 30).ok).toBe(true);
    expect(rateLimit(key, 1, 30).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 45));
    expect(rateLimit(key, 1, 30).ok).toBe(true);
  });
});

describe("readJsonLimited", () => {
  it("parses a body under the cap", async () => {
    expect(await readJsonLimited(body({ image: "x" }), 1024)).toEqual({ image: "x" });
  });

  it("refuses a body over the cap", async () => {
    expect(await readJsonLimited(body({ image: "x".repeat(2000) }), 512)).toBeNull();
  });

  // Content-Length is optional and can lie, so the byte count while streaming
  // is what actually enforces the ceiling.
  it("enforces the cap while streaming, not just on Content-Length", async () => {
    const big = JSON.stringify({ image: "x".repeat(4000) });
    const req = new Request("http://x/y", {
      method: "POST",
      body: new ReadableStream({
        start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); },
      }),
      // @ts-expect-error — undici requires this for a stream body
      duplex: "half",
    });
    expect(await readJsonLimited(req, 512)).toBeNull();
  });

  it("returns null on malformed JSON rather than throwing", async () => {
    const req = new Request("http://x/y", { method: "POST", body: "{not json" });
    expect(await readJsonLimited(req, 1024)).toBeNull();
  });
});
