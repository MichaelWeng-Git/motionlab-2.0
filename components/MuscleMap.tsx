"use client";

// The full-body muscle map — the user's GPT anatomy art, calibrated: each
// image's FIGURE bounding box was pixel-measured, so every view renders at
// the same body height with feet aligned, regardless of canvas margins.
// Heat spots live in figure-relative coordinates (% of the body box), so
// red lands ON muscles. Rotation crossfades adjacent views instead of
// hard-swapping — a body turning, not paper flipping.

import { useRef, useState } from "react";
import type { MuscleKey, MuscleLoad } from "@/lib/muscles";

type FaceName = "front" | "back" | "side-r" | "side-l";

// pixel-measured figure bounds within each PNG (fractions of the canvas)
const CAL: Record<FaceName, { x: number; y: number; w: number; h: number; iw: number; ih: number }> = {
  front: { x: 0.225, y: 0.0422, w: 0.545, h: 0.9103, iw: 911, ih: 1726 },
  back: { x: 0.21, y: 0.0345, w: 0.565, h: 0.8966, iw: 913, ih: 1723 },
  "side-r": { x: 0.34, y: 0.0345, w: 0.285, h: 0.8621, iw: 914, ih: 1721 },
  "side-l": { x: 0.35, y: 0.0371, w: 0.29, h: 0.8568, iw: 913, ih: 1723 },
};

// set true only while calibrating spot coordinates (lights every muscle)
const DBG = false;

type Spot = { k: MuscleKey; x: number; y: number; w: number; h: number; r?: number }; // % of the FIGURE box (+rotation°)

const FRONT_SPOTS: Spot[] = [
  { k: "shoulders", x: 16, y: 15, w: 20, h: 7 }, { k: "shoulders", x: 84, y: 15, w: 20, h: 7 },
  { k: "chest", x: 50, y: 20, w: 36, h: 10 },
  { k: "arms", x: 11, y: 25, w: 14, h: 11 }, { k: "arms", x: 89, y: 25, w: 14, h: 11 },
  { k: "arms", x: 8, y: 37, w: 12, h: 10 }, { k: "arms", x: 92, y: 37, w: 12, h: 10 },
  { k: "core", x: 50, y: 31, w: 24, h: 17 },
  { k: "quads", x: 38, y: 54, w: 16, h: 16 }, { k: "quads", x: 62, y: 54, w: 16, h: 16 },
  { k: "calves", x: 37, y: 79, w: 12, h: 11 }, { k: "calves", x: 63, y: 79, w: 12, h: 11 },
];

const BACK_SPOTS: Spot[] = [
  { k: "shoulders", x: 15, y: 15, w: 19, h: 7 }, { k: "shoulders", x: 85, y: 15, w: 19, h: 7 },
  { k: "back", x: 50, y: 23, w: 46, h: 19 },
  { k: "arms", x: 10, y: 26, w: 13, h: 11 }, { k: "arms", x: 90, y: 26, w: 13, h: 11 },
  { k: "arms", x: 8, y: 38, w: 11, h: 10 }, { k: "arms", x: 92, y: 38, w: 11, h: 10 },
  { k: "glutes", x: 50, y: 45, w: 30, h: 10 },
  { k: "hamstrings", x: 39, y: 57, w: 17, h: 13 }, { k: "hamstrings", x: 61, y: 57, w: 17, h: 13 },
  { k: "calves", x: 38, y: 78, w: 13, h: 11 }, { k: "calves", x: 62, y: 78, w: 13, h: 11 },
];

// side-r faces RIGHT: front of the body is the right edge of the figure box
const SIDE_R_SPOTS: Spot[] = [
  { k: "shoulders", x: 45, y: 15, w: 34, h: 8 },
  { k: "chest", x: 70, y: 19, w: 24, h: 9 },
  { k: "back", x: 30, y: 24, w: 24, h: 14 },
  { k: "arms", x: 48, y: 27, w: 24, h: 13 },
  { k: "arms", x: 44, y: 39, w: 18, h: 10 },
  { k: "core", x: 66, y: 31, w: 20, h: 13 },
  { k: "glutes", x: 28, y: 45, w: 28, h: 11 },
  { k: "quads", x: 60, y: 55, w: 24, h: 15 },
  { k: "hamstrings", x: 34, y: 57, w: 22, h: 13 },
  { k: "calves", x: 42, y: 78, w: 22, h: 11 },
];
const SIDE_L_SPOTS: Spot[] = SIDE_R_SPOTS.map((s) => ({ ...s, x: 100 - s.x }));

const SPOTS: Record<FaceName, Spot[]> = {
  front: FRONT_SPOTS, back: BACK_SPOTS, "side-r": SIDE_R_SPOTS, "side-l": SIDE_L_SPOTS,
};

