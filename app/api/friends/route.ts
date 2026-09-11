// Friends backend — identity from the Google session, storage in Supabase.
// GET  → full friends state for the signed-in user
// POST → { action: "sync" | "add" | "respond" | "remove", ... }
// Cloud data is ONLY name/avatar/xp/privacy — never videos or reports.

export const maxDuration = 15;

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sb, sbAdmin } from "@/lib/supabase-server";

type ProfileRow = {
  id: string;
  email: string;
  name: string;
  avatar: string;
  photo?: string | null;
  xp: number;
  is_private: boolean;
};
type FriendshipRow = {
  id: string;
  requester: string;
  addressee: string;
  status: "pending" | "accepted";
};

const pub = (p: ProfileRow) => ({
  id: p.id,
  name: p.name || "Player",
  avatar: p.avatar,
  photo: p.photo ?? null,
  private: p.is_private,
  xp: p.xp,
});

async function me(email: string) {
  const db = sbAdmin()!;
  const { data } = await db.from("profiles").select("*").eq("email", email).maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

// identity: Google session first, else a Supabase email-OTP access token
// (sent as a Bearer header by the client). Either way the answer is an email.
async function callerEmail(req: Request): Promise<{ email: string | null; name: string | null }> {
  const session = await getServerSession(authOptions);
  if (session?.user?.email) return { email: session.user.email, name: session.user.name ?? null };
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    try {
      const { data } = await sb()!.auth.getUser(auth.slice(7));
      if (data.user?.email) return { email: data.user.email, name: null };
    } catch {}
  }
  return { email: null, name: null };
}

export async function GET(req: Request) {
  const db = sbAdmin();
  if (!db) return Response.json({ ok: false, error: "no-backend" }, { status: 500 });
  const { email, name } = await callerEmail(req);
  if (!email) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  let my = await me(email);
  if (!my) {
    // first visit: create the profile from whichever identity signed in
    const { data, error } = await db
      .from("profiles")
      .insert({ email, name: name ?? "" })
      .select()
      .single();
    if (error) return Response.json({ ok: false, error: "profile-create" }, { status: 502 });
    my = data as ProfileRow;
  }

  const [{ data: rels }, { data: all }] = await Promise.all([
    db.from("friendships").select("*").or(`requester.eq.${my.id},addressee.eq.${my.id}`),
    db.from("profiles").select("*").neq("id", my.id),
  ]);
  const relRows = (rels ?? []) as FriendshipRow[];
  const others = new Map(((all ?? []) as ProfileRow[]).map((p) => [p.id, p]));

  const friends: ReturnType<typeof pub>[] = [];
  const incoming: { friendshipId: string; person: ReturnType<typeof pub> }[] = [];
  const outgoing: string[] = [];
  for (const r of relRows) {
    const otherId = r.requester === my.id ? r.addressee : r.requester;
    const other = others.get(otherId);
    if (!other) continue;
    if (r.status === "accepted") friends.push(pub(other));
    else if (r.addressee === my.id) incoming.push({ friendshipId: r.id, person: pub(other) });
    else outgoing.push(otherId);
  }

  return Response.json({
    ok: true,
    me: pub(my),
    friends,
    incoming,
    outgoing,
    people: [...others.values()].map(pub),
  });
}

export async function POST(req: Request) {
  const db = sbAdmin();
  if (!db) return Response.json({ ok: false, error: "no-backend" }, { status: 500 });
  const { email, name: sessionName } = await callerEmail(req);
  if (!email) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = (await req.json()) as {
    action: "sync" | "add" | "respond" | "remove";
    name?: string;
    avatar?: string;
    photo?: string | null;
    xp?: number;
    isPrivate?: boolean;
    targetId?: string;
    friendshipId?: string;
    accept?: boolean;
  };

  const my = await me(email);

  if (body.action === "sync") {
    const patch: Record<string, unknown> = {
      email,
      name: body.name ?? my?.name ?? sessionName ?? "",
      avatar: body.avatar ?? my?.avatar ?? "tennis",
      xp: typeof body.xp === "number" ? body.xp : my?.xp ?? 0,
      is_private: typeof body.isPrivate === "boolean" ? body.isPrivate : my?.is_private ?? true,
      updated_at: new Date().toISOString(),
    };
    // tiny data-URL headshot (cap the size — never store megabyte blobs)
    if (body.photo !== undefined) {
      patch.photo = body.photo && body.photo.length < 200_000 ? body.photo : null;
    }
    let { error } = await db.from("profiles").upsert(patch, { onConflict: "email" });
    if (error && patch.photo !== undefined) {
      // photo column may not exist yet on older databases — sync the rest anyway
      delete patch.photo;
      ({ error } = await db.from("profiles").upsert(patch, { onConflict: "email" }));
    }
    if (error) return Response.json({ ok: false, error: "sync" }, { status: 502 });
    return Response.json({ ok: true });
  }

  if (!my) return Response.json({ ok: false, error: "no-profile" }, { status: 400 });

  if (body.action === "add" && body.targetId) {
    const { data: target } = await db.from("profiles").select("*").eq("id", body.targetId).maybeSingle();
    if (!target) return Response.json({ ok: false, error: "no-target" }, { status: 400 });
    // if they already asked US, adding = accepting their request
    const { data: reverse } = await db
      .from("friendships")
      .select("*")
      .eq("requester", body.targetId)
      .eq("addressee", my.id)
      .maybeSingle();
    if (reverse) {
      await db.from("friendships").update({ status: "accepted" }).eq("id", (reverse as FriendshipRow).id);
      return Response.json({ ok: true, status: "accepted" });
    }
    const status = (target as ProfileRow).is_private ? "pending" : "accepted";
    const { error } = await db
      .from("friendships")
      .upsert({ requester: my.id, addressee: body.targetId, status }, { onConflict: "requester,addressee" });
    if (error) return Response.json({ ok: false, error: "add" }, { status: 502 });
    return Response.json({ ok: true, status });
  }

  if (body.action === "respond" && body.friendshipId) {
    if (body.accept) {
      await db.from("friendships").update({ status: "accepted" }).eq("id", body.friendshipId).eq("addressee", my.id);
    } else {
      await db.from("friendships").delete().eq("id", body.friendshipId).eq("addressee", my.id);
    }
    return Response.json({ ok: true });
  }

  if (body.action === "remove" && body.targetId) {
    await db
      .from("friendships")
      .delete()
      .or(
        `and(requester.eq.${my.id},addressee.eq.${body.targetId}),and(requester.eq.${body.targetId},addressee.eq.${my.id})`
      );
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: "bad-action" }, { status: 400 });
}
