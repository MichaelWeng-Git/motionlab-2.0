"use client";

// Profile — identity (avatar + name) plus the social/privacy side:
// Friends entry and the Instagram-style private-account switch.
// Body & training data lives in /account/training.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getProfile, type Profile } from "@/lib/profile";
import { CameraIcon, LockIcon } from "@/components/Icons";
import { SaveSuccess } from "@/components/SaveSuccess";
import { Avatar } from "@/components/Avatar";
import { syncMe } from "@/lib/friends";
import { clearDraft, readDraft, type IdentityDraft } from "@/lib/profile-draft";

export default function ProfileEdit() {
  const router = useRouter();
  const [p, setP] = useState<Profile>({});
  const [draft, setDraft] = useState<IdentityDraft | null>(null);
  const [priv, setPriv] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setP(getProfile());
    setPriv(localStorage.getItem("ml_public") !== "1");
    // a photo/icon staged on the Photo page counts as an unsaved change
    const d = readDraft();
    if (d) {
      setDraft(d);
      setDirty(true);
    }
  }, []);

  function set<K extends keyof Profile>(k: K, v: Profile[K]) {
    setP((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
  }

  // toggling only marks the page dirty — nothing persists until Save
  function togglePrivate() {
    setPriv((v) => !v);
    setDirty(true);
  }

  function save() {
    if (!dirty || saved) return;
    setSaved(true);
    // merge onto what's stored right now, then commit any staged photo/icon
    const cur = getProfile();
    const next: Profile = { ...cur, ...p, photo: cur.photo, avatar: cur.avatar ?? p.avatar };
    if (draft) {
      if (draft.photo !== undefined) next.photo = draft.photo ?? undefined;
      if (draft.avatar !== undefined) next.avatar = draft.avatar;
    }
    localStorage.setItem("ml_profile", JSON.stringify(next));
    clearDraft();
    if (priv) localStorage.removeItem("ml_public");
    else localStorage.setItem("ml_public", "1");
    window.dispatchEvent(new Event("ml:profile")); // top bar refreshes instantly
    syncMe(); // friends see the new photo/name immediately
    setTimeout(() => router.push("/account"), 1450);
  }

  // leaving without saving throws the staged photo/icon away
  function backWithoutSaving() {
    clearDraft();
    router.push("/account");
  }

  const preview: Profile = { ...p, ...(draft ?? {}) } as Profile;

  return (
    <div className="px-5 pt-8 pb-8">
      <div className="flex items-center gap-3">
        <button
          onClick={backWithoutSaving}
          className="grid h-9 w-9 place-items-center rounded-full bg-white text-ink shadow-soft"
        >
          ←
        </button>
        <h1 className="font-golden text-[26px] leading-none">Profile</h1>
      </div>

      {/* profile photo entry */}
      <p className="mt-4 text-xs font-bold uppercase tracking-widest text-ink-muted">Profile photo</p>
      <div className="mt-1.5 overflow-hidden rounded-2xl bg-white shadow-soft">
        <Link href="/account/photo" className="flex w-full items-center gap-3 px-4 py-3.5 transition active:bg-black/[0.03]">
          <span className="grid w-6 place-items-center"><CameraIcon className="text-volt-deep" /></span>
          <span className="flex-1 text-sm font-semibold">Change photo</span>
          {/* live preview — shows a staged (unsaved) photo/icon too */}
          <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-volt-mist">
            <Avatar p={preview} iconSize={24} />
          </span>
          <span className="font-bold text-ink">›</span>
        </Link>
      </div>

      {/* name */}
      <p className="mt-5 text-xs font-bold uppercase tracking-widest text-ink-muted">Name</p>
      <input
        value={p.name ?? ""}
        onChange={(e) => set("name", e.target.value)}
        maxLength={16}
        placeholder="Your name"
        className="mt-1.5 w-full rounded-2xl bg-white px-4 py-3.5 text-[15px] font-bold shadow-soft outline-none focus:border-ink"
      />

      {/* privacy */}
      <p className="mt-5 text-xs font-bold uppercase tracking-widest text-ink-muted">Privacy</p>
      <div className="mt-1.5 overflow-hidden rounded-2xl bg-white shadow-soft">
        <div className="flex w-full items-center gap-3 px-4 py-3.5">
          <span className="grid w-6 place-items-center"><LockIcon className="text-volt-deep" /></span>
          <p className="flex-1 text-sm font-semibold">Private account</p>
          {/* switch */}
          <button
            onClick={togglePrivate}
            aria-pressed={priv}
            aria-label="Private account"
            className={`relative h-7 w-12 rounded-full transition-colors ${priv ? "bg-volt" : "bg-black/15"}`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-soft transition-all ${
                priv ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Save: gray + inert until something changed; saving returns to account */}
      <button
        onClick={save}
        disabled={!dirty}
        className={`mt-7 w-full rounded-full py-4 text-[15px] font-bold transition ${
          dirty
            ? "btn-press bg-volt text-white"
            : "cursor-default bg-black/10 text-ink-muted"
        }`}
      >
        Save changes
      </button>

      <SaveSuccess show={saved} />
    </div>
  );
}
