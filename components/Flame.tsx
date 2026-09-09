"use client";

// Streak flame that actually burns: outer flame wobbles from its base while
// the bright core dances faster (CSS keyframes in globals). Unlit = quiet
// outline; lit = warm gradient fire.
// LEVELS (Whoop-style): every 10 streak days the fire burns hotter — deeper
// reds, brighter core, and a growing glow.

import { useId } from "react";

// 1-9 days → 1, 10-19 → 2, 20-29 → 3, 30+ → 4
export const flameLevel = (days: number) => Math.max(1, Math.min(4, 1 + Math.floor(days / 10)));

const PALETTES: { deep: string; stops: [string, string, string]; core: string; glow: string }[] = [
  { deep: "#E2450E", stops: ["#FF5A1F", "#FF8A1E", "#FFC24D"], core: "#FFEBBE", glow: "drop-shadow(0 1px 2.5px rgba(255,122,30,0.45))" },
  { deep: "#D63508", stops: ["#FF4413", "#FF7E12", "#FFC94F"], core: "#FFEFC4", glow: "drop-shadow(0 1px 4px rgba(255,122,30,0.6))" },
  { deep: "#C42604", stops: ["#F5320E", "#FF6A00", "#FFD056"], core: "#FFF3CC", glow: "drop-shadow(0 1px 6px rgba(255,106,0,0.65))" },
  { deep: "#AB1B00", stops: ["#E82500", "#FF5F00", "#FFE066"], core: "#FFF8DF", glow: "drop-shadow(0 1px 9px rgba(255,95,0,0.75))" },
];

export function Flame({ size = 22, lit = true, level = 1 }: { size?: number; lit?: boolean; level?: number }) {
  const uid = useId().replace(/:/g, "");
  const gid = `flame-g-${uid}`;
  const cid = `flame-c-${uid}`;

  if (!lit) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3.4c.6 2.6 1.9 4.1 3.6 5.8 1.6 1.6 2.6 3.2 2.6 5.2a6.2 6.2 0 0 1-12.4 0c0-2.5 1.3-4.2 2.6-5.7C10 7 11.6 5.6 12 3.4z" />
      </svg>
    );
  }

  const p = PALETTES[Math.max(0, Math.min(PALETTES.length - 1, Math.round(level) - 1))];

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ filter: p.glow, overflow: "visible" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={p.stops[0]} />
          <stop offset="0.55" stopColor={p.stops[1]} />
          <stop offset="1" stopColor={p.stops[2]} />
        </linearGradient>
        <linearGradient id={cid} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={p.stops[1]} />
          <stop offset="1" stopColor={p.core} />
        </linearGradient>
      </defs>
      {/* back tongue — a deeper lick swaying on its own beat, peeking out left */}
      <path
        className="flame-back"
        d="M8.9 6.5c-.2 1.9-1.2 3.1-2.3 4.4-1 1.3-1.8 2.7-1.8 4.5a5.4 5.4 0 0 0 5.4 5.3c-1.9-1.5-2.9-3.4-2.9-5.5 0-2 .8-3.6 1.6-5.1.6-1.2 1-2.4 1-3.6z"
        fill={p.deep}
        opacity="0.9"
      />
      <g className="flame-flicker">
        {/* main flame — asymmetric tip flicking right, fuller hips */}
        <path
          d="M11.8 2.4c.2 2.4 1.5 4 3.2 5.7 1.7 1.7 3.1 3.6 3.1 6a6.55 6.55 0 0 1-13.1.1c0-2.6 1.3-4.3 2.6-5.9 1.1-1.3 2.3-2.6 2.9-4.3.3-.8.4-1.3 1.3-1.6z"
          fill={`url(#${gid})`}
        />
        {/* hot core — offset toward the lean of the flame */}
        <path
          className="flame-core"
          d="M12.4 10.6c.2 1.4 1 2.3 1.9 3.3.8.9 1.4 1.9 1.4 3.1a3.45 3.45 0 0 1-6.9 0c0-1.3.7-2.3 1.5-3.2.9-1 1.8-1.9 2.1-3.2z"
          fill={`url(#${cid})`}
        />
      </g>
      {/* ember floating up off the tip */}
      <circle className="flame-spark" cx="15.6" cy="4.6" r="1.05" fill={p.stops[2]} />
    </svg>
  );
}
