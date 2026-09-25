"use client";

// ONE-TIME recovery: rebuild the lost session from the replay store
// (IndexedDB kept the real video + pose frames). Re-runs the SAME pipeline
// as /analyze — on-device metrics from the stored frames, then the AI coach —
// so every number is computed from the user's real footage. No invention.

import { useEffect, useRef, useState } from "react";
import { computeAnalysis, saveAnalysis, setReplay } from "@/lib/analysis";
import { loadReplayDb } from "@/lib/replay-db";
import { recordSession } from "@/lib/stats";
import { apiPost } from "@/lib/api-client";

export default function Recover() {
  const [log, setLog] = useState<string[]>([]);
  const [done, setDone] = useState<null | { sport: string; score: number }>(null);
  const ran = useRef(false);
  const say = (s: string) => setLog((l) => [...l, s]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        say("Reading stored replay…");
        const rep = await loadReplayDb();
        if (!rep || !rep.frames.length) { say("No stored replay found — nothing to recover."); return; }
        say(`Found ${rep.frames.length} tracked frames.`);

        const videoUrl = URL.createObjectURL(rep.video);
        const video = document.createElement("video");
        video.src = videoUrl;
        video.muted = true;
        video.playsInline = true;
        await new Promise<void>((res, rej) => {
          video.onloadedmetadata = () => res();
          video.onerror = () => rej(new Error("video load failed"));
        });
        const duration = video.duration || rep.frames[rep.frames.length - 1].t;

        say("Recomputing movement metrics from the real frames…");
        const analysis = computeAnalysis(rep.frames, duration);
        if (!analysis) { say("Frames too sparse to score — please re-upload the video instead."); return; }
        try {
          const { computeBiomech } = await import("@/lib/biomech");
          const prof0 = JSON.parse(localStorage.getItem("ml_profile") ?? "{}");
          const bm = computeBiomech(
            rep.frames,
            { heightCm: prof0.height, weightKg: prof0.weight },
            (failure) => { analysis.biomechFailure = failure; }
          );
          if (bm) analysis.biomech = bm;
        } catch {
          analysis.biomechFailure = {
            code: "processing-error",
            message: "Mechanics processing failed, so no muscle measurements were added to this report.",
          };
        }

        const seekTo = (t: number) =>
          new Promise<void>((res) => {
            video.onseeked = () => res();
            video.currentTime = Math.min(Math.max(t, 0), Math.max(0, duration - 0.05));
          });

        say("Grabbing keyframes for the AI coach…");
        const kc = document.createElement("canvas");
        const KW = 384;
        kc.width = KW;
        kc.height = Math.max(1, Math.round((KW * video.videoHeight) / video.videoWidth));
        const kctx = kc.getContext("2d")!;
        const kf: string[] = [];
        for (const frac of [0.15, 0.5, 0.85]) {
          await seekTo(duration * frac);
          kctx.drawImage(video, 0, 0, kc.width, kc.height);
          kf.push(kc.toDataURL("image/jpeg", 0.6));
        }

        let final = analysis;
        say("Asking the AI coach (same as a normal analysis)…");
        try {
          const prof = JSON.parse(localStorage.getItem("ml_profile") ?? "{}");
          const resp = await apiPost("/api/coach", {
            qualities: analysis.qualities,
            moments: analysis.keyMoments.map((k) => +(k.t / duration).toFixed(3)),
            duration,
            frames: rep.frames.length,
            profile: { level: prof.level, goal: prof.goal },
            keyframes: kf,
          });
          if (resp.ok) {
            const j = await resp.json();
            if (j.ok) {
              final = {
                ...analysis,
                score: analysis.score, headline: j.report.headline, tips: j.report.tips,
                drill: j.report.drill, sport: j.report.sport, action: j.report.action,
                proMatch: j.report.proMatch && Array.isArray(j.report.proMatch.moments) ? j.report.proMatch : undefined,
                ai: true,
              };
            }
          }
        } catch { say("AI coach unreachable — keeping the on-device report."); }

        say("Rebuilding the cover…");
        let cover: string | undefined;
        try {
          const cc = document.createElement("canvas");
          cc.width = 480;
          cc.height = Math.max(1, Math.round((480 * video.videoHeight) / video.videoWidth));
          await seekTo(duration * 0.5);
          cc.getContext("2d")!.drawImage(video, 0, 0, cc.width, cc.height);
          cover = cc.toDataURL("image/jpeg", 0.6);
        } catch {}

        saveAnalysis(final);
        setReplay({ videoUrl, frames: rep.frames, snapshots: [] });
        recordSession({
          sport: final.sport ?? "Practice",
          action: final.action ?? "Session",
          score: final.score,
          cover,
          report: final,
        });
        localStorage.removeItem("ml_muscle_ai"); // force a fresh muscle read
        try { sessionStorage.setItem("ml_reveal_pending", "1"); } catch {}
        say(`Recovered: ${final.sport ?? "Session"} — score ${final.score}.`);
        setDone({ sport: final.sport ?? "Session", score: final.score });
      } catch (e) {
        say("Recovery failed: " + String(e));
      }
    })();
  }, []);

  return (
    <div className="min-h-full bg-graphite px-5 pt-8 text-white">
      <h1 className="font-golden text-2xl leading-none text-white">RECOVERY</h1>
      <div className="mt-4 space-y-1.5 rounded-2xl bg-panel p-4 text-fg shadow-panel">
        {log.map((l, i) => (
          <p key={i} className="text-[13px] font-semibold text-fg">{l}</p>
        ))}
      </div>
      {done && (
        <a href="/" className="btn-press mt-5 block w-full rounded-full bg-action py-4 text-center text-[15px] font-bold text-on-action">
          Back to home
        </a>
      )}
    </div>
  );
}
