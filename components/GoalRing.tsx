"use client";

// The daily-goals object, shared by the home TODAY card and the Activity page.
// ONE circle cut into three 120° arcs (13° deliberate gaps), one hue in three
// steps. Kept in a component so both screens can never drift apart.

import { SURFACE } from "@/lib/palette";

export const GOAL_BG = SURFACE.graphite;               // neutral graphite ground
export const GOAL_ARCS = ["#DCF5E6", "#7FD9AE", "#2E9E6B"]; // one hue, three steps
export const GOAL_LABELS = ["MOVE", "ANALYZE", "WORKOUT"];

// hex → rgb → hex lerp, used only for the completed-ring blend
const hex2rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => {
  const A = hex2rgb(a), B = hex2rgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`;
};
// colour at a fraction around the circle, wrapping back to the first arc so
// the seam is invisible
function ringColorAt(f: number) {
  const stops = [...GOAL_ARCS, GOAL_ARCS[0]];
  const x = f * 3;
  const i = Math.min(2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}

export function GoalRing({ pcts, size = 132, w = 12 }: { pcts: number[]; size?: number; w?: number }) {
  const r = size / 2 - w - 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const GAP = 13;
  const seg = 120 - GAP;
  const len = (deg: number) => (deg / 360) * circ;
  const done = [0, 1, 2].every((i) => (pcts[i] ?? 0) >= 1);

  // ALL THREE DONE → the arcs close into ONE unbroken circle, colours blending
  // into each other. The gaps only exist while the day is unfinished.
  if (done) {
    const N = 72; // 5° slices — enough for a seamless conic-style blend
    const pt = (deg: number) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible" }}>
        {Array.from({ length: N }, (_, i) => {
          const a0 = (i * 360) / N;
          const a1 = ((i + 1) * 360) / N + 0.7; // slight overlap kills hairline seams
          const [x0, y0] = pt(a0);
          const [x1, y1] = pt(a1);
          return (
            <path
              key={i}
              d={`M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`}
              fill="none"
              stroke={ringColorAt(i / N)}
              strokeWidth={w}
              strokeLinecap="butt"
            />
          );
        })}
        {/* one soft halo for the whole closed ring — the day is complete */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={GOAL_ARCS[1]} strokeWidth={w}
          opacity={0.5} style={{ filter: `blur(7px)` }} />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}>
        {[0, 1, 2].map((i) => (
          <circle
            key={`t${i}`} cx={cx} cy={cy} r={r} fill="none"
            stroke="rgba(255,255,255,0.07)" strokeWidth={w} strokeLinecap="round"
            strokeDasharray={`${len(seg)} ${circ}`} strokeDashoffset={-len(i * 120 + GAP / 2)}
          />
        ))}
        {[0, 1, 2].map((i) => {
          const v = Math.min(1, Math.max(0, pcts[i] ?? 0));
          return (
            <circle
              key={`f${i}`} cx={cx} cy={cy} r={r} fill="none"
              stroke={GOAL_ARCS[i]} strokeWidth={w} strokeLinecap="round"
              strokeDasharray={`${Math.max(0.001, len(seg * v))} ${circ}`}
              strokeDashoffset={-len(i * 120 + GAP / 2)}
              style={{ filter: `drop-shadow(0 0 6px ${GOAL_ARCS[i]}55)`, transition: "stroke-dasharray 0.7s ease-out" }}
            />
          );
        })}
      </g>
    </svg>
  );
}

// the three labelled rows that sit beside the ring
export function GoalRows({ values, targets }: { values: number[]; targets: number[] }) {
  return (
    <div className="flex-1 space-y-3">
      {[0, 1, 2].map((i) => {
        const frac = targets[i] > 0 ? Math.min(1, values[i] / targets[i]) : 0;
        return (
          <div key={i}>
            <div className="flex items-baseline justify-between">
              <span className="font-golden text-[12px] leading-none text-white/60">{GOAL_LABELS[i]}</span>
              <span className="font-golden text-[15px] leading-none">
                {values[i]}<span className="text-white/55">/{targets[i]}</span>
              </span>
            </div>
            <div className="mt-1.5 h-[6px] w-full overflow-hidden rounded-full bg-white/[0.09]">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.max(frac > 0 ? 6 : 0, frac * 100)}%`,
                  background: GOAL_ARCS[i],
                  boxShadow: `0 0 8px ${GOAL_ARCS[i]}55`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// the graphite card shell with its light-catching top edge + colour washes
export function GoalCardShell({
      children,
      className = "",
      emphasis = false,
}: {
  children: React.ReactNode;
  className?: string;
  emphasis?: boolean;
}) {
  const background = emphasis
    ? [
        `radial-gradient(105% 160% at 104% 8%, ${GOAL_ARCS[2]}80 0%, ${GOAL_ARCS[2]}4D 40%, transparent 75%)`,
        `radial-gradient(85% 145% at -12% 118%, ${GOAL_ARCS[1]}24 0%, transparent 64%)`,
        GOAL_BG,
      ].join(", ")
    : GOAL_BG;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl px-5 py-4 text-white shadow-lift ${className}`}
      style={{ background }}
    >
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${emphasis ? GOAL_ARCS[1] : "rgba(255,255,255,0.22)"}, transparent)` }}
      />
      {!emphasis && (
        <>
          <span className="pointer-events-none absolute -right-20 -top-24 h-52 w-52 rounded-full blur-3xl" style={{ background: `${GOAL_ARCS[1]}1F` }} />
          <span className="pointer-events-none absolute -bottom-28 -left-16 h-48 w-48 rounded-full blur-3xl" style={{ background: `${GOAL_ARCS[1]}10` }} />
        </>
      )}
      <div className="relative">{children}</div>
    </div>
  );
}
