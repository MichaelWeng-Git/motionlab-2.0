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

// ——— SURFACES ———
// The two non-white grounds the app paints cards on. Both were magic constants
// repeated per file (`INK` in /form and /load, `GOAL_BG` in GoalRing, inline in
// weeks/loading), and a fourth near-black `#10271F` had started spreading —
// close enough to these to be indistinguishable alone, far enough to read as a
// rendering fault when two of them share a screen.
export const SURFACE = {
  // neutral graphite — the TODAY card and every dark card. Deliberately NOT a
  // green-black: the ring's mint arcs are the only colour on that card, and a
  // green ground fights them.
  graphite: "#14181B",
  // opaque raised sheet on graphite. It is the exact composite of the
  // standard white/7% panel over graphite, used where translucency would show
  // moving content through a modal.
  sheet: "#24282B",
  // warm paper — the day-intensity card. The 3D body reads a different colour
  // on cream than on white, so this is a deliberate choice, not decoration.
  cream: "#F3F0E8",
} as const;

// ——— AWARD METAL ———
// Podium ranks, medal tiers, deluxe pack trim. A genuine gap in the palette
// above: none of good/okay/work means "first place". `face` is the flat UI
// colour; `edge`/`light` exist so illustrated medals can be shaded from the
// same source rather than inventing their own golds.
export const AWARD = {
  gold:   { edge: "#9B6A12", face: "#E8B23E", light: "#FFE38A" },
  silver: { edge: "#718078", face: "#AFBBB4", light: "#E5ECE8" },
  bronze: { edge: "#8E5734", face: "#C98658", light: "#F1B486" },
} as const;

// ——— SEQUENTIAL HEAT ———
// A 4-step ramp for density/frequency (activity heatmaps, streak calendars),
// where the question is "how much", not "how good". The signal scale above is
// categorical and cannot express this — reaching for it produces red squares
// on a calendar, which reads as failure rather than volume.
// Mirrors tailwind.config.ts `heat.*` — keep the two identical.
export const HEAT = ["#315741", "#4D8A5D", "#7FCF72", "#A8E89B"] as const;
