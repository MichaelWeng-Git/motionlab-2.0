"use client";

// FORM = the athlete's OVERALL ability, not a log of analysis scores.
//
// Why not the coach score: it is graded against EACH SPORT's own standards, so
// a 70 tennis serve and a 75 easy run are not on one scale and averaging them
// means nothing. What IS comparable across sports is what we measure from the
// BODY: the on-device movement qualities (every session has them) and the
// deterministic biomechanics (sessions analysed since that layer shipped).
//
// Six capacities, each 0-100, each with its own trend. Missing inputs return
// null — the UI shows "locked", never an invented number.

import type { AnalysisResult } from "./analysis";

export type CapKey = "control" | "balance" | "power" | "mobility" | "symmetry" | "rhythm";

export const CAP_META: Record<CapKey, { label: string; blurb: string; source: string }> = {
  control:  { label: "CONTROL",  blurb: "How clean and jerk-free your movement is", source: "Smoothness of motion across the clip" },
  balance:  { label: "BALANCE",  blurb: "How steady your centre stays while you move", source: "Hip sway relative to your torso size" },
  power:    { label: "POWER",    blurb: "How explosively you can move", source: "Peak limb speed, body-size normalised" },
  mobility: { label: "MOBILITY", blurb: "How much range your joints actually use", source: "Best knee / hip / shoulder / elbow range seen" },
  symmetry: { label: "SYMMETRY", blurb: "How evenly your left and right sides work", source: "Left-vs-right range and muscle-load gaps" },
  rhythm:   { label: "RHYTHM",   blurb: "How consistent your tempo is", source: "Consistency of motion energy over time" },
};

export const CAP_ORDER: CapKey[] = ["control", "balance", "power", "mobility", "symmetry", "rhythm"];

export type Capacity = { key: CapKey; value: number | null; delta: number | null; samples: number };
export type FormProfile = {
  form: number | null;          // composite 0-100
  delta: number | null;         // vs the older half of the window
  caps: Capacity[];
  trend: { date: string; value: number }[]; // per-session composite, oldest → newest
  sessions: number;
  limitations: string[];
};

type Sess = { id: string; sport?: string; date: string; report?: AnalysisResult };

const q = (r: AnalysisResult | undefined, label: string): number | null => {
  const v = r?.qualities?.find((x) => x.label === label)?.value;
  return typeof v === "number" ? v : null;
};

// joint ranges a healthy adult uses in normal athletic movement — the yardstick
// for turning observed degrees into a 0-100 reading
const ROM_REF: Record<string, number> = {
  knee: 120, hip: 90, shoulder: 150, elbow: 130,
};

