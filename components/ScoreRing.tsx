"use client";

// Score reveal: the number rolls 0 → score while the ring draws its arc in
// sync (both driven by the same count-up value, so they always agree).

import { useCountUp } from "@/components/AnimatedNumber";

import { qualityColor } from "@/lib/palette";

export function ScoreRing({ score, size = 132, dark = false }: { score: number; size?: number; dark?: boolean }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  const shown = useCountUp(Math.max(0, Math.min(100, score)), 1100);
  const dash = c * (shown / 100);

  // color follows the FINAL score so it never flashes red on the way up.
  // One shared scale (lib/palette) — this used to carry its own thresholds and
  // its own greens, so a 73 read amber here and green everywhere else.
  const color = qualityColor(score);

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      {/* soft halo in the score's color — quiet depth behind the ring */}
      <span
        aria-hidden
        className="absolute inset-2 rounded-full blur-2xl"
        style={{ background: color, opacity: 0.18 }}
      />
      <svg width={size} height={size} className="relative -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke={dark ? "rgba(255,255,255,0.12)" : "rgba(14,31,26,0.07)"} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${dash} ${c}`}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`font-golden text-4xl tabular-nums tracking-tight ${dark ? "text-white" : "text-ink"}`}>{shown}</span>
        <span className={`text-[11px] font-medium ${dark ? "text-white/50" : "text-ink-muted"}`}>out of 100</span>
      </div>
    </div>
  );
}
