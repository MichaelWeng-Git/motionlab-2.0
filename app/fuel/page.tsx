"use client";

// FUEL — athlete fueling, framed as training input (never a diet app):
// snap a meal → the vision model estimates macros → protein counts toward
// a 1.6 g/kg daily target. Photos are analyzed and dropped, never stored.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { logMeal, proteinTarget, removeMeal, todayMeals, type Meal } from "@/lib/fuel";

type Scan = {
  isFood: boolean;
  dish: string;
  protein: number;
  carbs: number;
  fat: number;
  kcal: number;
  confidence: "high" | "medium" | "low";
};

const CONF: Record<Scan["confidence"], string> = { high: "#3BA55D", medium: "#E8A13C", low: "#E0523F" };

export default function Fuel() {
  const router = useRouter();
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "scanning" | "result" | "notfood" | "error">("idle");
  const [scan, setScan] = useState<Scan | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [target, setTarget] = useState<number | null>(null); // null = weight not set
  const [logged, setLogged] = useState(false);

  useEffect(() => {
    setMeals(todayMeals());
    setTarget(proteinTarget());
  }, []);

  // downscale to a small JPEG — enough for the model, tiny upload
  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const img = new Image();
    img.onload = async () => {
      const MAX = 640;
      const s = Math.min(1, MAX / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      const dataUrl = c.toDataURL("image/jpeg", 0.8);
      setPhoto(dataUrl);
      setScan(null);
      setLogged(false);
      setPhase("scanning");
      try {
        const r = await fetch("/api/fuel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl }),
        });
        const data = await r.json();
        if (!r.ok || !data.ok) throw new Error("scan failed");
        if (!data.isFood) {
          setPhase("notfood");
          return;
        }
        setScan(data as Scan);
        setPhase("result");
      } catch {
        setPhase("error");
      }
    };
    img.src = URL.createObjectURL(file);
  }

  function logIt() {
    if (!scan || logged) return;
    logMeal({ dish: scan.dish, protein: scan.protein, carbs: scan.carbs, fat: scan.fat, kcal: scan.kcal });
    setMeals(todayMeals());
    setLogged(true);
    setTimeout(() => {
      setPhase("idle");
      setPhoto(null);
      setScan(null);
    }, 700);
  }

  const protein = meals.reduce((m, x) => m + x.protein, 0);
  const pct = target ? Math.min(1, protein / target) : 0;

  return (
    <div className="stagger px-5 pb-8 pt-8">
      <div className="flex items-center gap-3">
        <button
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          className="grid h-9 w-9 place-items-center rounded-full bg-white text-ink shadow-soft"
        >
          ←
        </button>
        <h1 className="text-2xl font-extrabold tracking-tight">Fuel</h1>
      </div>

      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
      <input ref={libRef} type="file" accept="image/*" className="hidden" onChange={onPick} />

      {/* the scanner */}
      <div className="mt-4 overflow-hidden rounded-3xl bg-white shadow-soft">
        {photo ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="Your meal" className="max-h-[240px] w-full object-cover" />
            {phase === "scanning" && (
              <div className="absolute inset-0 overflow-hidden bg-ink/30">
                <div className="animate-scan absolute inset-x-0 h-1/3 bg-gradient-to-b from-transparent via-white/50 to-transparent" />
              </div>
            )}
            {phase === "result" && scan && (
              <span
                className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-white"
                style={{ background: CONF[scan.confidence] }}
              >
                {scan.confidence}
              </span>
            )}
          </div>
        ) : (
          <div className="grid h-[190px] place-items-center bg-[radial-gradient(120%_100%_at_50%_0%,#24463A_0%,#0E1811_65%)]">
            <div className="text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white/[0.12]">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 7h3l2-2.5h6L17 7h3a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V8.5A1.5 1.5 0 0 1 4 7z" />
                  <circle cx="12" cy="13" r="3.6" />
                </svg>
              </span>
              <p className="mt-3 font-golden text-2xl leading-none text-white">SCAN YOUR MEAL</p>
            </div>
          </div>
        )}

        <div className="p-5">
          {phase === "result" && scan ? (
            <>
              <div className="flex items-baseline justify-between">
                <p className="text-lg font-extrabold text-ink">{scan.dish}</p>
                <p className="text-sm font-bold text-ink-muted tabular-nums">{scan.kcal} kcal</p>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2.5">
                {[
                  { v: scan.protein, l: "Protein", hero: true },
                  { v: scan.carbs, l: "Carbs" },
                  { v: scan.fat, l: "Fat" },
                ].map((m) => (
                  <div key={m.l} className={`rounded-2xl py-3 text-center ${m.hero ? "bg-ink text-white" : "bg-paper text-ink"}`}>
                    <p className="text-xl font-extrabold tabular-nums">
                      {m.v}
                      <span className="text-xs font-bold opacity-60"> g</span>
                    </p>
                    <p className={`mt-0.5 text-[11px] font-bold ${m.hero ? "text-white/70" : "text-ink-muted"}`}>{m.l}</p>
                  </div>
                ))}
              </div>
              <button
                onClick={logIt}
                className="btn-press-good mt-4 w-full rounded-full bg-signal-good py-3.5 text-[15px] font-extrabold text-white transition"
              >
                {logged ? "Logged" : `Log it · +${scan.protein}g protein`}
              </button>
              <button
                onClick={() => { setPhase("idle"); setPhoto(null); setScan(null); }}
                className="mt-2.5 w-full rounded-full bg-white py-3 text-sm font-bold text-ink transition active:scale-[0.98]"
              >
                Scan another
              </button>
            </>
          ) : phase === "notfood" || phase === "error" ? (
            <>
              <p className="text-center text-[15px] font-extrabold text-ink">
                {phase === "notfood" ? "That doesn't look like food" : "Scan failed"}
              </p>
              <button
                onClick={() => { setPhase("idle"); setPhoto(null); }}
                className="btn-press mt-4 w-full rounded-full bg-ink py-3.5 text-[15px] font-bold text-white transition"
              >
                Try again
              </button>
            </>
          ) : phase === "scanning" ? (
            <p className="text-center text-sm font-bold text-ink-soft">Reading your meal…</p>
          ) : (
            <div className="flex gap-2.5">
              <button
                onClick={() => camRef.current?.click()}
                className="btn-press flex-1 rounded-full bg-ink py-3.5 text-[15px] font-bold text-white transition"
              >
                Camera
              </button>
              <button
                onClick={() => libRef.current?.click()}
                className="flex-1 rounded-full bg-white py-3.5 text-[15px] font-bold text-ink shadow-soft transition active:scale-[0.98]"
              >
                From library
              </button>
            </div>
          )}
        </div>
      </div>

      {/* today's protein — the one number an athlete needs */}
      <div className="mt-4 rounded-3xl bg-white p-5 shadow-soft">
        <div className="flex items-baseline justify-between">
          <h2 className="font-golden text-xl leading-none text-ink">TODAY&apos;S PROTEIN</h2>
          <p className="text-sm font-extrabold tabular-nums text-ink">
            {protein}
            {target ? (
              <span className="text-ink-muted"> / {target} g</span>
            ) : (
              <span className="text-ink-muted"> g</span>
            )}
          </p>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-black/[0.07]">
          <div
            className="h-full rounded-full bg-signal-good transition-all duration-700 ease-out"
            style={{ width: `${Math.max(pct * 100, protein > 0 && target ? 4 : 0)}%` }}
          />
        </div>
        {!target && (
          <Link href="/account/profile" className="mt-3 block text-[12px] font-bold text-ink-soft underline underline-offset-2">
            Add your weight to set a protein target
          </Link>
        )}

        {meals.length > 0 && (
          <div className="mt-4 space-y-2">
            {meals.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-2xl bg-paper px-3.5 py-3">
                <span className="flex-1 text-sm font-bold text-ink">{m.dish}</span>
                <span className="text-sm font-extrabold tabular-nums text-ink">{m.protein}g</span>
                <button
                  onClick={() => { removeMeal(m.id); setMeals(todayMeals()); }}
                  aria-label={`Remove ${m.dish}`}
                  className="grid h-7 w-7 place-items-center rounded-full text-ink-muted transition active:bg-black/[0.06]"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 5l14 14M19 5L5 19" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
