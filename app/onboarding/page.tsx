"use client";

import { useRouter } from "next/navigation";
import { DumbbellIcon, MedalIcon, ShieldIcon, SmileIcon, SproutIcon, TargetIcon, TrophyIcon } from "@/components/Icons";
import { useState } from "react";

import { SIcon, type SIconName } from "@/components/SIcon";

const AVATARS: { key: string; icon: SIconName; bg: string }[] = [
  { key: "tennis", icon: "tennis", bg: "bg-volt-mist" },
  { key: "run", icon: "run", bg: "bg-sky-100" },
  { key: "swim", icon: "swim", bg: "bg-cyan-100" },
  { key: "ball", icon: "basketball", bg: "bg-orange-100" },
  { key: "lift", icon: "strength", bg: "bg-rose-100" },
  { key: "bolt", icon: "flame", bg: "bg-amber-100" },
];

const LEVELS = [
  { key: "new", icon: <SproutIcon />, t: "Just starting", d: "New to it, building the basics" },
  { key: "mid", icon: <DumbbellIcon size={22} />, t: "Intermediate", d: "I can play — want cleaner form" },
  { key: "pro", icon: <TrophyIcon />, t: "Experienced", d: "Years in — chasing the details" },
];

const GOALS = [
  { key: "form", icon: <TargetIcon />, t: "Cleaner form" },
  { key: "safe", icon: <ShieldIcon />, t: "Avoid injuries" },
  { key: "match", icon: <MedalIcon />, t: "Compete" },
  { key: "fun", icon: <SmileIcon />, t: "Just for fun" },
];

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0); // 0,1,2

  // step 1
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0].key);
  // step 2
  const [gender, setGender] = useState<string | null>(null);
  // A slider parked at its default is NOT an answer. Until the user moves it,
  // the value is unset — biomech needs a real body, and 172/65 stored as if
  // stated is the same lie as inventing it later.
  const [height, setHeight] = useState(172);
  const [weight, setWeight] = useState(65);
  const [heightSet, setHeightSet] = useState(false);
  const [weightSet, setWeightSet] = useState(false);
  // step 3
  const [level, setLevel] = useState<string | null>(null);
  const [goal, setGoal] = useState<string | null>(null);

  const canNext =
    step === 0 ? name.trim().length > 0
    : step === 1 ? gender !== null && heightSet && weightSet
    : level !== null && goal !== null;

  function next() {
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    // finish: persist profile, mark onboarded, land on home
    localStorage.setItem(
      "ml_profile",
      JSON.stringify({
        name: name.trim(), avatar, gender, level, goal,
        height: heightSet ? height : undefined,
        weight: weightSet ? weight : undefined,
      })
    );
    localStorage.setItem("ml_onboarded", "1");
    // first-timer ritual: the black veil greets them with "WELCOME" on Home
    try { sessionStorage.setItem("ml_welcome_new", "1"); } catch {}
    router.replace("/");
  }

  return (
    <div className="flex flex-1 flex-col px-6 pb-8 pt-6">
      {/* progress */}
      <div className="flex items-center gap-3">
        {step > 0 ? (
          <button onClick={() => setStep(step - 1)} className="grid h-9 w-9 place-items-center rounded-full bg-white text-ink shadow-soft">
            ←
          </button>
        ) : (
          <span className="h-9 w-9" />
        )}
        <div className="flex flex-1 gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-all ${i <= step ? "bg-ink" : "bg-black/10"}`}
            />
          ))}
        </div>
        <span className="w-9 text-right text-xs font-semibold tabular-nums text-ink-muted">{step + 1}/3</span>
      </div>

      {/* STEP 1 — name & avatar */}
      {step === 0 && (
        <div className="flex flex-1 animate-fade-up flex-col pt-10">
          <h1 className="display text-3xl font-extrabold">First things first —
            <br />what should we call you?</h1>

          <div className="mt-8 flex justify-center">
            <span className={`grid h-24 w-24 place-items-center rounded-full ${AVATARS.find((a) => a.key === avatar)?.bg}`}>
              <SIcon name={AVATARS.find((a) => a.key === avatar)!.icon} size={64} />
            </span>
          </div>

          <div className="mt-5 flex justify-center gap-2.5">
            {AVATARS.map((a) => (
              <button
                key={a.key}
                onClick={() => setAvatar(a.key)}
                className={`grid h-11 w-11 place-items-center rounded-full transition ${a.bg} ${
                  avatar === a.key ? "ring-2 ring-ink ring-offset-2 ring-offset-paper" : "opacity-60"
                }`}
              >
                <SIcon name={a.icon} size={30} />
              </button>
            ))}
          </div>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={12}
            className="mt-8 w-full rounded-2xl bg-white px-5 py-4 text-center text-lg font-bold shadow-soft outline-none placeholder:font-normal placeholder:text-ink-muted focus:border-ink"
          />
          {name.trim() && (
            <p className="mt-5 animate-pop text-center text-xs font-semibold text-volt-deep">
              Nice to meet you, {name.trim()} — this is the name friends see on the leaderboard.
            </p>
          )}
        </div>
      )}

      {/* STEP 2 — gender / height / weight */}
      {step === 1 && (
        <div className="flex flex-1 animate-fade-up flex-col pt-10">
          <h1 className="display text-3xl font-extrabold">Your body basics</h1>

          <p className="mt-8 text-sm font-bold">Gender</p>
          <div className="mt-2.5 grid grid-cols-3 gap-2.5">
            {[
              { k: "m", t: "Male" },
              { k: "f", t: "Female" },
              { k: "x", t: "Skip" },
            ].map((g) => (
              <button
                key={g.k}
                onClick={() => setGender(g.k)}
                className={`rounded-2xl border py-3.5 text-sm font-bold transition ${
                  gender === g.k ? "border-ink bg-ink text-white" : "border-black/10 bg-white text-ink shadow-soft"
                }`}
              >
                {g.t}
              </button>
            ))}
          </div>

          <div className="mt-7">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-bold">Height</p>
              <p className="text-xl font-extrabold tabular-nums">
                {heightSet ? height : "—"}
                <span className="ml-1 text-xs font-semibold text-ink-muted">cm</span>
              </p>
            </div>
            <input
              type="range"
              min={140}
              max={210}
              value={height}
              onChange={(e) => { setHeight(+e.target.value); setHeightSet(true); }}
              className="mt-3 w-full accent-ink"
            />
          </div>

          <div className="mt-6">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-bold">Weight</p>
              <p className="text-xl font-extrabold tabular-nums">
                {weightSet ? weight : "—"}
                <span className="ml-1 text-xs font-semibold text-ink-muted">kg</span>
              </p>
            </div>
            <input
              type="range"
              min={35}
              max={150}
              value={weight}
              onChange={(e) => { setWeight(+e.target.value); setWeightSet(true); }}
              className="mt-3 w-full accent-ink"
            />
          </div>
          <p className="mt-6 text-center text-xs font-semibold text-volt-deep">
            {heightSet && weightSet
              ? `Got it — muscle load will be scaled to ${height} cm · ${weight} kg.`
              : "Set both — muscle load can't be measured without your body size."}
          </p>
        </div>
      )}

      {/* STEP 3 — level & goal */}
      {step === 2 && (
        <div className="flex flex-1 animate-fade-up flex-col pt-10">
          <h1 className="display text-3xl font-extrabold">One last thing</h1>

          <p className="mt-7 text-sm font-bold">How would you rate yourself?</p>
          <div className="mt-2.5 space-y-2.5">
            {LEVELS.map((l) => (
              <button
                key={l.key}
                onClick={() => setLevel(l.key)}
                className={`flex w-full items-center gap-3.5 rounded-2xl border p-4 text-left transition ${
                  level === l.key ? "border-ink bg-ink text-white" : "border-black/10 bg-white shadow-soft"
                }`}
              >
                <span className={level === l.key ? "text-volt-glow" : "text-volt-deep"}>{l.icon}</span>
                <span className="text-sm font-bold">{l.t}</span>
              </button>
            ))}
          </div>

          <p className="mt-7 text-sm font-bold">What do you want most?</p>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            {GOALS.map((g) => (
              <button
                key={g.key}
                onClick={() => setGoal(g.key)}
                className={`flex items-center gap-2 rounded-2xl border px-4 py-3.5 text-sm font-bold transition ${
                  goal === g.key ? "border-ink bg-ink text-white" : "border-black/10 bg-white shadow-soft"
                }`}
              >
                <span className={goal === g.key ? "text-volt-glow" : "text-volt-deep"}>{g.icon}</span>
                {g.t}
              </button>
            ))}
          </div>
          {goal !== null && (
            <p className="mt-6 animate-pop text-center text-xs font-semibold text-volt-deep">
              {goal === "form" && "Noted — the AI will zero in on your technique details."}
              {goal === "safe" && "Noted — we'll watch your joint angles and landings extra carefully."}
              {goal === "match" && "Noted — expect feedback aimed at winning points."}
              {goal === "fun" && "Noted — we'll keep it light: streaks, coins, and a tree to decorate."}
            </p>
          )}
        </div>
      )}

      {/* continue */}
      <button
        onClick={next}
        disabled={!canNext}
        className={`mt-8 w-full rounded-full py-4 text-[15px] font-bold transition active:scale-[0.98] ${
          canNext ? "btn-press bg-ink text-white" : "bg-black/10 text-ink-muted"
        }`}
      >
        {step === 2 ? "Finish & start" : "Continue"}
      </button>
    </div>
  );
}
