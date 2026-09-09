// Friends data layer — REAL users via our /api/friends routes (Supabase behind
// them, Google sign-in as identity). No more demo directory.

import { AVATAR_ICON, getProfile } from "@/lib/profile";
import { getStats } from "@/lib/stats";
import type { SIconName } from "@/components/SIcon";
import { sbAccessToken } from "@/lib/supabase-client";

// email-OTP users have no Google session — their Supabase access token is the
// identity our API routes verify instead
async function authHeaders(json = false): Promise<Record<string, string>> {
  const h: Record<string, string> = json ? { "Content-Type": "application/json" } : {};
  const t = await sbAccessToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

export type Person = {
  id: string;
  name: string;
  avatar: string;
  photo?: string | null; // small data-URL headshot, if the user set one
  private: boolean;
  xp: number;
};

export type FriendsState = {
  me: Person;
  friends: Person[];
  incoming: { friendshipId: string; person: Person }[];
  outgoing: string[]; // target profile ids with a pending request from me
  people: Person[];
};

export const iconOf = (p: Person): SIconName => AVATAR_ICON[p.avatar] ?? "tennis";

// push my current name/avatar/xp/privacy to the cloud (numbers only — videos
// and reports never leave the device)
export async function syncMe(): Promise<boolean> {
  try {
    const prof = getProfile();
    const stats = getStats();
    const r = await fetch("/api/friends", {
      method: "POST",
      headers: await authHeaders(true),
      body: JSON.stringify({
        action: "sync",
        name: prof.name ?? "",
        avatar: prof.avatar ?? "tennis",
        photo: prof.photo ?? null,
        xp: stats.xp,
        isPrivate: localStorage.getItem("ml_public") !== "1",
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// null = not signed in with Google (or backend unreachable)
export async function fetchFriends(): Promise<FriendsState | null> {
  try {
    const r = await fetch("/api/friends", { headers: await authHeaders() });
    if (!r.ok) return null;
    const data = await r.json();
    return data.ok ? (data as FriendsState) : null;
  } catch {
    return null;
  }
}

export async function addFriend(targetId: string): Promise<"accepted" | "pending" | null> {
  try {
    const r = await fetch("/api/friends", {
      method: "POST",
      headers: await authHeaders(true),
      body: JSON.stringify({ action: "add", targetId }),
    });
    const data = await r.json();
    return data.ok ? data.status ?? "pending" : null;
  } catch {
    return null;
  }
}

export async function respondRequest(friendshipId: string, accept: boolean): Promise<boolean> {
  try {
    const r = await fetch("/api/friends", {
      method: "POST",
      headers: await authHeaders(true),
      body: JSON.stringify({ action: "respond", friendshipId, accept }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function removeFriend(targetId: string): Promise<boolean> {
  try {
    const r = await fetch("/api/friends", {
      method: "POST",
      headers: await authHeaders(true),
      body: JSON.stringify({ action: "remove", targetId }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
