"use client";

// "How to improve" — compact training prescription: illustration from the
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
    <div className={`h-full min-h-0 w-full overflow-hidden rounded-xl bg-white ${loading ? "skeleton" : ""}`}>
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
  type Item = { name: string; dose: string; how?: string; img: string | null };
  const items: Item[] = [];
  const seen = new Set<string>();
  const push = (name: string, dose: string, img: string | null, how?: string) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ name, dose, how, img });
  };

  // 1) the coach's per-problem exercises (new reports)
  for (const t of tips) {
    if (!t.exercise?.name) continue;
    // new reports carry the exact catalog id; older ones fall back to fuzzy name match
    const byId = t.exercise.id ? CAT.find((c) => c.id === t.exercise!.id) : null;
    const m = byId ?? matchCatalog(t.exercise.name);
    push(m?.name ?? t.exercise.name, t.exercise.dose, m ? `/exercises/${m.id}.png` : null, t.exercise.how);
  }
  // 2) the legacy single drill
  if (!items.length && drill?.title) {
    const m = matchCatalog(drill.title);
    const secs = drill.detail.match(/(\d+)\s*(?:s\b|sec|seconds)/i)?.[1];
    push(drill.title, secs ? `3 × ${secs}s` : "3 × 10", m ? `/exercises/${m.id}.png` : null, drill.detail);
  }
  if (!items.length) return null;

  return (
    <section className="mt-4 overflow-hidden rounded-2xl bg-graphite p-4 text-white shadow-lift">
      <div className="px-1 pt-1">
        <p className="text-[9px] font-black tracking-[0.18em] text-[#7FD9AE]">NEXT SESSION</p>
        <div className="flex items-center gap-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <g stroke="#FF4E1A" strokeWidth="2.4" strokeLinecap="round">
              <rect x="4.2" y="5.5" width="4.6" height="13" rx="2.3" />
              <rect x="15.2" y="5.5" width="4.6" height="13" rx="2.3" />
              <path d="M8.8 12 H15.2" strokeWidth="3" />
              <path d="M1.8 9.5 V14.5 M22.2 9.5 V14.5" strokeWidth="2.6" />
            </g>
          </svg>
          <h2 className="font-golden text-xl leading-none text-white">TRAIN THESE</h2>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {items.slice(0, 3).map((ex, i) => (
          <div key={i} className="flex min-h-[104px] gap-3 rounded-2xl bg-white/[0.07] p-3 ring-1 ring-inset ring-white/5">
            <div className="h-20 w-20 shrink-0"><CardImg src={ex.img} /></div>
            <div className="min-w-0 flex-1 py-0.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-black leading-snug text-white">{i + 1}. {ex.name}</p>
                <span className="shrink-0 rounded-full bg-[#7FD9AE] px-2 py-1 text-[9px] font-black text-ink">{ex.dose}</span>
              </div>
              {ex.how && <p className="mt-2 line-clamp-2 text-[10px] font-semibold leading-relaxed text-white/55">{ex.how}</p>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
