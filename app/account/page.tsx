"use client";

// Account — everything on this page is the user's real data:
// profile from onboarding, stats from actual sessions.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { getProfile, type Profile } from "@/lib/profile";
import { Avatar } from "@/components/Avatar";
import { getStats, type Stats } from "@/lib/stats";
import { CameraIcon, ChatIcon, DumbbellIcon, FriendsIcon, LogoutIcon, PersonIcon } from "@/components/Icons";
import { clearDraft } from "@/lib/profile-draft";
import { syncMe } from "@/lib/friends";
import { LevelBadge, XpAvatarRing } from "@/components/XpLevel";
import { levelForXp } from "@/lib/xp";
import { syncAccountData } from "@/lib/cloud-data";

export default function Account() {
  const [profile, setProfile] = useState<Profile>({});
  const [stats, setStats] = useState<Stats | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  // WhatsApp-style photo change: camera badge on the avatar → action sheet
  // (Take photo / Choose from library / Remove) → preview → saved instantly
  const [photoSheet, setPhotoSheet] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProfile(getProfile());
    setStats(getStats());
    clearDraft(); // any photo staged but never saved is discarded here
  }, []);

  // downscale + center-crop to a small square data URL, then preview
  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const S = 256;
      const c = document.createElement("canvas");
      c.width = S; c.height = S;
      const side = Math.min(img.width, img.height);
      c.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
      setPending(c.toDataURL("image/jpeg", 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
    e.target.value = "";
    setPhotoSheet(false);
  }

  function commitPhoto(photo: string | undefined) {
    const next: Profile = { ...getProfile(), photo };
    localStorage.setItem("ml_profile", JSON.stringify(next));
    setProfile(next);
    window.dispatchEvent(new Event("ml:profile")); // top bar avatar refreshes
    syncMe(); // friends see the new photo
    setPending(null);
    setPhotoSheet(false);
  }

  // just Profile (tap in to edit everything) + Help. Nothing redundant.
  const menu: { icon: React.ReactNode; tint: string; label: string; hint?: string; href?: string }[][] = [
    [
      { icon: <PersonIcon className="text-[#17271F]" />, tint: "#17271F14", label: "Profile", href: "/account/profile" },
    ],
    [
      { icon: <DumbbellIcon className="text-[#C9821B]" />, tint: "#E8A13C24", label: "Body & training", href: "/account/training" },
      { icon: <FriendsIcon className="text-[#2E86F6]" />, tint: "#2E86F61C", label: "Friends", href: "/friends" },
    ],
    [
      { icon: <ChatIcon className="text-[#7C5CFF]" />, tint: "#7C5CFF1C", label: "Help & feedback", href: "/account/help" },
      { icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3.1 14H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>, tint: "#17271F12", label: "Settings & data", href: "/account/settings" },
      { icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.4-3 8.3-7 10-4-1.7-7-5.6-7-10V6z" /><path d="M9.5 12l1.8 1.8L15 10" /></svg>, tint: "#2E86F61C", label: "Privacy", href: "/account/privacy" },
    ],
  ];

  return (
    <div className="min-h-full bg-graphite px-5 pt-8 text-white">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/" className="grid h-10 w-10 place-items-center rounded-full bg-track text-white ring-1 ring-inset ring-hair">
          ←
        </Link>
        <h1 className="font-golden text-[26px] leading-none">Profile</h1>
      </div>
      {/* profile header — tap the avatar (camera badge = the affordance) to
          change the photo, WhatsApp-style */}
      <div className="flex items-center gap-4 rounded-2xl bg-inset p-4 ring-1 ring-inset ring-hair">
        <button onClick={() => setPhotoSheet(true)} className="relative shrink-0 transition active:scale-95" aria-label="Change profile photo">
          <XpAvatarRing xp={stats?.xp ?? 0}><span className="grid h-full w-full place-items-center bg-volt-mist"><Avatar p={profile} iconSize={44} /></span></XpAvatarRing>
          <span className="absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full bg-action text-on-action ring-2 ring-[#ECEFEC]">
            <CameraIcon size={13} />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-golden text-xl leading-none text-white">{profile.name ?? "You"}</p>
          <div className="mt-2"><LevelBadge xp={stats?.xp ?? 0} /></div>
          <Link href="/xp" className="mt-2 flex items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full" style={{ width: `${levelForXp(stats?.xp ?? 0).progress * 100}%`, background: levelForXp(stats?.xp ?? 0).color }} /></span><span className="font-golden text-[11px] text-white/50">{stats?.xp ?? 0} XP ›</span></Link>
        </div>
      </div>

      {/* quick stats — computed from real sessions */}
      <div className="mt-6 grid grid-cols-3 gap-2.5">
        {[
          { v: stats?.total ?? 0, l: "Sessions" },
          { v: stats?.total ? stats.bestScore : "—", l: "Best score" },
          { v: stats && stats.monthDelta > 0 ? `+${stats.monthDelta}` : "—", l: "This month" },
        ].map((s) => (
          <div key={s.l} className="rounded-2xl bg-inset py-4 text-center ring-1 ring-inset ring-hair">
            <p className="font-golden text-2xl leading-none">{s.v}</p>
            <p className="mt-1.5 text-[11px] font-bold uppercase tracking-wide text-fg-muted">{s.l}</p>
          </div>
        ))}
      </div>

      {/* menu groups */}
      <div className="mt-6 space-y-4 pb-6">
        {menu.map((group, gi) => (
          <div key={gi} className="overflow-hidden rounded-2xl bg-inset ring-1 ring-inset ring-hair">
            {group.map((item, i) => {
              const cls = `flex w-full items-center gap-3 px-4 py-3.5 text-left text-white transition active:bg-inset ${
                i > 0 ? "border-t border-white/10" : ""
              }`;
              const inner = (
                <>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: item.tint }}>{item.icon}</span>
                  <span className="flex-1 text-[15px] font-bold">{item.label}</span>
                  {item.hint && <span className="text-xs text-fg-muted">{item.hint}</span>}
                  <span className="font-bold text-white/60">›</span>
                </>
              );
              return item.href ? (
                <Link key={item.label} href={item.href} className={cls}>{inner}</Link>
              ) : (
                <button key={item.label} className={cls}>{inner}</button>
              );
            })}
          </div>
        ))}

        {/* log out — double-confirm; local data stays untouched */}
        <div className="overflow-hidden rounded-2xl bg-inset ring-1 ring-inset ring-hair">
          <button
            onClick={() => setConfirmOut(true)}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-black/[0.03]"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: "#E0523F1A" }}><LogoutIcon className="text-signal-work" /></span>
            <span className="flex-1 text-[15px] font-bold text-signal-work">Log out</span>
          </button>
        </div>
      </div>

      {/* hidden pickers: camera (capture) and library */}
      <input ref={camRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onPickPhoto} />
      <input ref={libRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />

      {/* WhatsApp-style photo action sheet */}
      {photoSheet && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-graphite/75 backdrop-blur-[2px]" onClick={() => setPhotoSheet(false)}>
          <div
            className="w-full max-w-phone animate-fade-up rounded-t-3xl bg-sheet p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-fg ring-1 ring-inset ring-hair"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto h-1 w-10 rounded-full bg-track" />
            <p className="mt-4 text-base font-extrabold">Profile photo</p>
            <div className="mt-3 overflow-hidden rounded-2xl bg-panel text-fg shadow-panel">
              <button onClick={() => camRef.current?.click()} className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-semibold transition active:bg-inset">
                <CameraIcon size={18} className="text-signal-good" />
                Take photo
              </button>
              <button onClick={() => libRef.current?.click()} className="flex w-full items-center gap-3 border-t border-hair px-4 py-3.5 text-left text-sm font-semibold transition active:bg-inset">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-signal-good">
                  <rect x="3" y="5" width="18" height="14" rx="2.5" />
                  <circle cx="9" cy="10.5" r="1.6" />
                  <path d="M21 15.5l-4.5-4.5L7 20" />
                </svg>
                Choose from library
              </button>
              {profile.photo && (
                <button onClick={() => commitPhoto(undefined)} className="flex w-full items-center gap-3 border-t border-hair px-4 py-3.5 text-left text-sm font-semibold text-signal-work transition active:bg-inset">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 13h9l1-13" />
                  </svg>
                  Remove photo
                </button>
              )}
            </div>
            <button onClick={() => setPhotoSheet(false)} className="mt-3 w-full rounded-full bg-inset py-3 text-sm font-bold text-fg transition active:scale-[0.98]">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* photo preview & confirm */}
      {pending && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-graphite/75 px-6 backdrop-blur-[2px]">
          <div className="w-full max-w-[340px] animate-pop rounded-3xl bg-sheet p-6 text-center text-fg ring-1 ring-inset ring-hair">
            <h2 className="text-lg font-extrabold">Preview</h2>
            <div className="mt-5 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pending} alt="" className="h-40 w-40 rounded-full object-cover ring-4 ring-white" />
            </div>
            <div className="mt-6 flex gap-2.5">
              <button onClick={() => setPending(null)} className="flex-1 rounded-full bg-inset py-3 text-sm font-bold text-fg transition active:scale-[0.98]">
                Cancel
              </button>
              <button onClick={() => commitPhoto(pending)} className="flex-1 rounded-full bg-action py-3 text-sm font-bold text-on-action transition active:scale-[0.98]">
                Set as photo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* confirm dialog */}
      {confirmOut && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-graphite/75 px-6 backdrop-blur-[2px]" onClick={() => setConfirmOut(false)}>
          <div
            className="w-full max-w-[340px] animate-pop rounded-3xl bg-sheet p-6 text-center text-fg ring-1 ring-inset ring-hair"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-extrabold">Log out?</h2>
            <div className="mt-5 flex gap-2.5">
              <button
                onClick={() => { setConfirmOut(false); setLogoutError(""); }}
                className="flex-1 rounded-full bg-inset py-3 text-sm font-bold text-fg transition active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  // Flush the latest local changes while the auth session still
                  // exists. Logging out changes identity only; it never changes
                  // profile, onboarding, or training records.
                  setLoggingOut(true);
                  setLogoutError("");
                  const saved = await syncAccountData();
                  if (!saved) {
                    setLoggingOut(false);
                    setLogoutError("Your latest changes could not be saved. Check your connection and try again.");
                    return;
                  }
                  localStorage.removeItem("ml_auth");
                  await import("@/lib/supabase-client").then((m) => m.sbBrowser()?.auth.signOut());
                  signOut({ callbackUrl: "/login" });
                }}
                disabled={loggingOut}
                className="btn-press-work flex-1 rounded-full bg-signal-work py-3 text-sm font-bold text-white transition disabled:opacity-50"
              >
                {loggingOut ? "Saving…" : "Log out"}
              </button>
            </div>
            {logoutError && <p className="mt-3 text-xs font-semibold text-signal-work">{logoutError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
