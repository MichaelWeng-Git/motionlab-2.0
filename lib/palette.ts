// THE signal palette — one source for every "how good is this number" colour.
//
// Before this file there were four: ScoreRing turned green at 75 with #16C784,
// ShareCard at 75 with a different green, recoveryColor only reached full green
// at 90, and loadColor ran the other way. The same 73 therefore rendered amber
// in one place and green in another, which reads as a bug because it is one.

// These are the SAME three values as tailwind.config.ts `signal.*` — Tailwind
// classes and inline styles must never drift apart.
export const SIGNAL = {
  good: "#3BA55D",
  okay: "#E8A13C",
  work: "#E0523F",
} as const;

// Higher is better: FORM score, recovery, symmetry, anything out of 100.
// Bands, not a gradient — lerping amber→green through RGB lands on olive right
// where most real scores live, which is how a perfectly good 73 ended up
// looking like a warning.
export function qualityColor(v: number): string {
  const x = Math.max(0, Math.min(100, v));
  if (x >= 70) return SIGNAL.good;
  if (x >= 50) return SIGNAL.okay;
  return SIGNAL.work;
}

// Higher is MORE, and more is not better — training load, fatigue. Deliberately
// the inverse direction, built from the same three colours so the two scales
// still read as one system.
export function intensityColor(v: number): string {
  const x = Math.max(0, Math.min(100, v));
  if (x >= 85) return SIGNAL.work;
  if (x >= 55) return SIGNAL.okay;
  return SIGNAL.good;
}
