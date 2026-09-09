"use client";

// "How to improve" — exercise cards (two per row): illustration from the
// palette-locked library in /public/exercises + name + dose. The AI coach picks
// each exercise FROM lib/exercise-catalog.json for this user's specific flaws;
// older reports are padded from the catalog by flagged body part.

import { useState } from "react";
import type { TipOut } from "@/lib/analysis";
import catalog from "@/lib/exercise-catalog.json";

type CatEntry = { id: string; name: string; sport: string; target: string; dose: string };
const CAT = catalog as CatEntry[];

// fuzzy match a coach-written exercise name to a catalog entry (for its image)
function matchCatalog(name: string): CatEntry | null {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const n = norm(name);
  let best: CatEntry | null = null, bestScore = 0;
  for (const c of CAT) {
    const cn = norm(c.name);
    if (cn === n) return c;
    const words = new Set(cn.split(" "));
    const score = n.split(" ").filter((w) => words.has(w)).length / Math.max(1, words.size);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 0.5 ? best : null;
}

// map a tip's body part to catalog targets, to pad old reports with real drills
function targetsFor(bodyPart?: string): string[] {
  const s = (bodyPart ?? "").toLowerCase();
  if (/hip|core|pelvis|balance|weight|center/.test(s)) return ["balance", "core", "hips"];
  if (/knee|leg|ankle|foot/.test(s)) return ["legs", "power", "foot-strike"];
  if (/arm|shoulder|wrist|elbow/.test(s)) return ["arms", "arm-swing", "posture"];
  if (/back|torso|chest|spine|posture|head|neck/.test(s)) return ["posture", "core"];
  return ["core", "legs"];
}

// illustration slot: shimmer skeleton while loading, fade the image in when
// ready; on a missing slug the slot settles into a clean blank white square
function CardImg({ src }: { src: string | null }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const loading = !!src && !loaded && !failed;
  return (
    <div className={`min-h-0 flex-1 overflow-hidden rounded-xl bg-white ${loading ? "skeleton" : ""}`}>
      {src && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`h-full w-full object-contain transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}

export function HowToImprove({ tips, drill, sport }: { tips: TipOut[]; drill?: { title: string; detail: string }; sport?: string }) {
  type Item = { name: string; dose: string; img: string | null };
  const items: Item[] = [];
  const seen = new Set<string>();
  const push = (name: string, dose: string, img: string | null) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ name, dose, img });
  };

  // 1) the coach's per-problem exercises (new reports)
  for (const t of tips) {
    if (!t.exercise?.name) continue;
    // new reports carry the exact catalog id; older ones fall back to fuzzy name match
    const byId = t.exercise.id ? CAT.find((c) => c.id === t.exercise!.id) : null;
    const m = byId ?? matchCatalog(t.exercise.name);
    push(m?.name ?? t.exercise.name, t.exercise.dose, m ? `/exercises/${m.id}.png` : null);
  }
  // 2) the legacy single drill
  if (!items.length && drill?.title) {
    const m = matchCatalog(drill.title);
    const secs = drill.detail.match(/(\d+)\s*(?:s\b|sec|seconds)/i)?.[1];
    push(drill.title, secs ? `3 × ${secs}s` : "3 × 10", m ? `/exercises/${m.id}.png` : null);
  }
  // 3) pad from the catalog up to FOUR cards (two full rows) — picked from the
  //    SAME body parts the coach flagged for THIS person, same sport or general
  if (items.length < 4) {
    const wanted = new Set(tips.flatMap((t) => targetsFor(t.bodyPart)));
    const pool = CAT.filter(
      (c) => (c.sport === "general" || c.sport.toLowerCase() === (sport ?? "").toLowerCase()) && wanted.has(c.target)
    );
    for (const c of pool) {
      if (items.length >= 4) break;
      push(c.name, c.dose, `/exercises/${c.id}.png`);
    }
  }
  if (!items.length) return null;

  return (
    <section className="mt-4 rounded-3xl bg-white p-4 shadow-soft">
      <div className="px-1">
        <div className="flex items-center gap-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <g stroke="#FF4E1A" strokeWidth="2.4" strokeLinecap="round">
              <rect x="4.2" y="5.5" width="4.6" height="13" rx="2.3" />
              <rect x="15.2" y="5.5" width="4.6" height="13" rx="2.3" />
              <path d="M8.8 12 H15.2" strokeWidth="3" />
              <path d="M1.8 9.5 V14.5 M22.2 9.5 V14.5" strokeWidth="2.6" />
            </g>
          </svg>
          <h2 className="font-golden text-lg leading-none text-ink">HOW TO IMPROVE</h2>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {items.slice(0, 4).map((ex, i) => (
          <div key={i} className="flex aspect-square flex-col rounded-2xl bg-[#EFF6F1] p-3">
            <CardImg src={ex.img} />
            <p className="mt-2 text-[13px] font-semibold leading-snug text-black">
              {i + 1}. {ex.name}
            </p>
            <span className="mt-1.5 self-start rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-black">
              {ex.dose}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
