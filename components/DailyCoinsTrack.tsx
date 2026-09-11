"use client";

// DAILY COINS as a Brawl-Stars NEW-Trophy-Road bar (researched from real
// screenshots, 2026-09): one continuous track across the week, the gold fill
// is a FATTER pipe poured into a plum groove, every day is a socket the bar
// swells into, rewards are oversized full-color coins overlapping from above,
// checks stamp at bar level, and an orange plaque under the fill tip marks
// where you stand. Claim = coin burst + counter bump + the fill pushes on.
//
// The three details that make it read "Supercell", not "seven dots on a line":
//   1. fill pipe ~2x the track height, bottom-lit (#FFDB66 inner edge)
//   2. sockets fused to the bar (gold when reached, plum radial when not);
//      missed days stay sunk & desaturated — the one deliberate break in gold
//   3. future rewards stay FULL COLOR (desire), only claimed get checks

import { useMemo, useState } from "react";
import { dayKey } from "@/lib/coins";

const BAR_Y = 76; // track centerline inside the 140px stage
const INSET = 22; // first/last node centers sit this far from the card edge

type NodeState = "claimed" | "today" | "grace" | "missed" | "future";
type Node = { k: string; label: string; state: NodeState; big: boolean; amount: number };

function weekNodes(claims: string[], offset: number): { nodes: Node[]; todayIdx: number } {
  const today = dayKey();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = dayKey(y);
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + offset * 7);
  const labels = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  let todayIdx = -1; // stays -1 for a past week → the road there is fully travelled
  const nodes = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const k = dayKey(d);
    if (k === today) todayIdx = i;
    const state: NodeState = claims.includes(k)
      ? "claimed"
      : k === today
      ? "today"
      : k === yesterday
      ? "grace"
      : k < today
      ? "missed"
      : "future";
    // Sunday pays double: a perfect week = 80 coins = exactly one Deluxe pack
    return { k, label: labels[i], state, big: i === 6, amount: i === 6 ? 20 : 10 };
  });
  return { nodes, todayIdx };
}

// chunky outlined coin — Supercell grammar: thick dark outline, inner ring,
// white sparkle. Full color even in the future (desire), grey only when missed.
function ChunkyCoin({ size, dim }: { size: number; dim?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      style={dim ? { filter: "grayscale(0.9) brightness(0.78)", opacity: 0.45 } : undefined}
    >
      <circle cx="20" cy="20" r="17.5" fill="#FFD21F" stroke="#3A2A10" strokeWidth="2.6" />
      <circle cx="20" cy="20" r="12" fill="none" stroke="#F5A800" strokeWidth="3" />
      {/* the brand bolt — this is a MotionLab coin, not a generic currency */}
      <path d="M21.8 10.5l-6.4 10.2h4.4l-1.6 8.8 6.6-10.6h-4.4z" fill="#C98F1B" />
      <path d="M12.2 8.6l0.9 2.1 2.1 0.9-2.1 0.9-0.9 2.1-0.9-2.1-2.1-0.9 2.1-0.9z" fill="#FFFFFF" />
    </svg>
  );
}

