// Shared guard for the routes that SPEND MONEY.
//
// /api/coach, /api/assistant and /api/fuel bill OpenAI; /api/pose3d bills
// fal.ai. All four were open to the internet with no auth and no ceiling, so
// anyone who found a URL could burn the owner's credits without limit, and
// /api/fuel — which takes an arbitrary image — doubled as a free vision proxy.
//
// Three layers here, in the order a request meets them:
//   1. size   — reject an oversized body before parsing it
//   2. identity — no anonymous calls to a paid upstream
//   3. rate   — a ceiling per caller, so one account cannot run away either

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sb } from "@/lib/supabase-server";

export type Caller = { email: string; name: string | null };

/**
 * Google sign-in arrives as a NextAuth session cookie (sent automatically on
 * same-origin fetch); email-OTP arrives as a Supabase bearer token that the
 * client attaches via lib/api-client. Either is a real, verified identity.
 */
export async function requireCaller(req: Request): Promise<Caller | null> {
  const session = await getServerSession(authOptions);
  if (session?.user?.email) {
    return { email: session.user.email.toLowerCase(), name: session.user.name ?? null };
  }
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const client = sb();
    if (!client) return null;
    const { data } = await client.auth.getUser(header.slice(7));
    return data.user?.email ? { email: data.user.email.toLowerCase(), name: null } : null;
  } catch {
    return null;
  }
}

/**
 * Sliding-window counter, in memory.
 *
 * HONEST LIMITATION: this is per server instance. On a serverless host each
 * warm lambda keeps its own window, so the effective ceiling is the limit times
 * the number of live instances, and a cold start resets it. That is enough to
 * stop a runaway client loop and casual abuse of a discovered URL — it is NOT a
 * defence against a distributed attack. Moving the counter into Supabase (or a
 * Redis/Upstash key) is the upgrade path; the call sites do not change.
 */
const windows = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000));
    windows.set(key, hits);
    return { ok: false, retryAfter };
  }
  hits.push(now);
  windows.set(key, hits);
  // the map would otherwise grow one entry per caller forever
  if (windows.size > 5000) {
    for (const [k, v] of windows) if (!v.some((t) => now - t < windowMs)) windows.delete(k);
  }
  return { ok: true, retryAfter: 0 };
}

/**
 * Read a JSON body with a hard ceiling. Checks Content-Length first, then
 * counts bytes while streaming, because Content-Length can be absent or lie.
 * Returns null when the body is too large or not valid JSON — the caller turns
 * that into a 413/400 rather than handing an unbounded string to JSON.parse.
 */
export async function readJsonLimited<T = unknown>(req: Request, maxBytes: number): Promise<T | null> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return null;

  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { buf.set(c, at); at += c.byteLength; }
  try {
    return JSON.parse(new TextDecoder().decode(buf)) as T;
  } catch {
    return null;
  }
}

export type GuardLimits = { perMinute: number; perHour: number; maxBytes: number };

/**
 * The whole gate in one call. Returns either a Response to send back
 * immediately, or the verified caller and parsed body.
 */
export async function guard<T = unknown>(
  req: Request,
  route: string,
  limits: GuardLimits
): Promise<{ error: Response } | { caller: Caller; body: T }> {
  const body = await readJsonLimited<T>(req, limits.maxBytes);
  if (body === null) {
    return { error: Response.json({ ok: false, error: "payload-too-large" }, { status: 413 }) };
  }

  const caller = await requireCaller(req);
  if (!caller) {
    return { error: Response.json({ ok: false, error: "unauthenticated" }, { status: 401 }) };
  }

  for (const [limit, windowMs] of [[limits.perMinute, 60_000], [limits.perHour, 3_600_000]] as const) {
    const hit = rateLimit(`${route}:${windowMs}:${caller.email}`, limit, windowMs);
    if (!hit.ok) {
      return {
        error: Response.json(
          { ok: false, error: "rate-limited", retryAfter: hit.retryAfter },
          { status: 429, headers: { "Retry-After": String(hit.retryAfter) } }
        ),
      };
    }
  }

  return { caller, body };
}
