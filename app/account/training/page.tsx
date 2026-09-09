"use client";

// Body & training — the physical/training half of the old profile form.
// Identity (avatar/name) and privacy/friends live in /account/profile.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getProfile, type Profile } from "@/lib/profile";
import { SaveSuccess } from "@/components/SaveSuccess";

const LEVELS = [
  { k: "new", t: "Just starting" },
  { k: "mid", t: "Intermediate" },
  { k: "pro", t: "Experienced" },
];
const GOALS = [
  { k: "form", t: "Cleaner form" },
  { k: "safe", t: "Avoid injuries" },
  { k: "match", t: "Compete" },
  { k: "fun", t: "Just for fun" },
];

export default function TrainingEdit() {
  const router = useRouter();
  const [p, setP] = useState<Profile>({});
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setP(getProfile());
  }, []);

  function set<K extends keyof Profile>(k: K, v: Profile[K]) {
    setP((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
  }

  function save() {
    if (!dirty || saved) return;
    setSaved(true);
    // merge with current storage so a stale copy never clobbers photo/avatar/name
    const cur = getProfile();
    localStorage.setItem(
      "ml_profile",
      JSON.stringify({ ...cur, ...p, photo: cur.photo, avatar: cur.avatar, name: cur.name ?? p.name })
    );
    window.dispatchEvent(new Event("ml:profile"));
    setTimeout(() => router.push("/account"), 1450); // let the save flood play
  }

  return (
    <div className="px-5 pt-8 pb-8">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/account")}
          className="grid h-9 w-9 place-items-center rounded-full bg-white text-ink shadow-soft"
        >
          ←
        </button>
        <h1 className="font-golden text-[26px] leading-none">Body &amp; training</h1>
      </div>

      {/* gender */}
      <p className="mt-6 font-golden text-[12px] tracking-wide text-ink-muted">GENDER</p>
      <div className="mt-1.5 grid grid-cols-3 gap-2">
        {[
          { k: "m", t: "Male" },
          { k: "f", t: "Female" },
          { k: "x", t: "Skip" },
        ].map((g) => (
          <button
            key={g.k}
            onClick={() => set("gender", g.k)}
            className={`rounded-2xl border py-3 text-sm font-bold transition ${
              p.gender === g.k ? "border-ink bg-ink text-white" : "border-black/10 bg-white shadow-soft"
            }`}
          >
            {g.t}
          </button>
        ))}
      </div>

      {/* height + weight — required before muscle load can be measured at all;
          the sliders show "—" until touched so an untouched default is never
          stored as a stated body */}
      {(!p.height || !p.weight) && (
        <p className="mt-4 rounded-2xl bg-signal-work/10 px-4 py-3 text-[12px] font-bold leading-relaxed text-signal-work">
          Set both to measure muscle load. Joint work is scaled to your body — without them your videos still get analysed, but the muscle map stays empty.
        </p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white p-4 shadow-soft">
          <div className="flex items-baseline justify-between">
            <span className="font-golden text-[12px] tracking-wide text-ink-muted">HEIGHT</span>
            <span className="font-golden text-[19px] leading-none">{p.height ?? "\u2014"}<span className="ml-1 font-sans text-xs font-bold text-ink-muted">cm</span></span>
          </div>
          <input type="range" min={140} max={210} value={p.height ?? 172} onChange={(e) => set("height", +e.target.value)} className="mt-2 w-full accent-ink" />
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-soft">
          <div className="flex items-baseline justify-between">
            <span className="font-golden text-[12px] tracking-wide text-ink-muted">WEIGHT</span>
            <span className="font-golden text-[19px] leading-none">{p.weight ?? "\u2014"}<span className="ml-1 font-sans text-xs font-bold text-ink-muted">kg</span></span>
          </div>
          <input type="range" min={35} max={150} value={p.weight ?? 65} onChange={(e) => set("weight", +e.target.value)} className="mt-2 w-full accent-ink" />
        </div>
      </div>

      {/* level */}
      <p className="mt-5 font-golden text-[12px] tracking-wide text-ink-muted">LEVEL</p>
      <div className="mt-1.5 grid grid-cols-3 gap-2">
        {LEVELS.map((l) => (
          <button
            key={l.k}
            onClick={() => set("level", l.k)}
            className={`rounded-2xl border py-3 text-xs font-bold transition ${
              p.level === l.k ? "border-ink bg-ink text-white" : "border-black/10 bg-white shadow-soft"
            }`}
          >
            {l.t}
          </button>
        ))}
      </div>

      {/* goal */}
      <p className="mt-5 font-golden text-[12px] tracking-wide text-ink-muted">GOAL</p>
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        {GOALS.map((g) => (
          <button
            key={g.k}
            onClick={() => set("goal", g.k)}
            className={`rounded-2xl border py-3 text-sm font-bold transition ${
              p.goal === g.k ? "border-ink bg-ink text-white" : "border-black/10 bg-white shadow-soft"
            }`}
          >
            {g.t}
          </button>
        ))}
      </div>

      {/* Save: gray + inert until something changed; saving returns to account */}
      <button
        onClick={save}
        disabled={!dirty}
        className={`mt-7 w-full rounded-full py-4 font-golden text-[16px] leading-none transition ${
          dirty
            ? "btn-press bg-volt text-white"
            : "cursor-default bg-black/10 text-ink-muted"
        }`}
      >
        SAVE CHANGES
      </button>

      <SaveSuccess show={saved} />
    </div>
  );
}
