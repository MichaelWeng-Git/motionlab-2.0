import type { ReactNode } from "react";
import { levelForXp } from "@/lib/xp";

// Tier colours are light (see lib/xp.ts), so anything FILLED with one carries
// dark type. White on them measures 2.5–3.6:1. The ring track and the badge
// border are shell colours too: a dark track on graphite is invisible, and a
// fixed #ECEFEC border was a bright halo left over from the paper design.

export function LevelBadge({ xp, compact = false }: { xp: number; compact?: boolean }) {
  const level = levelForXp(xp);
  return <span className={`inline-flex items-center gap-1.5 rounded-full font-black ${compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-[11px]"}`} style={{ color: level.color, background: `${level.color}18` }}><span className="font-golden text-[1.15em]">L{level.level}</span>{level.name.toUpperCase()}</span>;
}

export function XpAvatarRing({ xp, children, size = 78 }: { xp: number; children: ReactNode; size?: number }) {
  const level = levelForXp(xp);
  const stroke = 4, r = (size - stroke) / 2, c = Math.PI * 2 * r;
  return <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
    <svg className="absolute inset-0 -rotate-90" width={size} height={size}><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth={stroke} /><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={level.color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * level.progress} ${c}`} /></svg>
    <div className="grid place-items-center overflow-hidden rounded-full" style={{ width: size - 12, height: size - 12 }}>{children}</div>
    <span className="absolute -bottom-1 rounded-full border-2 border-graphite px-2 py-0.5 font-golden text-[11px] text-on-action" style={{ background: level.color }}>LV {level.level}</span>
  </div>;
}
