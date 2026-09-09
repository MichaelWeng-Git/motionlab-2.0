"use client";

// Progress mark shaped like the Deathly Hallows sign: a triangle, an
// inscribed circle, and a center line. Each element is one metric —
// triangle = exercise (red), circle = analyses (green), line = workouts
// (cyan). Faint tracks behind, progress strokes drawing on top.

import { useEffect, useState } from "react";
import { RING_COLORS } from "@/lib/goals";

const COLORS = [RING_COLORS.exercise, RING_COLORS.analyses, RING_COLORS.workouts];

// geometry in a 100×100 viewBox: equilateral-ish triangle + inscribed circle
const APEX_Y = 8;
const BASE_Y = 86;
const TRI = `M50 ${APEX_Y} L95 ${BASE_Y} L5 ${BASE_Y} Z`;
const CIRCLE = { cx: 50, cy: 60, r: 26 };
const LINE = `M50 ${APEX_Y} L50 ${BASE_Y}`;

export function Hallows({
  pcts,
  size,
  stroke = 7,
  dim = false,
  animate = false,
}: {
  pcts: [number, number, number]; // 0..1 for triangle / circle / line
  size: number;
  stroke?: number; // in viewBox units (100 wide)
  dim?: boolean;
  animate?: boolean; // grow strokes in on mount (big card)
}) {
  const [grow, setGrow] = useState(animate ? 0 : 1);
  useEffect(() => {
    if (!animate) return;
    const id = requestAnimationFrame(() => setGrow(1));
    return () => cancelAnimationFrame(id);
  }, [animate]);

  const p = pcts.map((x) => Math.min(1, Math.max(0, x)) * grow);
  const common = {
    fill: "none" as const,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: stroke,
  };
  const dash = (pct: number) =>
    pct > 0
      ? {
          pathLength: 100,
          strokeDasharray: `${Math.max(2.5, pct * 100)} 100`,
          style: { transition: "stroke-dasharray 0.8s cubic-bezier(0.34,1.2,0.5,1)" },
        }
      : null;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0" opacity={dim ? 0.35 : 1}>
      {/* tracks — bright enough that each shape reads instantly on dark */}
      <path d={TRI} {...common} stroke={`${COLORS[0]}80`} />
      <circle {...CIRCLE} {...common} stroke={`${COLORS[1]}80`} />
      <path d={LINE} {...common} stroke={`${COLORS[2]}80`} />
      {/* progress — triangle draws from the apex, circle from its top */}
      {dash(p[0]) && <path d={TRI} {...common} stroke={COLORS[0]} {...dash(p[0])!} />}
      {dash(p[1]) && (
        <circle {...CIRCLE} {...common} stroke={COLORS[1]} transform="rotate(-90 50 60)" {...dash(p[1])!} />
      )}
      {dash(p[2]) && <path d={LINE} {...common} stroke={COLORS[2]} {...dash(p[2])!} />}
    </svg>
  );
}
