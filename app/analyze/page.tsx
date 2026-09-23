"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { recordSession } from "@/lib/stats";
import { clearAnalysis, computeAnalysis, saveAnalysis, setReplay, type AnalysisResult, type Frame } from "@/lib/analysis";
import { clearReplayDb, saveReplayDb } from "@/lib/replay-db";
import { refinePose } from "@/lib/pose-post";
import { createEnsemble, probePeople, type PersonSeed } from "@/lib/ensemble";
import { createLifter } from "@/lib/lift3d";
import { createRefiner, spreadRefinement } from "@/lib/pose2d-refine";
import { drawSkeleton } from "@/lib/draw";
import { SIGNAL, SURFACE } from "@/lib/palette";
import { DEFAULT_SESSION_MIN, sessionSecondsOf } from "@/lib/workouts";
import { getPreferences } from "@/lib/preferences";

// Real skeleton tracking: MediaPipe Pose runs in the browser, frame by frame,
// drawing the skeleton over the user's actual video. No servers, no API keys.

type Step = "pick" | "who" | "processing" | "duration" | "error" | "notsport";

const STAGES = [
  { label: "Preparing video", detail: "Models load on this device" },
  { label: "Tracking movement", detail: "Up to 300 sampled frames" },
  { label: "Cleaning motion", detail: "Occlusions and tracking errors" },
  { label: "Building biomechanics", detail: "3D joints and measured mechanics" },
  { label: "Optional cloud refinement", detail: "Only when enabled" },
  { label: "Writing coaching notes", detail: "Measurements stay deterministic" },
];

