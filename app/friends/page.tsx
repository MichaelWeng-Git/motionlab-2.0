"use client";

// Friends — REAL platform users. Three horizontal category bubbles; tapping
// one reveals its list. Public accounts accept instantly (Added ✓ → row glides
// away); private accounts get an Instagram-style request.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { SIcon } from "@/components/SIcon";
import { FriendsIcon, PersonIcon, SearchIcon } from "@/components/Icons";
import {
  addFriend, fetchFriends, iconOf, removeFriend, respondRequest, syncMe,
  type FriendsState, type Person,
} from "@/lib/friends";
import { getProfile } from "@/lib/profile";
import { getStats } from "@/lib/stats";
import { LevelBadge } from "@/components/XpLevel";
import { isLocalDevAuthBypass } from "@/lib/dev-auth";

type Tab = "requests" | "friends" | "people";

export default function Friends() {
  const router = useRouter();
  const [st, setSt] = useState<FriendsState | null>(null);
  const [phase, setPhase] = useState<"loading" | "signedout" | "ready">("loading");
  const [tab, setTab] = useState<Tab>("friends");
  const [query, setQuery] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [leaving, setLeaving] = useState<string[]>([]);
  const [requested, setRequested] = useState<string[]>([]); // optimistic
  const [confirmRemove, setConfirmRemove] = useState<Person | null>(null);
  // unseen-new-friends badge on the "My friends" bubble — grows on Accept,
  // clears the moment the bubble is opened
  const [newFriends, setNewFriends] = useState(0);

  useEffect(() => {
    setNewFriends(Number(localStorage.getItem("ml_new_friends")) || 0);
  }, []);

  async function reload() {
    const data = await fetchFriends();
    if (data) {
      setSt(data);
      setPhase("ready");
      return;
    }
    // No cloud identity (or the friends backend is temporarily unavailable).
    // App authentication and Friends transport are separate concerns: a user
    // who is already inside MotionLab must never be told to sign in again.
    // Local preview mode intentionally has no cloud identity, so it gets the
    // same honest local-only state instead of a misleading Google prompt.
    let local = false;
    try {
      local = isLocalDevAuthBypass() || !!localStorage.getItem("ml_auth") || !!getProfile().name;
    } catch {}
    if (local) {
      const prof = getProfile();
      const stats = getStats();
      setSt({
        me: { id: "me", name: prof.name ?? "You", avatar: prof.avatar ?? "tennis", photo: prof.photo ?? null, private: true, xp: stats.xp },
        friends: [], incoming: [], outgoing: [], people: [],
      });
      setPhase("ready");
    } else {
      setPhase("signedout");
    }
  }

  useEffect(() => {
    (async () => {
      await syncMe(); // push my name/avatar/xp first so others see fresh data
      await reload();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onAdd(p: Person) {
    if (p.private) {
      setRequested((r) => [...r, p.id]); // optimistic "Requested"
      await addFriend(p.id);
      reload();
    } else {
      setLeaving((l) => [...l, p.id]); // Added ✓ → collapse → refresh
      await addFriend(p.id);
      setTimeout(() => {
        setLeaving((l) => l.filter((x) => x !== p.id));
        reload();
      }, 900);
    }
  }

  function onRespond(friendshipId: string, accept: boolean) {
    // OPTIMISTIC: the row disappears (and the friend appears) instantly —
    // the server call reconciles in the background
    const item = st?.incoming.find((i) => i.friendshipId === friendshipId);
    setSt((s) =>
      s
        ? {
            ...s,
            incoming: s.incoming.filter((i) => i.friendshipId !== friendshipId),
            friends: accept && item ? [...s.friends, item.person] : s.friends,
          }
        : s
    );
    if (accept) {
      setNewFriends((n) => {
        const v = n + 1;
        localStorage.setItem("ml_new_friends", String(v));
        return v;
      });
    }
    respondRequest(friendshipId, accept).then(() => reload());
  }

  function onRemove(p: Person) {
    // optimistic: gone from the list immediately, server reconciles after
    setConfirmRemove(null);
    setSt((s) => (s ? { ...s, friends: s.friends.filter((f) => f.id !== p.id) } : s));
    removeFriend(p.id).then(() => reload());
  }

  async function shareInvite() {
    const url = `${window.location.origin}/friends`;
    try {
      if (navigator.share) await navigator.share({ title: "Train with me on MotionLab", text: "Join my training circle on MotionLab.", url });
      else { await navigator.clipboard.writeText(url); setInviteCopied(true); window.setTimeout(() => setInviteCopied(false), 1800); }
    } catch {}
  }

  const incoming = st?.incoming ?? [];
  const friends = st?.friends ?? [];
  const friendIds = new Set(friends.map((f) => f.id));
  const people = (st?.people ?? []).filter((p) => !friendIds.has(p.id));
  const filteredPeople = people.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const outgoing = new Set([...(st?.outgoing ?? []), ...requested]);

  const bubbles: { key: Tab; label: string; count: number; icon: React.ReactNode }[] = [
    { key: "requests", label: "Friend requests", count: incoming.length, icon: <PersonIcon size={18} /> },
    // badge = UNSEEN new friends (not the total) — it clears on open
    { key: "friends", label: "My friends", count: newFriends, icon: <FriendsIcon size={18} /> },
    { key: "people", label: "People on MotionLab", count: 0, icon: <SearchIcon size={18} /> },
  ];

  const PersonAvatar = ({ p }: { p: Person }) => (
    <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-full bg-volt-mist">
      {p.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.photo} alt="" className="h-full w-full object-cover" />
      ) : (
        <SIcon name={iconOf(p)} size={28} />
      )}
    </span>
  );

  return (
    <div className="px-5 pt-8 pb-8">
      <div className="flex items-center gap-3">
        <button
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          className="grid h-9 w-9 place-items-center rounded-full bg-panel text-fg shadow-panel"
        >
          ←
        </button>
        <h1 className="font-golden text-[26px] leading-none">Friends</h1>
      </div>

      {phase === "loading" && (
        <div className="mt-6 space-y-2">
          <div className="skeleton h-20 rounded-2xl" />
          <div className="skeleton h-14 rounded-2xl" />
        </div>
      )}

      {phase === "signedout" && (
        <div className="mt-6 rounded-2xl bg-panel p-6 text-center text-fg shadow-panel">
          <p className="text-sm font-bold">Sign in to add friends</p>
          <button
            onClick={() => signIn("google", { callbackUrl: "/friends" })}
            className="mt-4 w-full rounded-full bg-action py-3 text-sm font-bold text-on-action transition active:scale-[0.98]"
          >
            Continue with Google
          </button>
        </div>
      )}

      {phase === "ready" && (
        <>
          <section className="relative mt-4 overflow-hidden rounded-3xl bg-graphite p-5 text-white shadow-lift">
            <div className="absolute -right-20 -top-24 h-60 w-60 rounded-full bg-signal-good/60 blur-3xl" />
            <p className="relative text-[11px] font-black tracking-[0.2em] text-signal-good">YOUR TRAINING CIRCLE</p>
            <div className="relative mt-3 flex items-end justify-between"><div><p className="font-golden text-6xl leading-none">{friends.length}</p><p className="mt-1 text-xs font-bold text-white/50">{friends.length === 1 ? "training friend" : "training friends"}</p></div><button onClick={shareInvite} className="btn-press rounded-full bg-white px-4 py-3 text-[11px] font-black text-on-action">{inviteCopied ? "LINK COPIED" : "INVITE A FRIEND"}</button></div>
            {incoming.length > 0 && <button onClick={() => setTab("requests")} className="relative mt-5 flex w-full items-center justify-between rounded-2xl bg-panel px-4 py-3"><span className="text-xs font-black">Friend requests</span><span className="grid h-6 min-w-6 place-items-center rounded-full bg-signal-work px-1 text-[11px] font-black">{incoming.length}</span></button>}
          </section>

          {/* compact sport-app segmented navigation */}
          <div className="mt-3 grid grid-cols-3 rounded-2xl bg-panel p-1 text-fg shadow-panel">
            {bubbles.map((b) => {
              const on = tab === b.key;
              return (
                <button
                  key={b.key}
                  onClick={() => {
                    setTab(b.key);
                    if (b.key === "friends") {
                      setNewFriends(0);
                      localStorage.removeItem("ml_new_friends");
                    }
                  }}
                  className={`press relative flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-center transition ${
                    on ? "bg-action text-on-action" : "text-fg-muted"
                  }`}
                >
                  <span className="text-[11px] font-black leading-tight">{b.key === "requests" ? "REQUESTS" : b.key === "friends" ? "FRIENDS" : "DISCOVER"}</span>
                  {b.count > 0 && (
                    <span className="absolute right-2 top-2 grid h-5 min-w-5 place-items-center rounded-full bg-signal-work px-1 text-[11px] font-extrabold text-white">
                      {b.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {tab === "requests" && (
            <section className="mt-4 space-y-2">
              {incoming.length === 0 && (
                <FriendEmpty kind="requests" onInvite={shareInvite} />
              )}
              {incoming.map(({ friendshipId, person }) => (
                <div key={friendshipId} className="flex items-center gap-3 rounded-2xl bg-panel p-3.5 text-fg shadow-panel">
                  <PersonAvatar p={person} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{person.name}</p>
                    <div className="mt-1"><LevelBadge xp={person.xp} compact /></div>
                  </div>
                  <button
                    onClick={() => onRespond(friendshipId, true)}
                    className="rounded-xl bg-action px-4 py-2 text-xs font-bold text-on-action transition active:scale-95"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => onRespond(friendshipId, false)}
                    className="rounded-xl bg-inset px-4 py-2 text-xs font-bold text-fg transition active:scale-95"
                  >
                    Decline
                  </button>
                </div>
              ))}
            </section>
          )}

          {tab === "friends" && (
            <section className="mt-4 space-y-2">
              {friends.length === 0 && (
                <FriendEmpty kind="friends" onInvite={shareInvite} />
              )}
              {friends.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-2xl bg-panel p-3.5 text-fg shadow-panel">
                  <PersonAvatar p={p} />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{p.name}</p><div className="mt-1"><LevelBadge xp={p.xp} compact /></div></div>
                  <button
                    onClick={() => setConfirmRemove(p)}
                    className="rounded-xl bg-inset px-4 py-2 text-xs font-bold text-fg-muted transition active:scale-95"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </section>
          )}

          {tab === "people" && (
            <section className="mt-4 space-y-2">
              <label className="flex items-center gap-2 rounded-2xl bg-panel px-4 py-3 text-fg shadow-panel"><SearchIcon size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search athletes by name" className="min-w-0 flex-1 bg-transparent text-sm font-bold text-fg outline-none placeholder:text-fg-muted" /></label>
              {filteredPeople.length === 0 && <FriendEmpty kind={query ? "search" : "people"} onInvite={shareInvite} />}
              {filteredPeople.map((p) => {
                const isLeaving = leaving.includes(p.id);
                const isRequested = outgoing.has(p.id);
                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-3 rounded-2xl bg-panel p-3.5 text-fg shadow-panel ${
                      isLeaving ? "card-removing" : ""
                    }`}
                    style={isLeaving ? { animationDelay: "0.45s" } : undefined}
                  >
                    <PersonAvatar p={p} />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{p.name}</p><div className="mt-1"><LevelBadge xp={p.xp} compact /></div></div>
                    {isLeaving ? (
                      <span className="animate-pop rounded-xl bg-signal-good px-4 py-2 text-xs font-bold text-white">Added ✓</span>
                    ) : isRequested ? (
                      <span className="animate-pop rounded-xl bg-inset px-4 py-2 text-xs font-bold text-fg-muted">Requested</span>
                    ) : (
                      <button
                        onClick={() => onAdd(p)}
                        className="rounded-xl bg-action px-5 py-2 text-xs font-bold text-on-action transition active:scale-95"
                      >
                        Add
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}

      {/* remove needs a second thought */}
      {confirmRemove && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-ink/40 px-10 backdrop-blur-[2px]"
          onClick={() => setConfirmRemove(null)}
        >
          <div
            className="w-full max-w-[300px] animate-pop rounded-3xl bg-sheet p-6 text-center text-fg shadow-lift ring-1 ring-inset ring-hair"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-extrabold text-fg">Remove {confirmRemove.name}?</p>
            <div className="mt-5 space-y-2.5">
              <button
                onClick={() => onRemove(confirmRemove)}
                className="btn-press-work w-full rounded-full bg-signal-work py-3 text-sm font-extrabold text-white transition"
              >
                Yes, remove
              </button>
              <button
                onClick={() => setConfirmRemove(null)}
                className="w-full rounded-full bg-inset py-3 text-sm font-bold text-fg transition active:scale-[0.98]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FriendEmpty({ kind, onInvite }: { kind: "requests" | "friends" | "people" | "search"; onInvite: () => void }) {
  const copy = {
    requests: ["NO REQUESTS", "New training requests will appear here."],
    friends: ["BUILD YOUR CIRCLE", "Invite someone you already train with."],
    people: ["NO ATHLETES TO DISCOVER", "Share MotionLab with your training group."],
    search: ["NO MATCHES", "Try another athlete name."],
  }[kind];
  return <div className="rounded-2xl border border-dashed border-white/15 bg-panel px-5 py-8 text-center text-fg shadow-panel"><span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-inset text-signal-good"><FriendsIcon size={21} /></span><p className="mt-3 font-golden text-lg text-fg">{copy[0]}</p><p className="mt-1 text-[11px] font-bold text-fg-muted">{copy[1]}</p>{kind !== "requests" && kind !== "search" && <button onClick={onInvite} className="mt-4 rounded-full bg-action px-4 py-2.5 text-[11px] font-black text-on-action">INVITE FRIEND</button>}</div>;
}
