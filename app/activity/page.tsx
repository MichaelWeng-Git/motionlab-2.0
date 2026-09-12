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

const DEFAULT_CENTER: LatLng = [31.2304, 121.4737]; // fallback until geolocation resolves

type Phase = "ready" | "live" | "save";
type Sheet = null | "picker" | "settings" | "confirm" | "discardConfirm" | "noLocation" | "iosLocation" | "mapType" | "resume";

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
  const [settings, setSettings] = useState({ autoPause: true, audioCues: false, screenOn: true });
  const [units, setUnits] = useState<UnitSystem>("metric");
  const [actName, setActName] = useState("");

  // — real location —
  // Permission is requested on the user's FIRST Start (native browser prompt).
  // Denied → GPS sports can't be recorded (court/pool sports still work).
  const [center, setCenter] = useState<LatLng>(() => {
    // last known region as the FIRST paint — the map never visibly jumps
    if (typeof window !== "undefined") {
      try {
        const c = JSON.parse(localStorage.getItem("ml_ip_center") ?? "null");
        if (Array.isArray(c) && c.length === 2) return c as LatLng;
      } catch {}
    }
    return DEFAULT_CENTER;
  });
  const [gps, setGps] = useState<"unknown" | "locating" | "ready" | "off">("unknown");
  // Google Maps died (billing/network/adblock) → swap to Leaflet, never a gray box
  const [gmapDead, setGmapDead] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const LiveMap = HAS_GKEY && !gmapDead ? GoogleMap : LeafletMap;

  // rough region lock BEFORE any GPS: center the map on the user's actual
  // city by IP (Strava-style "you open the map where you are"), replaced by
  // the real fix the moment geolocation answers
  const hasRealCenterRef = useRef(false);
  useEffect(() => {
    fetch("https://ipapi.co/json/")
      .then((r) => r.json())
      .then((j) => {
        if (j?.latitude && j?.longitude) {
          localStorage.setItem("ml_ip_center", JSON.stringify([j.latitude, j.longitude]));
          if (!hasRealCenterRef.current) setCenter([j.latitude, j.longitude]);
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => setUnits(getPreferences().units), []);
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
  const [splits, setSplits] = useState<{ km: number; seconds: number }[]>([]);
  const splitsRef = useRef<{ km: number; seconds: number }[]>([]);
  const splitAnchorRef = useRef({ dist: 0, sec: 0 });
  const [elevGain, setElevGain] = useState(0);
  const elevRef = useRef<{ ref: number | null; win: number[] }>({ ref: null, win: [] });
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

  // audio cues (Web Speech) — spoken only when the toggle is on
  function speak(text: string) {
    if (!settings.audioCues) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch {}
  }

  // km splits: whenever cumulative distance crosses n×1000m
  function recordDistance(nm: number) {
    const anchor = splitAnchorRef.current;
    if (nm - anchor.dist >= 1000) {
      const sec = Math.max(1, secondsRef.current - anchor.sec);
      splitAnchorRef.current = { dist: anchor.dist + 1000, sec: secondsRef.current };
      const km = splitsRef.current.length + 1;
      splitsRef.current = [...splitsRef.current, { km, seconds: sec }];
      setSplits(splitsRef.current);
      speak(`Kilometer ${km}. ${Math.floor(sec / 60)} minutes ${sec % 60} seconds.`);
    }
  }

  // elevation gain: smoothed altitude + 10m hysteresis (Strava's GPS-only rule)
  function recordAltitude(alt: number | null, altAcc: number | null) {
    if (alt == null || (altAcc != null && altAcc > 15)) return;
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
        kcal: kcalRef.current, elev: elevGainRef.current, ts: Date.now(),
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
      splitsRef.current = c.splits ?? []; setSplits(splitsRef.current);
      splitAnchorRef.current = c.anchor ?? { dist: (c.splits?.length ?? 0) * 1000, sec: c.sec };
      setKcal(c.kcal ?? 0);
      setElevGain(c.elev ?? 0);
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
  function attemptLocate(onReady?: () => void) {
    setGps("locating");
    if (!("geolocation" in navigator)) { setGps("off"); setSheet("noLocation"); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { hasRealCenterRef.current = true; setCenter([p.coords.latitude, p.coords.longitude]); setGps("ready"); onReady?.(); },
      () => { setGps("off"); setSheet("noLocation"); },
      { enableHighAccuracy: true, timeout: 8000 }
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
              hasRealCenterRef.current = true;
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
          hasRealCenterRef.current = true;
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
    try {
      addActivity({
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
        elevGain: Math.round(elevGain),
        kcal: hasCalorieEstimate ? Math.round(kcal) : null,
        path: isGps ? path : null,
        thumb: isGps ? routeThumb(path) : undefined, // static — shows instantly in the list
        date: new Date().toISOString(),
      });
    } catch {}
    localStorage.removeItem("ml_rec_checkpoint");
    speak("Activity saved");
    // saved — straight home, no detour through the activities list
    router.push("/");
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
          className="mt-4 w-full rounded-2xl bg-white px-4 py-3.5 text-base font-bold shadow-soft outline-none focus:border-ink"
        />

        <div className="mt-4 overflow-hidden rounded-3xl shadow-soft">
          {isGps && path.length > 1 ? (
            <LiveMap center={path[0]} path={path} fit interactive={false} className="h-44 w-full" />
          ) : (
            <div className="relative grid h-28 place-items-center bg-ink">
              <div className="absolute inset-0 bg-ink" />
              <SIcon name={sport.icon} size={44} className="relative" />
            </div>
          )}
          <div className="grid grid-cols-3 divide-x divide-black/5 border-b border-black/5 bg-white py-3.5">
            {f.slice(0, 3).map((s) => (
              <div key={s.l} className="text-center">
                <p className="text-lg font-extrabold tabular-nums">{s.v}</p>
                <p className="mt-0.5 text-[11px] font-bold uppercase tracking-widest text-ink-muted">{s.l}</p>
              </div>
            ))}
          </div>
          {/* second stat row: the numbers Strava shows under the big three */}
          <div className="flex items-center justify-center gap-5 bg-white pb-3 text-[11px] font-bold text-ink-muted">
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
          className="mt-3 w-full resize-none rounded-2xl bg-white px-4 py-3 text-sm font-medium shadow-soft outline-none placeholder:text-ink-muted focus:border-ink"
        />

        {/* perceived exertion 1-10 */}
        <div className="mt-3 rounded-2xl bg-white p-4 shadow-soft">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-bold">How did that feel?</p>
            <p className="text-sm font-extrabold tabular-nums text-volt-deep">{exertion}/10</p>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            value={exertion}
            onChange={(e) => setExertion(+e.target.value)}
            className="mt-2 w-full accent-volt"
          />
          <div className="flex justify-between text-[11px] font-semibold text-ink-muted">
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
                visibility === v.k ? "border-ink bg-ink text-white" : "border-black/10 bg-white text-ink shadow-soft"
              }`}
            >
              {v.t}
            </button>
          ))}
        </div>

        {/* km splits table */}
        {splits.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-2xl bg-white shadow-soft">
            <div className="flex items-center justify-between border-b border-black/5 px-4 py-2.5">
              <span className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">Km</span>
              <span className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">Pace</span>
            </div>
            {splits.map((s) => (
              <div key={s.km} className="flex items-center justify-between px-4 py-2 odd:bg-black/[0.02]">
                <span className="text-sm font-bold">{s.km}</span>
                <span className="text-sm font-extrabold tabular-nums">
                  {Math.floor(s.seconds / 60)}:{String(s.seconds % 60).padStart(2, "0")}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 space-y-3 pb-8">
          <button
            onClick={persist}
            className="w-full rounded-full bg-signal-good py-4 text-[15px] font-extrabold text-white shadow-lift transition active:scale-[0.98]"
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
      {isGps ? (
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
        <div className="relative h-full w-full bg-ink">
          <div className="absolute inset-0 bg-[radial-gradient(120%_70%_at_50%_0%,#1e2a45_0%,#17271F_60%)]" />
          <div className="absolute inset-0 grain opacity-25" />
          <div className="absolute inset-0 grid place-items-center pb-40 opacity-25"><SIcon name={sport.icon} size={110} /></div>
        </div>
      )}

      {isGps && mapUnavailable && (
        <div className="absolute inset-x-5 top-20 z-20 rounded-3xl bg-graphite p-5 text-white shadow-lift">
          <p className="font-golden text-xl leading-none">MAP IS OFFLINE</p>
          <p className="mt-2 text-sm font-semibold text-white/70">GPS recording still works. Reconnect to load the map tiles.</p>
          <button onClick={() => { setMapUnavailable(false); setMapAttempt((n) => n + 1); }} className="mt-4 rounded-full bg-volt px-5 py-2.5 text-xs font-black text-volt-ink">TRY MAP AGAIN</button>
        </div>
      )}

      {/* top-left: close (ready) / recording state (live) */}
      <div className="absolute left-4 top-3 z-10 flex flex-col items-start gap-2">
        {phase === "ready" ? (
          <button
            onClick={() => router.push("/")}
            className="grid h-11 w-11 place-items-center rounded-full bg-white text-ink shadow-soft"
          >
            ✕
          </button>
        ) : null}
      </div>

      {/* CURRENT STRAVA (2025 record redesign): the map stays FULL SCREEN and a
          floating white card carries ONE row of three stats — Time, the sport's
          average metric (center, larger), Distance — labels BELOW the numbers.
          A thin status strip tops the card; tapping it expands to full stats. */}
      {phase === "live" && !showSplits && (
        <div className="absolute inset-x-4 bottom-[150px] z-10">
          <button
            onClick={() => setShowSplits(true)}
            className="block w-full overflow-hidden rounded-2xl bg-white shadow-lift"
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
            <span className="flex items-end justify-between px-5 pb-3.5 pt-2">
              {[f[0], f[2], f[1]].map((s, i) => (
                <span key={s.l} className={`block ${i === 1 ? "text-center" : i === 0 ? "text-left" : "text-right"}`}>
                  <span
                    className={`block font-extrabold leading-none tabular-nums tracking-tight text-ink ${
                      i === 1 ? "text-[34px]" : "text-[24px]"
                    }`}
                  >
                    {s.v}
                  </span>
                  <span className="mt-1 block text-[11px] font-bold uppercase tracking-widest text-ink-muted">{s.l}</span>
                </span>
              ))}
            </span>
          </button>
        </div>
      )}

      {/* floating round buttons on the right edge (Strava: layers / locate) */}
      <div className="absolute right-4 top-3 z-10 flex flex-col gap-2.5">
        <button
          onClick={() => setSheet("settings")}
          className="grid h-11 w-11 place-items-center rounded-full bg-white text-ink shadow-soft transition active:scale-95"
        >
          <GearIcon />
        </button>
        {isGps && (
          <>
            <button
              onClick={() => setSheet("mapType")}
              className="grid h-11 w-11 place-items-center rounded-full bg-white text-ink shadow-soft transition active:scale-95"
            >
              <LayersIcon />
            </button>
            <button
              onClick={() => {
                // fresh GPS fix first; falls back to the latest path point
                attemptLocate();
                setCenter((c) => [...(path[path.length - 1] ?? c)] as LatLng);
              }}
              className="grid h-11 w-11 place-items-center rounded-full bg-white text-ink shadow-soft transition active:scale-95"
            >
              <LocateIcon />
            </button>
          </>
        )}
      </div>

      {/* bottom sheet — recording hides the nav, so the sheet hugs the bottom */}
      <div
        className={`absolute inset-x-0 bottom-0 z-10 rounded-t-3xl border-t border-black/5 bg-paper/95 shadow-[0_-8px_30px_rgba(14,31,26,0.12)] backdrop-blur-xl transition-[padding] duration-300 ${
          phase === "live" ? "pb-10" : "pb-32"
        }`}
      >
        {phase === "ready" && (
          <div className="px-5 pt-3">
            <div className="mx-auto h-1 w-10 rounded-full bg-black/10" />
            <button onClick={() => setSheet("picker")} className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left shadow-soft transition active:scale-[0.99]">
              <SIcon name={sport.icon} size={38} />
              <span className="min-w-0 flex-1"><span className="block text-[11px] font-black uppercase tracking-[0.16em] text-ink-muted">ACTIVITY</span><span className="mt-0.5 block text-lg font-extrabold text-ink">{sport.label}</span></span>
              <span className="font-golden text-2xl text-ink">›</span>
            </button>
            <div className="mt-3 flex items-center gap-3 px-1">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${!isGps || gps === "ready" ? "bg-signal-good" : gps === "locating" ? "bg-signal-okay" : "bg-signal-work"}`} />
              <span className="min-w-0 flex-1 text-sm font-bold text-ink">{!isGps ? "Timer ready · distance unavailable" : gps === "ready" ? acc != null ? `GPS ready · ±${acc} m` : "GPS ready" : gps === "locating" ? "Finding your GPS signal…" : "Location needed to record distance"}</span>
              {isGps && gps !== "ready" && <button onClick={() => allowLocation(true)} className="shrink-0 text-xs font-black text-volt-deep">ENABLE</button>}
            </div>
            <button onClick={start} className="btn-press mt-4 w-full rounded-full bg-volt py-4 text-[15px] font-black uppercase tracking-[0.1em] text-volt-ink shadow-lift">START {sport.label.toUpperCase()}</button>
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
              <span className="mx-auto block h-1 w-10 rounded-full bg-black/15" />
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
                  className={`grid h-[72px] w-[72px] place-items-center rounded-full shadow-lift transition-colors duration-300 active:scale-95 ${
                    isPaused ? "bg-signal-good text-white" : "bg-ink text-white"
                  }`}
                >
                  {isPaused ? <PlayIcon /> : <PauseIcon />}
                </button>
                <span className="text-[11px] font-bold text-ink">{isPaused ? "Resume" : "Pause"}</span>
              </div>
              <div
                className={`flex flex-col items-center gap-1.5 transition-all duration-300 ease-out ${
                  isPaused ? "translate-x-0 scale-100 opacity-100" : "pointer-events-none translate-x-[-24px] scale-75 opacity-0"
                }`}
              >
                <button
                  onClick={() => setSheet("confirm")}
                  tabIndex={isPaused ? 0 : -1}
                  className="grid h-[72px] w-[72px] place-items-center rounded-full bg-ink text-white shadow-lift active:scale-95"
                >
                  <StopIcon />
                </button>
                <span className="text-[11px] font-bold text-ink">Finish</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* FULLSCREEN stats — Strava's 2025 expanded record view: metrics stacked
          full-width and CENTERED with pure whitespace (no divider lines).
          Recording: Time (small, top) → CURRENT pace/speed as the giant hero →
          Distance. Paused: an amber banner holds the timer and the hero swaps
          to the AVERAGE metric — exactly Strava's behavior. */}
      {phase === "live" && showSplits && (
        <div className="absolute inset-0 z-20 flex animate-fade-up flex-col bg-paper">
          {isPaused && (
            <div className="bg-signal-okay/25 pb-3 pt-4 text-center">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#8A6410]">
                {autoPaused ? "Auto-paused" : "Paused"}
              </p>
              <p className="mt-1 text-4xl font-extrabold leading-none tabular-nums tracking-tight text-ink">{f[0].v}</p>
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
            <span className="mx-auto block h-1 w-10 rounded-full bg-black/15" />
          </button>

          <div className="flex flex-1 flex-col items-center justify-evenly px-6 pb-2">
            {(() => {
              type M = { v: string; l: string; s: "md" | "lg" | "hero" };
              const stack: M[] = isGps
                ? isPaused
                  ? [
                      { ...f[2], s: "hero" }, // average takes the hero slot while paused
                      { ...f[1], s: "lg" },
                      ...(sport.key === "ride" ? [{ v: `${Math.round(elevGain)} m`, l: "Elev gain", s: "md" as const }] : []),
                    ]
                  : [
                      { ...f[0], s: "md" }, // Time up top
                      { ...(f[3] ?? f[2]), s: "hero" }, // current pace / speed — the giant one
                      { ...f[1], s: "lg" }, // Distance
                      { ...f[2], s: "md" }, // average
                      ...(sport.key === "ride" ? [{ v: `${Math.round(elevGain)} m`, l: "Elev gain", s: "md" as const }] : []),
                    ]
                : [
                    { ...f[0], s: "md" },
                    { ...f[1], s: "hero" },
                    { ...f[2], s: "lg" },
                    { v: hasCalorieEstimate ? `${Math.round(kcal)}` : "—", l: "Est. calories", s: "md" },
                  ];
              const cls = { md: "text-4xl", lg: "text-6xl", hero: "text-[84px]" };
              return stack.map((m) => (
                <div key={m.l} className="text-center">
                  <p className={`font-extrabold leading-none tabular-nums tracking-tight text-ink ${cls[m.s]}`}>{m.v}</p>
                  <p className="mt-2 text-[11px] font-bold uppercase tracking-widest text-ink-muted">{m.l}</p>
                </div>
              ));
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
                className={`grid h-[72px] w-[72px] place-items-center rounded-full shadow-lift transition-colors duration-300 active:scale-95 ${
                  isPaused ? "bg-signal-good text-white" : "bg-ink text-white"
                }`}
              >
                {isPaused ? <PlayIcon /> : <PauseIcon />}
              </button>
              <span className="text-[11px] font-bold text-ink">{isPaused ? "Resume" : "Pause"}</span>
            </div>
            <div
              className={`flex flex-col items-center gap-1.5 transition-all duration-300 ease-out ${
                isPaused ? "translate-x-0 scale-100 opacity-100" : "pointer-events-none translate-x-[-24px] scale-75 opacity-0"
              }`}
            >
              <button
                onClick={() => setSheet("confirm")}
                tabIndex={isPaused ? 0 : -1}
                className="grid h-[72px] w-[72px] place-items-center rounded-full bg-ink text-white shadow-lift active:scale-95"
              >
                <StopIcon />
              </button>
              <span className="text-[11px] font-bold text-ink">Finish</span>
            </div>
          </div>
        </div>
      )}

      {/* sheets */}
      {sheet && sheet !== "confirm" && sheet !== "discardConfirm" && (
        <button aria-label="Close" onClick={() => setSheet(null)} className="absolute inset-0 z-20 bg-ink/40" />
      )}

      {sheet === "mapType" && (
        <div className="absolute inset-x-0 bottom-0 z-30 animate-fade-up rounded-t-3xl bg-paper p-5 pb-28 shadow-lift">
          <div className="mx-auto h-1 w-10 rounded-full bg-black/10" />
          <p className="mt-4 text-base font-extrabold">Map type</p>
          <div className="mt-4 space-y-2">
            {([
              { v: false, t: "Standard", d: "Streets and landmarks" },
              { v: true, t: "Satellite", d: "Aerial imagery with labels" },
            ] as const).map((o) => (
              <button
                key={o.t}
                onClick={() => { setSatellite(o.v); setSheet(null); }}
                className={`flex w-full items-center gap-3.5 rounded-2xl px-4 py-3.5 text-left shadow-soft transition active:scale-[0.99] ${
                  satellite === o.v ? "bg-volt-mist" : "bg-white"
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
        <div className="absolute inset-x-0 bottom-0 z-30 animate-fade-up rounded-t-3xl bg-paper p-5 pb-28 shadow-lift">
          <div className="mx-auto h-1 w-10 rounded-full bg-black/10" />
          <p className="mt-4 text-base font-extrabold">Choose a sport</p>
          <div className="mt-4 max-h-[45vh] space-y-1.5 overflow-y-auto">
            {PROFILES.map((p) => (
              <button
                key={p.key}
                onClick={() => pickSport(p)}
                className={`flex w-full items-center gap-3.5 rounded-2xl px-4 py-3 text-left shadow-soft transition active:scale-[0.99] ${
                  sport.key === p.key ? "bg-volt-mist" : "bg-white"
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
        <div className="absolute inset-x-0 bottom-0 z-30 animate-fade-up rounded-t-3xl bg-paper p-5 pb-28 shadow-lift">
          <div className="mx-auto h-1 w-10 rounded-full bg-black/10" />
          <p className="mt-4 text-base font-extrabold">Record settings</p>
          <div className="mt-4 space-y-2">
            {([
              { k: "autoPause", t: "Auto-pause", d: "Pause when you stop moving" },
              { k: "audioCues", t: "Audio cues", d: "Announce splits out loud" },
              { k: "screenOn", t: "Keep screen on", d: "Don't dim while recording" },
            ] as const).map((o) => (
              <button
                key={o.k}
                onClick={() => setSettings({ ...settings, [o.k]: !settings[o.k] })}
                className="flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3.5 text-left shadow-soft transition active:scale-[0.99]"
              >
                <span className="flex-1 text-sm font-bold">{o.t}</span>
                <span className={`relative h-7 w-12 rounded-full transition ${settings[o.k] ? "bg-volt-deep" : "bg-black/15"}`}>
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-soft transition-all ${
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
          <div className="w-full animate-pop rounded-3xl bg-paper p-6 text-center shadow-lift">
            <p className="text-lg font-extrabold">Stop {sport.label.toLowerCase()}?</p>
            <p className="mt-1 text-sm text-ink-muted">{fmtTime(seconds)} recorded</p>
            <div className="mt-5 space-y-2.5">
              <button
                onClick={toSave}
                className="btn-press-good w-full rounded-full bg-signal-good py-3.5 text-[15px] font-extrabold text-white transition"
              >
                Save activity
              </button>
              <button
                onClick={() => { setSheet(null); setPaused(false); }}
                className="btn-press w-full rounded-full bg-ink py-3.5 text-[15px] font-bold text-white transition"
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
          <div className="w-full animate-pop rounded-3xl bg-paper p-6 text-center shadow-lift">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-signal-work/12 text-signal-work">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 11.5-8 11.5S4 16 4 10a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></svg>
            </span>
            <p className="mt-3 text-base font-extrabold">Location is off</p>
            <div className="mt-5 space-y-2.5">
              <button
                onClick={() => { localStorage.removeItem("ml_loc_perm"); setSheet("iosLocation"); }}
                className="btn-press w-full rounded-full bg-ink py-3.5 text-[15px] font-bold text-white transition"
              >
                Try again
              </button>
              <button
                onClick={() => setSheet(null)}
                className="w-full rounded-full bg-white py-3.5 text-[15px] font-bold text-ink transition active:scale-[0.98]"
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
            <div className="w-full animate-pop rounded-3xl bg-paper p-6 text-center shadow-lift">
              <p className="text-base font-extrabold">Resume your workout?</p>
              <p className="mt-1 text-sm font-bold text-ink-soft">{fmtTime(chk.sec)} recorded</p>
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
                  className="w-full rounded-full bg-white py-3.5 text-[15px] font-bold text-ink transition active:scale-[0.98]"
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
      <div className="w-full max-w-[350px] animate-pop rounded-3xl bg-paper p-6 text-center shadow-lift">
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
            className="w-full rounded-full bg-white py-3.5 text-[15px] font-bold text-ink transition active:scale-[0.98]"
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
