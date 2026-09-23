"use client";

// The 3D view. Preferred source = MotionBERT's lifted 3D skeleton (17 H36M joints):
// a transformer with a learned body prior, so rotating to an angle the camera never
// saw still looks like a real human pose. Falls back to raw image+depth (33 joints)
// for older analyses that predate the lifter.
// Renders by hand on a canvas — no 3D library. On-device only.

import { useEffect, useRef, useState } from "react";
import type { Frame } from "@/lib/analysis";
import { H36M_BONES, H36M_TORSO, MP_TO_H36M } from "@/lib/lift3d";

type P3 = { x: number; y: number; z: number };

// ——— skeleton definitions ———
type Skel = {
  bones: [number, number][];
  torso: number[];
  head: number;            // joint drawn as the head ball
  ground: number[];        // ankle/foot joints for the shadow
  drawNeck: boolean;       // MP has no neck bone → draw mid-shoulder→nose
  neckPair?: [number, number];
  focusMap?: Record<number, number>;
};

const MP_BONES: [number, number][] = [
  [11, 12], [23, 24], [11, 23], [12, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 31], [24, 26], [26, 28], [28, 32],
];
const MP_SKEL: Skel = { bones: MP_BONES, torso: [11, 12, 24, 23], head: 0, ground: [27, 28, 31, 32], drawNeck: true, neckPair: [11, 12] };
const H36M_SKEL: Skel = { bones: H36M_BONES, torso: H36M_TORSO, head: 10, ground: [3, 6], drawNeck: false, focusMap: MP_TO_H36M };

const AZ_FULL = Math.PI;   // lifted 3D is trustworthy → free 360° spin
const AZ_LIMITED = 1.15;   // raw fallback → clamp so we never expose the noisy back

