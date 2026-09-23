"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { SIcon, type SIconName } from "@/components/SIcon";
import { routeThumb } from "@/lib/route-thumb";
import type { LatLng } from "@/components/LiveMap";
import { distanceUnit, distanceValue, getPreferences, type UnitSystem } from "@/lib/preferences";
import { addActivity } from "@/lib/activities";

// Maps touch `window` — load client-side only. Official Google Maps when the
// key is set (vector, retina-sharp); Leaflet/tile fallback otherwise.
const LeafletMap = dynamic(() => import("@/components/LiveMap").then((m) => m.LiveMap), { ssr: false });
const GoogleMap = dynamic(() => import("@/components/GoogleLiveMap").then((m) => m.GoogleLiveMap), { ssr: false });
const HAS_GKEY = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

// ——— Strava Record with a real map ———
// Real tiles (OSM / Esri satellite via the layers button), real geolocation,
// blue position dot, start→current polyline. Distance is added only from real,
// accuracy-gated GPS fixes; an unavailable signal never becomes fake movement.

type Mode = "gps" | "court" | "pool";
type Profile = { key: string; label: string; icon: SIconName; mode: Mode };

const PROFILES: Profile[] = [
  { key: "run", label: "Run", icon: "run", mode: "gps" },
  { key: "ride", label: "Ride", icon: "ride", mode: "gps" },
  { key: "tennis", label: "Tennis", icon: "tennis", mode: "court" },
  { key: "basketball", label: "Basketball", icon: "basketball", mode: "court" },
  { key: "golf", label: "Golf", icon: "golf", mode: "court" },
  { key: "lift", label: "Strength", icon: "strength", mode: "court" },
  { key: "swim", label: "Swim", icon: "swim", mode: "pool" },
];

const EMPTY_CENTER: LatLng = [0, 0]; // never presented as the athlete's location

type Phase = "ready" | "live" | "save";
type Sheet = null | "picker" | "settings" | "confirm" | "discardConfirm" | "noLocation" | "iosLocation" | "mapType" | "resume";
type Split = { n: number; unit: "km" | "mi"; seconds: number };
type RecordSettings = { autoPause: boolean; audioCues: boolean; screenOn: boolean };
const RECORD_SETTINGS_KEY = "ml_record_settings";
const DEFAULT_RECORD_SETTINGS: RecordSettings = { autoPause: true, audioCues: false, screenOn: true };

