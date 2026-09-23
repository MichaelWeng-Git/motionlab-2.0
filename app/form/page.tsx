"use client";

// FORM — the athlete's overall ability. The home card is just the curve; this
// is where it opens up: the hexagon profile, each capacity's own trend, and an
// honest note about what a single camera can and cannot measure.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSessions } from "@/lib/stats";
import { buildFormProfile, CAP_META, CAP_ORDER, type FormProfile } from "@/lib/form";
import type { AnalysisResult } from "@/lib/analysis";
import { SIGNAL, SURFACE } from "@/lib/palette";

// the app's one graphite ground — lib/palette SURFACE.graphite
const MINT = SIGNAL.good;

function Hex({ size = 218, values }: { size?: number; values: (number | null)[] }) {
  const cx = size / 2, cy = size / 2, R = size / 2 - 28;
  const pt = (i: number, r: number) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const ring = (f: number) => Array.from({ length: 6 }, (_, i) => pt(i, R * f).join(",")).join(" ");
  const shape = values.map((v, i) => pt(i, (R * Math.max(6, v ?? 6)) / 100).join(",")).join(" ");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible" }}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
      ))}
      {Array.from({ length: 6 }, (_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.10)" strokeWidth="1" />;
      })}
      <polygon points={shape} fill="rgba(127,217,174,0.22)" stroke={MINT} strokeWidth="2.5" strokeLinejoin="round" />
      {values.map((v, i) => {
        const [x, y] = pt(i, (R * Math.max(6, v ?? 6)) / 100);
        return <circle key={i} cx={x} cy={y} r="3.2" fill={v == null ? "rgba(255,255,255,0.25)" : MINT} />;
      })}
      {CAP_ORDER.map((k, i) => {
        const [x, y] = pt(i, R + 18);
        return (
          <text key={k} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.06em", fill: values[i] == null ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.55)" }}>
            {CAP_META[k].label}
          </text>
        );
      })}
    </svg>
  );
}


export default function FormPage() {
  const router = useRouter();
  const [p, setP] = useState<FormProfile | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    try {
      const ss = getSessions() as unknown as { id: string; sport?: string; date: string; report?: AnalysisResult }[];
      setP(buildFormProfile(ss));
    } catch { setP(null); }
  }, []);

  const values = p ? CAP_ORDER.map((k) => p.caps.find((c) => c.key === k)?.value ?? null) : [];
  const ranked = p ? [...p.caps].filter((c) => c.value != null).sort((a, b) => (b.value as number) - (a.value as number)) : [];
  const locked = p ? p.caps.filter((c) => c.value == null) : [];

  return (
    <div className="stagger min-h-full bg-graphite px-5 pb-10 pt-5 text-white">
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => router.push("/")}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-track text-base leading-none text-white ring-1 ring-inset ring-hair transition active:scale-95"
          aria-label="Back to Home"
        >
          ←
        </button>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-signal-good">Movement quality</p>
          <h1 className="font-golden text-[26px] leading-none">FORM</h1>
        </div>
      </div>

      {!p || p.form == null ? (
        <div className="mt-6 rounded-3xl bg-inset p-6 text-center ring-1 ring-inset ring-hair">
          <p className="font-golden text-lg text-white">NO PROFILE YET</p>
          <p className="mt-2 text-[13px] font-semibold text-white/55">Analyse one movement to reveal your first capacity.</p>
          <button onClick={() => router.push("/analyze")} className="mt-5 w-full rounded-full bg-white py-3.5 font-golden text-[13px] text-graphite">START ANALYSIS</button>
        </div>
      ) : (
        <>
          {/* hero: the hexagon IS the athlete */}
          <div className="relative mt-5 overflow-hidden rounded-3xl bg-inset px-5 pb-5 pt-4 text-white ring-1 ring-inset ring-hair" style={{ background: SURFACE.graphite }}>
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/22 to-transparent" />
            <div className="flex items-baseline justify-between">
              <span className="font-golden text-[13px] text-white/70">YOUR SHAPE</span>
              <span className="font-golden text-[12px] text-fg-muted">{p.sessions} SESSIONS</span>
            </div>
            <div className="relative mt-1 flex justify-center">
              <Hex values={values} />
              <div className="absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <p className="font-golden text-[40px] leading-none">{p.form}</p>
                  <p className="-mt-0.5 font-golden text-[11px] text-fg-muted">FORM</p>
                </div>
              </div>
            </div>
          </div>

          {/* strongest / weakest: the only interpretation before the raw capacities */}
          {ranked.length >= 2 && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-signal-good/15 p-3 ring-1 ring-inset ring-signal-good/20">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-signal-good">Strongest</p>
                <p className="mt-1 font-golden text-[17px] leading-none text-white">{CAP_META[ranked[0].key].label}</p>
              </div>
              <div className="rounded-xl bg-inset p-3 ring-1 ring-inset ring-hair">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-fg-muted">Build next</p>
                <p className="mt-1 font-golden text-[17px] leading-none text-white">{CAP_META[ranked[ranked.length - 1].key].label}</p>
              </div>
            </div>
          )}

          {/* every capacity: value, trend, and what it actually measures */}
          <section className="mt-6">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-golden text-[15px] leading-none text-white">CAPACITIES</h2>
              <span className="text-[11px] font-bold text-fg-muted">Tap for evidence</span>
            </div>
          <div className="overflow-hidden rounded-2xl bg-inset px-4 ring-1 ring-inset ring-hair">
            {ranked.map((c, i) => (
              <button
                key={c.key}
                onClick={() => setOpen(open === c.key ? null : c.key)}
                className={`block w-full py-4 text-left ${i ? "border-t border-white/10" : ""}`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-golden text-[14px] text-white">{CAP_META[c.key].label}</span>
                  <span className="font-golden text-[19px] leading-none text-white">{c.value}</span>
                </div>
                <div className="mt-2 h-[6px] overflow-hidden rounded-full bg-track">
                  <div className="h-full rounded-full bg-signal-good transition-all duration-700" style={{ width: `${c.value}%` }} />
                </div>
                {open === c.key && (
                  <div className="mt-3 rounded-xl bg-black/20 p-3">
                    <p className="text-[12px] font-semibold leading-relaxed text-white/70">{CAP_META[c.key].blurb}</p>
                    <p className="mt-2 text-[11px] font-bold text-fg-muted">Measured from: {CAP_META[c.key].source}</p>
                  </div>
                )}
              </button>
            ))}

            {locked.map((c) => (
              <div key={c.key} className="border-t border-white/10 py-4 opacity-45">
                <div className="flex items-baseline justify-between">
                  <span className="font-golden text-[13px] text-white">{CAP_META[c.key].label}</span>
                  <span className="text-[11px] font-bold text-white/50">Locked</span>
                </div>
              </div>
            ))}
          </div>
          </section>

        </>
      )}
    </div>
  );
}
