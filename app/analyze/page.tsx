"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { recordSession } from "@/lib/stats";
import { clearAnalysis, computeAnalysis, saveAnalysis, setReplay, type Frame } from "@/lib/analysis";
import { clearReplayDb, saveReplayDb } from "@/lib/replay-db";
import { refinePose } from "@/lib/pose-post";
import { createEnsemble, probePeople, type PersonSeed } from "@/lib/ensemble";
import { createLifter } from "@/lib/lift3d";
import { createRefiner, spreadRefinement } from "@/lib/pose2d-refine";
import { drawSkeleton } from "@/lib/draw";

// Real skeleton tracking: MediaPipe Pose runs in the browser, frame by frame,
// drawing the skeleton over the user's actual video. No servers, no API keys.

type Step = "pick" | "who" | "processing" | "error" | "notsport";

const STAGES = [
  { label: "Loading your video" },
  { label: "Tracking your body" },
  { label: "Scoring your movement" },
  { label: "Building your 3D model" },
  { label: "Refining with cloud AI" },
  { label: "Writing your report" },
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

  const pickedFileRef = useRef<File | null>(null);
  const seedRef = useRef<PersonSeed | null>(null);
  const [picker, setPicker] = useState<{ img: string; people: PersonSeed[] } | null>(null);
  const [pickerT, setPickerT] = useState(0); // the timestamp the picker frame came from

  function onFilePicked(file: File) {
    clearAnalysis(); // new video = clean slate, no stale report
    clearReplayDb();
    pickedFileRef.current = file;
    seedRef.current = null;
    setPicker(null);
    setVideoUrl(URL.createObjectURL(file));
    setStage(0);
    setProgress(0);
    setStep("who");
  }

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

        if (cancelRef.current) { engine.close(); return; }
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
            if (cancelRef.current) break;
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
        if (bwdTimes.length && !cancelRef.current) {
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
        if (cancelRef.current) return;

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
          if (lifter) {
            const poses = await lifter.lift(framesWithBody, video.videoWidth, video.videoHeight);
            framesWithBody.forEach((f, i) => { if (poses[i]) f.pose3d = poses[i]!; });
            lifter.close();
          }
        } catch (e) {
          console.warn("3D lift skipped", e);
        }
        // — stage 4: cloud accuracy layer (opt-in toggle) — SAM 3D Body anchors polish
        // the torso posture. Best-effort with hard timeouts; off/offline → local stands.
        setStage(4);
        setProgress(80);
        await tick();
        let useCloud = false; // still frames leave the device only after explicit opt-in
        try { useCloud = localStorage.getItem("ml_cloud3d") === "on"; } catch {}
        if (useCloud) {
          try {
            const { sam3dFuse } = await import("@/lib/sam3d");
            await sam3dFuse(video, framesWithBody);
          } catch (e) {
            console.warn("SAM 3D fusion skipped", e);
          }
        }
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
                radar: Array.isArray(j.report.radar) ? j.report.radar.slice(0, 6) : undefined,
                proMatch: j.report.proMatch && Array.isArray(j.report.proMatch.moments) ? j.report.proMatch : undefined,
                ai: true,
              };
            }
          }
        } catch {
          /* AI coach unreachable — the on-device report still stands */
        }

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

        saveAnalysis(final);
        setReplay({ videoUrl, frames: framesWithBody, snapshots: [] }); // powers the report's replay player
        // persist locally so the replay survives refreshes (device-only, never uploaded)
        // ALWAYS back up the replay — fall back to re-reading the object URL
        // so a missing picked-file ref can never mean "no backup" again
        try {
          const backup = pickedFileRef.current ?? (await fetch(videoUrl).then((r) => r.blob()).catch(() => null));
          if (backup) saveReplayDb(backup, framesWithBody).catch(() => {});
        } catch {}
        // store the FULL report per session so any past analysis can be reopened
        recordSession({
          sport: final.sport ?? "Practice",
          action: final.action ?? "Session",
          score: final.score,
          cover,
          report: final,
        });
        // warm the muscle model NOW (while the user reads the report) so the
        // home page's red-fade + recovery-drain start the instant they return
        import("@/lib/muscles").then((m) => m.fetchMuscleState().catch(() => {})).catch(() => {});
        // one-shot flag: the NEXT home visit (back from this report) plays the
        // white→red fade + recovery drain; ordinary tab switches never do
        try { sessionStorage.setItem("ml_reveal_pending", "1"); } catch {}
        setProgress(100);
        setTimeout(() => router.push("/report/latest"), 600);
      } catch (e) {
        console.error(e);
        setErrorMsg("Something went wrong while analyzing. Try again or pick another video.");
        setStep("error");
      }
    })();

    return () => {
      cancelRef.current = true;
    };
  }, [step, videoUrl, router]);

  return (
    <div className="pt-8">
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
          <h1 className="display text-4xl font-extrabold">
            Let&apos;s see
            <br />
            your move.
          </h1>

          {/* AI-vision cover: what the product actually does — a glowing pose
              skeleton inside a viewfinder, motion trails in the trio colors.
              Dark + luminous, no mascots. */}
          <button
            onClick={() => fileRef.current?.click()}
            className="group mt-6 block w-full overflow-hidden rounded-3xl bg-white/95 shadow-soft transition active:scale-[0.99]"
          >
            <svg viewBox="0 0 390 210" className="block w-full">
              <defs>
                <radialGradient id="azBg" cx="50%" cy="0%" r="110%">
                  <stop offset="0%" stopColor="#24463A" />
                  <stop offset="62%" stopColor="#0E1811" />
                </radialGradient>
              </defs>
              <rect width="390" height="210" fill="url(#azBg)" />
              {/* violet data-light pooling under the figure */}
              <ellipse cx="232" cy="182" rx="96" ry="18" fill="rgba(124,92,255,0.14)" />
              {/* viewfinder corner brackets */}
              <g fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="3" strokeLinecap="round">
                <path d="M18 32 v-14 h14" /><path d="M372 32 v-14 h-14" />
                <path d="M18 178 v14 h14" /><path d="M372 178 v14 h-14" />
              </g>
              {/* motion trails — glow pass then core */}
              <g fill="none" strokeLinecap="round">
                <path d="M28 96 Q110 66 176 96" stroke="rgba(124,92,255,0.25)" strokeWidth="15" />
                <path d="M40 122 Q116 94 178 118" stroke="rgba(22,199,132,0.22)" strokeWidth="15" />
                <path d="M54 148 Q124 122 182 140" stroke="rgba(46,134,246,0.22)" strokeWidth="15" />
                <path d="M28 96 Q110 66 176 96" stroke="#8F7AFF" strokeWidth="6" />
                <path d="M40 122 Q116 94 178 118" stroke="#16C784" strokeWidth="6" />
                <path d="M54 148 Q124 122 182 140" stroke="#2E86F6" strokeWidth="6" />
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
                    <g stroke="rgba(124,92,255,0.32)" strokeWidth="8" strokeLinecap="round">
                      {B.map((b, i) => <line key={i} x1={b[0]} y1={b[1]} x2={b[2]} y2={b[3]} />)}
                    </g>
                    <g stroke="#8F7AFF" strokeWidth="2.5" strokeLinecap="round">
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
            <div className="flex flex-col items-center gap-4 px-6 pb-7 pt-5">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-ink text-white shadow-lift transition group-hover:scale-105 group-active:scale-95">
                <UploadIcon />
              </span>
              <p className="font-golden text-3xl leading-none text-ink">UPLOAD YOUR VIDEO</p>
            </div>
          </button>

        </div>
      )}

      {step === "who" && (
        <div className="animate-fade-up px-5">
          <h1 className="display text-4xl font-extrabold">
            Who are we
            <br />
            watching?
          </h1>
          {!picker ? (
            <div className="mt-6 flex flex-col items-center gap-4 rounded-3xl bg-white p-10 shadow-soft">
              <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-black/10 border-t-ink" />
              <p className="text-sm font-bold text-ink-soft">Looking for people in your video…</p>
            </div>
          ) : (
            <>
              <p className="mt-3 rounded-2xl bg-white px-4 py-3 text-sm font-extrabold text-ink shadow-soft">
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
                      <span className="absolute -top-3 left-1/2 grid h-7 w-7 -translate-x-1/2 place-items-center rounded-full bg-volt text-xs font-extrabold text-volt-ink shadow-lift">
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
        <h1 className="font-golden text-[26px] leading-none text-ink">READING YOUR MOVE…</h1>

        <div className="relative mt-4 overflow-hidden rounded-3xl bg-ink">
          <video ref={videoRef} className="w-full" playsInline muted />
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          <div className="absolute right-4 top-4 rounded-full bg-black/50 px-3 py-1.5 text-[11px] font-bold tabular-nums text-white backdrop-blur">
            {Math.round(progress)}%
          </div>
        </div>

        <div className="mt-5 space-y-2.5 pb-6">
          {STAGES.map((s, i) => {
            const state = i < stage ? "done" : i === stage ? "active" : "todo";
            return (
              <div
                key={s.label}
                className={`flex items-center gap-3 rounded-2xl border p-4 transition ${
                  state === "todo" ? "border-black/5 bg-white opacity-50" : "border-black/5 bg-white shadow-soft"
                }`}
              >
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${
                    state === "done"
                      ? "bg-signal-good text-white"
                      : state === "active"
                      ? "bg-ink text-volt-glow"
                      : "bg-black/5 text-ink-muted"
                  }`}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                <p className="text-sm font-bold">{s.label}</p>
                {state === "active" && <span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-volt-deep" />}
              </div>
            );
          })}
        </div>
      </div>

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
          <div className="mx-auto mt-4 max-w-[300px] rounded-2xl bg-white p-4 shadow-soft">
            <p className="text-sm leading-relaxed text-ink-muted">
              {seenDesc
                ? `This looks like ${seenDesc} — not a sport or exercise. Nothing was saved.`
                : "We couldn't spot a sport or exercise movement in this video. Nothing was saved."}
            </p>
          </div>
          <button
            onClick={() => { setStep("pick"); setVideoUrl(null); setSeenDesc(""); }}
            className="btn-press mt-7 w-full rounded-full bg-ink py-4 text-[15px] font-bold text-white transition"
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
          <div className="mx-auto mt-4 max-w-[300px] rounded-2xl bg-white p-4 shadow-soft">
            <p className="text-sm leading-relaxed text-ink-muted">{errorMsg}</p>
          </div>
          <button
            onClick={() => { setStep("pick"); setVideoUrl(null); }}
            className="mt-7 w-full rounded-full bg-ink py-4 text-[15px] font-bold text-white shadow-lift transition active:scale-[0.98]"
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
