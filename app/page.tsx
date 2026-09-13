"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

// three.js viewer loads ONLY if the AI-generated body.glb exists — the
// heavy bundle never ships otherwise
const MuscleBody3D = dynamic(() => import("@/components/MuscleBody3D").then((m) => m.MuscleBody3D), {
  ssr: false,
  // reserve the exact slot so the card never resizes as the chunk arrives
  loading: () => <span className="block" style={{ width: 228 * 0.66, height: 228 }} />,
});
import { getSessions, getStats, type Stats } from "@/lib/stats";
import { getProfile, type Profile } from "@/lib/profile";
import { SIcon, type SIconName } from "@/components/SIcon";
import { Avatar } from "@/components/Avatar";
import { Gauge } from "@/components/Gauge";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { CoinIcon } from "@/components/Icons";
import { addBonusCoins, RING_COIN, dayKey } from "@/lib/coins";
import { fetchFriends, iconOf, syncMe, type Person } from "@/lib/friends";
import { getGoals, RING_COLORS, DEFAULT_GOALS, type Goals } from "@/lib/goals";
import { getCharge, CHARGE_META, type Charge } from "@/lib/charge";
import { touchDailyStreak } from "@/lib/streak";
import { DEFAULT_SESSION_MIN, fetchMuscleState, getCachedMuscleState, getRecoveryState, recoveryColor, recoveryStateText, type MuscleState, type RecoveryState } from "@/lib/muscles";
import { buildLoadMonth, loadColor, type LoadMonth } from "@/lib/fitness";
import { SIGNAL } from "@/lib/palette";
import { buildFormProfile, CAP_ORDER, type FormProfile } from "@/lib/form";
import { MuscleSpin } from "@/components/MuscleMap";
import { GoalCardShell, GoalRing, GoalRows } from "@/components/GoalRing";

const EMPTY: Stats = {
  total: 0, latestScore: 0, bestScore: 0, weekCount: 0, daysActiveThisWeek: 0,
  streakDays: 0, xp: 0, latestSport: null, latestAction: null, monthDelta: 0,
};

