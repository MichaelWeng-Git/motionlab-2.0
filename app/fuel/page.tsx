"use client";

// FUEL is recovery input, not calorie judgement. Protein is the hierarchy;
// meal photos are analysed then dropped. All AI macros remain visibly labelled
// estimates and can be corrected before saving.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getMeals, logMeal, proteinTarget, removeMeal, restoreMeal, todayMeals, type Meal } from "@/lib/fuel";
import { SIGNAL } from "@/lib/palette";

type Scan = {
  isFood: boolean; dish: string; protein: number; carbs: number; fat: number; kcal: number;
  confidence: "high" | "medium" | "low";
};
const CONF: Record<Scan["confidence"], { label: string; color: string }> = {
  high: { label: "HIGH CONFIDENCE", color: SIGNAL.good },
  medium: { label: "CHECK PORTION", color: SIGNAL.okay },
  low: { label: "LOW CONFIDENCE", color: SIGNAL.work },
};

export default function Fuel() {
  const router = useRouter();
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "scanning" | "result" | "notfood" | "error">("idle");
  const [scan, setScan] = useState<Scan | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [target, setTarget] = useState<number | null>(null);
  const [deleted, setDeleted] = useState<Meal | null>(null);

  const refresh = () => setMeals(getMeals());
  useEffect(() => {
    refresh();
    setTarget(proteinTarget());
    return () => requestRef.current?.abort();
  }, []);

  function resetScan() {
    requestRef.current?.abort();
    requestRef.current = null;
    setPhase("idle");
    setPhoto(null);
    setScan(null);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setPhase("error"); return; }
    const img = new Image();
    img.onload = async () => {
      const max = 640;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      setPhoto(dataUrl);
      setScan(null);
      setPhase("scanning");
      const controller = new AbortController();
      requestRef.current = controller;
      try {
        const response = await fetch("/api/fuel", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl }), signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error("scan failed");
        if (!data.isFood) { setPhase("notfood"); return; }
        setScan(normalizeScan(data));
        setPhase("result");
      } catch (error) {
        if ((error as Error).name !== "AbortError") setPhase("error");
      } finally {
        requestRef.current = null;
      }
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); setPhase("error"); };
    img.src = URL.createObjectURL(file);
  }

  function editMacro(key: "protein" | "carbs" | "fat" | "kcal", value: string) {
    if (!scan) return;
    setScan({ ...scan, [key]: Math.max(0, Math.round(Number(value) || 0)) });
  }

  function save() {
    if (!scan) return;
    logMeal({ dish: scan.dish.trim() || "Meal", protein: scan.protein, carbs: scan.carbs, fat: scan.fat, kcal: scan.kcal });
    refresh();
    resetScan();
  }

  function erase(meal: Meal) {
    removeMeal(meal.id);
    setDeleted(meal);
    refresh();
    window.setTimeout(() => setDeleted((m) => m?.id === meal.id ? null : m), 5000);
  }

  function undoDelete() {
    if (!deleted) return;
    restoreMeal(deleted);
    setDeleted(null);
    refresh();
  }

  const today = todayMeals();
  const protein = today.reduce((sum, meal) => sum + meal.protein, 0);
  const pct = target ? Math.min(1, protein / target) : 0;
  const history = [...meals].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);

  return (
    <div className="stagger min-h-full bg-graphite px-5 pb-10 pt-5 text-white">
      <header className="flex items-center gap-2.5">
        <button onClick={() => router.back()} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-base text-white ring-1 ring-inset ring-white/10 active:scale-95" aria-label="Back">←</button>
        <div><p className="text-[10px] font-black tracking-[0.18em] text-signal-good">RECOVERY INPUT</p><h1 className="font-golden text-[26px] leading-none">FUEL</h1></div>
      </header>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
      <input ref={libRef} type="file" accept="image/*" className="hidden" onChange={onPick} />

      <section className="relative mt-5 overflow-hidden rounded-3xl bg-white/[0.06] p-5 text-white ring-1 ring-inset ring-white/10">
        <div className="pointer-events-none absolute -right-20 -top-24 h-60 w-60 rounded-full bg-signal-good/20 blur-3xl" />
        <div className="relative flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black tracking-[0.18em] text-signal-good">TODAY</p>
            <h2 className="mt-2 font-golden text-3xl">PROTEIN</h2>
            <div className="mt-5 flex items-end gap-2">
              <span className="font-golden text-6xl leading-none">{protein}</span>
              <span className="pb-1 font-golden text-xl text-white/45">{target ? `/ ${target} G` : "G"}</span>
            </div>
            {target ? <p className="mt-2 text-xs font-bold text-white/60">{protein >= target ? "Target reached" : `${target - protein} g remaining`}</p> : <Link href="/account/training" className="mt-3 inline-flex rounded-full bg-white px-3 py-2 text-[11px] font-black text-ink">ADD WEIGHT FOR TARGET</Link>}
          </div>
          <ProteinRing pct={pct} known={target != null} />
        </div>
        {target && <div className="relative mt-5 border-t border-white/10 pt-3 text-[11px] font-bold text-white/45">Target uses 1.6 g per kg of your saved body weight</div>}
      </section>

      <section className="mt-3 overflow-hidden rounded-2xl bg-white/[0.06] ring-1 ring-inset ring-white/10">
        {photo ? (
          <div className="relative h-[205px] overflow-hidden bg-ink">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="Meal being analysed" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />
            {phase === "scanning" && <div className="absolute inset-0 overflow-hidden"><div className="animate-scan absolute inset-x-0 h-1/3 bg-gradient-to-b from-transparent via-signal-good/65 to-transparent" /></div>}
            {phase === "result" && scan && <span className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-black tracking-wider" style={{ color: CONF[scan.confidence].color }}>AI ESTIMATE · {CONF[scan.confidence].label}</span>}
            <button onClick={resetScan} className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white">×</button>
          </div>
        ) : (
          <div className="flex items-center gap-4 border-b border-white/10 p-5"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-signal-good text-white"><CameraIcon /></span><div><p className="font-golden text-xl text-white">LOG A MEAL</p><p className="mt-1 text-[11px] font-bold text-white/45">Photo analysed once, then discarded</p></div></div>
        )}

        <div className="p-5">
          {phase === "result" && scan ? (
            <>
              <label className="text-[11px] font-black tracking-wider text-white/45">MEAL NAME · EDIT IF NEEDED</label>
              <input value={scan.dish} onChange={(e) => setScan({ ...scan, dish: e.target.value })} className="mt-2 w-full rounded-xl bg-white/10 px-3 py-2.5 text-sm font-black text-white outline-none focus:ring-2 focus:ring-signal-good" />
              <div className="mt-3 grid grid-cols-4 gap-2">
                {(["protein", "carbs", "fat", "kcal"] as const).map((key) => <label key={key} className={`rounded-xl p-2 text-center ${key === "protein" ? "bg-signal-good text-white" : "bg-white/10 text-white"}`}><input inputMode="numeric" value={scan[key]} onChange={(e) => editMacro(key, e.target.value)} className="w-full bg-transparent text-center font-golden text-xl outline-none" /><span className="block text-[11px] font-black uppercase tracking-wider text-white/55">{key === "kcal" ? "kcal" : `${key} g`}</span></label>)}
              </div>
              <p className="mt-3 text-center text-[11px] font-bold text-white/45">Image estimate · correct before saving</p>
              <button onClick={save} className="btn-press-good mt-4 w-full rounded-full bg-signal-good py-3.5 text-sm font-black text-white">SAVE MEAL · +{scan.protein} G PROTEIN</button>
            </>
          ) : phase === "scanning" ? (
            <div className="flex items-center justify-center gap-3 py-2"><span className="h-5 w-5 animate-spin rounded-full border-2 border-white/15 border-t-signal-good" /><p className="text-sm font-black text-white">Estimating the visible portion…</p></div>
          ) : phase === "notfood" || phase === "error" ? (
            <div className="text-center"><p className="text-sm font-black text-white">{phase === "notfood" ? "No meal detected" : "Couldn’t analyse this photo"}</p><button onClick={resetScan} className="mt-4 w-full rounded-full bg-white py-3 font-golden text-[13px] text-graphite">TRY ANOTHER PHOTO</button></div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5"><button onClick={() => camRef.current?.click()} className="rounded-full bg-white py-3.5 font-golden text-[13px] text-graphite">CAMERA</button><button onClick={() => libRef.current?.click()} className="rounded-full bg-white/10 py-3.5 font-golden text-[13px] text-white ring-1 ring-inset ring-white/10 active:scale-[0.98]">LIBRARY</button></div>
          )}
        </div>
      </section>

      <section className="mt-3 rounded-2xl bg-white/[0.06] p-5 ring-1 ring-inset ring-white/10">
        <div className="flex items-end justify-between"><div><p className="text-[10px] font-black tracking-[0.18em] text-white/40">RECENT</p><h2 className="mt-1 font-golden text-xl text-white">MEAL HISTORY</h2></div><span className="font-golden text-lg text-white/40">{meals.length}</span></div>
        {history.length ? <div className="mt-4 space-y-2">{history.map((meal, index) => {
          const date = new Date(meal.date), previous = history[index - 1];
          const showDay = !previous || new Date(previous.date).toDateString() !== date.toDateString();
          return <div key={meal.id}>{showDay && <p className="pb-1.5 pt-2 text-[11px] font-black tracking-wider text-white/35">{dayLabel(date)}</p>}<div className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-3 py-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10"><MealIcon /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-black text-white">{meal.dish}</p><p className="mt-0.5 text-[11px] font-bold text-white/40">{date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {meal.kcal} kcal estimate</p></div><span className="font-golden text-base text-white">{meal.protein}g</span><button onClick={() => erase(meal)} aria-label={`Delete ${meal.dish}`} className="grid h-8 w-8 place-items-center rounded-full text-white/40 active:bg-white/10"><TrashIcon /></button></div></div>;
        })}</div> : <div className="mt-4 rounded-xl bg-white/[0.04] px-5 py-8 text-center ring-1 ring-inset ring-white/10"><MealIcon /><p className="mt-3 font-golden text-lg text-white">NO MEALS LOGGED</p></div>}
      </section>

      {deleted && <div className="fixed bottom-24 left-1/2 z-[80] flex w-[calc(100%_-_32px)] max-w-[398px] -translate-x-1/2 items-center rounded-2xl bg-ink px-4 py-3 text-white shadow-lift"><span className="flex-1 truncate text-xs font-bold">Deleted {deleted.dish}</span><button onClick={undoDelete} className="ml-3 text-xs font-black text-signal-good">UNDO</button></div>}
    </div>
  );
}

function normalizeScan(data: Partial<Scan>): Scan { const n = (value: unknown) => Math.max(0, Math.min(5000, Math.round(Number(value) || 0))); return { isFood: true, dish: String(data.dish || "Meal").slice(0, 48), protein: n(data.protein), carbs: n(data.carbs), fat: n(data.fat), kcal: n(data.kcal), confidence: data.confidence === "high" || data.confidence === "low" ? data.confidence : "medium" }; }
function dayLabel(date: Date) { const now = new Date(); if (date.toDateString() === now.toDateString()) return "TODAY"; const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1); if (date.toDateString() === yesterday.toDateString()) return "YESTERDAY"; return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }).toUpperCase(); }
function ProteinRing({ pct, known }: { pct: number; known: boolean }) { const r = 39, c = 2 * Math.PI * r; return <div className="relative grid h-24 w-24 place-items-center"><svg className="-rotate-90" width="96" height="96"><circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="9" /><circle cx="48" cy="48" r={r} fill="none" stroke={SIGNAL.good} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${known ? c * pct : 0} ${c}`} /></svg><span className="absolute font-golden text-xl">{known ? `${Math.round(pct * 100)}%` : "—"}</span></div>; }
function CameraIcon() { return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h3l2-2h6l2 2h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" /><circle cx="12" cy="13" r="4" /></svg>; }
function MealIcon() { return <svg className="mx-auto" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={SIGNAL.good} strokeWidth="2" strokeLinecap="round"><path d="M4 14h16M6 14a6 6 0 0 1 12 0M12 8V5M3 18h18" /></svg>; }
function TrashIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></svg>; }