export default function Analyze() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [step, setStep] = useState<Step>("pick");
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [seenDesc, setSeenDesc] = useState(""); // what the AI saw when it's not a sport
  const cancelRef = useRef(false);
  const runIdRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const [fileMeta, setFileMeta] = useState<{ name: string; bytes: number } | null>(null);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [sessionMinutes, setSessionMinutes] = useState(DEFAULT_SESSION_MIN);
  const pendingRef = useRef<{ final: AnalysisResult; cover?: string } | null>(null);

  const pickedFileRef = useRef<File | null>(null);
  const seedRef = useRef<PersonSeed | null>(null);
  const [picker, setPicker] = useState<{ img: string; people: PersonSeed[] } | null>(null);
  const [pickerT, setPickerT] = useState(0); // the timestamp the picker frame came from

  function finishAnalysis(minutes?: number) {
    const pending = pendingRef.current;
    if (!pending) return;
    recordSession({
      sport: pending.final.sport ?? "Practice",
      action: pending.final.action ?? "Session",
      score: pending.final.score,
      cover: pending.cover,
      sessionSeconds: minutes && minutes > 0 ? Math.round(minutes * 60) : undefined,
      report: pending.final,
    });
    pendingRef.current = null;
    import("@/lib/muscles").then((m) => m.fetchMuscleState().catch(() => {})).catch(() => {});
    try { sessionStorage.setItem("ml_reveal_pending", "1"); } catch {}
    router.push("/report/latest");
  }

  function onFilePicked(file: File) {
    if (!file.type.startsWith("video/")) {
      setErrorMsg("Choose a video file to analyse.");
      setStep("error");
      return;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    clearAnalysis(); // new video = clean slate, no stale report
    clearReplayDb();
    pickedFileRef.current = file;
    seedRef.current = null;
    setPicker(null);
    setFileMeta({ name: file.name, bytes: file.size });
    try { setCloudEnabled(getPreferences().cloud3d); } catch { setCloudEnabled(false); }
    setVideoUrl(URL.createObjectURL(file));
    setStage(0);
    setProgress(0);
    setStep("who");
  }

  function cancelAnalysis() {
    cancelRef.current = true;
    runIdRef.current++;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    seedRef.current = null;
    setPicker(null);
    setStage(0);
    setProgress(0);
    setStep("pick");
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    setFileMeta(null);
    pendingRef.current = null;
  }

  useEffect(() => () => {
    requestAbortRef.current?.abort();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  // — "who are we watching?" probe: if several people are in frame, the user
  // taps the one to analyze BEFORE any tracking starts (auto-lock is a coin
  // flip with two runners side by side). One person → skip straight through.
  useEffect(() => {
    if (step !== "who" || !videoUrl) return;
    let dead = false;
    (async () => {
      try {
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        await new Promise<void>((res, rej) => {
          v.onloadedmetadata = () => res();
          v.onerror = () => rej(new Error("Couldn't read this video file."));
          v.src = videoUrl;
        });
        const probe = await probePeople(v, [0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.82].map((f) => f * v.duration));
        if (dead) return;
        if (probe.people.length <= 1) {
          seedRef.current = probe.people[0] ? { ...probe.people[0], t: probe.t } : null;
          setStep("processing");
          return;
        }
        setPickerT(probe.t);
        // capture the probe frame for the picker
        const c = document.createElement("canvas");
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        await new Promise<void>((res) => {
          const timer = setTimeout(res, 2000);
          v.addEventListener("seeked", () => { clearTimeout(timer); res(); }, { once: true });
          v.currentTime = probe.t;
        });
        c.getContext("2d")!.drawImage(v, 0, 0);
        if (dead) return;
        setPicker({ img: c.toDataURL("image/jpeg", 0.85), people: probe.people });
      } catch (e) {
        console.warn("[probe] failed — continuing without picker", e);
        if (!dead) setStep("processing"); // probe is best-effort — never blocks analysis
      }
    })();
    return () => { dead = true; };
  }, [step, videoUrl]);

  // the real pipeline
  useEffect(() => {
    if (step !== "processing" || !videoUrl) return;
    cancelRef.current = false;
    const runId = ++runIdRef.current;
    const active = () => !cancelRef.current && runIdRef.current === runId;

    (async () => {
      // let React paint the stage label + progress before we block on heavy work
      const tick = () => new Promise((r) => setTimeout(r, 30));
      try {
        // — stage 0: load models (MediaPipe heavy + MoveNet Thunder ensemble) + video —
        const seed = seedRef.current ?? undefined;
        const engine = await createEnsemble(seed);
        // kick off the 3D lifter load NOW so its 162MB model downloads while we scan frames
        const lifterPromise = createLifter().catch(() => null);
        // ViTPose refiner (transformer 2D pose) — sharpens every frame's keypoints during the scan
        const refiner = await createRefiner().catch(() => null);

        const video = videoRef.current!;
        const canvas = canvasRef.current!;
        await new Promise<void>((res, rej) => {
          video.onloadedmetadata = () => res();
          video.onerror = () => rej(new Error("Couldn't read this video file."));
          video.src = videoUrl;
        });
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d")!;

        if (!active()) { engine.close(); return; }
        setStage(1);

        // — stage 1: offline frame-by-frame scan (pro pipelines never process in real time) —
        const frames: Frame[] = [];
        const rawLms: (Frame["lm"] | null)[] = []; // pre-ViTPose landmarks, for stride interpolation
        const wasRefined: boolean[] = [];
        let scanIdx = 0;
        video.muted = true;
        video.playsInline = true;
        video.pause();

        const seekTo = (t: number) =>
          new Promise<void>((res) => {
            video.addEventListener("seeked", () => res(), { once: true });
            video.currentTime = t;
          });

        // ~30 fps sampling; long clips cap at 300 samples (≈20fps at 15s — plenty
        // for form analysis, and it bounds the scan to a predictable duration)
        const step = Math.max(1 / 30, video.duration / 300);
        const allTimes: number[] = [];
        for (let t = 0; t < video.duration; t += step) allTimes.push(t);

        // The seed marks WHO at a specific MOMENT (the picker frame) — so tracking
        // must START there. Scan seed→end with one tracker, then seed→start with a
        // second one (its own instance keeps MediaPipe timestamps monotonic). Both
        // walk outward from the tapped frame, so identity never has to "find" the
        // person at t=0, where they may be elsewhere or absent — that exact gap made
        // a two-runner clip track one person per half.
        const seedT = seed?.t ?? 0;
        let splitIdx = 0;
        for (let i = 0; i < allTimes.length; i++) if (allTimes[i] <= seedT) splitIdx = i;
        const fwdTimes = allTimes.slice(splitIdx);
        const bwdTimes = seed && splitIdx > 0 ? allTimes.slice(0, splitIdx).reverse() : [];

        const totalN = allTimes.length;
        const scanPass = async (
          eng: Awaited<ReturnType<typeof createEnsemble>>,
          times: number[],
          reverseClock: boolean
        ) => {
          for (const t of times) {
            if (!active()) break;
            await seekTo(Math.min(t, video.duration - 0.01));
            // MediaPipe VIDEO mode needs increasing timestamps per instance — the
            // backward pass feeds a reversed clock to stay monotonic.
            const tMs = Math.round((reverseClock ? video.duration - t : t) * 1000);
            const res = await eng.detect(video, tMs);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (res) {
              // ViTPose second pass on EVERY frame — fast swings (tennis contact) change
              // too much between frames for interpolation; direct measurement each frame.
              const doRefine = !!refiner;
              const lm = doRefine ? await refiner!.refine(video, res.lm) : res.lm;
              drawSkeleton(ctx, lm, canvas.width, canvas.height); // raw live preview while scanning
              frames.push({ t, lm, world: res.world });
              rawLms.push(res.lm);
              wasRefined.push(doRefine);
            } else {
              frames.push({ t, lm: [] });
              rawLms.push(null);
              wasRefined.push(false);
            }
            scanIdx++;
            setProgress(Math.round((scanIdx / totalN) * 55)); // scan fills 0→55%
          }
        };

        await scanPass(engine, fwdTimes, false);
        engine.close();
        if (bwdTimes.length && active()) {
          // second leg of the seed-outward scan (no banner — it reads as noise)
          const engineB = await createEnsemble(seed);
          await scanPass(engineB, bwdTimes, true);
          engineB.close();
        }
        refiner?.close();
        // merge the two passes back into chronological order (keep arrays aligned)
        {
          const order = frames.map((_, i) => i).sort((a, b) => frames[a].t - frames[b].t);
          const f2 = order.map((i) => frames[i]);
          const r2 = order.map((i) => rawLms[i]);
          const w2 = order.map((i) => wasRefined[i]);
          frames.splice(0, frames.length, ...f2);
          rawLms.splice(0, rawLms.length, ...r2);
          wasRefined.splice(0, wasRefined.length, ...w2);
        }
        if (refiner) spreadRefinement(frames, rawLms, wasRefined); // fill the skipped frames
        if (!active()) return;

        // — stage 2: refine + score —
        setStage(2);
        setProgress(60);
        await tick();
        // full anti-jitter chain: median filter → occlusion recovery → bone clamp → zero-phase smoothing
        const framesWithBody = refinePose(frames);
        const analysis = computeAnalysis(framesWithBody, video.duration);
        if (!analysis) {
          setErrorMsg(
            "We couldn't see a full person in this video. Try one where your whole body is in frame with decent lighting."
          );
          setStep("error");
          return;
        }

        // — stage 3: lift the 2D keypoints to a coherent 3D skeleton (MotionBERT, on-device).
        // Best-effort: if the model can't load, the report still works with raw depth.
        setStage(3);
        setProgress(68);
        await tick();
        try {
          const lifter = await lifterPromise;
          if (!active()) { lifter?.close(); return; }
          if (lifter) {
            const poses = await lifter.lift(framesWithBody, video.videoWidth, video.videoHeight);
            framesWithBody.forEach((f, i) => { if (poses[i]) f.pose3d = poses[i]!; });
            lifter.close();
          }
        } catch (e) {
          console.warn("3D lift skipped", e);
        }
        if (!active()) return;
        // — stage 4: cloud accuracy layer (opt-in toggle) — SAM 3D Body anchors polish
        // the torso posture. Best-effort with hard timeouts; off/offline → local stands.
        setStage(4);
        setProgress(80);
        await tick();
        let useCloud = false; // still frames leave the device only after explicit opt-in
        try { useCloud = getPreferences().cloud3d; } catch {}
        if (useCloud) {
          try {
            const { sam3dFuse } = await import("@/lib/sam3d");
            await sam3dFuse(video, framesWithBody);
          } catch (e) {
            console.warn("SAM 3D fusion skipped", e);
          }
        }
        if (!active()) return;
        setProgress(88);

        // — stage 4.5: deterministic biomechanics from the final 3D skeleton —
        // joint angles, ROM, rep phases, tempo, L/R muscle demand (lib/biomech).
        // Pure math, personalized by the user's height/weight. Best-effort.
        try {
          const { computeBiomech } = await import("@/lib/biomech");
          const prof0 = JSON.parse(localStorage.getItem("ml_profile") ?? "{}");
          const bm = computeBiomech(
            framesWithBody,
            { heightCm: prof0.height, weightKg: prof0.weight },
            (failure) => { analysis.biomechFailure = failure; }
          );
          if (bm) analysis.biomech = bm;
        } catch (e) {
          console.warn("biomech layer skipped", e);
          analysis.biomechFailure = {
            code: "processing-error",
            message: "Mechanics processing failed, so no muscle measurements were added to this report.",
          };
        }

        // — stage 5: the AI coach recognizes the sport and writes the real report —
        let final = analysis;
        try {
          setStage(5);
          setProgress(92);
          await tick();
          // three small stills for sport recognition (video itself never leaves the device)
          const kf: string[] = [];
          const kc = document.createElement("canvas");
          const KW = 384;
          kc.width = KW;
          kc.height = Math.max(1, Math.round((KW * video.videoHeight) / video.videoWidth));
          const kctx = kc.getContext("2d")!;
          for (const frac of [0.15, 0.5, 0.85]) {
            await seekTo(video.duration * frac);
            kctx.drawImage(video, 0, 0, kc.width, kc.height);
            kf.push(kc.toDataURL("image/jpeg", 0.6));
          }
          const prof = JSON.parse(localStorage.getItem("ml_profile") ?? "{}");
          const ac = new AbortController();
          requestAbortRef.current = ac;
          const to = setTimeout(() => ac.abort(), 25000);
          const resp = await fetch("/api/coach", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              qualities: analysis.qualities,
              // engine-DETECTED key moments (clip fractions) — anchors for tip.when
              moments: analysis.keyMoments.map((k) => +(k.t / video.duration).toFixed(3)),
              duration: video.duration,
              frames: framesWithBody.length,
              profile: { level: prof.level, goal: prof.goal },
              keyframes: kf,
            }),
            signal: ac.signal,
          });
          clearTimeout(to);
          requestAbortRef.current = null;
          if (!active()) return;
          // the AI looked and it's NOT a sport → exception screen, save nothing
          if (resp.status === 422) {
            const j = await resp.json().catch(() => ({} as { seen?: string }));
            setSeenDesc(typeof j.seen === "string" ? j.seen : "");
            setStep("notsport");
            return;
          }
          if (resp.ok) {
            const j = await resp.json();
            if (j.ok) {
              final = {
                ...analysis,
                // Core score remains the deterministic on-device measurement.
                // GPT recognizes the activity and writes coaching prose only.
                score: analysis.score,
                headline: j.report.headline,
                tips: j.report.tips,
                drill: j.report.drill,
                sport: j.report.sport,
                action: j.report.action,
                proMatch: j.report.proMatch && Array.isArray(j.report.proMatch.moments) ? j.report.proMatch : undefined,
                ai: true,
              };
            }
          }
        } catch {
          requestAbortRef.current = null;
          /* AI coach unreachable — the on-device report still stands */
        }

        if (!active()) return;

        // cover thumbnail — a real frame from the middle of the video
        let cover: string | undefined;
        try {
          const cc = document.createElement("canvas");
          cc.width = 480;
          cc.height = Math.max(1, Math.round((480 * video.videoHeight) / video.videoWidth));
          await seekTo(video.duration * 0.5);
          cc.getContext("2d")!.drawImage(video, 0, 0, cc.width, cc.height);
          cover = cc.toDataURL("image/jpeg", 0.6);
        } catch {}

        if (!active()) return;
        saveAnalysis(final);
        setReplay({ videoUrl, frames: framesWithBody, snapshots: [] }); // powers the report's replay player
        // persist locally so the replay survives refreshes (device-only, never uploaded)
        // ALWAYS back up the replay — fall back to re-reading the object URL
        // so a missing picked-file ref can never mean "no backup" again
        try {
          const backup = pickedFileRef.current ?? (await fetch(videoUrl).then((r) => r.blob()).catch(() => null));
          if (backup) saveReplayDb(backup, framesWithBody).catch(() => {});
        } catch {}
        pendingRef.current = { final, cover };
        setProgress(100);
        // A paired GPS workout already supplies a real duration. Otherwise ask
        // before saving, so Home/LOAD/Recovery get the right first frame.
        let activities: { sport?: string; seconds?: number; date: string }[] = [];
        try { activities = JSON.parse(localStorage.getItem("ml_activities") ?? "[]"); } catch {}
        const pairedDuration = sessionSecondsOf({
          id: "pending", date: new Date().toISOString(), sport: final.sport,
          action: final.action, report: final,
        }, activities);
        if (pairedDuration) finishAnalysis();
        else {
          setSessionMinutes(DEFAULT_SESSION_MIN);
          setStep("duration");
        }
      } catch (e) {
        if (!active()) return;
        console.error(e);
        setErrorMsg("Something went wrong while analyzing. Try again or pick another video.");
        setStep("error");
      }
    })();

    return () => {
      cancelRef.current = true;
      requestAbortRef.current?.abort();
    };
  }, [step, videoUrl, router]);

  return (
    <div className={`min-h-full pt-8 ${step === "pick" ? "bg-graphite text-white" : ""}`}>
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFilePicked(f);
          e.target.value = "";
        }}
      />

      {step === "pick" && (
        <div className="animate-fade-up px-5">
          <p className="text-[11px] font-black tracking-[0.2em] text-signal-good">MOTION ANALYSIS</p>
          <h1 className="mt-2 font-golden text-[38px] leading-[0.92]">SEE HOW<br />YOU MOVE.</h1>
          <p className="mt-3 max-w-[310px] text-[13px] font-semibold leading-snug text-white/55">One video becomes measured form, muscle load and coaching.</p>

          {/* AI-vision cover: what the product actually does — a glowing pose
              skeleton inside a viewfinder, motion trails in the trio colors.
              Dark + luminous, no mascots. */}
          <button
            onClick={() => fileRef.current?.click()}
            className="group mt-6 block w-full overflow-hidden rounded-3xl bg-inset text-left ring-1 ring-inset ring-hair transition active:scale-[0.99]"
          >
            <svg viewBox="0 0 390 210" className="block w-full">
              <defs>
                <radialGradient id="azBg" cx="50%" cy="0%" r="110%">
                  <stop offset="0%" stopColor={SIGNAL.good} stopOpacity="0.24" />
                  <stop offset="72%" stopColor={SURFACE.graphite} />
                </radialGradient>
              </defs>
              <rect width="390" height="210" fill="url(#azBg)" />
              <ellipse cx="232" cy="182" rx="96" ry="18" fill={SIGNAL.good} opacity="0.12" />
              {/* viewfinder corner brackets */}
              <g fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="3" strokeLinecap="round">
                <path d="M18 32 v-14 h14" /><path d="M372 32 v-14 h-14" />
                <path d="M18 178 v14 h14" /><path d="M372 178 v14 h-14" />
              </g>
              {/* motion trails — glow pass then core */}
              <g fill="none" strokeLinecap="round">
                <path d="M28 96 Q110 66 176 96" stroke={SIGNAL.work} strokeOpacity="0.16" strokeWidth="15" />
                <path d="M40 122 Q116 94 178 118" stroke={SIGNAL.okay} strokeOpacity="0.16" strokeWidth="15" />
                <path d="M54 148 Q124 122 182 140" stroke={SIGNAL.good} strokeOpacity="0.18" strokeWidth="15" />
                <path d="M28 96 Q110 66 176 96" stroke={SIGNAL.work} strokeWidth="4" />
                <path d="M40 122 Q116 94 178 118" stroke={SIGNAL.okay} strokeWidth="4" />
                <path d="M54 148 Q124 122 182 140" stroke={SIGNAL.good} strokeWidth="4" />
              </g>
              {/* the pose skeleton — bones: glow pass then core */}
              {(() => {
                // a sprinter mid-stride: torso leaning in, front knee driving,
                // rear leg extended, arms in opposition
                const B = [
                  [244, 74, 252, 60], // neck → head
                  [244, 74, 250, 78], [244, 74, 236, 80], // neck → shoulders
                  [250, 78, 272, 90], [272, 90, 286, 70], // front arm up-forward
                  [236, 80, 216, 98], [216, 98, 200, 118], // back arm trailing
                  [244, 74, 222, 118], // spine (leaning forward)
                  [222, 118, 252, 134], [252, 134, 244, 164], // front leg: knee drive
                  [222, 118, 194, 144], [194, 144, 170, 168], // rear leg: push-off
                ];
                const J = [
                  [244, 74], [250, 78], [236, 80], [272, 90], [286, 70],
                  [216, 98], [200, 118], [222, 118], [252, 134], [244, 164],
                  [194, 144], [170, 168],
                ];
                return (
                  <g>
                    <g stroke={SIGNAL.good} strokeOpacity="0.22" strokeWidth="8" strokeLinecap="round">
                      {B.map((b, i) => <line key={i} x1={b[0]} y1={b[1]} x2={b[2]} y2={b[3]} />)}
                    </g>
                    <g stroke={SIGNAL.good} strokeWidth="2.5" strokeLinecap="round">
                      {B.map((b, i) => <line key={i} x1={b[0]} y1={b[1]} x2={b[2]} y2={b[3]} />)}
                    </g>
                    {/* head ring */}
                    <circle cx="255" cy="55" r="10" fill="none" stroke="rgba(255,255,255,0.30)" strokeWidth="6" />
                    <circle cx="255" cy="55" r="10" fill="none" stroke="#FFFFFF" strokeWidth="2.5" />
                    <g>
                      {J.map((j, i) => (
                        <g key={i}>
                          <circle cx={j[0]} cy={j[1]} r="6" fill="rgba(255,255,255,0.18)" />
                          <circle cx={j[0]} cy={j[1]} r="2.6" fill="#FFFFFF" />
                        </g>
                      ))}
                    </g>
                  </g>
                );
              })()}
            </svg>
            <div className="flex items-center gap-4 border-t border-white/10 px-5 py-5">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white text-on-action transition group-hover:scale-105 group-active:scale-95"><UploadIcon /></span>
              <div className="min-w-0 flex-1">
                <p className="font-golden text-xl leading-none text-white">CHOOSE VIDEO</p>
                <p className="mt-1 text-[11px] font-bold text-fg-muted">Private · processed on device</p>
              </div>
              <span className="text-xl text-white/60">→</span>
            </div>
          </button>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <CaptureRule icon="frame" label="FULL BODY" />
            <CaptureRule icon="light" label="GOOD LIGHT" />
            <CaptureRule icon="steady" label="STEADY VIEW" />
          </div>
        </div>
      )}

      {step === "who" && (
        <div className="animate-fade-up px-5">
          <h1 className="display text-4xl font-extrabold">
            Who are we
            <br />
            watching?
          </h1>
          {fileMeta && (
            <div className="mt-4 flex items-center justify-between rounded-2xl bg-panel px-4 py-3 text-fg shadow-panel">
              <div className="min-w-0">
                <p className="truncate text-xs font-black text-fg">{fileMeta.name}</p>
                <p className="mt-0.5 text-[11px] font-bold text-fg-muted">{formatBytes(fileMeta.bytes)} · processed on this device</p>
              </div>
              <button onClick={cancelAnalysis} className="ml-3 text-[11px] font-black text-signal-work">CHANGE</button>
            </div>
          )}
          {fileMeta && fileMeta.bytes >= 500 * 1024 * 1024 && (
            <p className="mt-3 rounded-2xl bg-award-gold-wash px-4 py-3 text-[11px] font-bold leading-relaxed text-[#805B17]">Large video. MotionLab samples at most 300 frames, but decoding can still take longer and use more memory.</p>
          )}
          {!picker ? (
            <div className="mt-6 flex flex-col items-center gap-4 rounded-3xl bg-panel p-10 text-fg shadow-panel">
              <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/10 border-t-signal-good" />
              <p className="text-sm font-bold text-fg-soft">Looking for people in your video…</p>
            </div>
          ) : (
            <>
              <p className="mt-3 rounded-2xl bg-panel px-4 py-3 text-sm font-extrabold text-fg shadow-panel">
                Tap the person to analyze
              </p>
              <div className="relative mt-4 overflow-hidden rounded-3xl bg-ink">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={picker.img} alt="pick your athlete" className="w-full" />
                {picker.people.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      seedRef.current = { ...p, t: pickerT };
                      setStep("processing");
                    }}
                    aria-label={`analyze person ${i + 1}`}
                    className="absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                  >
                    {/* open ring around the person (they stay visible inside it) */}
                    <span
                      className="relative grid place-items-center"
                      style={{ height: `${Math.max(44, p.diag * 420)}px`, width: `${Math.max(44, p.diag * 420)}px` }}
                    >
                      <span className="absolute inset-0 animate-pulse rounded-full border-[3px] border-volt shadow-[0_0_0_2px_rgba(0,0,0,0.35)]" />
                      <span className="absolute -top-3 left-1/2 grid h-7 w-7 -translate-x-1/2 place-items-center rounded-full bg-volt text-xs font-extrabold text-volt-ink">
                        {i + 1}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* processing — the user's real video with the live skeleton on top */}
      <div className={step === "processing" ? "animate-fade-up px-5" : "hidden"}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black tracking-[0.2em] text-signal-good">MOTION ANALYSIS</p>
            <h1 className="mt-1 font-golden text-[28px] leading-none text-fg">READING YOUR MOVE</h1>
          </div>
          <button onClick={cancelAnalysis} className="rounded-full bg-panel px-3 py-2 text-[11px] font-black text-signal-work shadow-panel">CANCEL</button>
        </div>

        <section className="mt-4 overflow-hidden rounded-3xl bg-graphite ring-1 ring-inset ring-hair">
          <div className="relative overflow-hidden bg-black">
            <video ref={videoRef} className="w-full" playsInline muted />
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 backdrop-blur">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#7FD9AE]" />
              <span className="text-[11px] font-black tracking-wider text-white">TRACKING</span>
            </div>
            <div className="absolute right-3 top-3 font-golden text-2xl tabular-nums text-white">{Math.round(progress)}%</div>
          </div>
          <div className="p-5">
            <div className="h-1.5 overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full bg-[#7FD9AE] transition-[width] duration-300" style={{ width: `${progress}%` }} /></div>
            <div className="mt-4 flex items-center justify-between">
              {STAGES.map((s, i) => {
                const skipped = i === 4 && !cloudEnabled && stage > 4;
                const done = i < stage;
                const active = i === stage;
                return <div key={s.label} className="flex flex-1 items-center last:flex-none">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-black ${skipped ? "bg-track text-fg-muted" : done ? "bg-[#7FD9AE] text-ink" : active ? "border-2 border-[#7FD9AE] text-[#7FD9AE]" : "border border-white/15 text-fg-muted"}`}>{skipped ? "—" : done ? "✓" : i + 1}</span>
                  {i < STAGES.length - 1 && <span className={`h-px flex-1 ${done ? "bg-signal-good/60" : "bg-track"}`} />}
                </div>;
              })}
            </div>
            <div className="mt-5 rounded-2xl bg-panel px-4 py-3">
              <div className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-[#7FD9AE]" /><p className="text-sm font-black text-white">{STAGES[stage]?.label}</p></div>
              <p className="mt-1 pl-4 text-[11px] font-bold text-white/50">{stage === 4 && !cloudEnabled ? "Local-only mode · no frames leave this device" : STAGES[stage]?.detail}</p>
            </div>
            {fileMeta && <p className="mt-3 truncate text-center text-[11px] font-bold text-fg-muted">{fileMeta.name} · {formatBytes(fileMeta.bytes)}</p>}
          </div>
        </section>
      </div>

      {step === "duration" && (
        <div className="animate-fade-up px-5 pt-5">
          <p className="text-[11px] font-black tracking-[0.2em] text-signal-good">ANALYSIS COMPLETE</p>
          <h1 className="mt-2 font-golden text-4xl leading-none text-fg">HOW LONG DID<br />YOU TRAIN?</h1>
          <section className="mt-6 rounded-3xl bg-graphite ring-1 ring-inset ring-hair p-5 text-white">
            <p className="text-[12px] font-bold leading-relaxed text-white/65">The video is a sample. Your answer sets the session load and recovery from the first screen.</p>
            <label className="mt-5 flex items-end justify-center gap-2" htmlFor="session-minutes">
              <input
                id="session-minutes"
                type="number"
                inputMode="numeric"
                min={1}
                max={360}
                value={sessionMinutes}
                onChange={(e) => setSessionMinutes(Math.max(1, Math.min(360, Number(e.target.value) || 1)))}
                className="w-28 border-b border-white/25 bg-transparent text-center font-golden text-6xl leading-none text-white"
              />
              <span className="pb-1 font-golden text-xl text-white/55">MIN</span>
            </label>
            <div className="mt-5 grid grid-cols-4 gap-2">
              {[20, 30, 45, 60].map((minutes) => (
                <button key={minutes} onClick={() => setSessionMinutes(minutes)} className={`rounded-full py-2 text-[12px] font-extrabold ${sessionMinutes === minutes ? "bg-white text-on-action" : "bg-track text-white/70"}`}>{minutes}</button>
              ))}
            </div>
          </section>
          <button onClick={() => finishAnalysis(sessionMinutes)} className="mt-4 w-full rounded-full bg-action py-4 text-[15px] font-extrabold text-on-action active:scale-[0.98]">SAVE {sessionMinutes} MIN SESSION</button>
          <button onClick={() => finishAnalysis()} className="mt-3 w-full py-3 text-[12px] font-bold text-fg-muted">Skip — use the visible {DEFAULT_SESSION_MIN} min assumption</button>
        </div>
      )}

      {step === "notsport" && (
        <div className="animate-pop px-5 pt-6 text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-signal-okay/15 text-signal-okay">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
              <path d="M8 11h6" />
            </svg>
          </span>
          <h1 className="mt-5 text-2xl font-extrabold">Sport not detected</h1>
          <div className="mx-auto mt-4 max-w-[300px] rounded-2xl bg-panel p-4 text-fg shadow-panel">
            <p className="text-sm leading-relaxed text-fg-muted">
              {seenDesc
                ? `This looks like ${seenDesc} — not a sport or exercise. Nothing was saved.`
                : "We couldn't spot a sport or exercise movement in this video. Nothing was saved."}
            </p>
          </div>
          <button
            onClick={() => { setStep("pick"); setVideoUrl(null); setSeenDesc(""); }}
            className="mt-7 w-full rounded-full bg-action py-4 text-[15px] font-bold text-on-action transition active:scale-[0.98]"
          >
            Try another video
          </button>
        </div>
      )}

      {step === "error" && (
        <div className="animate-pop px-5 pt-6 text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-signal-work/10 text-signal-work">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M5 20.5c.6-3.5 3.5-5.5 7-5.5s6.4 2 7 5.5" /><path d="M3.5 3.5l17 17" /></svg>
          </span>
          <h1 className="mt-5 text-2xl font-extrabold">Couldn&apos;t analyze that one</h1>
          <div className="mx-auto mt-4 max-w-[300px] rounded-2xl bg-panel p-4 text-fg shadow-panel">
            <p className="text-sm leading-relaxed text-fg-muted">{errorMsg}</p>
          </div>
          <button
            onClick={() => { setStep("pick"); setVideoUrl(null); }}
            className="mt-7 w-full rounded-full bg-action py-4 text-[15px] font-bold text-on-action shadow-panel transition active:scale-[0.98]"
          >
            Try another video
          </button>
        </div>
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function CaptureRule({ icon, label }: { icon: "frame" | "light" | "steady"; label: string }) {
  return (
    <div className="rounded-xl bg-inset px-2 py-3 text-center ring-1 ring-inset ring-hair">
      <svg className="mx-auto" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={SIGNAL.good} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {icon === "frame" && <><path d="M8 3H4a1 1 0 0 0-1 1v4M16 3h4a1 1 0 0 1 1 1v4M8 21H4a1 1 0 0 1-1-1v-4M16 21h4a1 1 0 0 0 1-1v-4" /><circle cx="12" cy="8" r="2" /><path d="M12 10.5v4M8.5 20l3.5-5.5 3.5 5.5M12 12l-4 2M12 12l4 2" /></>}
        {icon === "light" && <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>}
        {icon === "steady" && <><rect x="4" y="7" width="16" height="11" rx="2" /><path d="m9 7 1.5-2h3L15 7M9 12h6M12 9v6" /></>}
      </svg>
      <p className="mt-2 text-[11px] font-black tracking-[0.1em] text-white/65">{label}</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
