"use client";

// My tree — streak coins → packs → ornaments, GameKit-style:
// buy → the pack SHAKES and RIPS open (top flies off, light burst) → the
// ornament springs out → a bubble with Continue → everything blurs except the
// tree and you CLICK where to hang it (snaps to the nearest free hook).
// Storage: ml_coins_spent, ml_ornaments (Orn[], `s` = hook index once hung).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addBonusCoins, dayKey, getCoinBalance, notifyCoins } from "@/lib/coins";
import { CoinIcon } from "@/components/Icons";
import { DailyCoinsTrack } from "@/components/DailyCoinsTrack";

type OrnType = "ball" | "bell" | "candy" | "flake" | "gift";
// x/y = FREE position on the tree (viewBox coords) once hung; `s` is the old
// slot-based format, migrated to x/y on load
type Orn = { type: OrnType; color: string; x?: number; y?: number; s?: number };

const COINS_PER_DAY = 10;
const BALL_COLORS = ["#FF5A5F", "#F5B23D", "#12C6D4", "#FF8AB3", "#FFF6DC", "#B48CF2"];

// the shop shelf — GameKit-style, two packs side by side
const PACKS = [
  { key: "basic", name: "Ornament pack", sub: "1 random decoration", cost: 30, rolls: 1, deluxe: false },
  { key: "deluxe", name: "Deluxe pack", sub: "2 decorations · rarer finds", cost: 80, rolls: 2, deluxe: true },
] as const;
type Pack = (typeof PACKS)[number];

// legacy slot positions — only used to migrate old slot-based ornaments
const SLOTS: [number, number][] = [
  [110, 64], [96, 92], [126, 94], [82, 122], [112, 126], [140, 120],
  [70, 152], [98, 156], [126, 158], [150, 150], [60, 186], [88, 190],
  [116, 192], [142, 188], [164, 182], [76, 220], [104, 224], [132, 222],
  [156, 216], [110, 158],
];

// the fir's four foliage tiers (also used to draw it)
const TIERS = [
  { y: 42, w: 40, h: 56 },
  { y: 76, w: 58, h: 66 },
  { y: 116, w: 76, h: 74 },
  { y: 158, w: 94, h: 80 },
];

// ornaments can ONLY sit on the foliage: clamp any point to the widest tier
// triangle at that height, never beside or below the tree
function clampToTree(x: number, y: number): [number, number] {
  const Y = Math.min(232, Math.max(52, y));
  let half = 0;
  for (const t of TIERS) {
    if (Y >= t.y && Y <= t.y + t.h) half = Math.max(half, (t.w * (Y - t.y)) / t.h);
  }
  half = Math.max(3, half - 6); // keep the bauble on the branches
  const X = Math.min(110 + half, Math.max(110 - half, x));
  return [X, Y];
}

const ORN_NAMES: Record<OrnType, string> = {
  ball: "Bauble", bell: "Golden bell", candy: "Candy cane", flake: "Snowflake", gift: "Tiny gift",
};

function rollOrnament(deluxe: boolean): Orn {
  const r = Math.random();
  const ball = deluxe ? 0.35 : 0.6, candy = deluxe ? 0.55 : 0.75, bell = deluxe ? 0.75 : 0.9, flake = deluxe ? 0.9 : 0.97;
  if (r < ball) return { type: "ball", color: BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)] };
  if (r < candy) return { type: "candy", color: "#FF5A5F" };
  if (r < bell) return { type: "bell", color: "#F5B23D" };
  if (r < flake) return { type: "flake", color: "#EAF6FF" };
  return { type: "gift", color: "#FF5A5F" };
}