export default function Home() {
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<Profile>({});
  const [stats, setStats] = useState<Stats>(EMPTY);
  const [friendUsers, setFriendUsers] = useState<Person[]>([]);
  const [lbOpen, setLbOpen] = useState(false);
  // rows that are genuinely NEW this session get the squeeze-in animation;
  // everyone already seen stays perfectly still
  const [newRows, setNewRows] = useState<Set<string>>(new Set());

  // ranked leaderboard rows: you + accepted friends (real users)
  const lbRows: { id: string; name: string; xp: number; me: boolean; icon?: SIconName; photo?: string | null }[] = [
    { id: "me", name: name || "You", xp: stats.xp, me: true },
    ...friendUsers.map((u) => ({ id: u.id, name: u.name, xp: u.xp, me: false, icon: iconOf(u), photo: u.photo })),
  ].sort((a, b) => b.xp - a.xp);

  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);
  const [today, setToday] = useState({ minutes: 0, ana: 0, wo: 0 });
  // completed-but-unclaimed daily rings — each pops a reward bubble in turn
  const [ringQueue, setRingQueue] = useState<{ key: string; label: string; color: string }[]>([]);
  // signature metrics — OUR invented concepts (the way WHOOP invented
  // Recovery): FORM = technique score from AI analyses, LOAD = this week's
  // training volume vs your goal and vs last week
  const [week, setWeek] = useState({ total: 0 });
  // LOAD tile and the /load page read the SAME calendar, so tapping through
  // never shows a different number in a different unit
  const [loadMonth, setLoadMonth] = useState<LoadMonth | null>(null);
  // THE form number + curve come from the same profile the /form page renders,
  // so the surface and the detail can never disagree
  const [formProfile, setFormProfile] = useState<FormProfile | null>(null);
  // CHARGE: today's readiness (lib/charge) — the third invented metric
  const [charge, setCharge] = useState<Charge | null>(null);

  // MUSCLES: the AI model's read of what the body worked (lib/muscles —
  // real analyses + meals in, per-muscle load out; null = nothing to show)
  const [muscles, setMuscles] = useState<MuscleState | null>(null);
  const recovery = getRecoveryState(muscles);
  // true-3D body is the default; only fall back to the flat figures if the
  // model is genuinely missing. Optimistic so the old images never flash in.
  const [has3d, setHas3d] = useState(true);
  useEffect(() => {
    fetch("/muscles/body.glb", { method: "HEAD" })
      .then((r) => setHas3d(r.ok))
      .catch(() => setHas3d(false));
  }, []);
  // the fade/drain animations play ONLY right after a new analysis (the
  // analyze flow sets a one-shot flag) — plain tab switches show the current
  // state instantly with no replay
  const [freshAnalysis, setFreshAnalysis] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem("ml_reveal_pending")) {
        sessionStorage.removeItem("ml_reveal_pending");
        setFreshAnalysis(true);
      }
    } catch {}
  }, []);

  // where each muscle stood LAST time — the fade starts from this state
  // (already-red areas stay red; only the new delta animates in)
  const [prevLoad] = useState<MuscleState["load"]>(() => {
    try { return JSON.parse(localStorage.getItem("ml_muscle_last_load") ?? "{}"); } catch { return {}; }
  });
  useEffect(() => {
    if (muscles?.load) try { localStorage.setItem("ml_muscle_last_load", JSON.stringify(muscles.load)); } catch {}
  }, [muscles]);

  useEffect(() => {
    let dead = false;
    // paint the last known state INSTANTLY (animations start right away),
    // then swap in the fresh model read when it lands
    const cached = getCachedMuscleState();
    if (cached) setMuscles(cached);
    const refresh = () => { fetchMuscleState().then((m) => { if (!dead && m) setMuscles(m); }); };
    refresh();
    // LIVE RECOVERY: the load is a pure function of elapsed hours, so re-running
    // it on a timer (and whenever the tab comes back) makes the body genuinely
    // fade red→white as time passes, with the app just sitting open. This is a
    // real recomputation, never an animation pretending to recover.
    const timer = setInterval(refresh, 5 * 60 * 1000);
    const onWake = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", refresh);
    return () => {
      dead = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  // login streak: advance it on the first open each day and let the top-bar
  // flame bounce; a short delay so the bounce reads after the page settles
  useEffect(() => {
    try {
      const r = touchDailyStreak();
      setTimeout(() => window.dispatchEvent(new CustomEvent("ml:streak", { detail: r })), 700);
    } catch {}
  }, []);

  // FIRST-VISIT TOUR — a bouncing spotlight that introduces the core cards
  // once (ml_home_intro), then never again. No permanent explainer text.
  const todayRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const musclesRef = useRef<HTMLDivElement>(null);
  const chargeRef = useRef<HTMLElement>(null);
  const [introStep, setIntroStep] = useState<number | null>(null);
  const [introRect, setIntroRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const INTRO = [
    { t: "TODAY", d: "Your whole day in one score — Move, Analyze, Workout." },
    { t: "FORM & LOAD", d: "FORM is how well you move. LOAD is how much you train." },
    { t: "MUSCLES", d: "Your videos light up what you trained — red fades as you rest and refuel." },
    { t: "CHARGE", d: "How ready your body is today — green means push, red means rest." },
  ];

  useEffect(() => {
    if (introStep === null) return;
    const target = [todayRef, formRef, musclesRef, chargeRef][introStep]?.current;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    const measure = () => {
      const r = target.getBoundingClientRect();
      setIntroRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    const t = setTimeout(measure, 450);
    return () => clearTimeout(t);
  }, [introStep]);

  function nextIntro() {
    if (introStep === null) return;
    if (introStep >= INTRO.length - 1) {
      try { localStorage.setItem("ml_home_intro", "1"); } catch {}
      setIntroStep(null);
      setIntroRect(null);
    } else {
      setIntroStep(introStep + 1);
    }
  }

  useEffect(() => {
    const load = () => {
      const p = getProfile();
      const googleFirst = (localStorage.getItem("ml_google_name") ?? "").split(" ")[0];
      if (p.name) setName(p.name);
      else if (googleFirst) setName(googleFirst);
      setProfile(p);
      setStats(getStats());
      setGoals(getGoals());
      setCharge(getCharge());
      try { if (!localStorage.getItem("ml_home_intro")) setIntroStep((s) => (s === null ? 0 : s)); } catch {}
      // TODAY's numbers — same daily rings as the Activity page
      try {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const allActs = JSON.parse(localStorage.getItem("ml_activities") ?? "[]") as {
          name?: string; sport?: string; date: string; seconds?: number; meters?: number;
        }[];
        const sessions = getSessions();
        const acts = allActs.filter((a) => new Date(a.date) >= start);
        const ana = sessions.filter((s) => new Date(s.date) >= start).length;
        const t = {
          minutes: Math.round(acts.reduce((m, a) => m + (a.seconds ?? 0), 0) / 60),
          ana,
          wo: acts.length,
        };
        setToday(t);

        // LOAD inputs: this week's minutes and last week's, Monday-anchored
        const monday = new Date();
        monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
        monday.setHours(0, 0, 0, 0);
        const prevMonday = new Date(monday);
        prevMonday.setDate(prevMonday.getDate() - 7);
        let thisWk = 0;
        let lastWk = 0;
        for (const a of allActs) {
          const d = new Date(a.date);
          const m = Math.round((a.seconds ?? 0) / 60);
          if (d >= monday) thisWk += m;
          else if (d >= prevMonday) lastWk += m;
        }
        setWeek({ total: thisWk });
        try { setLoadMonth(buildLoadMonth()); } catch {}

        // One source for the card and /form: number, delta, link condition and
        // hexagon all consume this exact profile object.
        try { setFormProfile(buildFormProfile(sessions as never)); } catch {}

        // a COMPLETED ring pays out once per day — queue any unclaimed ones
        const g = getGoals();
        const tk = dayKey();
        let claims: Record<string, string[]> = {};
        try { claims = JSON.parse(localStorage.getItem("ml_ring_claims") ?? "{}"); } catch {}
        const done = claims[tk] ?? [];
        setRingQueue(
          [
            t.minutes >= g.minutes && !done.includes("exercise")
              ? { key: "exercise", label: "Exercise", color: RING_COLORS.exercise } : null,
            t.ana >= g.dayAnalyses && !done.includes("analyses")
              ? { key: "analyses", label: "Analyses", color: RING_COLORS.analyses } : null,
            t.wo >= g.dayWorkouts && !done.includes("workouts")
              ? { key: "workouts", label: "Workouts", color: RING_COLORS.workouts } : null,
          ].filter(Boolean) as { key: string; label: string; color: string }[]
        );
      } catch {}
      // daily login streak + reward: bump the run once per calendar day,
      // and offer the coin until it's claimed for that day
      try {
        const tk = dayKey();
        let rec: { last?: string; run?: number } = {};
        try { rec = JSON.parse(localStorage.getItem("ml_login") ?? "{}"); } catch {}
        if (rec.last !== tk) {
          const y = new Date();
          y.setDate(y.getDate() - 1);
          rec = { last: tk, run: rec.last === dayKey(y) ? (rec.run ?? 0) + 1 : 1 };
          localStorage.setItem("ml_login", JSON.stringify(rec));
        }
      } catch {}
    };
    load();
    // profile saves elsewhere (photo, name) must reflect here without a reload
    window.addEventListener("ml:goals", load);
    window.addEventListener("ml:profile", load);
    // real friends: push my fresh XP up, then pull the friend list down
    // friends render INSTANTLY from the local cache — no popping in seconds
    // later — then the server refresh reconciles silently in the background
    try {
      const cached = JSON.parse(localStorage.getItem("ml_friends_cache") ?? "[]") as Person[];
      if (cached.length) {
        setFriendUsers(cached);
        const seen: string[] = JSON.parse(sessionStorage.getItem("ml_lb_seen") ?? "[]");
        sessionStorage.setItem(
          "ml_lb_seen",
          JSON.stringify([...new Set([...seen, ...cached.map((f) => f.id)])])
        );
      }
    } catch {}
    (async () => {
      syncMe(); // fire-and-forget — never make the leaderboard wait for it
      const state = await fetchFriends();
      if (state) {
        // animate ONLY friends we haven't shown before in this session
        let seen: string[] = [];
        try { seen = JSON.parse(sessionStorage.getItem("ml_lb_seen") ?? "[]"); } catch {}
        const seenSet = new Set(seen);
        setNewRows(new Set(state.friends.filter((f) => !seenSet.has(f.id)).map((f) => f.id)));
        sessionStorage.setItem(
          "ml_lb_seen",
          JSON.stringify([...new Set([...seen, ...state.friends.map((f) => f.id)])])
        );
        setFriendUsers(state.friends);
        localStorage.setItem("ml_friends_cache", JSON.stringify(state.friends));
      }
    })();
    return () => window.removeEventListener("ml:profile", load);
  }, []);

  // claim a completed ring's coins, then show the next queued one (if any)
  function claimRing() {
    const r = ringQueue[0];
    if (!r) return;
    const tk = dayKey();
    let claims: Record<string, string[]> = {};
    try { claims = JSON.parse(localStorage.getItem("ml_ring_claims") ?? "{}"); } catch {}
    claims[tk] = [...(claims[tk] ?? []), r.key];
    localStorage.setItem("ml_ring_claims", JSON.stringify(claims));
    addBonusCoins(RING_COIN, `${r.label} goal`);
    setRingQueue((q) => q.slice(1));
  }

  // TODAY's rings — identical semantics to the Activity page day card:
  // red triangle = exercise minutes, green circle = analyses, cyan line =
  // workouts. (Streak lives in the flame chip, not in the rings.)
  const rings = [
    { label: "Exercise", value: today.minutes, target: goals.minutes, unit: " min", color: RING_COLORS.exercise },
    { label: "Analyses", value: today.ana, target: goals.dayAnalyses, unit: "", color: RING_COLORS.analyses },
    { label: "Workouts", value: today.wo, target: goals.dayWorkouts, unit: "", color: RING_COLORS.workouts },
  ];

  const form = formProfile?.form ?? null;
  const formTrend = formProfile?.delta ?? 0;
  // LOAD: this week's minutes against a weekly target (daily goal × 7)
  const loadDelta =
    loadMonth && loadMonth.lastWeek > 0
      ? Math.round(((loadMonth.week - loadMonth.lastWeek) / loadMonth.lastWeek) * 100)
      : null;

  // the day as three 0..1 fractions and one combined 0..100 score
  const pct = Math.min(1, goals.minutes > 0 ? today.minutes / goals.minutes : 0);
  const pAna = Math.min(1, today.ana / Math.max(1, goals.dayAnalyses));
  const pWo = Math.min(1, today.wo / Math.max(1, goals.dayWorkouts));
  const overall = (pct + pAna + pWo) / 3;

  return (
    <div className="stagger min-h-full bg-graphite px-5 pb-10 pt-7 text-white">
      {/* greeting — pure text; every control lives in the top bar's right
          cluster, so nothing floats loose down here */}
      <div className="animate-fade-up">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-signal-good">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
        </p>
        <h1 className="mt-1 font-golden text-[28px] leading-none text-white">{name ? `HEY, ${name}` : "HEY THERE"}</h1>
      </div>

      {/* TODAY — one object, not three meters: a single ring split into three
          arcs (mint, one hue three steps) on a graphite ground so the colour
          never fights the card. Labels + numbers in the brand face. */}
      <section className="mt-4" ref={todayRef}>
        <Link href="/weeks" className="block">
          <GoalCardShell className="ring-1 ring-inset ring-white/10 transition active:scale-[0.99]">
            <div className="flex items-center gap-5">
              <div className="relative shrink-0">
                <GoalRing pcts={[pct, pAna, pWo]} />
                <div className="absolute inset-0 grid place-items-center">
                  <div className="text-center">
                    <p className="font-golden text-[34px] leading-none">
                      <AnimatedNumber value={Math.round(overall * 100)} />
                    </p>
                    <p className="-mt-0.5 font-golden text-[11px] leading-none text-white/30">/100</p>
                  </div>
                </div>
              </div>
              <GoalRows
                values={[today.minutes, today.ana, today.wo]}
                targets={[goals.minutes, goals.dayAnalyses, goals.dayWorkouts]}
              />
            </div>
          </GoalCardShell>
        </Link>
      </section>

      {/* the split page: FORM above LOAD on the left, the muscle body
          standing tall on the right */}
      <section className="mt-4 grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-3" ref={formRef}>
        <Link
          href={form !== null ? "/form" : "/analyze"}
          className="gk-card block flex-1 !bg-cream p-5 transition active:scale-[0.98]"
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: "#7C5CFF1C" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7C5CFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2.5-6 4 12 2.5-6h5" /></svg>
              </span>
              <span className="font-golden text-lg leading-none text-ink">FORM</span>
            </span>
            {form !== null && formTrend !== 0 && (
              <span className={`text-[11px] font-extrabold ${formTrend > 0 ? "text-signal-good" : "text-signal-work"}`}>
                {formTrend > 0 ? "▲" : "▼"} {Math.abs(formTrend)}
              </span>
            )}
          </div>
          {/* the surface shows the SAME object as the detail page, shrunk —
              tapping it feels like zooming into your own profile. The shape
              itself says more than a line ever could. */}
          {(() => {
            const val = formProfile?.form ?? null;
            const vals = CAP_ORDER.map((k) => formProfile?.caps.find((c) => c.key === k)?.value ?? null);
            const measured = vals.filter((v) => v != null).length;
            if (val == null || measured < 3) {
              return (
                <div className="mt-4 flex h-[76px] items-center">
                  <p className="text-[13px] font-bold text-ink-soft">
                    {val != null ? `${val} — one analysis so far` : "Analyze a video to start your profile"}
                  </p>
                </div>
              );
            }
            const S = 104, cx = S / 2, cy = S / 2, R = S / 2 - 6;
            const pt = (i: number, r: number) => {
              const a = (Math.PI / 3) * i - Math.PI / 2;
              return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
            };
            const ring = (f: number) => Array.from({ length: 6 }, (_, i) => pt(i, R * f).join(",")).join(" ");
            const shape = vals.map((v, i) => pt(i, (R * Math.max(6, v ?? 6)) / 100).join(",")).join(" ");
            return (
              <div className="mt-2 flex items-center gap-2">
                <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} className="shrink-0">
                  {[0.5, 1].map((f) => (
                    <polygon key={f} points={ring(f)} fill="none" stroke="rgba(14,31,26,0.10)" strokeWidth="1" />
                  ))}
                  <polygon points={shape} fill="rgba(46,158,107,0.18)" stroke="#2E9E6B" strokeWidth="2" strokeLinejoin="round" />
                </svg>
                <div>
                  <p className="font-golden text-[32px] leading-none text-ink">{val}</p>
                </div>
              </div>
            );
          })()}
        </Link>
        <Link href="/load" className="gk-card block flex-1 !bg-paper p-5 transition active:scale-[0.98]">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: `${SIGNAL.good}1C` }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={SIGNAL.good} strokeWidth="2" strokeLinecap="round"><path d="M5 19a8.5 8.5 0 1 1 14 0" /><path d="M12 13l3.5-3.5" /><circle cx="12" cy="13.5" r="1.4" fill={SIGNAL.good} /></svg>
              </span>
              <span className="font-golden text-lg leading-none text-ink">LOAD</span>
            </span>
            {loadDelta !== null && (
              <span className={`text-[11px] font-extrabold ${loadDelta >= 0 ? "text-signal-good" : "text-ink-muted"}`}>
                {loadDelta >= 0 ? "▲" : "▼"} {Math.abs(loadDelta)}%
              </span>
            )}
          </div>
          <div className="mx-auto mt-2 w-full max-w-[168px]">
            <Gauge
              pct={(loadMonth?.week ?? 0) / 100}
              value={String(loadMonth?.week ?? 0)}
              label="LAST 7 DAYS"
              color={loadColor(loadMonth?.week ?? 0)}
              valueColor="#17271F"
              labelColor="#51604F"
            />
          </div>
        </Link>
        </div>

        {/* MUSCLES — the AI-read body, spinnable, standing tall on the right */}
        <div className="h-full" ref={musclesRef}>
          <div className="gk-card flex h-full flex-col overflow-hidden !bg-graphite p-4 pb-3 ring-1 ring-inset ring-white/10">
            <Link href="/muscles" className="flex items-center justify-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-xl bg-signal-good/15">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2E9E5B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="4.5" r="2.2" />
                  <path d="M12 8v6M12 8.5c-2.8 0-4.5 1-6 2.5M12 8.5c2.8 0 4.5 1 6 2.5M12 14l-2.8 6M12 14l2.8 6" />
                </svg>
              </span>
              <h2 className="font-golden text-lg leading-none text-white">MUSCLES</h2>
            </Link>
            <div className="flex flex-1 items-center justify-center pt-2">
              {has3d ? (
                <MuscleBody3D height={252} dolly={0.95} load={muscles?.load ?? {}} prevLoad={prevLoad} fadeIn={freshAnalysis} />
              ) : (
                <MuscleSpin load={muscles?.load ?? {}} height={228} />
              )}
            </div>
            {/* WHOOP-style recovery bar — one strip. Full green = fully
                recovered = clean body; it drains and reddens exactly as the
                muscles above light up (both derive from the same real loads). */}
            {recovery.kind === "known" || recovery.kind === "assumed-duration" ? (
              <RecoveryBar
                recovery={recovery}
                animate={freshAnalysis}
              />
            ) : (
              <p className="mt-1.5 text-center text-[11px] font-bold text-white/55">
                {muscles ? recoveryStateText(recovery) : "Reading your sessions…"}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* CHARGE — our third invented metric: how much training today's body
          can absorb (acute vs chronic volume, lib/charge). FORM = how well,
          LOAD = how much, CHARGE = how ready. */}
      {charge && (
        <section className="mt-4" ref={chargeRef}>
          <Link href="/charge" className="gk-card block w-full !bg-graphite p-5 text-left ring-1 ring-inset ring-white/10 transition active:scale-[0.99]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/10">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={CHARGE_META[charge.state].color}><path d="M13 2.5 5 13.5h5.5L11 21.5l8-11h-5.5L13 2.5z" /></svg>
                </span>
                <h2 className="font-golden text-lg leading-none text-white">CHARGE</h2>
              </span>
              <span
                className="rounded-full px-3 py-1.5 text-[11px] font-extrabold tracking-wide text-white"
                style={{ background: CHARGE_META[charge.state].color }}
              >
                {CHARGE_META[charge.state].action}
              </span>
            </div>
            <div className="mx-auto mt-1 w-[220px]">
              <Gauge
                pct={charge.value / 100}
                value={String(charge.value)}
                label={CHARGE_META[charge.state].word}
                big
                color={CHARGE_META[charge.state].color}
                valueColor={CHARGE_META[charge.state].color}
                labelColor={CHARGE_META[charge.state].color}
              />
            </div>
            <p className="mt-2.5 text-center text-[12px] font-bold text-white/80">{charge.why}</p>
            {charge.assumedWorkouts > 0 && (
              /* CHARGE is a VOLUME model, so when a workout's length is the
                 visible 30-minute assumption the number rests on it — say so
                 here exactly as the recovery bar does. */
              <p className="mt-1 text-center text-[11px] font-bold text-white/55">
                {charge.assumedWorkouts} {charge.assumedWorkouts === 1 ? "session assumes" : "sessions assume"} {DEFAULT_SESSION_MIN} min
              </p>
            )}
          </Link>
        </section>
      )}

      {/* LEADERBOARD — after your own status (every pro app ranks social
          below self); past 3 rows the 4th sits fogged behind "More" */}
      <section className="mt-4">
        <div className="gk-card overflow-hidden !bg-cream">
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <span className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: "#E8A13C24" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C9821B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0V4z" /><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v3M8.5 20h7M10 20v-2h4v2" /></svg>
              </span>
              <h2 className="font-golden text-lg leading-none text-ink">LEADERBOARD</h2>
            </span>
            <Link href="/friends" className="press rounded-full bg-paper px-3 py-1.5 text-[11px] font-extrabold text-ink">
              Friends ›
            </Link>
          </div>
          {(() => {
            const folded = !lbOpen && lbRows.length > 3;
            const meIdx = lbRows.findIndex((r) => r.me);
            const shown = folded ? lbRows.slice(0, 3) : lbRows;
            const meExtra = folded && meIdx >= 3 ? { row: lbRows[meIdx], rank: meIdx + 1 } : null;
            const hidden = folded ? lbRows.slice(3).filter((r) => !r.me) : [];

            const Row = ({ row, rank, divider }: { row: (typeof lbRows)[number]; rank: number; divider: boolean }) => (
              <div
                className={`flex items-center gap-3.5 px-5 py-3.5 ${row.me ? "bg-volt-mist" : ""} ${
                  divider ? "border-t border-black/5" : ""
                } ${!row.me && newRows.has(row.id) ? "row-squeeze" : ""}`}
                style={!row.me && newRows.has(row.id) ? { animationDelay: `${rank * 0.07}s` } : undefined}
              >
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-extrabold tabular-nums ${
                    rank === 1 ? "text-white" : "bg-black/10 text-ink-muted"
                  }`}
                  style={rank === 1 ? { background: "#F5B23D" } : undefined}
                >
                  {rank}
                </span>
                <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-paper">
                  {row.me ? (
                    <Avatar p={profile} iconSize={26} />
                  ) : row.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.photo} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <SIcon name={row.icon!} size={26} />
                  )}
                </span>
                <span className={`flex-1 text-sm text-ink ${row.me ? "font-extrabold" : "font-semibold"}`}>
                  {row.name}
                  {row.me && <span className="ml-2 text-[11px] font-bold uppercase tracking-wide text-ink-muted">You</span>}
                </span>
                <span className="text-sm font-bold tabular-nums text-ink-muted">{row.xp} XP</span>
              </div>
            );

            return (
              <>
                {shown.map((row, i) => (
                  <Row key={row.id} row={row} rank={i + 1} divider={i > 0} />
                ))}
                {meExtra && <Row row={meExtra.row} rank={meExtra.rank} divider />}
                {folded && hidden.length > 0 && (
                  <div className="relative border-t border-black/5">
                    {/* a hint of fog — one row, lightly blurred */}
                    <div className="pointer-events-none select-none opacity-70 blur-[1.5px]">
                      <Row row={hidden[0]} rank={lbRows.indexOf(hidden[0]) + 1} divider={false} />
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-white/55 to-white/80" />
                    {/* the whole fogged strip is the tap target */}
                    <button
                      onClick={() => setLbOpen(true)}
                      className="absolute inset-0 flex items-center justify-center gap-1 text-sm font-bold text-ink"
                    >
                      More
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                  </div>
                )}
                {lbOpen && lbRows.length > 4 && (
                  <button
                    onClick={() => setLbOpen(false)}
                    className="w-full border-t border-black/5 py-2.5 text-center text-xs font-bold text-ink-muted transition active:bg-black/[0.03]"
                  >
                    Show less
                  </button>
                )}
              </>
            );
          })()}
          {/* one rivalry line — the whole social stake in a sentence */}
          {lbRows.length > 1 && (() => {
            const i = lbRows.findIndex((r) => r.me);
            const line =
              i === 0
                ? `${lbRows[0].xp - lbRows[1].xp} XP ahead of ${lbRows[1].name}`
                : `${lbRows[i - 1].xp - lbRows[i].xp} XP behind ${lbRows[i - 1].name}`;
            return (
              <p className="border-t border-black/5 py-2.5 text-center text-[12px] font-bold text-ink-soft">{line}</p>
            );
          })()}
        </div>
      </section>

      {/* FIRST-VISIT TOUR — spotlight cutout + bouncing intro bubble */}
      {introStep !== null && introRect && (
        <div className="fixed inset-0 z-[80]" onClick={nextIntro}>
          <div
            className="absolute rounded-2xl transition-all duration-500"
            style={{
              top: introRect.top - 6,
              left: introRect.left - 6,
              width: introRect.width + 12,
              height: introRect.height + 12,
              boxShadow: "0 0 0 9999px rgba(10,15,13,0.6)",
              transitionTimingFunction: "cubic-bezier(0.22,1,0.36,1)",
            }}
          />
          <div
            className="absolute left-1/2 w-[290px] -translate-x-1/2 animate-bob"
            style={{ top: Math.min(introRect.top + introRect.height + 18, (typeof window !== "undefined" ? window.innerHeight : 800) - 170) }}
          >
            <div className="relative rounded-2xl bg-ink p-4 text-white shadow-lift">
              <span className="absolute -top-[7px] left-1/2 h-3.5 w-3.5 -translate-x-1/2 rotate-45 rounded-[3px] bg-ink" />
              <p className="font-golden text-xl leading-none text-white">{INTRO[introStep].t}</p>
              <p className="mt-2 text-[13px] font-bold leading-snug text-white/90">{INTRO[introStep].d}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="flex gap-1.5">
                  {INTRO.map((_, i) => (
                    <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === introStep ? "bg-white" : "bg-white/30"}`} />
                  ))}
                </span>
                <span className="rounded-full bg-white px-4 py-1.5 text-xs font-extrabold text-ink">
                  {introStep >= INTRO.length - 1 ? "Got it" : "Next"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ring completed! — centered reward bubble, one ring at a time */}
      {ringQueue.length > 0 && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/40 px-10 backdrop-blur-[2px]">
          <div className="w-full max-w-[300px] animate-pop rounded-3xl bg-paper p-6 text-center shadow-lift">
            <span
              className="mx-auto grid h-14 w-14 place-items-center rounded-full"
              style={{ background: `${ringQueue[0].color}1f` }}
            >
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={ringQueue[0].color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <p className="mt-3 text-base font-extrabold leading-snug text-ink">
              You finished your {ringQueue[0].label} ring!
            </p>
            <button
              onClick={claimRing}
              className="btn-press mt-5 flex w-full items-center justify-center gap-1.5 rounded-full bg-ink py-3 text-sm font-extrabold text-white transition"
            >
              Claim {RING_COIN}
              <CoinIcon size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// the FORM card's best-fit line: measured in real pixels so the arrowhead is
// WELDED to the line's end at the true angle (a stretched-SVG marker would
// distort; a floating glyph would drift). Solid, pale green.
function FitLine({ y0, y1 }: { y0: number; y1: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setDim({ w: el.clientWidth, h: el.clientHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  let art = null;
  if (dim && dim.w > 0) {
    const p1 = { x: dim.w * 0.02, y: (y0 / 100) * dim.h };
    const p2 = { x: dim.w * 0.96, y: (y1 / 100) * dim.h };
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const L = 7; // arrowhead barb length
    const barb = (da: number) => ({
      x: p2.x - L * Math.cos(ang + da),
      y: p2.y - L * Math.sin(ang + da),
    });
    const a1 = barb(-0.5), a2 = barb(0.5);
    art = (
      <svg width={dim.w} height={dim.h} className="absolute inset-0 overflow-visible">
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#3BA55D" strokeOpacity="0.85" strokeWidth="2.5" strokeLinecap="round" />
        <polyline
          points={`${a1.x},${a1.y} ${p2.x},${p2.y} ${a2.x},${a2.y}`}
          fill="none" stroke="#3BA55D" strokeOpacity="0.85" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
    );
  }
  return <div ref={ref} className="pointer-events-none absolute inset-0 z-10">{art}</div>;
}

// the MUSCLES card's recovery strip. Color is a CONTINUOUS blend (not three
// hard bands): pure red at ≤25, red→amber to 50, amber→green to 90 — so 70%
// reads yellow-green, not full green. The 100→value drain plays ONLY right
// after a new analysis (animate); ordinary visits show the value directly.
function RecoveryBar({ recovery, animate }: { recovery: Extract<RecoveryState, { kind: "known" | "assumed-duration" }>; animate: boolean }) {
  const { load, pct: target } = recovery;
  const hasData = Object.keys(load).length > 0;

  // the drain CONTINUES from wherever recovery stood last time (63 → 57),
  // never restarting from 100 — only the very first analysis starts at 100
  const [prev] = useState(() => {
    try {
      const v = Number(localStorage.getItem("ml_recovery_last"));
      return Number.isFinite(v) && v > 0 && v <= 100 ? v : 100;
    } catch { return 100; }
  });
  const [shown, setShown] = useState(animate ? prev : target);
  useEffect(() => {
    if (hasData) try { localStorage.setItem("ml_recovery_last", String(target)); } catch {}
    if (!animate) { setShown(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const from = prev;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 1400);
      const e = 1 - Math.pow(1 - t, 3); // ease-out
      setShown(Math.round(from + (target - from) * e));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, animate, hasData]);

  const color = recoveryColor(shown); // shared with every other recovery readout

  return (
    <div className="mt-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-white/45">
          {recoveryStateText(recovery)}
        </span>
        <span className="font-golden text-[13px] leading-none tabular-nums" style={{ color }}>{shown}%</span>
      </div>
      <div className="mt-1 h-[7px] overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${shown}%`, background: color }} />
      </div>
    </div>
  );
}
