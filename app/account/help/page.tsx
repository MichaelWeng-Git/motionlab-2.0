"use client";

// Chat with MotionLab 2.0 — the in-app assistant.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
      proteinTargetPerDay: prof.weight ? Math.round(prof.weight * 1.6) : null,
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
    { role: "assistant", content: "Hey! I'm MotionLab 2.0. Ask me anything about the app or your training — why your muscles look the way they do, what a score means, how to recover faster." },
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
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center gap-3 px-5 pt-6 pb-3">
        <button
          onClick={() => router.push("/account")}
          className="grid h-9 w-9 place-items-center rounded-full bg-white text-ink shadow-soft"
        >
          ←
        </button>
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" className="h-6 w-auto" />
          <div>
            <p className="text-sm font-extrabold leading-none">MotionLab 2.0</p>
            <p className="mt-1 text-[11px] text-signal-good">● Always here to help</p>
          </div>
        </div>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-3">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[82%] rounded-3xl px-4 py-2.5 text-sm leading-relaxed shadow-soft ${
                m.role === "user"
                  ? "rounded-br-lg bg-ink text-white"
                  : "rounded-bl-lg bg-white text-ink"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="flex gap-1 rounded-3xl rounded-bl-lg bg-white px-4 py-3 shadow-soft">
              {[0, 1, 2].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted" style={{ animationDelay: `${d * 0.15}s` }} />
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
                className="rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-ink shadow-soft transition active:scale-95"
              >
                {sug}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* input — floating pill, same language as the bottom nav */}
      <div className="px-4 pb-[max(0.9rem,env(safe-area-inset-bottom))] pt-2">
        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="flex items-center gap-2 rounded-2xl bg-paper/50 p-2 shadow-lift backdrop-blur-xl"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask MotionLab 2.0…"
            className="flex-1 rounded-full bg-white px-4 py-3 text-sm outline-none focus:border-ink"
          />
          <button
            type="submit"
            disabled={!input.trim() || busy}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition active:scale-95 ${
              input.trim() && !busy ? "bg-ink text-white" : "bg-black/10 text-ink-muted"
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
