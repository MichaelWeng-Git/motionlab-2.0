"use client";

// Official Google Maps JS API version of LiveMap — vector-rendered, retina
// sharp, true Google satellite/hybrid imagery. Used automatically when
// NEXT_PUBLIC_GOOGLE_MAPS_KEY is set; LiveMap (Leaflet) stays as fallback.
// Same props as LiveMap so the two are drop-in interchangeable.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef } from "react";

export type LatLng = [number, number];

let loaderPromise: Promise<any> | null = null;
function loadGoogle(key: string): Promise<any> {
  const w = window as any;
  if (w.google?.maps) return Promise.resolve(w.google);
  if (!loaderPromise) {
    loaderPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
      s.async = true;
      // slow networks: give up after 8s so the caller can fall back to Leaflet
      const timer = setTimeout(() => reject(new Error("maps timeout")), 8000);
      s.onload = () => {
        clearTimeout(timer);
        const g = (window as any).google;
        g?.maps?.Map ? resolve(g) : reject(new Error("maps missing"));
      };
      s.onerror = () => {
        clearTimeout(timer);
        reject(new Error("maps script failed"));
      };
      document.head.appendChild(s);
    });
    // a rejected load must NOT be cached forever — let later mounts retry
    loaderPromise.catch(() => {
      loaderPromise = null;
    });
  }
  return loaderPromise;
}

const toLL = (p: LatLng) => ({ lat: p[0], lng: p[1] });

export function GoogleLiveMap({
  center,
  path = [],
  planned = [],
  satellite = false,
  follow = false,
  fit = false,
  interactive = true,
  className = "",
  onFail,
}: {
  center: LatLng;
  path?: LatLng[];
  planned?: LatLng[];
  satellite?: boolean;
  follow?: boolean;
  fit?: boolean;
  interactive?: boolean;
  className?: string;
  onFail?: () => void; // script/auth failure → caller can fall back to Leaflet
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const gRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const lineRef = useRef<any>(null);
  const planRef = useRef<any>(null);
  const dotRef = useRef<any>(null);
  const startRef = useRef<any>(null);
  const didFitRef = useRef(false);

  // init once
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
    if (!key || !divRef.current || mapRef.current) return;
    let cancelled = false;
    // Google's official auth-failure hook (bad key / billing) — NEVER leave a
    // silent gray rectangle; hand control back so Leaflet can take over
    (window as any).gm_authFailure = () => {
      if (!cancelled) onFail?.();
    };
    loadGoogle(key)
      .then((g) => {
        if (cancelled || !divRef.current || mapRef.current) return;
        gRef.current = g;
        const map = new g.maps.Map(divRef.current, {
          center: toLL(center),
          zoom: 16,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: interactive ? "greedy" : "none",
          keyboardShortcuts: false,
          mapTypeId: satellite ? "hybrid" : "roadmap",
        });
        mapRef.current = map;

        lineRef.current = new g.maps.Polyline({
          map,
          path: path.map(toLL),
          strokeColor: "#FF4E1A",
          strokeWeight: 5,
          strokeOpacity: 1,
        });
        planRef.current = new g.maps.Polyline({
          map,
          path: planned.map(toLL),
          strokeColor: "#5B6472",
          strokeOpacity: 0,
          icons: [
            {
              icon: { path: "M 0,-0.5 0,0.5", strokeOpacity: 1, strokeColor: "#5B6472", strokeWeight: 4, scale: 2 },
              offset: "0",
              repeat: "14px",
            },
          ],
        });
        startRef.current = new g.maps.Marker({
          map,
          position: path.length ? toLL(path[0]) : toLL(center),
          visible: path.length > 0,
          icon: {
            path: g.maps.SymbolPath.CIRCLE,
            scale: 6,
            fillColor: "#17271F",
            fillOpacity: 1,
            strokeColor: "#FFFFFF",
            strokeWeight: 3,
          },
          zIndex: 5,
        });
        dotRef.current = new g.maps.Marker({
          map,
          position: toLL(path.length ? path[path.length - 1] : center),
          icon: {
            path: g.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#1d6bff",
            fillOpacity: 1,
            strokeColor: "#FFFFFF",
            strokeWeight: 3,
          },
          zIndex: 10,
        });

        if (fit && path.length > 1) {
          const b = new g.maps.LatLngBounds();
          path.forEach((p) => b.extend(toLL(p)));
          map.fitBounds(b, 28);
          didFitRef.current = true;
        }

        // Google's tile fade-in sometimes sticks at opacity 0 in embedded
        // webviews, leaving a gray map. Force any stuck tile layer visible.
        const unstick = () => {
          divRef.current?.querySelectorAll<HTMLElement>(".gm-style div").forEach((d) => {
            if (!d.className && getComputedStyle(d).opacity === "0") d.style.opacity = "1";
          });
        };
        g.maps.event.addListenerOnce(map, "tilesloaded", () => setTimeout(unstick, 250));
        setTimeout(unstick, 1500);
        setTimeout(unstick, 4000);
      })
      .catch(() => {
        if (!cancelled) onFail?.(); // script blocked/offline → fall back
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // map type
  useEffect(() => {
    mapRef.current?.setMapTypeId(satellite ? "hybrid" : "roadmap");
  }, [satellite]);

  // center / follow
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (follow || !didFitRef.current) map.panTo(toLL(center));
  }, [center, follow]);

  // path / planned updates
  useEffect(() => {
    const g = gRef.current;
    if (!g) return;
    lineRef.current?.setPath(path.map(toLL));
    if (path.length) {
      startRef.current?.setPosition(toLL(path[0]));
      startRef.current?.setVisible(true);
      dotRef.current?.setPosition(toLL(path[path.length - 1]));
    } else {
      startRef.current?.setVisible(false);
      dotRef.current?.setPosition(toLL(center));
    }
    if (fit && path.length > 1 && mapRef.current) {
      const b = new g.maps.LatLngBounds();
      path.forEach((p: LatLng) => b.extend(toLL(p)));
      mapRef.current.fitBounds(b, 28);
      didFitRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, planned, fit]);

  useEffect(() => {
    planRef.current?.setPath(planned.map(toLL));
  }, [planned]);

  return <div ref={divRef} className={className} />;
}
