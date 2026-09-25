"use client";

// The privacy page. Every number and destination here was read out of the code,
// not written from intent:
//   · 3 stills at 384 px      app/analyze/page.tsx (KW = 384, fracs .15/.5/.85)
//   · 4–12 stills at 480 px   lib/sam3d.ts (CW = 480, MAX_ANCHORS = 12), and only
//                             when preferences.cloud3d is on — it defaults to false
//   · 1 meal photo ≤ 640 px   app/fuel/page.tsx (max = 640)
//   · the account snapshot    lib/cloud-data.ts ACCOUNT_KEYS (covers and route
//                             thumbnails stripped, GPS paths deliberately kept)
//   · the replay video        lib/replay-db.ts — IndexedDB, never in the snapshot
// If any of those change, this page is wrong until it changes with them.

import Link from "next/link";

const LEAVES = [
  {
    n: "3",
    what: "still frames, 384 px wide",
    where: "to the AI coach (OpenAI)",
    why: "It reads what activity you are doing and writes the coaching notes. Your scores are measured on this device, not by it.",
    when: "Every analysis",
  },
  {
    n: "4–12",
    what: "still frames, 480 px wide",
    where: "to SAM 3D Body (fal.ai)",
    why: "Sharpens torso posture in 3D.",
    when: "Only with Cloud 3D on — it is off unless you turn it on",
  },
  {
    n: "1",
    what: "meal photo, up to 640 px",
    where: "to the food scanner (OpenAI)",
    why: "Estimates the macros. It is read and dropped — MotionLab never stores it.",
    when: "Only when you scan a meal",
  },
  {
    n: "0",
    what: "video files, ever",
    where: "",
    why: "The whole analysis runs in your browser. The file is never uploaded. The replay copy lives in this browser and is not part of your account backup — clearing this browser's data deletes it for good.",
    when: "",
  },
];

const ACCOUNT = [
  ["Who you are", "Email, name and avatar from Google sign-in or your email code."],
  ["Your training", "Analysed sessions, recorded workouts including GPS routes, meals, goals, streaks and coins."],
  ["Your body", "Height, weight, age and sex, if you entered them. Muscle load is scaled by them — without them it is withheld rather than guessed."],
  ["Your friends", "Who you are connected to, and requests either way."],
];

const THIRD_PARTIES = [
  ["OpenAI", "The three keyframes, the meal photos, and the numbers already measured on your device."],
  ["fal.ai", "The extra keyframes, and only if you switch Cloud 3D on."],
  ["Supabase", "Stores your account and the private backup of your training."],
  ["OpenStreetMap · Esri · Google Maps", "While a map is on screen they serve its tiles, which tells them roughly where you are looking."],
  ["Google Fonts", "Serves the app's display font, so Google sees the request your browser makes for it."],
  ["YouTube", "Only if you open a pro comparison video."],
];

