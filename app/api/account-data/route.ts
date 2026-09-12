export const maxDuration = 15;

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sb, sbAdmin } from "@/lib/supabase-server";

async function caller(req: Request): Promise<{ email: string; name: string | null } | null> {
  const session = await getServerSession(authOptions);
  if (session?.user?.email) return { email: session.user.email.toLowerCase(), name: session.user.name ?? null };
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const { data } = await sb()?.auth.getUser(header.slice(7))!;
    return data.user?.email ? { email: data.user.email.toLowerCase(), name: null } : null;
  } catch { return null; }
}

export async function GET(req: Request) {
  const who = await caller(req);
  if (!who) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const db = sbAdmin();
  if (!db) return Response.json({ ok: false, error: "sync-not-configured" }, { status: 503 });

  const { data: existing, error: lookupError } = await db.from("profiles").select("id,email,name,avatar,photo").eq("email", who.email).maybeSingle();
  if (lookupError) return Response.json({ ok: false, error: "profile-lookup" }, { status: 502 });
  let profile = existing as { id: string; email: string; name?: string; avatar?: string; photo?: string | null } | null;
  const isNew = !profile;
  if (!profile) {
    const { data, error } = await db.from("profiles").insert({ email: who.email, name: who.name ?? "" }).select("id,email,name,avatar,photo").single();
    if (error || !data) {
      // Another tab may have created the same unique email after our lookup.
      const { data: raced } = await db.from("profiles").select("id,email,name,avatar,photo").eq("email", who.email).maybeSingle();
      if (!raced) return Response.json({ ok: false, error: "profile-create" }, { status: 502 });
      profile = raced as { id: string; email: string };
    } else profile = data as { id: string; email: string };
  }

  const { data: stored, error } = await db.from("account_data").select("payload,updated_at").eq("profile_id", profile.id).maybeSingle();
  if (error) return Response.json({ ok: false, error: "account-data-read" }, { status: 502 });
  return Response.json({
    ok: true, email: who.email, isNew, hasCloudData: !!stored,
    payload: stored?.payload ?? {}, updatedAt: stored?.updated_at ?? null,
    legacyProfile: profile.name ? { name: profile.name, avatar: profile.avatar ?? "tennis", photo: profile.photo ?? undefined } : null,
  });
}

export async function POST(req: Request) {
  const who = await caller(req);
  if (!who) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const db = sbAdmin();
  if (!db) return Response.json({ ok: false, error: "sync-not-configured" }, { status: 503 });
  const { data: profile } = await db.from("profiles").select("id").eq("email", who.email).maybeSingle();
  if (!profile) return Response.json({ ok: false, error: "no-profile" }, { status: 404 });
  const body = await req.json().catch(() => null) as { payload?: unknown; baseUpdatedAt?: string | null } | null;
  if (!body?.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) return Response.json({ ok: false, error: "bad-payload" }, { status: 400 });
  const encoded = JSON.stringify(body.payload);
  if (encoded.length > 8_000_000) return Response.json({ ok: false, error: "payload-too-large" }, { status: 413 });
  const updatedAt = new Date().toISOString();
  const { data: current, error: readError } = await db.from("account_data").select("payload,updated_at").eq("profile_id", profile.id).maybeSingle();
  if (readError) return Response.json({ ok: false, error: "account-data-read" }, { status: 502 });
  if (current) {
    if (!body.baseUpdatedAt || body.baseUpdatedAt !== current.updated_at) {
      return Response.json({ ok: false, error: "cloud-conflict", updatedAt: current.updated_at, payload: current.payload ?? {} }, { status: 409 });
    }
    // The timestamp predicate makes the write optimistic: if another device
    // wins between the read above and this update, zero rows are returned.
    const { data, error } = await db.from("account_data")
      .update({ payload: body.payload, updated_at: updatedAt })
      .eq("profile_id", profile.id).eq("updated_at", body.baseUpdatedAt)
      .select("updated_at").maybeSingle();
    if (error) return Response.json({ ok: false, error: "account-data-write" }, { status: 502 });
    if (!data) return Response.json({ ok: false, error: "cloud-conflict" }, { status: 409 });
  } else {
    const { error } = await db.from("account_data").insert({ profile_id: profile.id, payload: body.payload, updated_at: updatedAt });
    if (error) {
      // A simultaneous first write created the row. Never overwrite it.
      return Response.json({ ok: false, error: "cloud-conflict" }, { status: 409 });
    }
  }
  return Response.json({ ok: true, updatedAt });
}
