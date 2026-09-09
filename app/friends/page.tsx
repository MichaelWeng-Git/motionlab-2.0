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

type Tab = "requests" | "friends" | "people";

export default function Friends() {
  const router = useRouter();
  const [st, setSt] = useState<FriendsState | null>(null);
  const [phase, setPhase] = useState<"loading" | "signedout" | "ready">("loading");
  const [tab, setTab] = useState<Tab | null>(null);
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
    // no cloud identity — but if you're logged into the app locally, don't nag
    // to sign in; show a local view (just you, empty lists) instead
    let local = false;
    try { local = !!localStorage.getItem("ml_auth") || !!getProfile().name; } catch {}
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

  const incoming = st?.incoming ?? [];
  const friends = st?.friends ?? [];
  const friendIds = new Set(friends.map((f) => f.id));
  const people = (st?.people ?? []).filter((p) => !friendIds.has(p.id));
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
          className="grid h-9 w-9 place-items-center rounded-full bg-white text-ink shadow-soft"
        >
          ←
        </button>
        <h1 className="text-2xl font-extrabold tracking-tight">Friends</h1>
      </div>

      {phase === "loading" && (
        <div className="mt-6 space-y-2">
          <div className="skeleton h-20 rounded-2xl" />
          <div className="skeleton h-14 rounded-2xl" />
        </div>
      )}

      {phase === "signedout" && (
        <div className="mt-6 rounded-2xl bg-white p-6 text-center shadow-soft">
          <p className="text-sm font-bold">Sign in to add friends</p>
          <button
            onClick={() => signIn("google", { callbackUrl: "/friends" })}
            className="btn-press mt-4 w-full rounded-full bg-ink py-3 text-sm font-bold text-white transition"
          >
            Continue with Google
          </button>
        </div>
      )}

      {phase === "ready" && (
        <>
          {/* three category bubbles in one horizontal row */}
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            {bubbles.map((b) => {
              const on = tab === b.key;
              return (
                <button
                  key={b.key}
                  onClick={() => {
                    setTab(tab === b.key ? null : b.key);
                    if (b.key === "friends") {
                      setNewFriends(0);
                      localStorage.removeItem("ml_new_friends");
                    }
                  }}
                  className={`press relative flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3.5 text-center shadow-soft transition ${
                    on ? "border-ink bg-ink text-white" : "border-black/5 bg-white text-ink"
                  }`}
                >
                  <span className={on ? "text-volt-glow" : "text-volt-deep"}>{b.icon}</span>
                  <span className="text-[11px] font-bold leading-tight">{b.label}</span>
                  {b.count > 0 && (
                    <span className="absolute right-2 top-2 grid h-5 min-w-5 place-items-center rounded-full bg-signal-work px-1 text-[10px] font-extrabold text-white">
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
                <p className="rounded-2xl bg-white p-4 text-center text-[13px] font-bold text-ink-soft shadow-soft">
                  No requests right now.
                </p>
              )}
              {incoming.map(({ friendshipId, person }) => (
                <div key={friendshipId} className="flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-soft">
                  <PersonAvatar p={person} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{person.name}</p>
                  </div>
                  <button
                    onClick={() => onRespond(friendshipId, true)}
                    className="rounded-xl bg-ink px-4 py-2 text-xs font-bold text-white transition active:scale-95"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => onRespond(friendshipId, false)}
                    className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-ink transition active:scale-95"
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
                <p className="rounded-2xl bg-white p-4 text-center text-[13px] font-bold text-ink-soft shadow-soft">
                  No friends yet — find people in the third bubble.
                </p>
              )}
              {friends.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-soft">
                  <PersonAvatar p={p} />
                  <p className="min-w-0 flex-1 truncate text-sm font-bold">{p.name}</p>
                  <button
                    onClick={() => setConfirmRemove(p)}
                    className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-ink-muted transition active:scale-95"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </section>
          )}

          {tab === "people" && (
            <section className="mt-4 space-y-2">
              {people.length === 0 && (
                <p className="rounded-2xl bg-white p-4 text-center text-[13px] font-bold text-ink-soft shadow-soft">
                  No one else here yet — invite your friends to MotionLab!
                </p>
              )}
              {people.map((p) => {
                const isLeaving = leaving.includes(p.id);
                const isRequested = outgoing.has(p.id);
                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-soft ${
                      isLeaving ? "card-removing" : ""
                    }`}
                    style={isLeaving ? { animationDelay: "0.45s" } : undefined}
                  >
                    <PersonAvatar p={p} />
                    <p className="min-w-0 flex-1 truncate text-sm font-bold">{p.name}</p>
                    {isLeaving ? (
                      <span className="animate-pop rounded-xl bg-signal-good px-4 py-2 text-xs font-bold text-white">Added ✓</span>
                    ) : isRequested ? (
                      <span className="animate-pop rounded-xl bg-paper px-4 py-2 text-xs font-bold text-ink-muted">Requested</span>
                    ) : (
                      <button
                        onClick={() => onAdd(p)}
                        className="rounded-xl bg-ink px-5 py-2 text-xs font-bold text-white transition active:scale-95"
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
            className="w-full max-w-[300px] animate-pop rounded-3xl bg-paper p-6 text-center shadow-lift"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-extrabold text-ink">Remove {confirmRemove.name}?</p>
            <div className="mt-5 space-y-2.5">
              <button
                onClick={() => onRemove(confirmRemove)}
                className="btn-press-work w-full rounded-full bg-signal-work py-3 text-sm font-extrabold text-white transition"
              >
                Yes, remove
              </button>
              <button
                onClick={() => setConfirmRemove(null)}
                className="w-full rounded-full bg-white py-3 text-sm font-bold text-ink transition active:scale-[0.98]"
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
