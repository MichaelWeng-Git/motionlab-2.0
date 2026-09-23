"use client";

// The report's centerpiece: your real video with the skeleton/trail overlay,
// slow-mo, an Onform-style FOCUS annotation (ring + label on the problem joint),
// and SwingVision-style REP dots on the scrubber you can jump between.

import { useEffect, useRef, useState } from "react";
import { CONNECTIONS, type Frame } from "@/lib/analysis";
import { drawPoseDebug, drawSkeleton } from "@/lib/draw";

const SPEEDS = [
  { v: 1, label: "1×" },
  { v: 0.5, label: "0.5×" },
  { v: 0.25, label: "0.25×" },
];

export function VideoReplay({
  videoUrl,
  frames,
  focus,
  speed: speedProp,
  onSpeedChange,
  timeRef: timeRefProp,
  marker,
  seekRef,
  debugControls = false,
}: {
  videoUrl: string;
  frames: Frame[];
  focus?: { landmark: number; label: string } | null;
  speed?: number;                      // controlled speed (report page shares it with the 3D view)
  onSpeedChange?: (v: number) => void;
  timeRef?: { current: number };       // written every frame with currentTime — drives the synced 3D view
  // video-native coaching overlay: ONE issue at a time, drawn on the video near
  // its moment — joint dot + direction arrow + a short cue. No second person.
  marker?: { landmark: number; dir?: "up" | "forward" | "back" | "down"; cue: string; when: number } | null;
  seekRef?: { current: number | null }; // set to a 0-1 fraction to make the video jump there (consumed once)
  debugControls?: boolean;              // developer-only; enabled by ?debug=pose on the report
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const [speedState, setSpeedState] = useState(1);
  const speed = speedProp ?? speedState;
  const setSpeed = (v: number) => { setSpeedState(v); onSpeedChange?.(v); };
  const [duration, setDuration] = useState(0);
  const [showFocus, setShowFocus] = useState(false); // Focus ring/label retired from the UI
  const [debugPose, setDebugPose] = useState(false);

  const focusOnRef = useRef(showFocus); focusOnRef.current = showFocus;
  const focusRef = useRef(focus); focusRef.current = focus;
  const markerRef = useRef(marker); markerRef.current = marker;
  const debugPoseRef = useRef(debugPose); debugPoseRef.current = debugPose;

  function frameAt(t: number): Frame | null {
    if (!frames.length) return null;
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    const a = frames[Math.max(0, lo - 1)], b = frames[lo];
    return Math.abs(a.t - t) < Math.abs(b.t - t) ? a : b;
  }

  useEffect(() => {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    video.src = videoUrl;
    video.muted = true;
    video.playsInline = true;

    const onMeta = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      setDuration(video.duration);
    };
    video.addEventListener("loadedmetadata", onMeta);
    const onEnd = () => setPlaying(false);
    video.addEventListener("ended", onEnd);

    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const draw = () => {
      // external one-shot seek (tapping an improvement card jumps to its moment)
      if (seekRef && seekRef.current != null && video.duration) {
        video.currentTime = Math.max(0, Math.min(video.duration - 0.05, seekRef.current * video.duration));
        video.pause();
        setPlaying(false);
        seekRef.current = null;
      }
      const t = video.currentTime;
      if (timeRefProp) timeRefProp.current = t; // feed the synced 3D view
      if (scrubRef.current && document.activeElement !== scrubRef.current) scrubRef.current.value = String(t);
      if (timeRef.current) timeRef.current.textContent = `${t.toFixed(1)}s`;

      const w = canvas.width, h = canvas.height;
      const lw = Math.max(3, w / 240);
      ctx.clearRect(0, 0, w, h);
      const f = frameAt(t);
      if (f && f.lm.length && Math.abs(f.t - t) < 0.25) {
        // one view only: the skeleton (the Trail/Skeleton toggle was cut)
        if (debugPoseRef.current) drawPoseDebug(ctx, f.lm, w, h);
        else drawSkeleton(ctx, f.lm, w, h);

        // ——— Onform-style focus annotation ———
        const fc = focusRef.current;
        if (focusOnRef.current && fc) {
          const p = f.lm[fc.landmark];
          if (p) {
            const x = p.x * w, y = p.y * h;
            const pulse = 1 + 0.18 * Math.sin(performance.now() / 260);
            const r = lw * 5 * pulse;
            ctx.strokeStyle = "#FF4E1A";
            ctx.lineWidth = lw * 1.1;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = "rgba(53,133,90,0.35)";
            ctx.beginPath();
            ctx.arc(x, y, r + lw * 2.2, 0, Math.PI * 2);
            ctx.stroke();

            // label tag, kept inside the frame
            const label = fc.label;
            ctx.font = `700 ${Math.round(lw * 4)}px -apple-system, system-ui, sans-serif`;
            const padX = lw * 2.2, tagH = lw * 6.5;
            const tw = ctx.measureText(label).width + padX * 2;
            let tx = x + r + lw * 2;
            if (tx + tw > w) tx = x - r - lw * 2 - tw;
            const ty = Math.max(tagH, Math.min(h - lw, y - tagH / 2));
            roundRect(ctx, tx, ty - tagH / 2, tw, tagH, tagH / 2);
            ctx.fillStyle = "#17271F";
            ctx.fill();
            ctx.fillStyle = "#FFFFFF";
            ctx.textBaseline = "middle";
            ctx.fillText(label, tx + padX, ty);
          }
        }

        // ——— freeze-frame coaching shadow ———
        // Tap a "3 things" card → the video freezes on the clearest frame of that
        // flaw and shows the CORRECT position as a translucent green shadow limb.
        // No text, no buttons over the frame. Playback stays completely clean.
        const mk = markerRef.current;
        if (mk && video.duration && video.paused) {
          const mt = mk.when * video.duration;
          if (Math.abs(t - mt) < 3) {
            const p = f.lm[mk.landmark];
            if (p) {
              const x = p.x * w, y = p.y * h;
              // direction of the fix (defaults to "up" — most cues are lift/raise)
              const nose = f.lm[0], hipL = f.lm[23], hipR = f.lm[24];
              const facing = nose && hipL && hipR ? Math.sign(nose.x - (hipL.x + hipR.x) / 2) || 1 : 1;
              const D: Record<string, [number, number]> = {
                up: [0, -1], down: [0, 1], forward: [facing, 0], back: [-facing, 0],
              };
              const [dvx, dvy] = D[mk.dir ?? "up"];
              const len = lw * 9;
              const offX = dvx * len * 1.4, offY = dvy * len * 1.4;

              // dim the frame slightly so the shadow reads instantly
              ctx.fillStyle = "rgba(14,31,26,0.28)";
              ctx.fillRect(0, 0, w, h);

              // FULL-BODY GHOST — the mockup's "要改成这样" adapted to video:
              // clone this frame's whole skeleton, shift the joint being fixed
              // TOGETHER WITH everything it carries (fix the core → shoulders,
              // arms and head move as one), draw it as a translucent green person.
              const CARRY: Record<number, number[]> = {
                // torso/hips: the whole upper body rides along
                23: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22],
                24: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22],
                0:  [0,1,2,3,4,5,6,7,8,9,10],
                11: [11,13,15,17,19,21], 12: [12,14,16,18,20,22],
                13: [13,15,17,19,21],    14: [14,16,18,20,22],
                15: [15,17,19,21],       16: [16,18,20,22],
                25: [25,27,29,31],       26: [26,28,30,32],
                27: [27,29,31],          28: [28,30,32],
              };
              const carry = new Set(CARRY[mk.landmark] ?? [mk.landmark]);
              const ghost = f.lm.map((q, j) =>
                q ? { x: q.x * w + (carry.has(j) ? offX : 0), y: q.y * h + (carry.has(j) ? offY : 0), v: q.visibility ?? 1 } : null
              );
              ctx.strokeStyle = "rgba(98,217,139,0.6)";
              ctx.lineWidth = lw * 1.5;
              ctx.lineCap = "round";
              for (const [a, b] of CONNECTIONS) {
                const qa = ghost[a], qb = ghost[b];
                if (!qa || !qb || qa.v < 0.3 || qb.v < 0.3) continue;
                ctx.beginPath(); ctx.moveTo(qa.x, qa.y); ctx.lineTo(qb.x, qb.y); ctx.stroke();
              }
              // ghost head
              const gh = ghost[0];
              if (gh && gh.v >= 0.3) {
                ctx.beginPath();
                ctx.arc(gh.x, gh.y, lw * 3, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(98,217,139,0.45)";
                ctx.fill();
              }

              // the problem spot + a small arrow toward the fix
              ctx.beginPath();
              ctx.arc(x, y, lw * 2, 0, Math.PI * 2);
              ctx.fillStyle = "#FF3B5C";
              ctx.fill();
              const x2 = x + dvx * len, y2 = y + dvy * len;
              ctx.strokeStyle = "rgba(255,59,92,0.9)";
              ctx.lineWidth = lw * 1.3;
              ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
              const ah = lw * 2.6;
              ctx.beginPath();
              ctx.moveTo(x2, y2);
              ctx.lineTo(x2 - dvx * ah - dvy * ah * 0.6, y2 - dvy * ah + dvx * ah * 0.6);
              ctx.moveTo(x2, y2);
              ctx.lineTo(x2 - dvx * ah + dvy * ah * 0.6, y2 - dvy * ah - dvx * ah * 0.6);
              ctx.stroke();
            }
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("ended", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  function togglePlay() {
    const v = videoRef.current!;
    if (v.paused) {
      if (v.ended) v.currentTime = 0;
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  function seek(t: number) {
    const v = videoRef.current!;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, t));
  }

  return (
    <div>
      {/* stage */}
      <div className="relative overflow-hidden rounded-3xl bg-ink">
        <video ref={videoRef} className="w-full" playsInline muted onClick={togglePlay} />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {/* tap the frame to pause / tap again to resume — no overlay button,
            nothing covers the freeze-frame annotation */}
        <span
          ref={timeRef}
          className="absolute right-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-bold tabular-nums text-white backdrop-blur"
        >
          0.0s
        </span>
      </div>

      {/* scrubber */}
      <div className="mt-3 px-1">
        <input
          ref={scrubRef}
          type="range"
          min={0}
          max={duration || 0.01}
          step={0.01}
          defaultValue={0}
          onInput={(e) => seek(+(e.target as HTMLInputElement).value)}
          className="w-full accent-ink"
        />
      </div>

      {/* controls: play · speeds · trail/skeleton switch */}
      <div className="mt-2 flex items-center gap-2">
        {/* speed pills — compact */}
        <div className="flex gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s.v}
              onClick={() => setSpeed(s.v)}
              className={`rounded-full px-2.5 py-1.5 text-[11px] font-bold tabular-nums transition ${
                speed === s.v ? "bg-ink text-white" : "bg-white text-ink-muted shadow-soft"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

      </div>

      {debugControls && (
        <div className="mt-3 rounded-2xl bg-graphite px-4 py-3 text-white">
          <button onClick={() => setDebugPose((value) => !value)} className="flex w-full items-center justify-between text-left">
            <span><span className="block text-xs font-extrabold">Pose correction overlay</span><span className="mt-0.5 block text-[11px] font-bold text-white/55">Developer diagnostic · accepted, corrected, rebuilt</span></span>
            <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${debugPose ? "bg-volt-deep" : "bg-track"}`}><i className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${debugPose ? "left-6" : "left-1"}`} /></span>
          </button>
          {debugPose && <div className="mt-3 flex flex-wrap gap-3 border-t border-white/10 pt-3 text-[11px] font-bold text-white/70"><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-signal-good" />Accepted</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-signal-okay" />Corrected</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-signal-work" />Rebuilt</span></div>}
        </div>
      )}
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1.5" />
      <rect x="14" y="5" width="4" height="14" rx="1.5" />
    </svg>
  );
}