// green check with white + dark double stroke, stamped at bar level
function StampCheck({ fresh }: { fresh: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" className={fresh ? "check-stamp" : undefined}>
      <path d="M4.5 12.8l5 5L19.8 6.8" fill="none" stroke="#062B00" strokeWidth="8.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 12.8l5 5L19.8 6.8" fill="none" stroke="#FFFFFF" strokeWidth="6.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 12.8l5 5L19.8 6.8" fill="none" stroke="#37CE20" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DailyCoinsTrack({ claims, onClaim }: { claims: string[]; onClaim: (k: string, amount: number) => void }) {
  // 0 = this week, -1 = last week (read-only look-back, Trophy-Road style)
  const [week, setWeek] = useState(0);
  const { nodes, todayIdx } = useMemo(() => weekNodes(claims, week), [claims, week]);
  // burst particles + freshly-stamped check live only for the claim moment
  const [fx, setFx] = useState<{ idx: number; id: number } | null>(null);
  const [bump, setBump] = useState(0);

  const todayClaimed = todayIdx >= 0 && nodes[todayIdx].state === "claimed";
  const claimedCount = nodes.filter((n) => n.state === "claimed").length;
  const weekEarned = nodes.reduce((m, n) => m + (n.state === "claimed" ? n.amount : 0), 0);
  // the fill tip = where you stand: today's socket, pushed onward once
  // claimed; a past week's road is fully travelled
  const frac = todayIdx < 0 ? 1 : Math.min(1, (todayIdx + (todayClaimed ? 0.45 : 0)) / 6);

  function claim(n: Node, i: number) {
    if (n.state !== "today" && n.state !== "grace") return;
    onClaim(n.k, n.amount);
    setFx({ idx: i, id: Date.now() });
    setBump((b) => b + 1);
    setTimeout(() => setFx(null), 700);
  }

  // node center as a CSS position along the inset track
  const at = (i: number) => `calc(${INSET}px + (100% - ${INSET * 2}px) * ${i / 6})`;
  // the plaque is wide — clamp harder than the nodes so it never leaves the card
  const tip = `calc(${INSET}px + (100% - ${INSET * 2}px) * ${Math.min(0.82, Math.max(0.1, frac))})`;

  return (
    <div className="relative mt-4 overflow-hidden rounded-3xl bg-white p-5 pb-4 shadow-soft">
      {/* backdrop scene at ≤5% contrast — clouds, so the gold can scream */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-8 top-6 h-24 w-40 rounded-full bg-[#E4F2F4]/70" />
        <div className="absolute right-2 top-16 h-20 w-32 rounded-full bg-[#E9F5F0]/70" />
        <div className="absolute -bottom-10 left-1/4 h-24 w-48 rounded-full bg-[#EDF4EE]/80" />
      </div>

      {/* header: golden title + dark counter pill (Trophy-Road header grammar);
          the left chevron pages back to last week's road and returns */}
      <div className="relative">
        <h2 className="text-center font-golden text-2xl text-ink">DAILY COINS</h2>
        <button
          onClick={() => setWeek((w) => (w === 0 ? -1 : 0))}
          aria-label={week === 0 ? "Show last week" : "Back to this week"}
          className="absolute left-0 top-1/2 flex h-[26px] -translate-y-1/2 items-center gap-0.5 rounded-full bg-paper px-2 text-[12px] font-extrabold text-ink transition active:scale-90"
        >
          {week === 0 ? "‹" : "›"}
        </button>
        <span
          key={bump}
          className={`absolute right-0 top-1/2 flex h-[24px] -translate-y-1/2 items-center gap-1 rounded-full bg-[#23242A] pl-1.5 pr-2 ${bump ? "pill-bump" : ""}`}
        >
          <ChunkyCoin size={14} />
          <span className="text-[12px] font-extrabold tabular-nums text-white">{claimedCount}/7</span>
        </span>
      </div>

      {/* the road */}
      <div className="relative mt-1 h-[140px]">
        {/* plum groove */}
        <div
          className="absolute rounded-full"
          style={{
            left: INSET, right: INSET, top: BAR_Y - 4, height: 8,
            background: "linear-gradient(180deg,#C47378 0%,#AB4B70 30%,#A2445F 100%)",
            boxShadow: "inset 0 -2px 2px rgba(57,22,41,0.4)",
          }}
        />
        {/* gold fill — a fatter, bottom-lit pipe ON the groove */}
        <div
          className="absolute rounded-full transition-all duration-700 ease-out"
          style={{
            left: INSET, top: BAR_Y - 7, height: 14,
            width: `max(14px, calc((100% - ${INSET * 2}px) * ${frac}))`,
            background: "linear-gradient(180deg,#F9BE4B 0%,#FFBB4B 55%,#FFDB66 82%,#EFA93E 100%)",
            boxShadow: "0 0 0 1px rgba(80,20,35,0.35), 0 1px 2px rgba(57,22,41,0.25)",
          }}
        />

        {/* sockets — the bar swells at every day */}
        {nodes.map((n, i) => {
          const reached = i < todayIdx || n.state === "claimed";
          const sunk = n.state === "missed"; // the one deliberate break in the gold
          return (
            <div
              key={`s${n.k}`}
              className="absolute rounded-[50%]"
              style={{
                left: at(i), top: BAR_Y - 11, width: 42, height: 22, transform: "translateX(-50%)",
                background: reached && !sunk
                  ? "radial-gradient(ellipse at 50% 35%, #FFC95A 0%, #F0A63E 70%, #D17E33 100%)"
                  : "radial-gradient(ellipse at 50% 35%, #7A2D47 0%, #521F36 100%)",
                boxShadow: reached && !sunk
                  ? "0 0 0 1px rgba(80,20,35,0.35)"
                  : "inset 0 2px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(57,22,41,0.5)",
              }}
            >
              {!reached && !sunk && (
                <span className="absolute left-[30%] top-[30%] h-[3px] w-[3px] rounded-full bg-white/70" />
              )}
            </div>
          );
        })}

        {/* per-day rewards */}
        {nodes.map((n, i) => {
          const size = n.state === "today" ? 42 : n.state === "grace" ? 36 : n.state === "claimed" ? 30 : n.state === "missed" ? 24 : n.big ? 34 : 28;
          const raise = n.state === "today" ? 6 : n.state === "grace" ? 4 : 0;
          // coins overlap the socket TOP only — the groove must stay visible
          const top = n.state === "missed" ? BAR_Y - size / 2 : BAR_Y + 2 - size - raise;
          const claimable = n.state === "today" || n.state === "grace";
          return (
            <div key={n.k} className="absolute" style={{ left: at(i), top: 0, bottom: 0, width: 0 }}>
              {/* floating amount chip — TODAY only (grace gets a corner badge,
                  so two adjacent claimables never collide) */}
              {n.state === "today" && (
                <div className="absolute -translate-x-1/2" style={{ top: top - 27, left: 0 }}>
                  <span
                    className="flex h-[21px] items-center gap-0.5 whitespace-nowrap rounded-lg px-1.5 text-[11px] font-extrabold text-white"
                    style={{
                      background: "linear-gradient(180deg,#43E6DF 0%,#04B5FB 100%)",
                      boxShadow: "0 0 0 1px rgba(23,39,31,0.25)",
                      textShadow: "0 1px 0 rgba(23,39,31,0.35)",
                    }}
                  >
                    <ChunkyCoin size={12} /> +{n.amount}
                  </span>
                  <span
                    className="absolute left-1/2 top-full -translate-x-1/2"
                    style={{
                      width: 0, height: 0, borderLeft: "5px solid transparent",
                      borderRight: "5px solid transparent", borderTop: "5px solid #04B5FB",
                    }}
                  />
                </div>
              )}

              {/* Sunday ×2 ribbon */}
              {n.big && !claimable && n.state !== "claimed" && (
                <span
                  className="absolute -translate-x-1/2 rounded bg-[#DEE6CF] px-1 text-[11px] font-extrabold text-[#8A6FE8]"
                  style={{ top: top - 15, left: 0, boxShadow: "0 0 0 1px rgba(23,39,31,0.15)" }}
                >
                  ×2
                </span>
              )}

              {/* glow behind claimable coins */}
              {claimable && (
                <span
                  className="absolute -translate-x-1/2"
                  style={{
                    top: top + size / 2 - 32, left: 0, width: 64, height: 64, borderRadius: "50%",
                    background: `radial-gradient(circle, rgba(255,217,59,${n.state === "today" ? 0.5 : 0.28}) 0%, rgba(255,217,59,0) 68%)`,
                  }}
                />
              )}

              {/* the coin itself */}
              <button
                onClick={() => claim(n, i)}
                disabled={!claimable}
                aria-label={claimable ? `Claim ${n.label}'s ${n.amount} coins` : n.label}
                className={`absolute -translate-x-1/2 ${n.state === "today" ? "node-pulse" : ""} ${claimable ? "active:scale-90" : ""}`}
                style={{ top, left: 0 }}
              >
                <ChunkyCoin size={size} dim={n.state === "missed"} />
                {n.state === "grace" && (
                  <span
                    className="absolute -right-1.5 -top-1 grid h-[15px] w-[15px] place-items-center rounded-full text-[11px] font-extrabold leading-none text-white"
                    style={{ background: "linear-gradient(180deg,#FFB020,#FF9900)", boxShadow: "0 0 0 1.5px #FFFFFF" }}
                  >
                    !
                  </span>
                )}
              </button>

              {/* check stamped at bar level */}
              {n.state === "claimed" && (
                <span className="absolute -translate-x-1/2" style={{ top: BAR_Y - 10, left: 0 }}>
                  <StampCheck fresh={fx?.idx === i} />
                </span>
              )}

              {/* claim burst: gold particles arc out, +N floats away */}
              {fx?.idx === i && (
                <>
                  {[...Array(6)].map((_, p) => (
                    <span
                      key={`${fx.id}-${p}`}
                      className="coin-fly absolute -translate-x-1/2"
                      style={{
                        top: BAR_Y - 20, left: 0,
                        ["--dx" as string]: `${[-34, -20, -8, 8, 22, 36][p]}px`,
                        ["--dy" as string]: `${[-46, -64, -52, -66, -50, -58][p]}px`,
                        animationDelay: `${p * 40}ms`,
                      }}
                    >
                      <ChunkyCoin size={13} />
                    </span>
                  ))}
                  <span
                    className="plus-fly absolute -translate-x-1/2 text-[15px] font-extrabold text-[#F5A800]"
                    style={{ top: BAR_Y - 44, left: 0, textShadow: "0 1px 0 #FFFFFF" }}
                  >
                    +{n.amount}
                  </span>
                </>
              )}

              {/* day label in the track's own color family */}
              <span
                className={`absolute -translate-x-1/2 text-[11px] font-extrabold tracking-wide ${
                  n.state === "today" ? "text-ink" : n.state === "missed" ? "text-[#F2877B]/50" : "text-[#F2877B]"
                }`}
                style={{ top: BAR_Y + 16, left: 0 }}
              >
                {n.state === "today" ? "TODAY" : n.label.slice(0, 1) + n.label.slice(1, 3).toLowerCase()}
              </span>
            </div>
          );
        })}

        {/* current-position plaque under the fill tip — hard shadow, no blur */}
        <div className="absolute -translate-x-1/2" style={{ left: tip, top: BAR_Y + 36 }}>
          <span
            className="absolute bottom-full left-1/2 -translate-x-1/2"
            style={{
              width: 0, height: 0, borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent", borderBottom: "6px solid #FF9900",
            }}
          />
          <span
            className="flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#FF9900] px-2"
            style={{ boxShadow: "3px 3px 0 rgba(60,60,70,0.28), 0 0 0 1px rgba(80,40,0,0.25)" }}
          >
            <ChunkyCoin size={15} />
            <span className="text-[14px] font-extrabold tabular-nums text-white" style={{ textShadow: "0 1px 0 rgba(80,40,0,0.4)" }}>
              {weekEarned}
            </span>
            <span className="text-[11px] font-bold italic text-[#FFE98A]">{week === 0 ? "THIS WEEK" : "LAST WEEK"}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