export function PrivacyPolicy({ backHref }: { backHref: string }) {
  return (
    <div className="min-h-full bg-graphite px-5 pb-10 pt-8 text-white">
      <div className="flex items-center gap-3">
        <Link href={backHref} aria-label="Back" className="grid h-10 w-10 place-items-center rounded-full bg-panel text-fg shadow-panel">←</Link>
        <h1 className="font-golden text-[26px] leading-none">PRIVACY</h1>
      </div>

      <section className="mt-5 overflow-hidden rounded-2xl bg-panel p-5 text-fg shadow-panel">
        <p className="text-[11px] font-black tracking-[0.18em] text-signal-good">THE SHORT VERSION</p>
        <h2 className="mt-2 font-golden text-3xl leading-none">YOUR VIDEO<br />STAYS HERE.</h2>
        <p className="mt-3 text-[13px] font-semibold leading-snug text-fg-soft">
          The pose models run in your browser. What leaves this device is a handful
          of small still frames, listed below with the exact count. Nothing is sold,
          and there are no ad or analytics trackers in this app.
        </p>
      </section>

      <section className="mt-5">
        <h2 className="font-golden text-xl">WHAT LEAVES THIS DEVICE</h2>
        <div className="mt-2 overflow-hidden rounded-2xl bg-panel text-fg shadow-panel">
          {LEAVES.map((row, i) => (
            <div key={row.what} className={`px-4 py-4 ${i ? "border-t border-hair" : ""}`}>
              <div className="flex items-baseline gap-2.5">
                <span className={`font-golden text-2xl leading-none ${row.n === "0" ? "text-signal-good" : "text-fg"}`}>{row.n}</span>
                <span className="text-sm font-extrabold">{row.what}</span>
              </div>
              {row.where && <p className="mt-1 text-[11px] font-black tracking-wider text-fg-muted">{row.where.toUpperCase()}</p>}
              <p className="mt-1.5 text-[13px] font-semibold leading-snug text-fg-soft">{row.why}</p>
              {row.when && <p className="mt-1.5 text-[11px] font-bold text-fg-muted">{row.when}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-5">
        <h2 className="font-golden text-xl">WHAT YOUR ACCOUNT HOLDS</h2>
        <p className="mt-1 text-[12px] font-semibold text-fg-muted">
          Kept on this device first, and mirrored to a private backup only you and
          the server can read. Cover images and route thumbnails are left out.
        </p>
        <div className="mt-2 overflow-hidden rounded-2xl bg-panel text-fg shadow-panel">
          {ACCOUNT.map(([title, body], i) => (
            <div key={title} className={`px-4 py-4 ${i ? "border-t border-hair" : ""}`}>
              <p className="text-sm font-extrabold">{title}</p>
              <p className="mt-1 text-[13px] font-semibold leading-snug text-fg-soft">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-5">
        <h2 className="font-golden text-xl">WHO ELSE IS INVOLVED</h2>
        <div className="mt-2 overflow-hidden rounded-2xl bg-panel text-fg shadow-panel">
          {THIRD_PARTIES.map(([name, body], i) => (
            <div key={name} className={`px-4 py-4 ${i ? "border-t border-hair" : ""}`}>
              <p className="text-sm font-extrabold">{name}</p>
              <p className="mt-1 text-[13px] font-semibold leading-snug text-fg-soft">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-5">
        <h2 className="font-golden text-xl">LOCATION</h2>
        <div className="mt-2 overflow-hidden rounded-2xl bg-panel p-4 text-fg shadow-panel">
          <p className="text-[13px] font-semibold leading-snug text-fg-soft">
            Used only while a workout is recording, to draw your route and measure
            distance and pace. It is saved with that workout, so it is in your
            account backup. It is never used for anything else, and a fix too fuzzy
            to trust is discarded rather than turned into distance you did not run.
          </p>
        </div>
      </section>

      <section className="mt-5">
        <h2 className="font-golden text-xl">WHAT YOU CAN DO</h2>
        <div className="mt-2 overflow-hidden rounded-2xl bg-panel text-fg shadow-panel">
          <Link href="/account/settings" className="flex items-center justify-between border-hair px-4 py-4">
            <span>
              <span className="block text-sm font-extrabold">Export everything</span>
              <span className="mt-0.5 block text-[11px] font-bold text-fg-muted">Your whole record as a JSON file</span>
            </span>
            <span className="font-black">›</span>
          </Link>
          <Link href="/account/settings" className="flex items-center justify-between border-t border-hair px-4 py-4">
            <span>
              <span className="block text-sm font-extrabold">Turn Cloud 3D off</span>
              <span className="mt-0.5 block text-[11px] font-bold text-fg-muted">Stops the extra frames leaving. Off by default</span>
            </span>
            <span className="font-black">›</span>
          </Link>
          <Link href="/account/settings" className="flex items-center justify-between border-t border-hair px-4 py-4 text-signal-work">
            <span>
              <span className="block text-sm font-extrabold">Delete your training data</span>
              <span className="mt-0.5 block text-[11px] font-bold opacity-65">From this device and from your account</span>
            </span>
            <span className="font-black">›</span>
          </Link>
        </div>
        <p className="mt-3 text-[12px] font-semibold leading-snug text-fg-muted">
          To have the account itself removed — the email, name and friend
          connections that outlive your training data — ask from Help &amp; feedback
          and it will be deleted.
        </p>
      </section>

      <p className="mt-6 text-center text-[11px] font-bold text-fg-muted">Last updated 25 September 2026</p>
    </div>
  );
}