// one hung ornament, drawn by type
function Ornament({ x, y, o, scale = 1 }: { x: number; y: number; o: Orn; scale?: number }) {
  const s = (v: number) => v * scale;
  switch (o.type) {
    case "bell":
      return (
        <g transform={`translate(${x} ${y})`}>
          <path d={`M0 ${s(-7)} Q ${s(6)} ${s(-6)} ${s(6)} ${s(3)} L ${s(-6)} ${s(3)} Q ${s(-6)} ${s(-6)} 0 ${s(-7)}`} fill={o.color} />
          <rect x={s(-7)} y={s(3)} width={s(14)} height={s(2.2)} rx={s(1)} fill="#C98F1B" />
          <circle cx="0" cy={s(6.5)} r={s(1.8)} fill="#C98F1B" />
        </g>
      );
    case "candy":
      return (
        <g transform={`translate(${x} ${y})`} fill="none" strokeLinecap="round">
          <path d={`M ${s(-2)} ${s(7)} L ${s(-2)} ${s(-3)} Q ${s(-2)} ${s(-7)} ${s(2)} ${s(-7)} Q ${s(5)} ${s(-7)} ${s(5)} ${s(-4)}`} stroke="#fff" strokeWidth={s(3.4)} />
          <path d={`M ${s(-2)} ${s(7)} L ${s(-2)} ${s(-3)} Q ${s(-2)} ${s(-7)} ${s(2)} ${s(-7)} Q ${s(5)} ${s(-7)} ${s(5)} ${s(-4)}`} stroke={o.color} strokeWidth={s(3.4)} strokeDasharray={`${s(2.6)} ${s(2.6)}`} />
        </g>
      );
    case "flake":
      return (
        <g transform={`translate(${x} ${y})`} stroke={o.color} strokeWidth={s(1.4)} strokeLinecap="round">
          {[0, 60, 120].map((a) => (
            <line key={a} x1={-s(6) * Math.cos((a * Math.PI) / 180)} y1={-s(6) * Math.sin((a * Math.PI) / 180)} x2={s(6) * Math.cos((a * Math.PI) / 180)} y2={s(6) * Math.sin((a * Math.PI) / 180)} />
          ))}
        </g>
      );
    case "gift":
      return (
        <g transform={`translate(${x} ${y})`}>
          <rect x={s(-6)} y={s(-5)} width={s(12)} height={s(11)} rx={s(1.5)} fill={o.color} />
          <rect x={s(-1.2)} y={s(-5)} width={s(2.4)} height={s(11)} fill="#FFE9B8" />
          <rect x={s(-6)} y={s(-1.2)} width={s(12)} height={s(2.4)} fill="#FFE9B8" />
        </g>
      );
    default:
      return (
        <g transform={`translate(${x} ${y})`}>
          <line x1="0" y1={s(-9)} x2="0" y2={s(-6)} stroke="#C9B896" strokeWidth={s(1)} />
          <circle r={s(6)} fill={o.color} />
          <circle cx={s(-2)} cy={s(-2.2)} r={s(1.8)} fill="rgba(255,255,255,0.7)" />
        </g>
      );
  }
}

type OpenStage = "tear" | "bubble";

