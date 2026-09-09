"use client";

// Professional reference packs for the side-by-side comparison.
// COPYRIGHT-SAFE BY DESIGN: we store only metadata — the pro's video plays
// through the official YouTube embed of the source channel's own upload.
// (Skeleton frame data will be added per-pack later, extracted offline with
// our own pipeline; the sync view works with video + anchor alone.)

export type ProPack = {
  sport: string;      // must match the report's recognized sport ("Running", "Tennis"…)
  pro: string;        // "Eliud Kipchoge"
  action: string;     // short: "marathon cruise stride"
  youtubeId: string;  // official-channel video
  startS: number;     // segment start (s)
  endS: number;       // segment end (s)
  anchorS: number;    // the pro's key moment inside the video (s) — alignment point
};

// Pro 3D skeleton clip (from real motion capture, converted offline): H36M-17
// joints per frame in our renderer's units (pelvis-origin-ish, y-up, ~1.7 tall).
export type ProSkeleton = {
  pro: string;                 // who the reference represents
  fps: number;
  frames: [number, number, number][][]; // [frame][17 joints][x,y,z]
};

export async function loadProSkeleton(sport: string): Promise<ProSkeleton | null> {
  try {
    const res = await fetch(`/pros/skel-${sport.toLowerCase()}.json`);
    if (!res.ok) return null;
    const j = (await res.json()) as ProSkeleton;
    return Array.isArray(j.frames) && j.frames.length > 10 && j.frames[0].length === 17 ? j : null;
  } catch {
    return null;
  }
}

let cache: ProPack[] | null = null;

export async function loadProPacks(): Promise<ProPack[]> {
  if (cache) return cache;
  try {
    const res = await fetch("/pros/index.json");
    if (!res.ok) return (cache = []);
    const j = (await res.json()) as ProPack[];
    cache = Array.isArray(j) ? j.filter((p) => p.youtubeId && p.sport) : [];
  } catch {
    cache = [];
  }
  return cache;
}

// same-sport only — never compare a run to a serve. If the AI coach named a pro
// we have a pack for, prefer that; otherwise first same-sport pack.
export function pickPack(packs: ProPack[], sport?: string, preferPro?: string): ProPack | null {
  if (!sport) return null;
  const same = packs.filter((p) => p.sport.toLowerCase() === sport.toLowerCase());
  if (!same.length) return null;
  if (preferPro) {
    const hit = same.find((p) => p.pro.toLowerCase() === preferPro.toLowerCase());
    if (hit) return hit;
  }
  return same[0];
}
