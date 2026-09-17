"use client";

// Chat with MotionLab 2.0 — the in-app assistant.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { proteinTargetForWeight } from "@/lib/fuel";
import { computeMuscleState, getRecoveryState, recoveryStateText } from "@/lib/muscles";

type Msg = { role: "user" | "assistant"; content: string };

// snapshot of the user's REAL current state, sent with every question so the
// assistant can answer "why is MY body redder?" with their actual numbers —
// never inventing data it can't see
function buildContext() {
  try {
    // the SAME function every screen calls — the assistant must never quote a
    // recovery number the user cannot see on the page
    const ai = computeMuscleState();
    const recovery = getRecoveryState(ai);
    const load = recovery.kind === "known" || recovery.kind === "assumed-duration" ? recovery.load : null;
    const prof = JSON.parse(localStorage.getItem("ml_profile") ?? "{}") as { weight?: number; height?: number };
    type Sess = { sport?: string; action?: string; score?: number; date?: string; report?: { biomech?: { reps?: unknown[]; tempo?: { avgRepS?: number | null } } } };
    const sessions = (JSON.parse(localStorage.getItem("ml_sessions") ?? "[]") as Sess[]).slice(-5).map((s) => ({
      sport: s.sport, action: s.action, score: s.score, when: s.date?.slice(0, 16),
      reps: s.report?.biomech?.reps?.length,
      avgRepS: s.report?.biomech?.tempo?.avgRepS ?? undefined,
    }));
    const meals = JSON.parse(localStorage.getItem("ml_fuel") ?? "[]") as { protein?: number; date: string }[];
    const protein48h = Math.round(
      meals.filter((m) => Date.now() - new Date(m.date).getTime() < 48 * 3600e3).reduce((a, m) => a + (m.protein || 0), 0)
    );
    return {
      weightKg: prof.weight ?? null,
      heightCm: prof.height ?? null,
      muscleLoad: load,
      recovery,
      recoveryText: recoveryStateText(recovery),
      protein48h,
      proteinTargetPerDay: proteinTargetForWeight(prof.weight),
      recentSessions: sessions,
    };
  } catch {
    return null;
  }
}

const SUGGESTIONS = [
  "How does the analysis work?",
  "Are my videos private?",
  "What do the scores mean?",
];

export default function Help() {
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", content: "Ask me about your training, recovery, or a MotionLab score." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  // arriving from the Home ask-bar (?q=...): fire the question immediately
  const autoSent = useRef(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q && !autoSent.current) {
      autoSent.current = true;
      window.history.replaceState(null, "", "/account/help"); // don't re-ask on refresh
      send(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next = [...msgs, { role: "user" as const, content: q }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, context: buildContext() }),
      });
      const j = await r.json();
      setMsgs((m) => [
        ...m,
        { role: "assistant", content: j.ok ? j.reply : "Sorry, I couldn't reach my brain just now — try again in a sec." },
      ]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Hmm, something glitched. Give it another try?" }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-graphite text-white">
      {/* header */}
      <div className="flex items-center gap-3 px-5 pb-3 pt-6">
        <button
          onClick={() => router.push("/account")}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white ring-1 ring-inset ring-white/15"
          aria-label="Back to profile"
        >
          ←
        </button>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 items-center rounded-full bg-white px-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="" className="h-5 w-auto" />
          </span>
          <div>
            <h1 className="font-golden text-[20px] leading-none">AI COACH</h1>
            <p className="mt-1 flex items-center gap-1.5 text-[11px] font-bold text-white/55">
              <span className="h-1.5 w-1.5 rounded-full bg-signal-good" /> TRAINING ASSISTANT
            </p>
          </div>
        </div>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[84%] rounded-2xl px-4 py-3 text-sm font-semibold leading-relaxed ${
                m.role === "user"
                  ? "rounded-br-md bg-signal-good text-white"
                  : "rounded-bl-md bg-white/[0.08] text-white ring-1 ring-inset ring-white/15"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="flex gap-1 rounded-2xl rounded-bl-md bg-white/[0.08] px-4 py-3 ring-1 ring-inset ring-white/15">
              {[0, 1, 2].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/55" style={{ animationDelay: `${d * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}
        {msgs.length === 1 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {SUGGESTIONS.map((sug) => (
              <button
                key={sug}
                onClick={() => send(sug)}
                className="rounded-full bg-white/[0.08] px-4 py-2.5 text-xs font-bold text-white ring-1 ring-inset ring-white/15 transition active:scale-95"
              >
                {sug}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* input — floating pill, same language as the bottom nav */}
      <div className="sticky bottom-0 bg-gradient-to-t from-graphite via-graphite to-transparent px-4 pb-3 pt-5">
        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="flex items-center gap-2 rounded-2xl bg-white/[0.08] p-2 ring-1 ring-inset ring-white/15 backdrop-blur-xl"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask MotionLab 2.0…"
            className="min-w-0 flex-1 rounded-xl bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white outline-none placeholder:text-white/40 focus:ring-1 focus:ring-inset focus:ring-white/25"
          />
          <button
            type="submit"
            disabled={!input.trim() || busy}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition active:scale-95 ${
              input.trim() && !busy ? "bg-white text-graphite" : "bg-white/10 text-white/30"
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
