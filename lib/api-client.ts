"use client";

// One fetch for the routes behind lib/api-guard.
//
// Google sign-in rides on the NextAuth session cookie, which a same-origin
// fetch already sends. Email-OTP sign-in has no cookie — its identity is a
// Supabase access token — so it has to be attached by hand. Calling these
// routes with a bare fetch works for Google users and 401s for everyone else,
// which is exactly the kind of bug that only shows up for half the users.

import { sbAccessToken } from "@/lib/supabase-client";

export type ApiFailure =
  | { kind: "unauthenticated" }
  | { kind: "rate-limited"; retryAfter: number }
  | { kind: "too-large" }
  | { kind: "failed"; status: number };

/** Plain-language text for a guard failure — the same wording everywhere. */
export function apiFailureText(f: ApiFailure): string {
  switch (f.kind) {
    case "unauthenticated": return "Sign in to use this.";
    case "rate-limited": return `Too many requests — try again in ${f.retryAfter}s.`;
    case "too-large": return "That file is too large to analyse.";
    case "failed": return "That didn't go through. Try again.";
  }
}

export function apiFailureOf(status: number, payload?: { retryAfter?: number }): ApiFailure {
  if (status === 401) return { kind: "unauthenticated" };
  if (status === 429) return { kind: "rate-limited", retryAfter: payload?.retryAfter ?? 30 };
  if (status === 413) return { kind: "too-large" };
  return { kind: "failed", status };
}

export async function apiPost(
  path: string,
  body: unknown,
  // callers that time out or cancel (analyze, SAM 3D) pass their AbortSignal
  opts?: { signal?: AbortSignal }
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const token = await sbAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // no Supabase session — a Google cookie may still carry the identity
  }
  return fetch(path, { method: "POST", headers, body: JSON.stringify(body), signal: opts?.signal });
}
