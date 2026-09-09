"use client";

// Real map (Leaflet + OpenStreetMap / Esri satellite).
// Swappable to Google Maps later — only the tile URLs change.

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type LatLng = [number, number];

// Google tiles, English labels, retina-sharp. (Production swaps to the official
// Google Maps SDK with an API key — same component, different loader.)
const TILES = {
  map: {
    url: "https://mt{s}.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}",
    credit: "© Google",
  },
  satellite: {
    url: "https://mt{s}.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}", // hybrid: imagery + labels
    credit: "© Google",
  },
};

export function LiveMap({
  center,
  path = [],
  planned = [],
  satellite = false,
  follow = false,
  fit = false,
  interactive = true,
  className = "",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  onFail?: () => void; // accepted for drop-in parity with GoogleLiveMap
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseRef = useRef<L.TileLayer | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const planRef = useRef<L.Polyline | null>(null);
  const dotRef = useRef<L.Marker | null>(null);
  const startRef = useRef<L.CircleMarker | null>(null);

  // init once
  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: interactive,
      scrollWheelZoom: interactive,
      touchZoom: interactive,
      doubleClickZoom: interactive,
      boxZoom: false,
      keyboard: false,
      // tame trackpad/pinch momentum — otherwise one gesture keeps zooming
      wheelDebounceTime: 60,
      wheelPxPerZoomLevel: 600, // a full trackpad swipe ≈ one zoom level
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      bounceAtZoomLimits: false,
      // never zoom out into the void — clamp to the world
      minZoom: 3,
      maxBounds: [
        [-85, -180],
        [85, 180],
      ],
      maxBoundsViscosity: 1.0,
    }).setView(center, 16);
    mapRef.current = map;

    // the page mounts with an entrance animation (transform) — Leaflet measures the
    // container mid-animation and gets it wrong. Re-measure now, and again after it ends.
    let dead = false;
    const fix = () => {
      if (dead) return;
      map.invalidateSize();
      map.setView(center, 16, { animate: false });
    };
    requestAnimationFrame(fix);
    const t = setTimeout(fix, 480);
    const ro = new ResizeObserver(() => { if (!dead) map.invalidateSize(); });
    ro.observe(divRef.current);

    return () => {
      dead = true;
      clearTimeout(t);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      baseRef.current = null;
      lineRef.current = null;
      planRef.current = null;
      dotRef.current = null;
      startRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // base layer (standard ↔ satellite)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    baseRef.current?.remove();
    const t = satellite ? TILES.satellite : TILES.map;
    baseRef.current = L.tileLayer(t.url, {
      maxZoom: 20,
      minZoom: 3,
      subdomains: "0123",
      detectRetina: true, // crisp on high-DPI screens
    }).addTo(map);
    baseRef.current.bringToBack();
  }, [satellite]);

  // re-center when the center prop changes (geolocation resolves / locate button)
  useEffect(() => {
    if (!follow && !fit) mapRef.current?.setView(center, mapRef.current.getZoom(), { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center]);

  // recorded path + position dot + start marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!lineRef.current) {
      lineRef.current = L.polyline([], { color: "#FF4E1A", weight: 5, lineJoin: "round", lineCap: "round" }).addTo(map);
    }
    lineRef.current.setLatLngs(path);

    const pos: LatLng = path.length ? path[path.length - 1] : center;
    if (!dotRef.current) {
      dotRef.current = L.marker(pos, {
        icon: L.divIcon({ className: "", html: '<div class="live-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        interactive: false,
      }).addTo(map);
    } else {
      dotRef.current.setLatLng(pos);
    }

    if (path.length) {
      if (!startRef.current) {
        startRef.current = L.circleMarker(path[0], {
          radius: 6, color: "#FFFFFF", weight: 3, fillColor: "#17271F", fillOpacity: 1,
        }).addTo(map);
      }
      startRef.current.setLatLng(path[0]);
    }

    if (follow) map.panTo(pos, { animate: true, duration: 0.8 });
    if (fit && path.length > 1) map.fitBounds(L.latLngBounds(path), { padding: [28, 28] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, follow, fit]);

  // planned route underlay (navigation)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    planRef.current?.remove();
    planRef.current = null;
    if (planned.length > 1) {
      planRef.current = L.polyline(planned, { color: "#5B6472", weight: 4, dashArray: "2 10", lineCap: "round" }).addTo(map);
    }
  }, [planned]);

  return (
    <div className={`relative isolate ${className}`}>
      <div ref={divRef} className="absolute inset-0 z-0" />
      <span className="pointer-events-none absolute bottom-1 right-2 z-[1] text-[9px] text-black/40">
        {satellite ? TILES.satellite.credit : TILES.map.credit}
      </span>
    </div>
  );
}