function Face({ name, load, H }: { name: FaceName; load: MuscleLoad; H: number }) {
  const c = CAL[name];
  const Rh = H / c.h;
  const Rw = Rh * (c.iw / c.ih);
  return (
    <div className="h-full w-full">
      <div className="relative h-full w-full overflow-visible">
        {/* cut-out art: exterior is transparent, the body interior stays
            opaque so it occludes the far side of the box */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/muscles/${name}.png`}
          alt=""
          draggable={false}
          className="pointer-events-none"
          style={{ position: "absolute", width: Rw, height: Rh, left: -c.x * Rw, top: -c.y * Rh, maxWidth: "none" }}
        />
        {SPOTS[name].map((s, i) => {
          const v = DBG ? 0.85 : load[s.k] ?? 0;
          if (v < 0.04) return null;
          return (
            <div
              key={i}
              className="absolute rounded-full"
              style={{
                left: `${s.x - s.w / 2}%`,
                top: `${s.y - s.h / 2}%`,
                width: `${s.w}%`,
                height: `${s.h}%`,
                transform: s.r ? `rotate(${s.r}deg)` : undefined,
                background: `radial-gradient(closest-side, rgba(224,82,63,${(0.55 * Math.min(1, v)).toFixed(2)}) 55%, rgba(224,82,63,0))`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// drag to spin: the four calibrated views stand as the four faces of a real
// CSS-3D box (perspective + translateZ at true body half-widths), so every
// angle — 45° included — is a continuous dimensional turn, never a photo
// swap. Momentum on release, stops at ANY angle. No auto-motion.
export function MuscleSpin({ load, height = 212 }: { load: MuscleLoad; height?: number }) {
  const [angle, setAngle] = useState(0);
  const drag = useRef(false);
  const lastX = useRef(0);
  const vel = useRef(0);
  const raf = useRef<number | null>(null);

  const settle = () => {
    raf.current = null;
    setAngle((prev) => {
      const a = prev + vel.current;
      vel.current *= 0.95;
      if (Math.abs(vel.current) < 0.05) {
        vel.current = 0;
        return a;
      }
      raf.current = requestAnimationFrame(settle);
      return a;
    });
  };

  const faceW = (n: FaceName) => {
    const c = CAL[n];
    return ((height / c.h) * c.iw) / c.ih * c.w;
  };
  const PLANES: { name: FaceName; rot: number }[] = [
    { name: "front", rot: 0 },
    { name: "side-l", rot: 90 },
    { name: "back", rot: 180 },
    { name: "side-r", rot: 270 },
  ];

  // signed angle between this face's normal and the viewer, in (-180, 180]
  const a = ((angle % 360) + 360) % 360;
  const offset = (rot: number) => {
    let d = (a + rot) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  };

  return (
    <div
      className="mx-auto cursor-grab touch-pan-y select-none active:cursor-grabbing"
      style={{ width: height * 0.62, perspective: "900px" }}
      onPointerDown={(e) => {
        drag.current = true;
        lastX.current = e.clientX;
        vel.current = 0;
        if (raf.current) { cancelAnimationFrame(raf.current); raf.current = null; }
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const dx = (e.clientX - lastX.current) * 0.55;
        lastX.current = e.clientX;
        vel.current = Math.max(-10, Math.min(10, dx)); // flick cap: fast but never wild
        setAngle((p) => p + dx);
      }}
      onPointerUp={() => {
        drag.current = false;
        if (!raf.current) raf.current = requestAnimationFrame(settle);
      }}
      onPointerCancel={() => {
        drag.current = false;
        if (!raf.current) raf.current = requestAnimationFrame(settle);
      }}
    >
      <div className="relative" style={{ height }}>
        {/* NOT a textured column: every view shares ONE spine axis. Each face
            yaws by its own offset from the viewer around that common center
            and cos-fades — the person turns in place, heels planted. */}
        {PLANES.map((p) => ({ p, off: offset(p.rot) }))
          .filter(({ off }) => Math.abs(off) < 90)
          .sort((x, y) => Math.abs(y.off) - Math.abs(x.off)) // most-facing paints on top
          .map(({ p, off }) => {
            const w = faceW(p.name);
            const opacity = Math.pow(Math.cos((off * Math.PI) / 180), 0.7);
            return (
              <div key={p.name} className="absolute inset-0 flex items-end justify-center" style={{ opacity: opacity.toFixed(3) }}>
                <div style={{ width: w, height, transform: `perspective(900px) rotateY(${off.toFixed(2)}deg)` }}>
                  <Face name={p.name} load={load} H={height} />
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
