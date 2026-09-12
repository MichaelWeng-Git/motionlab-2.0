"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EXPORT_KEYS, TRAINING_KEYS, getPreferences, savePreferences, type Preferences } from "@/lib/preferences";
import { syncClearedAccountData } from "@/lib/cloud-data";
import { dayKey } from "@/lib/date";

export default function SettingsPage() {
  const [prefs, setPrefs] = useState<Preferences>({ units: "metric", trainingReminders: false, recoveryAlerts: false, cloud3d: false });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<{ prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> } | null>(null);
  useEffect(() => setPrefs(getPreferences()), []);
  useEffect(() => {
    const onPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function update(patch: Partial<Preferences>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePreferences(next);
  }

  async function toggleNotification(key: "trainingReminders" | "recoveryAlerts") {
    if (!prefs[key] && "Notification" in window && Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setNotice("Notifications remain off. You can enable them in browser settings."); return; }
    }
    if (!prefs[key] && (!("Notification" in window) || Notification.permission === "denied")) {
      setNotice("Notifications are unavailable in this browser."); return;
    }
    update({ [key]: !prefs[key] });
  }

  function exportData() {
    const data: Record<string, unknown> = {};
    for (const key of EXPORT_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw == null) continue;
      try { data[key] = JSON.parse(raw); } catch { data[key] = raw; }
    }
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), version: 1, data }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `motionlab-export-${dayKey()}.json`; a.click();
    URL.revokeObjectURL(url);
    setNotice("Export downloaded.");
  }

  async function deleteTrainingData() {
    if (deleteText !== "DELETE") return;
    for (const key of TRAINING_KEYS) localStorage.removeItem(key);
    window.dispatchEvent(new Event("ml:sessions"));
    const synced = await syncClearedAccountData();
    setConfirmDelete(false); setDeleteText("");
    setNotice(synced
      ? "Training data deleted from this device and your account."
      : "Deleted on this device, but cloud deletion is pending. Keep the app open and online.");
  }

  return (
    <div className="px-5 pb-8 pt-8">
      <div className="flex items-center gap-3"><Link href="/account" className="grid h-9 w-9 place-items-center rounded-full bg-white shadow-soft">←</Link><h1 className="text-2xl font-extrabold">Settings</h1></div>

      <section className="mt-5 overflow-hidden rounded-2xl bg-graphite p-5 text-white shadow-lift">
        <p className="text-[11px] font-black tracking-[0.18em] text-volt">YOUR APP</p><h2 className="mt-2 font-golden text-3xl leading-none">TRAIN YOUR WAY</h2>
        <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-white/8 p-1.5">
          {(["metric", "imperial"] as const).map((unit) => <button key={unit} onClick={() => update({ units: unit })} className={`rounded-xl py-3 text-xs font-black uppercase tracking-wider ${prefs.units === unit ? "bg-volt text-ink" : "text-white/55"}`}>{unit}<span className="ml-1 opacity-60">{unit === "metric" ? "KM · KG" : "MI · LB"}</span></button>)}
        </div>
      </section>

      <section className="mt-5"><h2 className="font-golden text-xl">NOTIFICATIONS</h2><div className="mt-2 overflow-hidden rounded-2xl bg-white shadow-soft">
        {[{ key: "trainingReminders" as const, title: "Training reminders", hint: "A nudge on planned training days" }, { key: "recoveryAlerts" as const, title: "Recovery ready", hint: "When your body is ready to go again" }].map((item, i) => <button key={item.key} onClick={() => toggleNotification(item.key)} className={`flex w-full items-center gap-3 px-4 py-4 text-left ${i ? "border-t border-black/5" : ""}`}><span className="flex-1"><span className="block text-sm font-extrabold">{item.title}</span><span className="mt-0.5 block text-[11px] font-bold text-ink-muted">{item.hint}</span></span><span className={`relative h-7 w-12 rounded-full transition ${prefs[item.key] ? "bg-volt-deep" : "bg-black/15"}`}><i className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${prefs[item.key] ? "left-6" : "left-1"}`} /></span></button>)}
      </div></section>

      <section className="mt-5"><h2 className="font-golden text-xl">VIDEO PRIVACY</h2><div className="mt-2 overflow-hidden rounded-2xl bg-white shadow-soft">
        <div className="px-4 py-4">
          <p className="text-sm font-extrabold">Your full video stays on this device</p>
          <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs font-bold text-ink-muted">
            <span className="font-golden text-lg leading-none text-ink">3</span><span>screenshots go to the AI coach for activity recognition and coaching notes.</span>
            <span className="font-golden text-lg leading-none text-ink">0</span><span>video files are uploaded or stored by MotionLab.</span>
          </div>
        </div>
        <button onClick={() => update({ cloud3d: !prefs.cloud3d })} className="flex w-full items-center gap-3 border-t border-black/5 px-4 py-4 text-left">
          <span className="flex-1"><span className="block text-sm font-extrabold">Cloud 3D refinement</span><span className="mt-0.5 block text-xs font-bold text-ink-muted">Sends 4–12 extra sampled screenshots to refine torso posture</span></span>
          <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${prefs.cloud3d ? "bg-volt-deep" : "bg-black/15"}`}><i className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${prefs.cloud3d ? "left-6" : "left-1"}`} /></span>
        </button>
      </div></section>

      <section className="mt-5"><h2 className="font-golden text-xl">YOUR DATA</h2><div className="mt-2 overflow-hidden rounded-2xl bg-white shadow-soft">
        <button onClick={exportData} className="flex w-full items-center justify-between px-4 py-4 text-left"><span><span className="block text-sm font-extrabold">Export MotionLab data</span><span className="mt-0.5 block text-[11px] font-bold text-ink-muted">Sessions, workouts, meals and progress as JSON</span></span><span className="font-black">↓</span></button>
        <button onClick={() => setConfirmDelete(true)} className="flex w-full items-center justify-between border-t border-black/5 px-4 py-4 text-left text-signal-work"><span><span className="block text-sm font-extrabold">Delete training data</span><span className="mt-0.5 block text-[11px] font-bold opacity-65">Keeps your account and profile</span></span><span className="font-black">›</span></button>
      </div></section>
      <section className="mt-5"><h2 className="font-golden text-xl">APP</h2><button onClick={async () => { if (installPrompt) { await installPrompt.prompt(); const result = await installPrompt.userChoice; setNotice(result.outcome === "accepted" ? "MotionLab installed." : "Install cancelled."); setInstallPrompt(null); } else { setNotice("On iPhone, use Share → Add to Home Screen. On desktop, use the install icon in the address bar."); } }} className="mt-2 flex w-full items-center justify-between rounded-2xl bg-white px-4 py-4 text-left shadow-soft"><span><span className="block text-sm font-extrabold">Install MotionLab</span><span className="mt-0.5 block text-[11px] font-bold text-ink-muted">Full-screen launch and offline fallback</span></span><span className="grid h-9 w-9 place-items-center rounded-full bg-volt font-black">↓</span></button></section>
      {notice && <button onClick={() => setNotice(null)} className="fixed bottom-24 left-1/2 z-50 w-[calc(100%-40px)] max-w-[390px] -translate-x-1/2 rounded-2xl bg-ink px-4 py-3 text-left text-xs font-bold text-white shadow-lift">{notice}</button>}
      {confirmDelete && <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/50 px-6 backdrop-blur-sm"><div className="w-full max-w-[350px] rounded-2xl bg-paper p-6 shadow-lift"><p className="font-golden text-2xl text-signal-work">DELETE TRAINING DATA?</p><p className="mt-2 text-sm font-bold text-ink">This permanently removes sessions, activities, meals, goals, coins and collectibles from this device.</p><label className="mt-5 block text-[11px] font-black tracking-wider text-ink-muted">TYPE DELETE TO CONFIRM</label><input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} className="mt-2 w-full rounded-2xl bg-white px-4 py-3 font-black outline-none" /><div className="mt-4 flex gap-2"><button onClick={() => { setConfirmDelete(false); setDeleteText(""); }} className="flex-1 rounded-full bg-white py-3 text-sm font-bold">Cancel</button><button disabled={deleteText !== "DELETE"} onClick={deleteTrainingData} className="flex-1 rounded-full bg-signal-work py-3 text-sm font-black text-white disabled:opacity-30">Delete</button></div></div></div>}
    </div>
  );
}
