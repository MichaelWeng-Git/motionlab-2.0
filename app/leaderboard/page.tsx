"use client";

// Full friends leaderboard — reached from the light Friends line on Home.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getStats } from "@/lib/stats";
import { getProfile, type Profile } from "@/lib/profile";
import { Avatar } from "@/components/Avatar";
import { SIcon, type SIconName } from "@/components/SIcon";
import { FriendsIcon } from "@/components/Icons";
import { fetchFriends, iconOf, syncMe, type Person } from "@/lib/friends";

export default function Leaderboard() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<Profile>({});
  const [xp, setXp] = useState(0);
  const [friendUsers, setFriendUsers] = useState<Person[]>([]);

  useEffect(() => {
    const p = getProfile();
    const googleFirst = (localStorage.getItem("ml_google_name") ?? "").split(" ")[0];
    setName(p.name || googleFirst || "You");
    setProfile(p);
    try { setXp(getStats().xp); } catch {}
    try {
      const cached = JSON.parse(localStorage.getItem("ml_friends_cache") ?? "[]") as Person[];
      if (cached.length) setFriendUsers(cached);
    } catch {}
    (async () => {
      syncMe();
      const state = await fetchFriends();
      if (state) {
        setFriendUsers(state.friends);
        localStorage.setItem("ml_friends_cache", JSON.stringify(state.friends));
      }
    })();
  }, []);

  const rows: { id: string; name: string; xp: number; me: boolean; icon?: SIconName; photo?: string | null }[] = [
    { id: "me", name, xp, me: true },
    ...friendUsers.map((u) => ({ id: u.id, name: u.name, xp: u.xp, me: false, icon: iconOf(u), photo: u.photo })),
  ].sort((a, b) => b.xp - a.xp);

  return (
    <div className="animate-fade-up px-5 pt-7">
      <div className="flex items-center gap-3">
        <button
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          className="grid h-9 w-9 place-items-center rounded-full bg-white text-ink shadow-soft"
        >
          ←
        </button>
        <h1 className="font-golden text-2xl leading-none text-ink">LEADERBOARD</h1>
      </div>

      <div className="mt-5 overflow-hidden rounded-3xl bg-white shadow-soft">
        {rows.map((row, i) => (
          <div
            key={row.id}
            className={`flex items-center gap-3.5 px-5 py-4 ${row.me ? "bg-volt-mist" : ""} ${
              i > 0 ? "border-t border-black/5" : ""
            }`}
          >
            <span className="w-6 text-center text-base font-extrabold tabular-nums text-ink-muted">{i + 1}</span>
            <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-paper">
              {row.me ? (
                <Avatar p={profile} iconSize={28} />
              ) : row.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.photo} alt="" className="h-full w-full object-cover" />
              ) : (
                <SIcon name={row.icon!} size={28} />
              )}
            </span>
            <span className={`flex-1 text-[15px] ${row.me ? "font-extrabold" : "font-semibold"}`}>
              {row.name}
              {row.me && <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-ink-muted">You</span>}
            </span>
            <span className="text-[15px] font-extrabold tabular-nums text-ink">{row.xp} XP</span>
          </div>
        ))}
      </div>

      <Link
        href="/friends"
        className="mt-4 flex items-center justify-center gap-2 rounded-full bg-white py-3.5 text-sm font-extrabold text-ink shadow-soft transition active:scale-[0.98]"
      >
        <FriendsIcon size={17} />
        Manage friends
      </Link>
    </div>
  );
}