export function PoseAvatar3D({
  frames,
  focus,
  initialAz = 0,
  speed = 1,
  syncRef,
}: {
  frames: Frame[];
  focus?: { landmark: number } | null;
  initialAz?: number; // starting azimuth in radians (0 = the video's own angle)
  speed?: number;     // playback rate — pass the video player's speed to stay in sync
  syncRef?: { current: number }; // video currentTime — when given, the 3D mirrors the
                                 // video frame-for-frame (same pose, same rhythm, scrubbing included)
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(true);
  const playRef = useRef(true); playRef.current = playing;
  const focusRef = useRef(focus); focusRef.current = focus;
  const speedRef = useRef(speed); speedRef.current = speed;

  const azRef = useRef(initialAz);
  const elRef = useRef(0);
  const draggingRef = useRef(false);
  const azLimitRef = useRef(AZ_LIMITED);

  const modelRef = useRef<{ pts: (P3 | null)[]; t: number }[]>([]);
  const fitRef = useRef({ extent: 2, cy: 0 });
  const skRef = useRef<Skel>(MP_SKEL);
  const visibleRef = useRef(true);
  const dirtyRef = useRef(true);

  useEffect(() => {
    const usable = frames.filter((f) => f.lm.length > 0);
    if (!usable.length) { modelRef.current = []; return; }

    const useLift = usable.some((f) => (f.pose3d?.length ?? 0) >= 17);
    skRef.current = useLift ? H36M_SKEL : MP_SKEL;
    azLimitRef.current = useLift ? AZ_FULL : AZ_LIMITED;

    let model: { pts: (P3 | null)[]; t: number }[];

    void 0; // (rigid-rebuild helpers are module-level, below the component)
    if (useLift) {
      // MotionBERT 3D — already cleaned by the lifter (upright, rigid bones, feet on
      // a stable ground plane). Do NOT re-center per frame: that would undo the
      // ground anchoring and bring the bobbing back.
      model = usable
        .filter((f) => (f.pose3d?.length ?? 0) >= 17)
        .map((f) => {
          const pts = f.pose3d!.map((p) => (p ? { x: p.x, y: p.y, z: p.z } : null));
          return { pts, t: f.t };
        });
      // RIGID-BONE rebuild: crop-box normalization makes the raw skeleton "breathe"
      // (camera zoom feel) because bone lengths vary per frame. Real bones don't.
      // Keep each frame's bone DIRECTIONS, rebuild positions from the pelvis out
      // with the clip-median length per bone — kills the scale pumping.
      rebuildRigid(model);
      // Drop anatomically impossible frames (subject left the frame / lock lost):
      // their skeletons explode to several body-heights and wreck the auto-fit.
      if (model.length > 4) {
        const dims = model.map((m) => {
          let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity, mxz = -Infinity;
          for (const p of m.pts) if (p) {
            mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x);
            mny = Math.min(mny, p.y); mxy = Math.max(mxy, p.y);
            mnz = Math.min(mnz, p.z); mxz = Math.max(mxz, p.z);
          }
          return { h: mxy - mny, w: mxx - mnx, d: mxz - mnz };
        });
        const sorted = dims.map((v) => v.h).sort((a, b) => a - b);
        const medH = sorted[sorted.length >> 1];
        model = model.filter((_, k) =>
          dims[k].h > 0.55 * medH && dims[k].h < 1.8 * medH &&
          dims[k].w < 1.6 * medH && dims[k].d < 1.6 * medH
        );
        // and drop frames whose pelvis leaps away from the local (±10 frame) median
        // position — the person-lock briefly grabbing someone else. Median is robust
        // as long as the impostor frames are the minority of any window.
        const px0 = model.map((m) => m.pts[0]?.x ?? 0);
        const medOf = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[s.length >> 1]; };
        model = model.filter((m, k) => {
          const win = px0.slice(Math.max(0, k - 10), Math.min(px0.length, k + 11));
          return Math.abs((m.pts[0]?.x ?? 0) - medOf(win)) < 1.0 * medH;
        });
      }
      // A runner crossing the frame drags the camera-true x across the whole clip,
      // which blows up the auto-fit and shrinks the avatar to a dot. Subtract the
      // SMOOTHED pelvis path (x/z only, ±15 frames) — gross travel goes, the
      // within-stride motion and the ground anchor (y untouched) stay.
      const M = model.length;
      if (M > 2) {
        const px = model.map((m) => m.pts[0]?.x ?? 0);
        const pz = model.map((m) => m.pts[0]?.z ?? 0);
        for (let k = 0; k < M; k++) {
          let sx = 0, sz = 0, n = 0;
          for (let w = Math.max(0, k - 15); w <= Math.min(M - 1, k + 15); w++) { sx += px[w]; sz += pz[w]; n++; }
          const cx = sx / n, cz = sz / n;
          for (const p of model[k].pts) if (p) { p.x -= cx; p.z -= cz; }
        }
      }
    } else {
      // fallback: x,y from the reliable image skeleton, z from world/lm depth
      const med = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
      const hasWorld = usable.some((f) => (f.world?.length ?? 0) >= 33);
      const tImg: number[] = [], tWorld: number[] = [];
      for (const f of usable) {
        const a = f.lm[11], b = f.lm[12], c = f.lm[23], d = f.lm[24];
        if (a && b && c && d) tImg.push(Math.hypot((a.x + b.x) / 2 - (c.x + d.x) / 2, (a.y + b.y) / 2 - (c.y + d.y) / 2));
        const wa = f.world?.[11], wb = f.world?.[12], wc = f.world?.[23], wd = f.world?.[24];
        if (wa && wb && wc && wd) tWorld.push(Math.hypot((wa.x + wb.x) / 2 - (wc.x + wd.x) / 2, (wa.y + wb.y) / 2 - (wc.y + wd.y) / 2));
      }
      const ratio = hasWorld && med(tWorld) ? med(tImg) / med(tWorld) : 1;
      model = usable.map((f) => {
        const pts = Array.from({ length: 33 }, (_, i): P3 | null => {
          const p = f.lm[i];
          if (!p) return null;
          const wz = f.world?.[i]?.z;
          const z = hasWorld && wz != null ? -wz * ratio : -(p.z ?? 0);
          return { x: p.x, y: -p.y, z };
        });
        const hl = pts[23], hr = pts[24];
        const c = hl && hr ? { x: (hl.x + hr.x) / 2, y: (hl.y + hr.y) / 2, z: (hl.z + hr.z) / 2 } : { x: 0, y: 0, z: 0 };
        for (const p of pts) if (p) { p.x -= c.x; p.y -= c.y; p.z -= c.z; }
        return { pts, t: f.t };
      });
    }

    const N = model.length;
    const J = model[0].pts.length;

    // temporal smoothing (light — sources are already fairly clean)
    const half = useLift ? 1 : 1;
    for (let j = 0; j < J; j++) {
      for (const axis of ["x", "y", "z"] as const) {
        const vals = model.map((m) => m.pts[j]?.[axis]);
        for (let k = 0; k < N; k++) {
          if (model[k].pts[j] == null) continue;
          let sum = 0, n = 0;
          for (let w = Math.max(0, k - half); w <= Math.min(N - 1, k + half); w++) {
            const v = vals[w]; if (v != null) { sum += v; n++; }
          }
          if (n) model[k].pts[j]![axis] = sum / n;
        }
      }
    }

    // auto-fit
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const m of model) for (const p of m.pts) if (p) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    fitRef.current = { extent, cy: (minY + maxY) / 2 };
    modelRef.current = model;
    dirtyRef.current = true;
  }, [frames]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (w && h) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      dirtyRef.current = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(
      ([e]) => { visibleRef.current = e.isIntersecting; if (e.isIntersecting) dirtyRef.current = true; },
      { threshold: 0.01 }
    );
    io.observe(canvas);

    let raf = 0, last = performance.now(), playhead = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const animating = playRef.current || draggingRef.current;
      if (!visibleRef.current || (!animating && !dirtyRef.current)) { last = now; return; }
      const model = modelRef.current;
      const sk = skRef.current;
      // real elapsed time × playback speed — a dropped frame must NOT slow the clip
      // down (the old tight clamp turned lag into slow motion). 0.25s cap only guards
      // tab-switch jumps.
      const dt = Math.min(0.25, (now - last) / 1000) * speedRef.current;
      last = now; dirtyRef.current = false;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      if (model.length >= 2) {
        const loopEnd = model[model.length - 1].t;
        if (syncRef) {
          playhead = Math.max(0, Math.min(loopEnd, syncRef.current)); // mirror the video exactly
        } else if (playRef.current) {
          playhead += dt;
          if (playhead > loopEnd) playhead = 0;
        }
        let fi = 0;
        while (fi < model.length - 2 && model[fi + 1].t <= playhead) fi++;
        const f0 = model[fi], f1 = model[fi + 1] ?? f0;
        const u = Math.max(0, Math.min(1, (playhead - f0.t) / ((f1.t - f0.t) || 1)));
        const pts: (P3 | null)[] = f0.pts.map((p, i) => {
          const q = f1.pts[i];
          if (!p) return q ?? null;
          if (!q) return p;
          return { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u, z: p.z + (q.z - p.z) * u };
        });

        const { extent, cy: modelCy } = fitRef.current;
        const az = azRef.current, el = elRef.current;
        const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
        const cx = W / 2, cy = H * 0.5;
        const scale = (Math.min(W, H) * 0.66) / extent;

        const project = (p: P3) => {
          const y0 = p.y - modelCy;
          const rx = p.x * ca + p.z * sa;
          let rz = -p.x * sa + p.z * ca;
          const ry = y0 * ce - rz * se;
          rz = y0 * se + rz * ce;
          return { sx: cx + rx * scale, sy: cy - ry * scale, depth: rz };
        };
        const proj = pts.map((p) => (p ? project(p) : null));

        let dmin = Infinity, dmax = -Infinity;
        for (const q of proj) if (q) { dmin = Math.min(dmin, q.depth); dmax = Math.max(dmax, q.depth); }
        const shade = (d: number) => (d - dmin) / ((dmax - dmin) || 1);

        // ground shadow
        let feetY = -Infinity; const feet: { sx: number }[] = [];
        for (const i of sk.ground) { const q = proj[i]; if (q) { feetY = Math.max(feetY, q.sy); feet.push(q); } }
        if (feet.length) {
          const fx = feet.reduce((a, b) => a + b.sx, 0) / feet.length;
          ctx.beginPath();
          ctx.ellipse(fx, feetY + 6 * dpr, scale * extent * 0.16, scale * extent * 0.03, 0, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(14,31,26,0.12)"; ctx.fill();
        }

        // torso fill
        if (sk.torso.every((i) => proj[i])) {
          ctx.beginPath();
          sk.torso.forEach((i, k) => { const q = proj[i]!; k ? ctx.lineTo(q.sx, q.sy) : ctx.moveTo(q.sx, q.sy); });
          ctx.closePath();
          ctx.fillStyle = "rgba(53,133,90,0.16)"; ctx.fill();
        }

        // neck (MP fallback only — H36M already has neck bones)
        if (sk.drawNeck && sk.neckPair && proj[sk.neckPair[0]] && proj[sk.neckPair[1]] && proj[sk.head]) {
          const a = proj[sk.neckPair[0]]!, b = proj[sk.neckPair[1]]!;
          ctx.strokeStyle = "hsl(151 45% 60%)"; ctx.lineWidth = 6 * dpr; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo((a.sx + b.sx) / 2, (a.sy + b.sy) / 2); ctx.lineTo(proj[sk.head]!.sx, proj[sk.head]!.sy); ctx.stroke();
        }

        // bones, back-to-front
        const bones = sk.bones
          .map(([a, b]) => ({ qa: proj[a], qb: proj[b] }))
          .filter((s) => s.qa && s.qb)
          .sort((s1, s2) => (s1.qa!.depth + s1.qb!.depth) - (s2.qa!.depth + s2.qb!.depth));
        for (const s of bones) {
          const near = (shade(s.qa!.depth) + shade(s.qb!.depth)) / 2;
          ctx.strokeStyle = `hsl(151 46% ${38 + near * 40}%)`;
          ctx.lineWidth = (6 + near * 4) * dpr; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(s.qa!.sx, s.qa!.sy); ctx.lineTo(s.qb!.sx, s.qb!.sy); ctx.stroke();
        }

        // head
        if (proj[sk.head]) {
          const near = shade(proj[sk.head]!.depth);
          ctx.beginPath(); ctx.arc(proj[sk.head]!.sx, proj[sk.head]!.sy, scale * extent * 0.052, 0, Math.PI * 2);
          ctx.fillStyle = `hsl(151 44% ${58 + near * 14}%)`; ctx.fill();
        }

        // joints (skip head), near on top
        const jointIdx = [...new Set(sk.bones.flat())].filter((i) => i !== sk.head);
        const rawFocus = focusRef.current?.landmark;
        const focusIdx = rawFocus == null ? null : sk.focusMap ? sk.focusMap[rawFocus] ?? null : rawFocus;
        const js = jointIdx.map((i) => ({ i, q: proj[i] })).filter((j) => j.q).sort((a, b) => a.q!.depth - b.q!.depth);
        for (const j of js) {
          const near = shade(j.q!.depth);
          const r = (3 + near * 3) * dpr;
          const isFocus = focusIdx != null && j.i === focusIdx;
          if (isFocus) {
            const pulse = 1 + 0.25 * Math.sin(now / 260);
            ctx.beginPath(); ctx.arc(j.q!.sx, j.q!.sy, r * 2.6 * pulse, 0, Math.PI * 2);
            ctx.strokeStyle = "#FF4E1A"; ctx.lineWidth = 2 * dpr; ctx.stroke();
          }
          ctx.beginPath(); ctx.arc(j.q!.sx, j.q!.sy, r, 0, Math.PI * 2);
          ctx.fillStyle = isFocus ? "#FF4E1A" : `hsl(151 40% ${86 - near * 24}%)`; ctx.fill();
        }
      }
    };
    raf = requestAnimationFrame(draw);

    let px = 0, py = 0;
    const down = (e: PointerEvent) => { e.preventDefault(); draggingRef.current = true; px = e.clientX; py = e.clientY; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      const lim = azLimitRef.current;
      azRef.current = Math.max(-lim, Math.min(lim, azRef.current + (e.clientX - px) * 0.012));
      elRef.current = Math.max(-0.4, Math.min(0.4, elRef.current + (e.clientY - py) * 0.005));
      px = e.clientX; py = e.clientY;
      dirtyRef.current = true;
    };
    const up = (e: PointerEvent) => { draggingRef.current = false; dirtyRef.current = true; try { canvas.releasePointerCapture(e.pointerId); } catch {} };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, []);

  return (
    <div className="relative overflow-hidden rounded-3xl bg-[radial-gradient(120%_100%_at_50%_0%,#F3F7F4_0%,#E7EEE9_100%)]">
      <canvas ref={canvasRef} className="block h-[320px] w-full cursor-grab touch-none select-none active:cursor-grabbing" />
      <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-ink-muted backdrop-blur">
        <RotateIcon /> Drag to rotate
      </span>
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 p-3">
        {!syncRef && (
          <button
            onClick={() => setPlaying((p) => !p)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-white shadow-soft transition active:scale-95"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
        )}
        <button
          onClick={() => { azRef.current = 0; elRef.current = 0; dirtyRef.current = true; }}
          className="rounded-full bg-white/85 px-3 py-2 text-xs font-bold text-on-action shadow-soft backdrop-blur transition active:scale-95"
        >
          Recenter
        </button>
      </div>
    </div>
  );
}

function RotateIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v4h-4" />
    </svg>
  );
}
function PlayIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5z" /></svg>;
}
function PauseIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.5" /><rect x="14" y="5" width="4" height="14" rx="1.5" /></svg>;
}

// ——— rigid-bone helpers (H36M-17) ———
// Kinematic tree, parents before children so a single pass rebuilds the chain.
const H36M_TREE: [number, number][] = [
  [1, 0], [2, 1], [3, 2],      // right leg
  [4, 0], [5, 4], [6, 5],      // left leg
  [7, 0], [8, 7], [9, 8], [10, 8], // spine, neck, head
  [11, 8], [12, 11], [13, 12], // left arm
  [14, 8], [15, 14], [16, 15], // right arm
];

type RigidModel = { pts: (P3 | null)[]; t: number }[];

// median length of every bone across the clip — the skeleton's "true" anatomy
export function medianBoneLengths(model: RigidModel): number[] {
  return H36M_TREE.map(([c, p]) => {
    const ls: number[] = [];
    for (const m of model) {
      const a = m.pts[p], b = m.pts[c];
      if (a && b) ls.push(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
    ls.sort((x, y) => x - y);
    return ls.length ? ls[ls.length >> 1] : 0;
  });
}

// keep each frame's bone DIRECTIONS, rebuild positions with the given lengths.
// Fixing lengths removes the per-frame scale "breathing" (crop-box zoom feel)
// and — with someone else's lengths — retargets a pro's motion onto the user's
// proportions so the two avatars read as the same body.
export function rebuildWithLengths(model: RigidModel, lengths: number[]) {
  for (const m of model) {
    const src = m.pts;
    const out: (P3 | null)[] = new Array(17).fill(null);
    out[0] = src[0] ? { ...src[0] } : null;
    if (!out[0]) continue;
    H36M_TREE.forEach(([c, p], bi) => {
      const sa = src[p], sb = src[c], np = out[p];
      if (!sa || !sb || !np) return;
      const dx = sb.x - sa.x, dy = sb.y - sa.y, dz = sb.z - sa.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-6) { out[c] = { ...np }; return; }
      const L = lengths[bi] || d;
      out[c] = { x: np.x + (dx / d) * L, y: np.y + (dy / d) * L, z: np.z + (dz / d) * L };
    });
    m.pts = out;
  }
}

function rebuildRigid(model: RigidModel) {
  if (model.length < 5) return;
  rebuildWithLengths(model, medianBoneLengths(model));
}
