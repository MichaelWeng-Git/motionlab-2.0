"use client";

// FORM — the athlete's overall ability. The home card is just the curve; this
// is where it opens up: the hexagon profile, each capacity's own trend, and an
// honest note about what a single camera can and cannot measure.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSessions } from "@/lib/stats";
import { buildFormProfile, CAP_META, CAP_ORDER, type FormProfile } from "@/lib/form";
import type { AnalysisResult } from "@/lib/analysis";
import { SURFACE } from "@/lib/palette";

// the app's one graphite ground — lib/palette SURFACE.graphite
const MINT = "#7FD9AE";
const DEEP = "#2E9E6B";

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
    <div className="stagger px-5 pb-10 pt-3">
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => router.push("/")}
          className="flex h-7 w-11 items-center justify-center rounded-full bg-white text-[13px] leading-none text-ink shadow-soft transition active:scale-95"
        >
          ←
        </button>
        <h1 className="font-golden text-[24px] leading-none">Form</h1>
      </div>

      {!p || p.form == null ? (
        <div className="mt-6 rounded-3xl bg-white p-6 text-center shadow-soft">
          <p className="font-golden text-lg text-ink">NO PROFILE YET</p>
          <p className="mt-2 text-[13px] font-semibold text-ink-soft">
            Analyse a video and your athletic profile starts building.
          </p>
        </div>
      ) : (
        <>
          {/* hero: the hexagon IS the athlete */}
          <div className="mt-3 overflow-hidden rounded-2xl px-5 py-5 text-white shadow-lift" style={{ background: SURFACE.graphite }}>
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/22 to-transparent" />
            <div className="flex items-baseline justify-between">
              <span className="font-golden text-[13px] text-white/55">ATHLETIC PROFILE</span>
              <span className="text-[11px] font-bold text-white/35">{p.sessions} sessions</span>
            </div>
            <div className="relative mt-1 flex justify-center">
              <Hex values={values} />
              <div className="absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <p className="font-golden text-[40px] leading-none">{p.form}</p>
                  <p className="-mt-0.5 font-golden text-[10px] text-white/30">FORM</p>
                </div>
              </div>
            </div>
          </div>

          {/* strongest / weakest, in one plain sentence */}
          {ranked.length >= 2 && (
            <div className="mt-3 rounded-2xl bg-volt-mist px-4 py-3">
              <p className="text-[13px] font-bold leading-snug text-[#1E4D33]">
                {CAP_META[ranked[0].key].label.toLowerCase()} is your strongest quality.{" "}
                {CAP_META[ranked[ranked.length - 1].key].label.toLowerCase()} is where there&rsquo;s most to gain.
              </p>
            </div>
          )}

          {/* every capacity: value, trend, and what it actually measures */}
          <div className="mt-3 rounded-2xl bg-white p-4 shadow-soft">
            {ranked.map((c, i) => (
              <button
                key={c.key}
                onClick={() => setOpen(open === c.key ? null : c.key)}
                className={`block w-full text-left ${i ? "mt-3 border-t border-black/[0.06] pt-3" : ""}`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-golden text-[13px] text-ink">{CAP_META[c.key].label}</span>
                  <span className="font-golden text-[16px] leading-none text-ink">{c.value}</span>
                </div>
                <div className="mt-1.5 h-[6px] overflow-hidden rounded-full bg-black/[0.07]">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${c.value}%`, background: DEEP }} />
                </div>
                {open === c.key && (
                  <div className="mt-2">
                    <p className="text-[12px] font-semibold leading-relaxed text-ink-soft">{CAP_META[c.key].blurb}</p>
                    <p className="mt-1 text-[11px] font-bold text-ink-muted">Measured from: {CAP_META[c.key].source}</p>
                  </div>
                )}
              </button>
            ))}

            {locked.map((c) => (
              <div key={c.key} className="mt-3 border-t border-black/[0.06] pt-3 opacity-45">
                <div className="flex items-baseline justify-between">
                  <span className="font-golden text-[13px] text-ink">{CAP_META[c.key].label}</span>
                  <span className="text-[11px] font-bold text-ink-muted">Locked</span>
                </div>
                <p className="mt-1 text-[11px] font-semibold text-ink-muted">
                  Analyse a new video to unlock — needs the biomechanics layer.
                </p>
              </div>
            ))}
          </div>

        </>
      )}
    </div>
  );
}