function mobilityOf(r: AnalysisResult | undefined): number | null {
  const j = r?.biomech?.joints;
  if (!j) return null;
  const scores: number[] = [];
  for (const [base, ref] of Object.entries(ROM_REF)) {
    const l = j[`${base}_l` as keyof typeof j]?.romDeg;
    const rr = j[`${base}_r` as keyof typeof j]?.romDeg;
    const best = Math.max(l ?? 0, rr ?? 0);
    if (best > 0) scores.push(Math.min(100, (best / ref) * 100));
  }
  if (!scores.length) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function symmetryOf(r: AnalysisResult | undefined): number | null {
  const bm = r?.biomech;
  if (!bm) return null;
  const gaps: number[] = [];
  for (const base of ["knee", "hip", "shoulder", "elbow"]) {
    const l = bm.joints[`${base}_l` as keyof typeof bm.joints]?.romDeg;
    const rr = bm.joints[`${base}_r` as keyof typeof bm.joints]?.romDeg;
    if (l && rr) gaps.push(Math.abs(l - rr) / Math.max(l, rr));
  }
  const ml = bm.muscleLoad as Record<string, number> | undefined;
  if (ml) {
    for (const base of ["quads", "hamstrings", "glutes", "calves", "arms", "shoulders"]) {
      const l = ml[`${base}_l`], rr = ml[`${base}_r`];
      if (l != null && rr != null && Math.max(l, rr) > 0.05) gaps.push(Math.abs(l - rr) / Math.max(l, rr));
    }
  }
  if (!gaps.length) return null;
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return Math.round(Math.max(0, Math.min(100, 100 - (avgGap / 0.4) * 100)));
}

function capsOfSession(s: Sess): Record<CapKey, number | null> {
  const r = s.report;
  return {
    control: q(r, "Smoothness"),
    balance: q(r, "Balance"),
    rhythm: q(r, "Rhythm"),
    power: q(r, "Power flow"),
    mobility: mobilityOf(r),
    symmetry: symmetryOf(r),
  };
}

// recency-weighted mean: a session from today counts about twice one from
// two weeks ago, so the profile tracks the athlete you are NOW
const weightOf = (daysAgo: number) => Math.pow(0.5, daysAgo / 14);

export function buildFormProfile(sessions: Sess[], windowDays = 60): FormProfile {
  const now = Date.now();
  const inWindow = sessions
    .filter((s) => (now - new Date(s.date).getTime()) / 86400e3 <= windowDays)
    .sort((a, b) => a.date.localeCompare(b.date));

  const limitations: string[] = [];
  if (!inWindow.length) {
    return { form: null, delta: null, caps: CAP_ORDER.map((k) => ({ key: k, value: null, delta: null, samples: 0 })), trend: [], sessions: 0, limitations };
  }

  const rows = inWindow.map((s) => ({
    date: s.date,
    daysAgo: (now - new Date(s.date).getTime()) / 86400e3,
    caps: capsOfSession(s),
  }));

  const agg = (list: typeof rows, k: CapKey): { v: number | null; n: number } => {
    let num = 0, den = 0, n = 0;
    for (const r of list) {
      const v = r.caps[k];
      if (v == null) continue;
      const w = weightOf(r.daysAgo);
      num += v * w; den += w; n++;
    }
    return { v: den > 0 ? Math.round(num / den) : null, n };
  };

  const half = Math.max(1, Math.floor(rows.length / 2));
  const older = rows.slice(0, rows.length - half);
  const newer = rows.slice(rows.length - half);

  const caps: Capacity[] = CAP_ORDER.map((k) => {
    const all = agg(rows, k);
    const a = agg(older, k).v;
    const b = agg(newer, k).v;
    return { key: k, value: all.v, delta: a != null && b != null ? b - a : null, samples: all.n };
  });

  const present = caps.filter((c) => c.value != null);
  const rawForm = present.length ? present.reduce((s, c) => s + (c.value as number), 0) / present.length : null;

  // DETRAINING — the only thing that should pull FORM down without a bad
  // session is not training. Grace of 7 days, then ~1.5% of the remaining
  // gap toward an untrained 50 per idle day (a month off ≈ -10 points).
  const idleDays = Math.min(...rows.map((r) => r.daysAgo));
  const decayDays = Math.max(0, idleDays - 7);
  const form = rawForm == null
    ? null
    : Math.round(50 + (rawForm - 50) * Math.pow(0.985, decayDays));
  if (decayDays > 0) limitations.push(`No sessions for ${Math.round(idleDays)} days — form drifts down until you train again.`);

  const oldForm = (() => {
    const vs = CAP_ORDER.map((k) => agg(older, k).v).filter((v): v is number => v != null);
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  })();
  const newForm = (() => {
    const vs = CAP_ORDER.map((k) => agg(newer, k).v).filter((v): v is number => v != null);
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  })();

  // per-session composite for the curve — EVERY point must be computed on the
  // SAME basis or the line lies. A session analysed before the biomechanics
  // layer can't measure mobility/symmetry; averaging 4 capacities for it and 6
  // for a newer one made the curve DROP just because more was measured. So a
  // missing capacity is filled with that capacity's own profile value.
  const capAvg: Partial<Record<CapKey, number>> = {};
  for (const c of caps) if (c.value != null) capAvg[c.key] = c.value;
  const basis = CAP_ORDER.filter((k) => capAvg[k] != null);
  const trend = basis.length
    ? rows.map((r) => {
        const vs = basis.map((k) => r.caps[k] ?? (capAvg[k] as number));
        return { date: r.date, value: Math.round(vs.reduce((a, b) => a + b, 0) / vs.length) };
      })
    : [];

  const lockedCount = caps.filter((c) => c.value == null).length;
  if (lockedCount) limitations.push("Mobility and Symmetry need analyses recorded with the biomechanics layer — analyse a new video to unlock them.");
  if (rows.length < 3) limitations.push("Few sessions in range: the profile firms up as you add more.");

  return {
    form,
    delta: oldForm != null && newForm != null ? Math.round(newForm - oldForm) : null,
    caps, trend, sessions: rows.length, limitations,
  };
}