const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function haversine(a: LatLng, b: LatLng) {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// data fields per sport — gps uses REAL distance; the 4th tile is the CURRENT
// pace/speed over the last ~60s (no fabricated cadence/HR numbers)
function fields(p: Profile, seconds: number, meters: number, rolling: number | null | undefined, units: UnitSystem): { v: string; l: string }[] {
  if (p.mode === "gps") {
    const distance = distanceValue(meters, units);
    const unit = distanceUnit(units);
    const unitMeters = units === "imperial" ? 1609.344 : 1000;
    // plain clock format — 3:12, not 3'12" (everyone reads it instantly)
    const paceFmt = (secPerKm: number) =>
      `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, "0")}`;
    if (p.key === "ride") {
      const speed = seconds > 2 && meters > 1 ? units === "imperial" ? ((meters / seconds) * 2.23694).toFixed(1) : ((meters / seconds) * 3.6).toFixed(1) : "—";
      return [
        { v: fmtTime(seconds), l: "Time" },
        { v: distance.toFixed(2), l: `Distance · ${unit}` },
        { v: speed, l: `Avg speed · ${unit}/h` },
        { v: rolling ? (rolling * (units === "imperial" ? 2.23694 : 3.6)).toFixed(1) : "—", l: `Speed · ${unit}/h` },
      ];
    }
    let pace = "—";
    if (seconds > 3 && meters > 5) {
      pace = paceFmt(seconds / distance);
    }
    return [
      { v: fmtTime(seconds), l: "Time" },
      { v: distance.toFixed(2), l: `Distance · ${unit}` },
      { v: pace, l: `Avg pace · /${unit}` },
      { v: rolling ? paceFmt(unitMeters / rolling) : "—", l: `Pace · /${unit}` },
    ];
  }
  if (p.mode === "pool") {
    return [
      { v: fmtTime(seconds), l: "Time" },
      { v: "—", l: "Distance" },
      { v: "—", l: "Pace · /100m" },
      { v: "—", l: "Laps" },
    ];
  }
  return [
    { v: fmtTime(seconds), l: "Time" },
    { v: "—", l: "Moves" },
    { v: "—", l: "Calories" },
    { v: "—", l: "Avg HR" },
  ];
}

function defaultName(sport: Profile) {
  const h = new Date().getHours();
  // Strava's exact day-part buckets
  const part = h >= 4 && h < 11 ? "Morning" : h < 14 ? "Lunch" : h < 17 ? "Afternoon" : h < 21 ? "Evening" : "Night";
  return `${part} ${sport.label}`;
}

export default function Activity() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("ready");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sport, setSport] = useState(PROFILES[0]);
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [count, setCount] = useState<number | null>(null); // 3 → 2 → 1 → 0 (GO)
  const [settings, setSettings] = useState<RecordSettings>(DEFAULT_RECORD_SETTINGS);
  const [units, setUnits] = useState<UnitSystem>("metric");
  const [actName, setActName] = useState("");

  // — real location —
  // Permission is requested on the user's FIRST Start (native browser prompt).
  // Denied → GPS sports can't be recorded (court/pool sports still work).
  const [center, setCenter] = useState<LatLng>(EMPTY_CENTER);
  const [gps, setGps] = useState<"unknown" | "locating" | "ready" | "off">("unknown");
  // Google Maps died (billing/network/adblock) → swap to Leaflet, never a gray box
  const [gmapDead, setGmapDead] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const LiveMap = HAS_GKEY && !gmapDead ? GoogleMap : LeafletMap;

  useEffect(() => {
    setUnits(getPreferences().units);
    try { setSettings({ ...DEFAULT_RECORD_SETTINGS, ...JSON.parse(localStorage.getItem(RECORD_SETTINGS_KEY) ?? "{}") }); } catch {}
  }, []);
  const [path, setPath] = useState<LatLng[]>([]);
  const [meters, setMeters] = useState(0);
  const realGpsRef = useRef(false);
  const lastFixRef = useRef<number | null>(null);
  // cumulative meters over the last ~60s → live "current pace"
  const recentRef = useRef<{ t: number; m: number }[]>([]);
  const [acc, setAcc] = useState<number | null>(null);

  // ——— Strava-parity recording state ———
  const [autoPaused, setAutoPaused] = useState(false); // GPS-detected standstill
  const isPaused = paused || autoPaused;
  const [splits, setSplits] = useState<Split[]>([]);
  const splitsRef = useRef<Split[]>([]);
  const splitAnchorRef = useRef({ dist: 0, sec: 0 });
  const [elevGain, setElevGain] = useState(0);
  const elevRef = useRef<{ ref: number | null; win: number[] }>({ ref: null, win: [] });
  const elevationMeasuredRef = useRef(false);
  const [kcal, setKcal] = useState(0);
  const weightRef = useRef<number | null>(null);
  const smoothSpeedRef = useRef(0); // exp-smoothed m/s for auto-pause decisions
  const slowSinceRef = useRef<number | null>(null);
  const pauseAnchorRef = useRef<LatLng | null>(null);
  const lastRawRef = useRef<{ ll: LatLng; t: number } | null>(null);
  const lastFixAtRef = useRef(0);
  const [gpsLost, setGpsLost] = useState(false);
  const [showSplits, setShowSplits] = useState(false); // fullscreen stats view
  const dragStartRef = useRef<number | null>(null);
  const warmupRef = useRef(0); // discard the first fixes while the chip settles
  const [chk, setChk] = useState<{ sec: number } | null>(null);
  // save-screen extras (Strava field set)
  const [desc, setDesc] = useState("");
  const [exertion, setExertion] = useState(5);
  const [visibility, setVisibility] = useState<"everyone" | "followers" | "private">("followers");
  const [saveError, setSaveError] = useState(false);
  // live mirrors so interval callbacks & checkpoints read fresh values
  const secondsRef = useRef(0);
  const metersRef = useRef(0);
  const pathRef = useRef<LatLng[]>([]);
  const kcalRef = useRef(0);
  const elevGainRef = useRef(0);
  useEffect(() => { secondsRef.current = seconds; }, [seconds]);
  useEffect(() => { metersRef.current = meters; }, [meters]);
  useEffect(() => { pathRef.current = path; }, [path]);
  useEffect(() => { kcalRef.current = kcal; }, [kcal]);
  useEffect(() => { elevGainRef.current = elevGain; }, [elevGain]);
  useEffect(() => {
    try {
      const weight = JSON.parse(localStorage.getItem("ml_profile") ?? "{}").weight;
      weightRef.current = typeof weight === "number" && weight > 0 ? weight : null;
    } catch {}
  }, []);

  function toggleRecordSetting(key: keyof RecordSettings) {
    setSettings((current) => {
      const next = { ...current, [key]: !current[key] };
      try { localStorage.setItem(RECORD_SETTINGS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // audio cues (Web Speech) — spoken only when the toggle is on
  function speak(text: string) {
    if (!settings.audioCues) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch {}
  }

  // Splits follow the selected unit while route distance stays in meters.
  function recordDistance(nm: number) {
    const anchor = splitAnchorRef.current;
    const splitMeters = units === "imperial" ? 1609.344 : 1000;
    if (nm - anchor.dist >= splitMeters) {
      const sec = Math.max(1, secondsRef.current - anchor.sec);
      splitAnchorRef.current = { dist: anchor.dist + splitMeters, sec: secondsRef.current };
      const n = splitsRef.current.length + 1;
      const unit = units === "imperial" ? "mi" : "km";
      splitsRef.current = [...splitsRef.current, { n, unit, seconds: sec }];
      setSplits(splitsRef.current);
      speak(`${unit === "mi" ? "Mile" : "Kilometer"} ${n}. ${Math.floor(sec / 60)} minutes ${sec % 60} seconds.`);
    }
  }

  // elevation gain: smoothed altitude + 10m hysteresis (Strava's GPS-only rule)
  function recordAltitude(alt: number | null, altAcc: number | null) {
    if (alt == null || (altAcc != null && altAcc > 15)) return;
    elevationMeasuredRef.current = true;
    const e = elevRef.current;
    e.win.push(alt);
    if (e.win.length > 7) e.win.shift();
    if (e.win.length < 4) return;
    const smooth = e.win.reduce((a, b) => a + b, 0) / e.win.length;
    if (e.ref == null) { e.ref = smooth; return; }
    if (smooth - e.ref >= 10) { setElevGain((g) => g + (smooth - e.ref!)); e.ref = smooth; }
    else if (e.ref - smooth >= 10) e.ref = smooth;
  }

  // crash/reload insurance: checkpoint the whole recording every 15s
  function saveCheckpoint() {
    try {
      localStorage.setItem("ml_rec_checkpoint", JSON.stringify({
        sport: sport.key, sec: secondsRef.current, meters: metersRef.current,
        path: pathRef.current, splits: splitsRef.current, anchor: splitAnchorRef.current,
        kcal: kcalRef.current, elev: elevGainRef.current, elevMeasured: elevationMeasuredRef.current, ts: Date.now(),
      }));
    } catch {}
  }
  function restoreCheckpoint() {
    try {
      const c = JSON.parse(localStorage.getItem("ml_rec_checkpoint")!);
      const found = PROFILES.find((p) => p.key === c.sport);
      if (found) setSport(found);
      secondsRef.current = c.sec; setSeconds(c.sec);
      setMeters(c.meters);
      setPath(c.path ?? []);
      splitsRef.current = (c.splits ?? []).map((split: { n?: number; km?: number; unit?: "km" | "mi"; seconds: number }, index: number) => ({ n: split.n ?? split.km ?? index + 1, unit: split.unit ?? "km", seconds: split.seconds }));
      setSplits(splitsRef.current);
      const splitMeters = units === "imperial" ? 1609.344 : 1000;
      splitAnchorRef.current = c.anchor ?? { dist: splitsRef.current.length * splitMeters, sec: c.sec };
      setKcal(c.kcal ?? 0);
      setElevGain(c.elev ?? 0);
      elevationMeasuredRef.current = c.elevMeasured === true || c.elev > 0;
      savedRef.current = false;
      setSheet(null);
      setPhase("live");
    } catch { setSheet(null); }
  }
  // offer to resume a recording that died with the page (< 3h old, > 30s long)
  useEffect(() => {
    try {
      const c = JSON.parse(localStorage.getItem("ml_rec_checkpoint") ?? "null");
      if (c && Date.now() - c.ts < 3 * 3600_000 && c.sec >= 30) {
        setChk({ sec: c.sec });
        setSheet("resume");
      } else localStorage.removeItem("ml_rec_checkpoint");
    } catch {}
  }, []);

  // sport chosen on entry — restore last used (Strava behavior)
  useEffect(() => {
    try {
      const found = PROFILES.find((p) => p.key === localStorage.getItem("ml_last_sport"));
      if (found) setSport(found);
    } catch {}
  }, []);

  // App-level permission, remembered after the first ask (ml_loc_perm).
  // The ask happens on FIRST ENTRY to this page (like a real iOS app).
  // In the packaged app the real system dialog replaces our replica.
  const pendingStartRef = useRef(false);

  useEffect(() => {
    const perm = localStorage.getItem("ml_loc_perm");
    if (perm === "granted") attemptLocate();
    else if (perm === "denied") setGps("off");
    else if (sport.mode === "gps") {
      // first visit — ask right away
      const t = setTimeout(() => setSheet("iosLocation"), 600);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport.mode]);

  // Locate after the user allowed us. Real fix → GPS Ready (their true position).
  // If the browser cannot provide a fix, keep distance unavailable.
  function attemptLocate(onReady?: () => void, showBlockingError = true) {
    setGps("locating");
    if (!("geolocation" in navigator)) { setGps("off"); setSheet("noLocation"); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCenter([p.coords.latitude, p.coords.longitude]);
        setAcc(Math.round(p.coords.accuracy));
        setGps("ready");
        onReady?.();
      },
      () => {
        if (showBlockingError) { setGps("off"); setSheet("noLocation"); }
        else setGpsLost(true);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
    );
  }

  function allowLocation(remember: boolean) {
    if (remember) localStorage.setItem("ml_loc_perm", "granted");
    setSheet(null);
    attemptLocate(() => {
      if (pendingStartRef.current) {
        pendingStartRef.current = false;
        runCountdown();
      }
    });
  }

  function denyLocation() {
    localStorage.setItem("ml_loc_perm", "denied");
    pendingStartRef.current = false;
    setGps("off");
    setSheet("noLocation");
  }

  // real GPS takes over when available. Strava-grade hygiene:
  // high-accuracy fixes only, jitter gate scaled by reported accuracy, and a
  // per-sport speed cap so a bad fix can never teleport the path.
  useEffect(() => {
    if (phase !== "live" || sport.mode !== "gps" || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude, longitude, accuracy, altitude, altitudeAccuracy } = p.coords;
        const now = p.timestamp || Date.now();
        if (Date.now() - now > 10_000) return; // stale cached fix
        setAcc(Math.round(accuracy));
        lastFixAtRef.current = Date.now();
        setGpsLost(false);
        if (accuracy > 30) return; // too fuzzy to trust (indoors, first fixes)
        if (warmupRef.current < 2) {
          // GPS warm-up: the first fixes wander — never count them as distance
          warmupRef.current += 1;
          lastRawRef.current = { ll: [latitude, longitude], t: now };
          return;
        }
        const ll: LatLng = [latitude, longitude];

        // instantaneous + smoothed speed (drives auto-pause, calories)
        const raw = lastRawRef.current;
        const rawDt = raw ? Math.max(0.3, (now - raw.t) / 1000) : 1;
        const inst = raw ? haversine(raw.ll, ll) / rawDt : 0;
        lastRawRef.current = { ll, t: now };
        smoothSpeedRef.current = smoothSpeedRef.current * 0.65 + inst * 0.35;
        realGpsRef.current = true;

        if (paused) return; // manual pause freezes everything

        // AUTO-RESUME: real movement away from the standstill anchor
        if (autoPaused) {
          const anchor = pauseAnchorRef.current;
          const resumeSpeed = sport.key === "ride" ? 1.4 : 1.0;
          const farEnough = !anchor || haversine(anchor, ll) > (sport.key === "ride" ? 12 : 6);
          if (inst > resumeSpeed && farEnough) {
            setAutoPaused(false);
            slowSinceRef.current = null;
            speak("Resumed");
            setPath((prev) => {
              const last = prev[prev.length - 1];
              if (last) {
                const d = haversine(last, ll);
                if (d > 2) {
                  setMeters((m) => {
                    const nm = m + d;
                    recordDistance(nm);
                    return nm;
                  });
                }
              }
              setCenter(ll);
              return [...prev, ll];
            });
          }
          return;
        }

        // AUTO-PAUSE: sustained standstill (Strava thresholds: pause slow, resume fast)
        const pauseSpeed = sport.key === "ride" ? 1.0 : 0.7;
        const pauseHold = sport.key === "ride" ? 6000 : 10000;
        if (settings.autoPause && smoothSpeedRef.current < pauseSpeed) {
          if (slowSinceRef.current == null) slowSinceRef.current = Date.now();
          else if (Date.now() - slowSinceRef.current > pauseHold) {
            setAutoPaused(true);
            pauseAnchorRef.current = ll;
            speak("Auto paused");
            return;
          }
        } else slowSinceRef.current = null;

        setPath((prev) => {
          const last = prev[prev.length - 1];
          if (!last) { lastFixRef.current = now; return [ll]; }
          const d = haversine(last, ll);
          const dt = Math.max(0.3, (now - (lastFixRef.current ?? now - 1000)) / 1000);
          const speedCap = sport.key === "ride" ? 25 : 12.5; // m/s sanity per sport
          const minMove = Math.max(4, accuracy * 0.5); // jitter + stuck-point gate
          if (d < minMove || d / dt > speedCap) return prev;
          lastFixRef.current = now;
          recordAltitude(altitude, altitudeAccuracy ?? null);
          setMeters((m) => {
            const nm = m + d;
            recentRef.current.push({ t: now, m: nm });
            recentRef.current = recentRef.current.filter((x) => now - x.t < 65000);
            recordDistance(nm);
            return nm;
          });
          setCenter(ll); // map follows the athlete
          return [...prev, ll];
        });
      },
      () => setGpsLost(true),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused, autoPaused, sport, settings.autoPause, settings.audioCues]);

  // crash insurance, part 2: the page being hidden, closed, or navigated away
  // mid-recording also snapshots the workout — nothing is ever lost
  useEffect(() => {
    if (phase !== "live") return;
    const snap = () => {
      if (secondsRef.current > 5 && !savedRef.current) saveCheckpoint();
    };
    document.addEventListener("visibilitychange", snap);
    window.addEventListener("pagehide", snap);
    return () => {
      snap(); // unmount (accidental navigation) = snapshot too
      document.removeEventListener("visibilitychange", snap);
      window.removeEventListener("pagehide", snap);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // PURE workout mode: from countdown until the workout ENDS (including while
  // paused), the shell drops ALL chrome — no top bar to mis-tap into (which
  // killed recordings), no bottom nav. Everything returns on the Save screen.
  useEffect(() => {
    const on = count !== null || phase === "live";
    window.dispatchEvent(new CustomEvent("ml:immersive", { detail: on }));
    return () => {
      window.dispatchEvent(new CustomEvent("ml:immersive", { detail: false }));
    };
  }, [phase, count]);

  // keep the screen awake while recording — a sleeping phone suspends the page
  // (web apps can't record in the background; this is the web-Strava tradeoff)
  useEffect(() => {
    if (phase !== "live" || !settings.screenOn) return;
    let lock: { release?: () => Promise<void> } | null = null;
    const acquire = async () => {
      try {
        lock = await (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<never> } }).wakeLock?.request("screen") ?? null;
      } catch {}
    };
    const onVis = () => { if (document.visibilityState === "visible") acquire(); };
    acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      try { lock?.release?.(); } catch {}
    };
  }, [phase, settings.screenOn]);

  // clock + explicitly estimated calories + GPS-lost watchdog + checkpoints
  useEffect(() => {
    if (phase !== "live" || isPaused || sheet === "confirm" || sheet === "discardConfirm") return;
    let tick = 0;
    const iv = setInterval(() => {
      tick += 1;
      setSeconds((s) => s + 1);
      // live calories: MET rises with speed (≈ Strava's live estimate)
      const bodyWeight = weightRef.current;
      if (bodyWeight != null && sport.mode === "gps" && realGpsRef.current) {
        const vkmh = smoothSpeedRef.current * 3.6;
        const met = Math.max(1, 1.02 * vkmh);
        setKcal((k) => k + (met * bodyWeight) / 3600);
      }
      // real fixes stopped arriving → tell the athlete
      if (sport.mode === "gps" && realGpsRef.current && Date.now() - lastFixAtRef.current > 10_000) {
        setGpsLost(true);
      }
      // crash insurance
      if (tick % 10 === 0) saveCheckpoint();
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isPaused, sheet, sport]);

  const isGps = sport.mode === "gps";
  // rolling speed over the last ~60s window of accepted GPS fixes
  const rolling = (() => {
    const r = recentRef.current;
    if (r.length < 2) return null;
    const dm = r[r.length - 1].m - r[0].m;
    const dt = (r[r.length - 1].t - r[0].t) / 1000;
    return dt >= 5 && dm >= 3 ? dm / dt : null;
  })();
  const f = fields(sport, seconds, meters, rolling, units);
  const hasCalorieEstimate = isGps && realGpsRef.current && weightRef.current != null;
  const hasRealMapPosition = gps === "ready" || path.length > 0;
  const savedRef = useRef(false);

  function pickSport(p: Profile) {
    setSport(p);
    try { localStorage.setItem("ml_last_sport", p.key); } catch {}
    setSheet(null);
  }

  function beginRecording() {
    setSeconds(0);
    setMeters(0);
    // A map/IP center is not a recorded route point. The route starts only
    // after watchPosition supplies an accuracy-gated real GPS fix.
    setPath([]);
    setPaused(false);
    setAutoPaused(false);
    setSplits([]);
    splitsRef.current = [];
    splitAnchorRef.current = { dist: 0, sec: 0 };
    setElevGain(0);
    elevRef.current = { ref: null, win: [] };
    elevationMeasuredRef.current = false;
    setKcal(0);
    setGpsLost(false);
    setShowSplits(false);
    smoothSpeedRef.current = 0;
    slowSinceRef.current = null;
    lastRawRef.current = null;
    warmupRef.current = 0;
    savedRef.current = false;
    realGpsRef.current = false;
    lastFixRef.current = null;
    lastFixAtRef.current = Date.now();
    recentRef.current = [];
    setAcc(null);
    setPhase("live");
    speak("Activity started");
  }

  // Strava-style start: black screen, 3 → 2 → 1 → GO, then recording.
  // Effect-driven (not one setInterval) so an interrupted tick can never
  // strand the black screen — it always advances or finishes.
  function runCountdown() {
    setCount(3);
  }
  useEffect(() => {
    if (count === null) return;
    const t = setTimeout(() => {
      if (count > 1) setCount(count - 1);
      else if (count === 1) setCount(0); // "GO"
      else {
        setCount(null);
        beginRecording();
      }
    }, 850);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  function start() {
    // iOS requires speech to be unlocked inside a user gesture
    if (settings.audioCues) {
      try { window.speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch {}
    }
    // GPS sports need location
    if (isGps) {
      const perm = localStorage.getItem("ml_loc_perm");
      if (perm === "denied") { setSheet("noLocation"); return; }
      if (perm !== "granted") { pendingStartRef.current = true; setSheet("iosLocation"); return; }
      if (gps !== "ready") { attemptLocate(() => runCountdown()); return; }
    }
    runCountdown();
  }

  function toSave() {
    setActName(defaultName(sport));
    setSheet(null);
    setPhase("save");
  }

  function persist() {
    if (savedRef.current) return;
    savedRef.current = true;
    setSaveError(false);
    const id = crypto.randomUUID();
    try {
      addActivity({
        id,
        name: actName.trim() || defaultName(sport),
        sport: sport.label,
        mode: sport.mode,
        seconds,
        meters: Math.round(meters),
        stats: f.slice(0, 3),
        description: desc.trim() || null,
        exertion,
        privacy: visibility,
        splits: splits.length ? splits : null,
        elevGain: elevationMeasuredRef.current ? Math.round(elevGain) : undefined,
        elevMeasured: elevationMeasuredRef.current,
        kcal: hasCalorieEstimate ? Math.round(kcal) : null,
        path: isGps ? path : null,
        thumb: isGps ? routeThumb(path) : undefined, // static — shows instantly in the list
        date: new Date().toISOString(),
      });
    } catch {
      savedRef.current = false;
      setSaveError(true);
      return;
    }
    localStorage.removeItem("ml_rec_checkpoint");
    speak("Activity saved");
    router.push(`/activities/${id}`);
  }

  function discard() {
    // mark handled BEFORE the phase flips: leaving "live" runs the crash-
    // insurance snapshot in that effect's cleanup, which would otherwise
    // resurrect the checkpoint we just deleted (secondsRef is still stale)
    savedRef.current = true;
    secondsRef.current = 0;
    localStorage.removeItem("ml_rec_checkpoint");
    setSheet(null);
    setPhase("ready");
    setSeconds(0);
    setMeters(0);
    setPath([]);
    setPaused(false);
    setAutoPaused(false);
    setSplits([]);
    splitsRef.current = [];
    setKcal(0);
    setElevGain(0);
    elevationMeasuredRef.current = false;
    setDesc("");
  }

  /* ————— SAVE SCREEN ————— */
  if (phase === "save") {
    return (
      <div className="animate-fade-up px-5 pt-6">
        <h1 className="font-golden text-[26px] leading-none">Save activity</h1>

        <input
          value={actName}
          onChange={(e) => setActName(e.target.value)}
          maxLength={40}
          className="mt-4 w-full rounded-2xl bg-panel px-4 py-3.5 text-base font-bold text-fg shadow-panel outline-none placeholder:text-fg-muted focus:ring-1 focus:ring-inset focus:ring-white/20"
        />

        <div className="mt-4 overflow-hidden rounded-3xl">
          {isGps && path.length > 1 ? (
            <LeafletMap center={path[0]} path={path} fit interactive={false} className="h-44 w-full" />
          ) : (
            <div className="relative grid h-28 place-items-center bg-well">
              <div className="absolute inset-0 bg-well" />
              <SIcon name={sport.icon} size={44} className="relative" />
            </div>
          )}
          <div className="grid grid-cols-3 divide-x divide-hair border-b border-hair bg-panel py-3.5 text-fg">
            {f.slice(0, 3).map((s) => (
              <div key={s.l} className="text-center">
                <p className="text-lg font-extrabold tabular-nums">{s.v}</p>
                <p className="mt-0.5 text-[11px] font-bold uppercase tracking-widest text-fg-muted">{s.l}</p>
              </div>
            ))}
          </div>
          {/* second stat row: the numbers Strava shows under the big three */}
          <div className="flex items-center justify-center gap-5 bg-panel pb-3 text-[11px] font-bold text-fg-muted">
            {isGps && <span>↑ {Math.round(elevGain)} m elev</span>}
            <span>{hasCalorieEstimate ? `${Math.round(kcal)} est. kcal` : "Calories unavailable"}</span>
          </div>
        </div>

        {/* description — Strava's "How'd it go?" */}
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="How'd it go?"
          rows={2}
          maxLength={280}
          className="mt-3 w-full resize-none rounded-2xl bg-panel px-4 py-3 text-sm font-medium text-fg shadow-panel outline-none placeholder:text-fg-muted focus:ring-1 focus:ring-inset focus:ring-white/20"
        />

        {/* perceived exertion 1-10 */}
        <div className="mt-3 rounded-2xl bg-panel p-4 text-fg shadow-panel">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-bold">How did that feel?</p>
            <p className="text-sm font-extrabold tabular-nums text-signal-good">{exertion}/10</p>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            value={exertion}
            onChange={(e) => setExertion(+e.target.value)}
            className="mt-2 w-full accent-volt"
          />
          <div className="flex justify-between text-[11px] font-semibold text-fg-muted">
            <span>Easy</span>
            <span>Max effort</span>
          </div>
        </div>

        {/* visibility — Strava's exact three states */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {([
            { k: "everyone", t: "Everyone" },
            { k: "followers", t: "Friends" },
            { k: "private", t: "Only you" },
          ] as const).map((v) => (
            <button
              key={v.k}
              onClick={() => setVisibility(v.k)}
              className={`rounded-2xl border py-2.5 text-xs font-bold transition ${
                visibility === v.k ? "border-white bg-action text-on-action" : "border-hair bg-panel text-fg shadow-panel"
              }`}
            >
              {v.t}
            </button>
          ))}
        </div>

        {/* distance splits table */}
        {splits.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-2xl bg-panel text-fg shadow-panel">
            <div className="flex items-center justify-between border-b border-hair px-4 py-2.5">
              <span className="text-[11px] font-bold uppercase tracking-widest text-fg-muted">{splits[0]?.unit ?? (units === "imperial" ? "mi" : "km")}</span>
              <span className="text-[11px] font-bold uppercase tracking-widest text-fg-muted">Pace</span>
            </div>
            {splits.map((s) => (
              <div key={`${s.unit}-${s.n}`} className="flex items-center justify-between px-4 py-2 odd:bg-inset">
                <span className="font-golden text-sm">{s.n}</span>
                <span className="text-sm font-extrabold tabular-nums">
                  {Math.floor(s.seconds / 60)}:{String(s.seconds % 60).padStart(2, "0")}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 space-y-3 pb-8">
          {saveError && <div role="alert" className="rounded-2xl bg-signal-work/10 px-4 py-3 text-sm font-bold text-signal-work">Couldn’t save this activity. Your recovery copy is still safe—free some browser storage and try again.</div>}
          <button
            onClick={persist}
            className="w-full rounded-full bg-signal-good py-4 text-[15px] font-extrabold text-white transition active:scale-[0.98]"
          >
            Save activity
          </button>
          <button
            onClick={() => setSheet("discardConfirm")}
            className="mx-auto flex items-center gap-2 rounded-full border border-signal-work/30 bg-signal-work/10 px-5 py-2.5 text-sm font-bold text-signal-work transition active:scale-[0.97]"
          >
            <TrashIcon />
            Discard
          </button>
        </div>

        {sheet === "discardConfirm" && (
          <DiscardConfirm sport={sport} onKeep={() => setSheet(null)} onDiscard={discard} />
        )}
      </div>
    );
  }

  /* ————— MAP SCREEN (ready / live) ————— */
  return (
    <div className="relative -mb-28 min-h-0 w-full flex-1 overflow-hidden">
      {/* real map / court backdrop */}
      {isGps && hasRealMapPosition ? (
        <LiveMap
          key={`${gmapDead ? "leaflet" : "google"}-${mapAttempt}`}
          center={center}
          path={phase === "live" ? path : []}
          satellite={satellite}
          follow={phase === "live"}
          className="h-full w-full"
          onFail={() => {
            if (HAS_GKEY && !gmapDead) setGmapDead(true);
            else setMapUnavailable(true);
          }}
        />
      ) : (
        <div className="relative h-full w-full bg-well">
          <div className="absolute inset-0 bg-graphite" />
          <div className="absolute inset-0 grain opacity-25" />
          <div className="absolute inset-0 grid place-items-center pb-40 opacity-25"><SIcon name={isGps ? "run" : sport.icon} size={110} /></div>
          {isGps && <div className="absolute inset-x-0 top-[30%] text-center text-white"><span className="mx-auto block h-3 w-3 animate-pulse rounded-full bg-signal-good" /><p className="mt-4 font-golden text-xl">FINDING YOUR POSITION</p></div>}
        </div>
      )}

      {isGps && mapUnavailable && (
        <div className="absolute inset-x-5 top-20 z-20 rounded-3xl bg-graphite ring-1 ring-inset ring-hair p-5 text-white">
          <p className="font-golden text-xl leading-none">MAP IS OFFLINE</p>
          <p className="mt-2 text-sm font-semibold text-white/70">GPS recording still works. Reconnect to load the map tiles.</p>
          <button onClick={() => { setMapUnavailable(false); setMapAttempt((n) => n + 1); }} className="mt-4 rounded-full bg-action px-5 py-2.5 text-xs font-black text-on-action">TRY MAP AGAIN</button>
        </div>
      )}

      {/* top-left: close (ready) / recording state (live) */}
      <div className="absolute left-4 top-3 z-10 flex flex-col items-start gap-2">
        {phase === "ready" ? (
          <button
            onClick={() => router.push("/")}
            className="grid h-11 w-11 place-items-center rounded-full bg-white text-on-action shadow-soft"
          >
            ✕
          </button>
        ) : null}
      </div>

      {/* The map stays full screen. The live card gives one sport-specific
          metric the hero row (run = time, ride = distance), then keeps the
          other three measured fields in one quiet row below it. */}
      {phase === "live" && !showSplits && (
        <div className="absolute inset-x-4 bottom-[190px] z-10">
          <button
            onClick={() => setShowSplits(true)}
            className="block w-full overflow-hidden rounded-2xl bg-sheet text-fg ring-1 ring-inset ring-hair"
          >
            {(() => {
              const strip = gpsLost
                ? { t: "GPS signal lost", c: "bg-signal-work/15 text-signal-work" }
                : autoPaused
                ? { t: "Auto-paused", c: "bg-signal-okay/20 text-[#9A6B00]" }
                : paused
                ? { t: "Paused", c: "bg-signal-okay/20 text-[#9A6B00]" }
                : isGps
                ? gps === "ready"
                  ? { t: "GPS acquired", c: "bg-signal-good/12 text-signal-good" }
                  : { t: "Waiting for GPS", c: "bg-signal-okay/15 text-signal-okay" }
                : { t: "Recording", c: "bg-signal-good/12 text-signal-good" };
              return (
                <span className={`flex items-center justify-between px-4 py-1.5 text-[11px] font-extrabold uppercase tracking-widest ${strip.c}`}>
                  {strip.t}
                  <ExpandIcon />
                </span>
              );
            })()}
            {(() => {
              const primaryIndex = sport.key === "ride" ? 1 : 0;
              const primary = f[primaryIndex];
              const secondary = f.filter((_, index) => index !== primaryIndex);
              return (
                <span className="block">
                  <span className="block px-5 pb-3 pt-2 text-left">
                    <span className="block font-golden text-[48px] leading-none tabular-nums text-fg">{primary.v}</span>
                    <span className="mt-1 block text-[11px] font-bold uppercase tracking-widest text-fg-muted">{primary.l}</span>
                  </span>
                  <span className="grid grid-cols-3 gap-3 border-t border-hair px-5 py-3">
                    {secondary.map((metric) => (
                      <span key={metric.l} className="min-w-0 text-left">
                        <span className="block truncate font-golden text-[19px] leading-none tabular-nums text-fg">{metric.v}</span>
                        <span className="mt-1 block text-[11px] font-bold uppercase leading-tight tracking-wider text-fg-muted">{metric.l}</span>
                      </span>
                    ))}
                  </span>
                </span>
              );
            })()}
          </button>
        </div>
      )}

      {/* floating round buttons on the right edge (Strava: layers / locate) */}
      <div className="absolute right-4 top-3 z-10 flex flex-col gap-2.5">
        <button
          onClick={() => setSheet("settings")}
          className="grid h-11 w-11 place-items-center rounded-full bg-white text-on-action shadow-soft transition active:scale-95"
        >
          <GearIcon />
        </button>
        {isGps && (
          <>
            <button
              onClick={() => setSheet("mapType")}
              className="grid h-11 w-11 place-items-center rounded-full bg-white text-on-action shadow-soft transition active:scale-95"
            >
              <LayersIcon />
            </button>
            <button
              onClick={() => {
                // fresh GPS fix first; falls back to the latest path point
                attemptLocate(undefined, phase !== "live");
                setCenter((c) => [...(path[path.length - 1] ?? c)] as LatLng);
              }}
              className="grid h-11 w-11 place-items-center rounded-full bg-white text-on-action shadow-soft transition active:scale-95"
            >
              <LocateIcon />
            </button>
          </>
        )}
      </div>

      {/* bottom sheet — recording hides the nav, so the sheet hugs the bottom */}
      <div
        className={`absolute inset-x-0 bottom-0 z-10 rounded-t-3xl border-t border-white/10 bg-sheet text-fg transition-[padding] duration-300 ${
          phase === "live" ? "pb-10" : "pb-32"
        }`}
      >
        {phase === "ready" && (
          <div className="px-5 pt-3">
            <div className="mx-auto h-1 w-10 rounded-full bg-track" />
            <button onClick={() => setSheet("picker")} className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-panel px-4 py-3 text-left text-fg shadow-panel transition active:scale-[0.99]">
              <SIcon name={sport.icon} size={38} />
              <span className="min-w-0 flex-1"><span className="block text-[11px] font-black uppercase tracking-[0.16em] text-fg-muted">ACTIVITY</span><span className="mt-0.5 block text-lg font-extrabold text-fg">{sport.label}</span></span>
              <span className="font-golden text-2xl text-fg">›</span>
            </button>
            <div className="mt-3 flex items-center gap-3 px-1">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${!isGps || gps === "ready" ? "bg-signal-good" : gps === "locating" ? "bg-signal-okay" : "bg-signal-work"}`} />
              <span className="min-w-0 flex-1 text-sm font-bold text-fg">{!isGps ? "Timer ready · distance unavailable" : gps === "ready" ? acc != null ? `GPS ready · ±${acc} m` : "GPS ready" : gps === "locating" ? "Finding your GPS signal…" : "Location needed to record distance"}</span>
              {isGps && gps !== "ready" && <button onClick={() => allowLocation(true)} className="shrink-0 text-xs font-black text-signal-good">ENABLE</button>}
            </div>
            <button onClick={start} className="btn-press mt-4 w-full rounded-full bg-action py-4 text-[15px] font-black uppercase tracking-[0.1em] text-on-action">START {sport.label.toUpperCase()}</button>
          </div>
        )}

        {phase === "live" && (
          <div className="animate-fade-up px-5 pt-2">
            {/* the gray bar: swipe UP (or tap) → fullscreen stats, Strava-style */}
            <button
              onPointerDown={(e) => { dragStartRef.current = e.clientY; }}
              onPointerUp={(e) => {
                const dy = e.clientY - (dragStartRef.current ?? e.clientY);
                dragStartRef.current = null;
                if (dy < 12) setShowSplits(true); // up-swipe or plain tap
              }}
              aria-label="Expand stats"
              className="block w-full touch-none py-2"
            >
              <span className="mx-auto block h-1 w-10 rounded-full bg-track" />
            </button>

            {/* stable morphing controls — Strava-style: round buttons with a
                small text label BELOW each. The pause button also clears an
                auto-pause (manual override). */}
            <div className="mt-1 flex items-start justify-center gap-5">
              <div
                style={{ transform: isPaused ? "translateX(0)" : "translateX(48px)" }}
                className="flex flex-col items-center gap-1.5 transition-transform duration-300 ease-out"
              >
                <button
                  onClick={() => {
                    if (autoPaused) {
                      setAutoPaused(false);
                      slowSinceRef.current = null;
                    } else setPaused(!paused);
                  }}
                  className={`grid h-[72px] w-[72px] place-items-center rounded-full transition-colors duration-300 active:scale-95 ${
                    isPaused ? "bg-signal-good text-white" : "bg-action text-on-action"
                  }`}
                >
                  {isPaused ? <PlayIcon /> : <PauseIcon />}
                </button>
                <span className="text-[11px] font-bold text-fg">{isPaused ? "Resume" : "Pause"}</span>
              </div>
              <div
                className={`flex flex-col items-center gap-1.5 transition-all duration-300 ease-out ${
                  isPaused ? "translate-x-0 scale-100 opacity-100" : "pointer-events-none translate-x-[-24px] scale-75 opacity-0"
                }`}
              >
                <button
                  onClick={() => setSheet("confirm")}
                  tabIndex={isPaused ? 0 : -1}
                  className="grid h-[72px] w-[72px] place-items-center rounded-full bg-action text-on-action active:scale-95"
                >
                  <StopIcon />
                </button>
                <span className="text-[11px] font-bold text-fg">Finish</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Expanded live stats preserve the same hierarchy as the compact card:
          one primary metric, then the remaining three in a single row. */}
      {phase === "live" && showSplits && (
        <div className="absolute inset-0 z-20 flex animate-fade-up flex-col bg-graphite text-fg">
          {isPaused && (
            <div className="bg-signal-okay/25 pb-3 pt-4 text-center">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#8A6410]">
                {autoPaused ? "Auto-paused" : "Paused"}
              </p>
            </div>
          )}
          <button
            onPointerDown={(e) => { dragStartRef.current = e.clientY; }}
            onPointerUp={(e) => {
              const dy = e.clientY - (dragStartRef.current ?? e.clientY);
              dragStartRef.current = null;
              if (dy > -12) setShowSplits(false); // down-swipe or tap
            }}
            aria-label="Collapse stats"
            className="touch-none py-3"
          >
            <span className="mx-auto block h-1 w-10 rounded-full bg-track" />
          </button>

          <div className="flex flex-1 flex-col justify-center gap-14 px-6 pb-2">
            {(() => {
              const primaryIndex = sport.key === "ride" ? 1 : 0;
              const primary = f[primaryIndex];
              const secondary = f.filter((_, index) => index !== primaryIndex);
              return (
                <>
                  <div className="text-center">
                    <p className="font-golden text-[88px] leading-none tabular-nums text-fg">{primary.v}</p>
                    <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.18em] text-fg-muted">{primary.l}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-4 border-y border-hair py-5">
                    {secondary.map((metric) => (
                      <div key={metric.l} className="min-w-0 text-center">
                        <p className="truncate font-golden text-3xl leading-none tabular-nums text-fg">{metric.v}</p>
                        <p className="mt-2 text-[11px] font-bold uppercase leading-tight tracking-wider text-fg-muted">{metric.l}</p>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>

          {/* same labeled controls, always reachable */}
          <div className="flex items-start justify-center gap-5 pb-8">
            <div
              style={{ transform: isPaused ? "translateX(0)" : "translateX(48px)" }}
              className="flex flex-col items-center gap-1.5 transition-transform duration-300 ease-out"
            >
              <button
                onClick={() => {
                  if (autoPaused) {
                    setAutoPaused(false);
                    slowSinceRef.current = null;
                  } else setPaused(!paused);
                }}
                className={`grid h-[72px] w-[72px] place-items-center rounded-full transition-colors duration-300 active:scale-95 ${
                  isPaused ? "bg-signal-good text-white" : "bg-action text-on-action"
                }`}
              >
                {isPaused ? <PlayIcon /> : <PauseIcon />}
              </button>
              <span className="text-[11px] font-bold text-fg">{isPaused ? "Resume" : "Pause"}</span>
            </div>
            <div
              className={`flex flex-col items-center gap-1.5 transition-all duration-300 ease-out ${
                isPaused ? "translate-x-0 scale-100 opacity-100" : "pointer-events-none translate-x-[-24px] scale-75 opacity-0"
              }`}
            >
              <button
                onClick={() => setSheet("confirm")}
                tabIndex={isPaused ? 0 : -1}
                className="grid h-[72px] w-[72px] place-items-center rounded-full bg-action text-on-action active:scale-95"
              >
                <StopIcon />
              </button>
              <span className="text-[11px] font-bold text-fg">Finish</span>
            </div>
          </div>
        </div>
      )}

      {/* sheets */}
      {sheet && sheet !== "confirm" && sheet !== "discardConfirm" && (
        <button aria-label="Close" onClick={() => setSheet(null)} className="absolute inset-0 z-20 bg-ink/40" />
      )}

      {sheet === "mapType" && (
        <div className="absolute inset-x-0 bottom-0 z-30 animate-fade-up rounded-t-3xl bg-sheet p-5 pb-28 text-fg ring-1 ring-inset ring-hair">
          <div className="mx-auto h-1 w-10 rounded-full bg-track" />
          <p className="mt-4 text-base font-extrabold">Map type</p>
          <div className="mt-4 space-y-2">
            {([
              { v: false, t: "Standard", d: "Streets and landmarks" },
              { v: true, t: "Satellite", d: "Aerial imagery with labels" },
            ] as const).map((o) => (
              <button
                key={o.t}
                onClick={() => { setSatellite(o.v); setSheet(null); }}
                className={`flex w-full items-center gap-3.5 rounded-2xl px-4 py-3.5 text-left transition active:scale-[0.99] ${
                  satellite === o.v ? "bg-signal-good/15 text-fg" : "bg-panel text-fg"
                }`}
              >
                <span className="flex-1 text-sm font-bold">{o.t}</span>
                {satellite === o.v && <CheckIcon />}
              </button>
            ))}
          </div>
        </div>
      )}

      {sheet === "picker" && (
        <div className="absolute inset-x-0 bottom-0 z-30 animate-fade-up rounded-t-3xl bg-sheet p-5 pb-28 text-fg ring-1 ring-inset ring-hair">
          <div className="mx-auto h-1 w-10 rounded-full bg-track" />
          <p className="mt-4 text-base font-extrabold">Choose a sport</p>
          <div className="mt-4 max-h-[45vh] space-y-1.5 overflow-y-auto">
            {PROFILES.map((p) => (
              <button
                key={p.key}
                onClick={() => pickSport(p)}
                className={`flex w-full items-center gap-3.5 rounded-2xl px-4 py-3 text-left transition active:scale-[0.99] ${
                  sport.key === p.key ? "bg-signal-good/15 text-fg" : "bg-panel text-fg"
                }`}
              >
                <SIcon name={p.icon} size={40} />
                <span className="flex-1 text-sm font-bold">{p.label}</span>
                {sport.key === p.key && <CheckIcon />}
              </button>
            ))}
          </div>
        </div>
      )}

      {sheet === "settings" && (
        <div className="absolute inset-x-0 bottom-0 z-30 animate-fade-up rounded-t-3xl bg-sheet p-5 pb-28 text-fg ring-1 ring-inset ring-hair">
          <div className="mx-auto h-1 w-10 rounded-full bg-track" />
          <p className="mt-4 text-base font-extrabold">Record settings</p>
          <div className="mt-4 space-y-2">
            {([
              { k: "autoPause", t: "Auto-pause", d: "Pause when you stop moving" },
              { k: "audioCues", t: "Audio cues", d: "Announce splits out loud" },
              { k: "screenOn", t: "Keep screen on", d: "Don't dim while recording" },
            ] as const).map((o) => (
              <button
                key={o.k}
                onClick={() => toggleRecordSetting(o.k)}
                className="flex w-full items-center gap-3 rounded-2xl bg-panel px-4 py-3.5 text-left text-fg shadow-panel transition active:scale-[0.99]"
              >
                <span className="flex-1 text-sm font-bold">{o.t}</span>
                <span className={`relative h-7 w-12 rounded-full transition ${settings[o.k] ? "bg-signal-good" : "bg-track"}`}>
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
                      settings[o.k] ? "left-6" : "left-1"
                    }`}
                  />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {sheet === "confirm" && (
        <>
          <div className="absolute inset-0 z-20 bg-ink/50 backdrop-blur-[2px]" />
          <div className="absolute inset-0 z-30 grid place-items-center px-6">
          <div className="w-full animate-pop rounded-3xl bg-sheet p-6 text-center text-fg ring-1 ring-inset ring-hair">
            <p className="text-lg font-extrabold">Stop {sport.label.toLowerCase()}?</p>
            <p className="mt-1 text-sm text-fg-muted">{fmtTime(seconds)} recorded</p>
            <div className="mt-5 space-y-2.5">
              <button
                onClick={toSave}
                className="btn-press-good w-full rounded-full bg-signal-good py-3.5 text-[15px] font-extrabold text-white transition"
              >
                Save activity
              </button>
              <button
                onClick={() => { setSheet(null); setPaused(false); setAutoPaused(false); slowSinceRef.current = null; }}
                className="w-full rounded-full bg-action py-3.5 text-[15px] font-bold text-on-action transition active:scale-[0.98]"
              >
                Resume
              </button>
              <button
                onClick={() => setSheet("discardConfirm")}
                className="mx-auto flex items-center gap-2 rounded-full border border-signal-work/30 bg-signal-work/10 px-5 py-2.5 text-sm font-bold text-signal-work transition active:scale-[0.97]"
              >
                <TrashIcon />
                Discard
              </button>
            </div>
          </div>
          </div>
        </>
      )}

      {sheet === "discardConfirm" && (
        <DiscardConfirm sport={sport} onKeep={() => setSheet("confirm")} onDiscard={discard} />
      )}

      {/* location permission denied */}
      {sheet === "noLocation" && (
        <>
          <div className="absolute inset-0 z-20 bg-ink/50 backdrop-blur-[2px]" />
          <div className="absolute inset-0 z-30 grid place-items-center px-8">
          <div className="w-full animate-pop rounded-3xl bg-sheet p-6 text-center text-fg ring-1 ring-inset ring-hair">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-signal-work/12 text-signal-work">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 11.5-8 11.5S4 16 4 10a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></svg>
            </span>
            <p className="mt-3 text-base font-extrabold">Location is off</p>
            <div className="mt-5 space-y-2.5">
              <button
                onClick={() => { localStorage.removeItem("ml_loc_perm"); setSheet("iosLocation"); }}
                className="w-full rounded-full bg-action py-3.5 text-[15px] font-bold text-on-action transition active:scale-[0.98]"
              >
                Try again
              </button>
              <button
                onClick={() => setSheet(null)}
                className="w-full rounded-full bg-inset py-3.5 text-[15px] font-bold text-fg transition active:scale-[0.98]"
              >
                Not now
              </button>
            </div>
          </div>
          </div>
        </>
      )}

      {/* a recording died with the page — offer to pick it back up */}
      {sheet === "resume" && chk && (
        <>
          <div className="absolute inset-0 z-40 bg-ink/50 backdrop-blur-[2px]" />
          <div className="absolute inset-0 z-50 grid place-items-center px-8">
            <div className="w-full animate-pop rounded-3xl bg-sheet p-6 text-center text-fg ring-1 ring-inset ring-hair">
              <p className="text-base font-extrabold">Resume your workout?</p>
              <p className="mt-1 text-sm font-bold text-fg-soft">{fmtTime(chk.sec)} recorded</p>
              <div className="mt-5 space-y-2.5">
                <button
                  onClick={restoreCheckpoint}
                  className="btn-press-good w-full rounded-full bg-signal-good py-3.5 text-[15px] font-extrabold text-white transition"
                >
                  Resume
                </button>
                <button
                  onClick={() => {
                    localStorage.removeItem("ml_rec_checkpoint");
                    setChk(null);
                    setSheet(null);
                  }}
                  className="w-full rounded-full bg-inset py-3.5 text-[15px] font-bold text-fg transition active:scale-[0.98]"
                >
                  Delete it
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Strava-style start countdown: black screen, giant white 3 → 2 → 1 → GO */}
      {count !== null && (
        <div className="fixed inset-y-0 left-1/2 z-[70] grid w-full max-w-[430px] -translate-x-1/2 place-items-center bg-black">
          <span
            key={count}
            className="count-pop font-extrabold tracking-tight text-white"
            style={{ fontSize: count === 0 ? 110 : 180, lineHeight: 1 }}
          >
            {count === 0 ? "GO" : count}
          </span>
        </div>
      )}

      {/* iOS-system-style location permission dialog (replaced by the real one in the packaged app) */}
      {sheet === "iosLocation" && (
        <>
          <div className="absolute inset-0 z-40 bg-black/40" />
          <div className="absolute inset-0 z-50 grid place-items-center">
          <div className="w-[280px] animate-pop overflow-hidden rounded-lg bg-[#F5F5F5]/95 text-center shadow-2xl backdrop-blur-xl">
            <div className="px-5 pb-4 pt-5">
              <p className="text-[16px] font-semibold leading-snug text-black">
                Allow &ldquo;MotionLab 2.0&rdquo; to use your location?
              </p>
              <p className="mt-1.5 text-[12px] leading-snug text-black/60">
                Your precise location is used to record your route while you work out.
              </p>
            </div>
            <button
              onClick={() => allowLocation(false)}
              className="w-full border-t border-black/15 py-2.5 text-[16px] text-[#0A84FF] transition active:bg-black/5"
            >
              Allow Once
            </button>
            <button
              onClick={() => allowLocation(true)}
              className="w-full border-t border-black/15 py-2.5 text-[16px] text-[#0A84FF] transition active:bg-black/5"
            >
              Allow While Using App
            </button>
            <button
              onClick={denyLocation}
              className="w-full border-t border-black/15 py-2.5 text-[16px] text-[#0A84FF] transition active:bg-black/5"
            >
              Don&apos;t Allow
            </button>
          </div>
          </div>
        </>
      )}
    </div>
  );
}

function DiscardConfirm({ sport, onKeep, onDiscard }: { sport: Profile; onKeep: () => void; onDiscard: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/50 backdrop-blur-[2px]" />
      <div className="fixed inset-0 z-50 grid place-items-center px-10">
      <div className="w-full max-w-[350px] animate-pop rounded-3xl bg-sheet p-6 text-center text-fg ring-1 ring-inset ring-hair">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-signal-work/12 text-signal-work">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
        </span>
        <p className="mt-3 text-base font-extrabold">Discard this {sport.label.toLowerCase()}?</p>
        <div className="mt-5 space-y-2.5">
          <button
            onClick={onDiscard}
            className="btn-press-work w-full rounded-full bg-signal-work py-3.5 text-[15px] font-extrabold text-white transition"
          >
            Yes, discard
          </button>
          <button
            onClick={onKeep}
            className="w-full rounded-full bg-inset py-3.5 text-[15px] font-bold text-fg transition active:scale-[0.98]"
          >
            Keep it
          </button>
        </div>
      </div>
      </div>
    </>
  );
}

/* icons */
function PauseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1.5" />
      <rect x="14" y="5" width="4" height="14" rx="1.5" />
    </svg>
  );
}
// outward diagonal arrows — "expand to full stats" (Strava's card corner icon)
function ExpandIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5z" />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
    </svg>
  );
}
function LayersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}
function LocateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF4E1A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l5 5L20 7" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}
