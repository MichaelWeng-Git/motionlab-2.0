"use client";

// Six-axis radar — the sport's own fundamentals, scored by the AI coach.
// Animates from center outward on mount. Labels always fit (wrap + generous margins).

import { useEffect, useState } from "react";

export function RadarChart({
  data,
  size = 300,
  target,
}: {
  data: { label: string; value: number }[]; // up to 6
  size?: number;
  target?: number; // 0-100 goal line drawn as a dashed ring (Sportsbox-style)
}) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const dur = 700;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      setT(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data]);

  // keep AI labels short so they never overflow (e.g. "Core engagement" → "Core")
  const dims = data.slice(0, 6).map((d) => ({
    ...d,
    label: d.label.length > 11 ? d.label.split(/\s|-/)[0] : d.label,
  }));
  const N = dims.length;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 58; // extra room so labels never clip

  const pt = (i: number, r: number) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / N;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)] as const;
  };

  const rings = [0.25, 0.5, 0.75, 1];
  const valuePts = dims.map((d, i) => pt(i, R * (Math.max(0, Math.min(100, d.value)) / 100) * t));
  const areaPath = valuePts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + " Z";

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto block w-full max-w-[300px] overflow-visible"
    >
      {/* grid rings */}
      {rings.map((rr, ri) => (
        <polygon
          key={ri}
          points={dims.map((_, i) => pt(i, R * rr).join(",")).join(" ")}
          fill="none"
          stroke="rgba(14,31,26,0.08)"
          strokeWidth="1"
        />
      ))}
      {/* spokes */}
      {dims.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(14,31,26,0.08)" strokeWidth="1" />;
      })}
      {/* target ring (goal line) — dashed, sits behind your shape */}
      {target != null && (
        <polygon
          points={dims.map((_, i) => pt(i, R * (target / 100)).join(",")).join(" ")}
          fill="none"
          stroke="#5B6472"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
      )}
      {/* value area */}
      <path d={areaPath} fill="rgba(53,133,90,0.18)" stroke="#FF4E1A" strokeWidth="2.5" strokeLinejoin="round" />
      {valuePts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3.5" fill="#FF4E1A" />
      ))}
      {/* labels: anchor by side so words stay inside the viewBox; long words wrap to 2 lines */}
      {dims.map((d, i) => {
        const [lx, ly] = pt(i, R + 20);
        const isTop = Math.abs(lx - cx) < 8 && ly < cy;
        const isBottom = Math.abs(lx - cx) < 8 && ly > cy;
        const anchor = isTop || isBottom ? "middle" : lx > cx ? "start" : "end";
        const words = d.label.split(" ");
        const twoLine = d.label.length > 9 && words.length > 1;
        const line1 = twoLine ? words.slice(0, Math.ceil(words.length / 2)).join(" ") : d.label;
        const line2 = twoLine ? words.slice(Math.ceil(words.length / 2)).join(" ") : "";
        const baseY = isTop ? ly - (twoLine ? 16 : 4) : ly;
        return (
          <g key={i}>
            <text x={lx} y={baseY} textAnchor={anchor} className="fill-ink text-[12px] font-bold">
              {line1}
            </text>
            {twoLine && (
              <text x={lx} y={baseY + 13} textAnchor={anchor} className="fill-ink text-[12px] font-bold">
                {line2}
              </text>
            )}
            <text
              x={lx}
              y={baseY + (twoLine ? 26 : 13)}
              textAnchor={anchor}
              className="fill-ink-muted text-[11px] font-semibold tabular-nums"
            >
              {Math.round(d.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