export default function Tree() {
  const router = useRouter();
  const [coins, setCoins] = useState(0);
  const [inv, setInv] = useState<Orn[]>([]);
  const [opening, setOpening] = useState<{ pack: Pack; stage: OpenStage; won: Orn[] } | null>(null);
  const [placing, setPlacing] = useState<number[]>([]); // inv indices awaiting a hook
  const [broke, setBroke] = useState(false);
  // EDIT mode: free-drag ornaments anywhere, then Save persists the layout
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<{ invIdx: number } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Brawl-Stars-style daily reward track: one claim per day; yesterday's
  // missed coin stays claimable, older ones are gone (ml_daily_claims)
  const [dailyClaims, setDailyClaims] = useState<string[]>([]);

  useEffect(() => {
    setCoins(getCoinBalance());
    try {
      let c: string[] = JSON.parse(localStorage.getItem("ml_daily_claims") ?? "[]");
      // migrate the old single-day marker so today doesn't double-pay
      const legacy = localStorage.getItem("ml_daily_claim");
      if (legacy && !c.includes(legacy)) c = [...c, legacy];
      setDailyClaims(c);
    } catch {}
    let stored: Orn[] = [];
    try { stored = JSON.parse(localStorage.getItem("ml_ornaments") ?? "[]"); } catch {}
    // migrate old slot-based ornaments to free positions, and pull anything
    // that ended up off the foliage back onto the tree
    let migrated = false;
    stored = stored.map((o) => {
      let next = o;
      if (o.x == null && o.s != null && SLOTS[o.s]) {
        next = { ...o, x: SLOTS[o.s][0], y: SLOTS[o.s][1] };
        migrated = true;
      }
      if (next.x != null) {
        const [cx, cy] = clampToTree(next.x, next.y!);
        if (cx !== next.x || cy !== next.y) {
          next = { ...next, x: cx, y: cy };
          migrated = true;
        }
      }
      return next;
    });
    if (migrated) localStorage.setItem("ml_ornaments", JSON.stringify(stored));
    setInv(stored);
    // ornaments bought but never hung (left mid-flow) resume placement now
    const unplaced = stored.map((o, i) => (o.x == null ? i : -1)).filter((i) => i >= 0);
    if (unplaced.length) setPlacing(unplaced);
    return () => timers.current.forEach(clearTimeout);
  }, []);

  function saveInv(next: Orn[]) {
    setInv(next);
    localStorage.setItem("ml_ornaments", JSON.stringify(next));
  }

  function claimDaily(k: string, amount: number) {
    if (dailyClaims.includes(k)) return;
    const next = [...dailyClaims, k].slice(-30);
    setDailyClaims(next);
    localStorage.setItem("ml_daily_claims", JSON.stringify(next));
    localStorage.setItem("ml_daily_claim", dayKey()); // keep the legacy marker in sync
    addBonusCoins(amount);
    setCoins(getCoinBalance());
    notifyCoins();
  }

  function buyPack(pack: Pack) {
    if (opening || placing.length) return;
    if (coins < pack.cost) {
      setBroke(true);
      return;
    }
    const won = Array.from({ length: pack.rolls }, () => rollOrnament(pack.deluxe));
    localStorage.setItem(
      "ml_coins_spent",
      String((Number(localStorage.getItem("ml_coins_spent") ?? 0) || 0) + pack.cost)
    );
    saveInv([...inv, ...won]); // owned immediately; hung after placement
    setCoins(getCoinBalance());
    notifyCoins();
    // the show: tear (~1.75s) → straight to the bubble with Continue
    setOpening({ pack, stage: "tear", won });
    timers.current.push(setTimeout(() => setOpening((o) => (o ? { ...o, stage: "bubble" } : o)), 1750));
  }

  function startPlacing() {
    const unplaced = inv.map((o, i) => (o.x == null ? i : -1)).filter((i) => i >= 0);
    setOpening(null);
    setPlacing(unplaced);
  }

  // pixel → viewBox coordinates
  function svgXY(el: SVGSVGElement, clientX: number, clientY: number): [number, number] {
    const r = el.getBoundingClientRect();
    return [((clientX - r.left) / r.width) * 220, ((clientY - r.top) / r.height) * 270];
  }

  // click the tree → the ornament hangs EXACTLY where you clicked
  function onTreeClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!placing.length) return;
    const [rx, ry] = svgXY(e.currentTarget, e.clientX, e.clientY);
    const [x, y] = clampToTree(rx, ry);
    const idx = placing[0];
    const next = [...inv];
    next[idx] = { ...next[idx], x, y };
    saveInv(next);
    setPlacing((q) => q.slice(1));
  }

  // EDIT drags: press anywhere near an ornament to pick it up (no precise
  // hit needed), move it ANYWHERE, release to drop. Save persists.
  function onSvgPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!editing) return;
    e.preventDefault();
    const [x, y] = svgXY(e.currentTarget, e.clientX, e.clientY);
    let best = -1, bd = Infinity;
    inv.forEach((o, i) => {
      if (o.x == null) return;
      const d = (o.x - x) ** 2 + (o.y! - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0 && bd < 55 ** 2) setDrag({ invIdx: best });
  }
  function onSvgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!editing || !drag) return;
    const [rx, ry] = svgXY(e.currentTarget, e.clientX, e.clientY);
    const [x, y] = clampToTree(rx, ry);
    setInv((prev) => {
      const c = [...prev];
      c[drag.invIdx] = { ...c[drag.invIdx], x, y };
      return c;
    });
  }
  function onSvgPointerUp() {
    setDrag(null);
  }
  function saveLayout() {
    localStorage.setItem("ml_ornaments", JSON.stringify(inv));
    setEditing(false);
    setDrag(null);
  }

  const hung = inv.filter((o) => o.x != null);
  const placingActive = placing.length > 0;
  const current = placingActive ? inv[placing[0]] : null;
  const focused = placingActive || editing; // tree lifted above the blur

  return (
    <div className="stagger px-5 pb-8 pt-8">
      <div className="flex items-center gap-3">
        <button
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/streak"))}
          className="grid h-9 w-9 place-items-center rounded-full bg-white text-ink shadow-soft"
        >
          ←
        </button>
        <h1 className="flex-1 text-2xl font-extrabold tracking-tight">My tree</h1>
      </div>

      {/* placing/editing: dim + blur EVERYTHING except the tree card */}
      {focused && <div className="fixed inset-0 z-[60] bg-ink/45 backdrop-blur-[6px]" />}

      {/* the fir — night scene. While placing/editing, ONLY the tree (and its
          instruction) lift above the blur — the card itself stays dimmed too. */}
      <div className="relative mt-5 overflow-hidden rounded-3xl bg-gradient-to-b from-[#0E1B2E] via-[#12283C] to-[#1C4A32] p-5 text-center shadow-lift">
        {/* rearrange the layout */}
        {!focused && hung.length > 0 && (
          <button
            onClick={() => setEditing(true)}
            className="absolute right-5 top-5 z-10 flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-ink shadow-soft transition active:scale-95"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16.5 3.9a2.1 2.1 0 0 1 3 3L7 19.4l-4 1 1-4L16.5 3.9z" />
            </svg>
            Edit
          </button>
        )}
        <div className={focused ? "relative z-[65]" : ""}>
        {editing && (
          <p className="mb-2 font-golden text-lg leading-tight text-white">DRAG ORNAMENTS TO MOVE THEM</p>
        )}
        {placingActive && (
          <div className="mb-2 flex items-center justify-center gap-2">
            <p className="font-golden text-lg leading-tight text-white">CLICK WHERE YOU WANT TO HANG IT</p>
            {current && (
              <svg viewBox="-10 -10 20 20" className="h-7 w-7 shrink-0">
                <Ornament x={0} y={0} o={current} />
              </svg>
            )}
          </div>
        )}
        {placingActive && placing.length > 1 && (
          <p className="-mt-1 mb-1 text-[11px] font-semibold text-white/60">{placing.length} to hang</p>
        )}
        <svg
          viewBox="0 0 220 270"
          onClick={onTreeClick}
          onPointerDown={onSvgPointerDown}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
          onPointerLeave={onSvgPointerUp}
          className={`mx-auto w-[250px] max-w-full ${placingActive ? "cursor-pointer" : ""} ${
            editing ? "cursor-grab touch-none" : ""
          }`}
        >
          <defs>
            <linearGradient id="tier" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#4FA372" />
              <stop offset="1" stopColor="#2A6B48" />
            </linearGradient>
            <linearGradient id="tierD" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#35855A" />
              <stop offset="1" stopColor="#1F5237" />
            </linearGradient>
            <radialGradient id="starGlow">
              <stop offset="0" stopColor="rgba(245,178,61,0.55)" />
              <stop offset="1" stopColor="rgba(245,178,61,0)" />
            </radialGradient>
          </defs>

          <ellipse cx="110" cy="252" rx="92" ry="12" fill="rgba(255,255,255,0.9)" />
          <ellipse cx="110" cy="248" rx="60" ry="8" fill="#fff" />

          <rect x="101" y="228" width="18" height="26" rx="4" fill="#5E3F26" />
          <rect x="101" y="228" width="7" height="26" rx="3" fill="#6B4A2E" />

          <circle cx="110" cy="34" r="26" fill="url(#starGlow)" />
          <path d="M110 18l4.6 9.4 10.4 1.5-7.5 7.3 1.8 10.3-9.3-4.9-9.3 4.9 1.8-10.3-7.5-7.3 10.4-1.5L110 18z" fill="#F5B23D" />

          {TIERS.map((t, i) => {
            const bottom = t.y + t.h;
            const jag = (x0: number, x1: number) => {
              const seg = (x1 - x0) / 6;
              let d = "";
              for (let k = 0; k < 6; k++) {
                const xa = x0 + seg * (k + 0.5);
                const xb = x0 + seg * (k + 1);
                d += ` Q ${xa} ${bottom + 9} ${xb} ${bottom}`;
              }
              return d;
            };
            return (
              <g key={i}>
                <path d={`M110 ${t.y + 6} L ${110 - t.w} ${bottom + 6} ${jag(110 - t.w, 110 + t.w)} Z`} fill="url(#tierD)" />
                <path d={`M110 ${t.y} L ${110 - t.w + 6} ${bottom} ${jag(110 - t.w + 6, 110 + t.w - 6)} L 110 ${t.y} Z`} fill="url(#tier)" />
              </g>
            );
          })}

          <path d="M70 98 Q 78 104 86 99 M132 96 Q 140 102 150 97" stroke="rgba(255,255,255,0.55)" strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M52 178 Q 62 185 74 179 M148 176 Q 158 183 170 177" stroke="rgba(255,255,255,0.5)" strokeWidth="3" strokeLinecap="round" fill="none" />

          {inv.map((o, invIdx) =>
            o.x == null ? null : <Ornament key={invIdx} x={o.x} y={o.y!} o={o} />
          )}
        </svg>
        {editing && (
          <button
            onClick={saveLayout}
            className="mt-3 w-full rounded-full bg-white py-3 text-sm font-extrabold text-ink transition active:scale-[0.98]"
          >
            Save
          </button>
        )}
        </div>
        {hung.length > 0 && !focused && (
          <p className="mt-1 text-sm font-semibold text-white/75">
            {hung.length} {hung.length === 1 ? "ornament" : "ornaments"} hung
          </p>
        )}
      </div>

      {/* DAILY COINS — the reworked Trophy-Road bar, rebuilt from real
          Brawl Stars screenshots: gold fill poured into a plum groove,
          day sockets, oversized coins, claim burst (components/DailyCoinsTrack) */}
      <DailyCoinsTrack claims={dailyClaims} onClaim={claimDaily} />

      {/* SHOP — big title, coin balance top-right (the header no longer shows coins) */}
      <div className="relative mt-4 rounded-3xl bg-white p-5 shadow-soft">
        <h2 className="text-center font-golden text-3xl text-ink">SHOP</h2>
        <span className="absolute right-4 top-4 flex h-8 items-center gap-1 rounded-full bg-paper pl-1.5 pr-2.5 shadow-soft">
          <CoinIcon size={17} />
          <span className="text-[13px] font-extrabold tabular-nums text-ink">{coins}</span>
        </span>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {PACKS.map((p) => (
            <div key={p.key} className="flex flex-col items-center rounded-2xl bg-paper p-4">
              <div
                className={`relative grid h-20 w-16 place-items-center rounded-xl shadow-soft ${
                  p.deluxe ? "bg-gradient-to-b from-[#F5B23D] to-[#C98F1B]" : "bg-gradient-to-b from-volt to-volt-deep"
                }`}
              >
                <span className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-ink text-[11px] font-extrabold text-white shadow-soft">
                  ?
                </span>
                <MiniPackTree />
                {p.deluxe && <span className="absolute bottom-1 text-[9px] font-extrabold uppercase tracking-wide text-white/90">×2</span>}
              </div>
              <p className="mt-3 text-sm font-extrabold text-ink">{p.name}</p>
              <p className="mt-0.5 text-center text-[11px] font-bold leading-tight text-ink-soft">{p.sub}</p>
              <button
                onClick={() => buyPack(p)}
                className="btn-press mt-3 flex w-full items-center justify-center gap-1.5 rounded-full bg-ink py-2.5 text-sm font-extrabold text-white transition"
              >
                <CoinIcon size={15} />
                {p.cost}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* PACK OPENING — tear → reveal → bubble */}
      {opening && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-ink/70 px-8 backdrop-blur-[3px]">
          {opening.stage === "tear" && (
            <div className="relative">
              {/* light burst behind the rip */}
              <span className="pack-burst absolute left-1/2 top-1/2 -ml-20 -mt-20 h-40 w-40 rounded-full bg-[#F5B23D]/70" />
              <div className="pack-wiggle relative">
                <div
                  className={`relative grid h-48 w-36 place-items-center rounded-2xl shadow-lift ${
                    opening.pack.deluxe ? "bg-gradient-to-b from-[#F5B23D] to-[#C98F1B]" : "bg-gradient-to-b from-volt to-volt-deep"
                  }`}
                >
                  <MiniPackTree size={2.2} />
                  <span className="absolute bottom-2 text-[11px] font-extrabold uppercase tracking-wide text-white/80">
                    {opening.pack.name}
                  </span>
                </div>
                {/* the top strip that rips off */}
                <div
                  className={`pack-rip absolute -top-0 left-0 right-0 h-10 rounded-t-2xl border-b-2 border-dashed border-white/40 ${
                    opening.pack.deluxe ? "bg-[#C98F1B]" : "bg-volt-deep"
                  }`}
                />
              </div>
            </div>
          )}

          {opening.stage === "bubble" && (
            <div className="w-full max-w-[300px] animate-pop rounded-3xl bg-paper p-6 text-center shadow-lift">
              <div className="flex items-center justify-center gap-2">
                {opening.won.map((o, i) => (
                  <div key={i} className="float-soft" style={{ animationDelay: `${i * 0.3}s` }}>
                    <svg viewBox="-20 -20 40 40" className="h-20 w-20">
                      <Ornament x={0} y={0} o={o} scale={2} />
                    </svg>
                  </div>
                ))}
              </div>
              <p className="mt-1 font-golden text-2xl leading-none text-ink">
                {opening.won.map((o) => ORN_NAMES[o.type].toUpperCase()).join(" + ")}
              </p>
              <button
                onClick={startPlacing}
                className="btn-press mt-5 w-full rounded-full bg-ink py-3 text-sm font-extrabold text-white transition"
              >
                Continue
              </button>
            </div>
          )}
        </div>
      )}

      {/* not enough coins */}
      {broke && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-ink/50 px-10 backdrop-blur-[2px]" onClick={() => setBroke(false)}>
          <div className="w-full max-w-[280px] animate-pop rounded-3xl bg-paper p-6 text-center shadow-lift" onClick={(e) => e.stopPropagation()}>
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-black/5 opacity-70">
              <CoinIcon size={26} />
            </span>
            <p className="mt-3 text-base font-extrabold text-ink">Not enough coins</p>
            <button
              onClick={() => setBroke(false)}
              className="btn-press mt-5 w-full rounded-full bg-ink py-3 text-sm font-bold text-white transition"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniPackTree({ size = 1 }: { size?: number }) {
  return (
    <svg width={26 * size} height={30 * size} viewBox="0 0 26 30">
      <path d="M13 2l1.2 2.4 2.6.4-1.9 1.8.5 2.6L13 8l-2.4 1.2.5-2.6-1.9-1.8 2.6-.4L13 2z" fill="#F5B23D" />
      <path d="M13 8 6 18h14L13 8z" fill="#8FD6A8" />
      <path d="M13 13 3 26h20L13 13z" fill="#E3F0E8" />
    </svg>
  );
}
