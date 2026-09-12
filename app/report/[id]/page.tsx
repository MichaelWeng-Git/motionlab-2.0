"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { DEMO_ANALYSIS } from "@/lib/mock";
import { getLastAnalysis, getReplay, setReplay, type AnalysisResult, type TipOut } from "@/lib/analysis";
import { getSession, getSessions, updateSession, type Session } from "@/lib/stats";
import { DEFAULT_SESSION_MIN, sessionSecondsOf } from "@/lib/muscles";
import { loadReplayDb } from "@/lib/replay-db";
import { bodyPartToLandmark, detectReps, RADAR_TARGET } from "@/lib/feedback";
import { ScoreRing } from "@/components/ScoreRing";
import { SkeletonStage } from "@/components/SkeletonStage";
import { VideoReplay } from "@/components/VideoReplay";
import { RadarChart } from "@/components/RadarChart";
import { HowToImprove } from "@/components/HowToImprove";
import { ShareButton } from "@/components/ShareCard";
import { ClapperIcon, FilmIcon } from "@/components/Icons";

// /report/latest → the user's real analysis (from the on-device engine)
// /report/demo   → sample data, kept as a showcase
export default function Report() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [a, setA] = useState<AnalysisResult | null>(null);
  const [empty, setEmpty] = useState(false);
  const [curId, setCurId] = useState<string | null>(null);
  const [cover, setCover] = useState<string | undefined>(undefined); // video cover → share poster
  const [replaySpeed, setReplaySpeed] = useState(1); // shared: video player + 3D view stay in sync
  const [debugPoseAvailable, setDebugPoseAvailable] = useState(false);

  const [, bump] = useState(0);
  // video-native coaching overlay: the ONE tip currently marked on the video
  const [coachMark, setCoachMark] = useState<TipOut | null>(null);
  const seekFracRef = useRef<{ current: number | null }>({ current: null }).current;


  useEffect(() => {
    setDebugPoseAvailable(new URLSearchParams(window.location.search).get("debug") === "pose");
    if (params.id !== "demo") {
      const sessions = getSessions();
      const isLatest = params.id === "latest";
      // /report/latest → newest; /report/<id> → that specific stored session
      const session = isLatest ? sessions[sessions.length - 1] : getSession(params.id);
      const report = (session?.report as AnalysisResult | undefined) ?? (isLatest ? getLastAnalysis() : null);
      setCurId(session?.id ?? (isLatest ? sessions[sessions.length - 1]?.id ?? null : params.id));
      setCover(session?.cover);

      if (report) {
        setA(report);
        // only the newest session still has its video replay stored
        const newestId = sessions[sessions.length - 1]?.id;
        const canReplay = isLatest || params.id === newestId;
        if (canReplay && !getReplay()) {
          loadReplayDb().then((r) => {
            if (r) {
              setReplay({ videoUrl: URL.createObjectURL(r.video), frames: r.frames, snapshots: [] });
              bump((n) => n + 1);
            }
          });
        }
        return;
      }
      setEmpty(true); // no stored analysis — never fake one
      return;
    }
    // demo fallback, adapted into the same shape
    setA({
      score: DEMO_ANALYSIS.score,
      headline: DEMO_ANALYSIS.headline,
      qualities: DEMO_ANALYSIS.qualities,
      tips: DEMO_ANALYSIS.tips as TipOut[],
      drill: {
        title: "Weight-forward drill",
        detail:
          'Ten slow shadow swings against a wall. Press your weight into your front foot — find that "walking into the ball" feeling.',
      },
      keyMoments: [],
      frames: 0,
      duration: 0,
      date: new Date().toISOString(),
    });
  }, [params.id]);

  if (empty) {
    return (
      <div className="px-5 pt-10">
        <div className="flex flex-col items-center rounded-3xl bg-white p-8 text-center shadow-soft">
          <span className="grid h-16 w-16 place-items-center rounded-3xl bg-paper"><ClapperIcon size={32} className="text-volt-deep" /></span>
          <h1 className="mt-4 text-xl font-extrabold">No report yet</h1>
          <Link
            href="/analyze"
            className="btn-press mt-6 w-full rounded-full bg-ink py-3.5 text-[15px] font-bold text-white transition"
          >
            Analyze a video
          </Link>
        </div>
      </div>
    );
  }
  if (!a) return null;

  const isReal = params.id !== "demo" && a.frames > 0;
  const replay = getReplay();
  const hasReplay = isReal && !!replay;

  // the one thing to fix → the joint we circle on the video / 3D figure
  const fix = a.tips.find((t) => t.rating === "work") ?? a.tips[0];
  const focusLm = bodyPartToLandmark(fix?.bodyPart);
  const focus = focusLm != null ? { landmark: focusLm, label: fix.bodyPart } : null;

  // auto-recognition: count reps from the busiest joint
  const reps = hasReplay ? detectReps(replay!.frames).times : [];

  // vs your best: the strongest OTHER session OF THE SAME SPORT (never compare a run to a serve)
  const best = isReal ? bestOther(curId, a.sport) : null;
  const jointEntries = Object.entries(a.biomech?.joints ?? {}).filter((entry) => typeof entry[1]?.romDeg === "number");
  const primaryJoint = jointEntries.sort((left, right) => right[1].romDeg - left[1].romDeg)[0] ?? null;
  const mechanics = a.biomech ? [
    primaryJoint ? { label: primaryJoint[0].replace("_", " "), value: `${primaryJoint[1].romDeg}°`, note: "range of motion" } : null,
    a.biomech.tempo.avgRepS != null ? { label: "Average rep", value: `${a.biomech.tempo.avgRepS.toFixed(1)}s`, note: `${a.biomech.reps.length} measured` } : null,
    a.biomech.tempo.eccConRatio != null ? { label: "Down : up", value: `${a.biomech.tempo.eccConRatio.toFixed(2)}×`, note: "tempo ratio" } : null,
  ].filter((item): item is { label: string; value: string; note: string } => item !== null) : [];

  return (
    <div className="stagger px-5 pt-2">
      {/* back to wherever the report was opened from — small and flat, the
          score card is the hero here */}
      <button
        onClick={() => router.push("/")}
        aria-label="Back to home"
        className="mb-1.5 flex h-6 w-10 items-center justify-center rounded-lg bg-white text-[13px] leading-none text-ink shadow-soft transition active:scale-95"
      >
        ←
      </button>

      {/* hero: one score, one activity, one takeaway. */}
      <section className="relative overflow-hidden rounded-3xl bg-graphite p-6 text-white shadow-lift">
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-signal-good/60 blur-3xl" />
        {isReal && <ShareButton a={a} cover={cover} videoUrl={hasReplay ? replay!.videoUrl : undefined} />}
        <div className="relative flex items-start justify-between pr-11">
          <div className="min-w-0 pt-1">
            <p className="text-[11px] font-black tracking-[0.2em] text-[#7FD9AE]">MOVEMENT REPORT</p>
            <h1 className="mt-2 truncate font-golden text-3xl leading-none text-white">{(a.action ?? a.sport ?? "Movement").toUpperCase()}</h1>
            {a.sport && a.action && <p className="mt-1 text-xs font-bold text-white/50">{a.sport}</p>}
          </div>
          <ScoreRing score={a.score} size={116} dark />
        </div>
        <div className="relative mt-5 border-t border-white/10 pt-4">
          {/* PR celebration — beats every previous session of this sport */}
          {isReal && best && a.score > best.score && (
            <span className="inline-flex animate-pop items-center gap-1 rounded-full bg-volt px-3 py-1 text-xs font-extrabold text-volt-ink shadow-lift">
              New personal best&nbsp;+{a.score - best.score}
            </span>
          )}
          <p className="text-lg font-bold leading-snug text-white">{a.headline}</p>
        </div>

        {/* at a glance — what the engine recognized, in plain chips */}
        {isReal && (
          <div className="mt-5 grid grid-cols-3 gap-2.5">
            {[
              { v: a.sport ?? "Movement", l: "Sport" },
              { v: reps.length > 0 ? String(reps.length) : "—", l: reps.length === 1 ? "rep" : "reps" },
              { v: `${a.duration.toFixed(1)}s`, l: "Length" },
            ].map((s) => (
              <div key={s.l} className="rounded-2xl bg-white/[0.07] px-2 py-3 text-center ring-1 ring-inset ring-white/5">
                <p className="truncate font-golden text-base text-white">{s.v}</p>
                <p className="mt-0.5 text-[11px] font-black uppercase tracking-wider text-white/40">{s.l}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* The score's component parts, measured locally from tracked motion. */}
      {a.qualities.length >= 3 && (
        <section className="mt-4 rounded-3xl bg-white p-4 shadow-soft">
          <div className="flex items-center justify-between px-1">
            <div>
              <p className="text-[11px] font-black tracking-[0.18em] text-ink-muted">MEASURED ON DEVICE</p>
              <h2 className="mt-1 font-golden text-xl leading-none text-ink">MOVEMENT BREAKDOWN</h2>
            </div>
            <span className="rounded-full bg-volt-mist px-3 py-1.5 text-[11px] font-black text-signal-good">NO AI SCORES</span>
          </div>
          <RadarChart data={a.qualities} target={RADAR_TARGET} />
          <div className="mt-1 flex items-center justify-center gap-4 text-[11px] font-semibold">
            <span className="inline-flex items-center gap-1.5 text-ink"><span className="h-2 w-2 rounded-full bg-volt" /> You</span>
            <span className="inline-flex items-center gap-1.5 text-ink-muted"><span className="inline-block h-0 w-4 border-t-2 border-dashed border-[#5B6472]" /> Target</span>
          </div>
        </section>
      )}

      {isReal && mechanics.length > 0 && (
        <section className="mt-4 rounded-3xl bg-cream p-5 shadow-soft">
          <div className="flex items-baseline justify-between">
            <div><p className="text-[11px] font-black tracking-[0.18em] text-ink-muted">FROM YOUR 3D MOTION</p><h2 className="mt-1 font-golden text-xl leading-none text-ink">MECHANICS</h2></div>
            <span className="rounded-full bg-white px-3 py-1.5 text-[11px] font-black uppercase text-ink-muted">{a.biomech!.confidence} confidence</span>
          </div>
          <div className={`mt-4 grid gap-2 ${mechanics.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
            {mechanics.map((metric) => (
              <div key={metric.label} className="rounded-2xl bg-white px-3 py-4 text-center">
                <p className="font-golden text-2xl leading-none text-ink">{metric.value}</p>
                <p className="mt-1 truncate text-[11px] font-extrabold capitalize text-ink">{metric.label}</p>
                <p className="mt-0.5 text-[11px] font-bold text-ink-muted">{metric.note}</p>
              </div>
            ))}
          </div>
          {a.biomech!.limitations.length > 0 && (
            <details className="mt-3 rounded-2xl bg-white px-4 py-3">
              <summary className="cursor-pointer text-[12px] font-extrabold text-ink">Measurement notes · {a.biomech!.limitations.length}</summary>
              <ul className="mt-3 space-y-2">
                {a.biomech!.limitations.map((note) => <li key={note} className="text-[12px] font-semibold leading-relaxed text-ink-muted">{note}</li>)}
              </ul>
            </details>
          )}
        </section>
      )}

      {/* ——— the tape: your real video with focus + rep markers ——— */}
      <section className="mt-4">
        {hasReplay ? (
          <VideoReplay
            videoUrl={replay!.videoUrl}
            frames={replay!.frames}
            focus={focus}
            speed={replaySpeed}
            onSpeedChange={setReplaySpeed}
            marker={
              coachMark?.when != null && coachMark.cue
                ? {
                    landmark: bodyPartToLandmark(coachMark.bodyPart) ?? 25,
                    dir: coachMark.dir,
                    cue: coachMark.cue,
                    when: coachMark.when,
                  }
                : null
            }
            seekRef={seekFracRef}
            debugControls={debugPoseAvailable}
          />
        ) : isReal ? (
          /* past session: video was never stored (privacy) — say so honestly */
          <div className="flex items-center gap-3.5 rounded-2xl bg-white p-4 shadow-soft">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-paper"><FilmIcon className="text-volt-deep" /></span>
            <div>
              <p className="text-sm font-bold">Replay not available</p>
            </div>
          </div>
        ) : (
          <SkeletonStage label="Your analysis" highlight={fix?.bodyPart} />
        )}
      </section>

      {/* ——— coach's note: the 3 points, right under the video ——— */}
      <CoachNote
        tips={a.tips}
        drill={a.drill}
        onShow={
          hasReplay
            ? (tip) => {
                setCoachMark(tip);
                if (tip.when != null) seekFracRef.current = Math.max(0, tip.when - 0.02);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            : undefined
        }
      />

      {/* ——— how to improve: exercise cards, two per row ——— */}
      <HowToImprove tips={a.tips} drill={a.drill} sport={a.sport} />

      {/* ——— how long the session actually was: turns the clip sample into a
              real dose (lib/muscles volumeOf) ——— */}
      {a.biomech?.bodyKnown && (a.biomech.observedS ?? a.duration ?? 0) > 0 && (
          <SessionLength id={curId} observedS={a.biomech.observedS ?? a.duration!} />
        )}

      {isReal && a.biomech && !a.biomech.bodyKnown && (
        <section className="mt-4 rounded-3xl bg-signal-okay/15 p-5">
          <h2 className="font-golden text-lg leading-none text-ink">MUSCLE LOAD NEEDS YOUR BODY</h2>
          <p className="mt-2 text-[13px] font-semibold leading-relaxed text-ink">
            Add both height and weight in Profile. Your joint angles are measured, but muscle load is withheld until it can be scaled to your body.
          </p>
          <Link href="/account/training" className="mt-3 inline-flex rounded-full bg-ink px-4 py-2 text-xs font-bold text-white">
            Add body details
          </Link>
        </section>
      )}

      {isReal && a.biomechFailure && (
        <section className="mt-4 rounded-3xl bg-signal-work/10 p-5">
          <h2 className="font-golden text-lg leading-none text-signal-work">MECHANICS UNAVAILABLE</h2>
          <p className="mt-2 text-[13px] font-semibold leading-relaxed text-ink">
            {a.biomechFailure.message}
          </p>
        </section>
      )}

    </div>
  );
}

// The strongest OTHER session of the SAME sport — the only fair "vs your best".
// A tennis serve and an easy run share no scale, so cross-sport comparison is out.
function bestOther(curId: string | null, sport?: string): { score: number; sport: string } | null {
  if (!sport) return null;
  let sessions: Session[] = [];
  try { sessions = getSessions(); } catch { return null; }
  const key = sport.toLowerCase();
  const others = sessions.filter(
    (s) => s.id !== curId && typeof s.score === "number" && (s.sport ?? "").toLowerCase() === key
  );
  if (!others.length) return null;
  const top = others.reduce((a, b) => (b.score > a.score ? b : a));
  return { score: top.score, sport: top.sport ?? sport };
}

// Coaching, mockup-style: the 3 points that matter most as tappable cards
// (tap = mark it on the video + expand the plain-language detail), then the
// coach's speech bubble with the drill. Max 3, details collapsed by default.
function CoachNote({ tips, drill, onShow }: { tips: TipOut[]; drill: { title: string; detail: string }; onShow?: (t: TipOut) => void }) {
  const order: Record<TipOut["rating"], number> = { work: 0, okay: 1, good: 2 };
  const sorted = [...tips].sort((a, b) => order[a.rating] - order[b.rating]).slice(0, 3);
  const [open, setOpen] = useState<number | null>(null);
  const dot: Record<TipOut["rating"], string> = {
    work: "bg-signal-work",
    okay: "bg-[#E8B93E]",
    good: "bg-signal-good",
  };

  return (
    <section className="mt-6">
      <h2 className="font-golden text-lg leading-none text-ink">WHAT MATTERS MOST</h2>

      <div className="mt-3 space-y-2">
        {sorted.map((t, i) => (
          <div key={t.title} className="rounded-2xl bg-white shadow-soft">
            <button
              onClick={() => {
                setOpen(open === i ? null : i);
                if (t.when != null && t.cue) onShow?.(t);
              }}
              className="flex w-full items-center gap-3 p-4 text-left"
            >
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-extrabold text-white ${dot[t.rating]}`}>
                {i + 1}
              </span>
              <span className="flex-1 text-[14px] font-bold leading-snug text-ink">{t.title}</span>
              {onShow && t.when != null && t.cue && (
                <span className="shrink-0 rounded-full bg-paper px-2.5 py-1 text-[11px] font-bold text-ink">
                  ▶ Show me
                </span>
              )}
            </button>
            {open === i && (
              <p className="px-4 pb-4 pl-[52px] text-[13px] leading-relaxed text-ink-muted">{t.detail}</p>
            )}
          </div>
        ))}
      </div>

    </section>
  );
}

// ——— SESSION LENGTH ———
// A clip is a SAMPLE of a session. Until the athlete supplies the real length,
// the shared muscle calculation uses one visible, editable default.
function SessionLength({ id, observedS }: { id: string | null; observedS: number }) {
  const [mins, setMins] = useState<number | null>(null);
  const [fromWorkout, setFromWorkout] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!id) return;
    const s = getSession(id);
    if (!s) return;
    if (typeof s.sessionSeconds === "number" && s.sessionSeconds > 0) {
      setMins(Math.round(s.sessionSeconds / 60));
      return;
    }
    let acts: { sport?: string; seconds?: number; date: string }[] = [];
    try { acts = JSON.parse(localStorage.getItem("ml_activities") ?? "[]"); } catch {}
    const auto = sessionSecondsOf(s as never, acts);
    if (auto) { setMins(Math.round(auto / 60)); setFromWorkout(true); }
  }, [id]);

  function commit(m: number) {
    setMins(m);
    setFromWorkout(false);
    if (!id) return;
    updateSession(id, { sessionSeconds: Math.round(m * 60) });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  const OPTIONS = [10, 20, 30, 45, 60, 90];

  return (
    <section className="mt-4 rounded-3xl bg-white p-5 shadow-soft">
      <div className="flex items-baseline justify-between">
        <h2 className="font-golden text-lg leading-none text-ink">SESSION LENGTH</h2>
        {saved && <span className="text-[11px] font-extrabold text-signal-good">Saved</span>}
      </div>
      <p className="mt-2 text-[12px] font-semibold leading-relaxed text-ink-soft">
        {mins == null
          ? `This clip covers ${observedS.toFixed(1)}s. Muscle load currently assumes a ${DEFAULT_SESSION_MIN} min session — tap the real length to correct it.`
          : fromWorkout
            ? `Taken from your recorded workout. Tap to change.`
            : `Muscle load counts ${mins} min of training.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {OPTIONS.map((m) => (
          <button
            key={m}
            onClick={() => commit(m)}
            className={`rounded-full px-3.5 py-2 text-[12px] font-bold transition active:scale-95 ${
              mins === m ? "bg-ink text-white" : "bg-paper text-ink"
            }`}
          >
            {m} min
          </button>
        ))}
      </div>
    </section>
  );
}
