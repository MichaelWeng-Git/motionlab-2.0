"use client";

// Static route thumbnail, generated once at save time — instant to display
// forever, no tiles to load. (The Strava-list trick.)

export function routeThumb(path: [number, number][], w = 640, h = 400): string | undefined {
  if (!path || path.length < 2) return undefined;
  const lats = path.map((p) => p[0]);
  const lngs = path.map((p) => p[1]);
  let minLat = Math.min(...lats), maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const padLat = (maxLat - minLat) * 0.2 + 1e-6;
  const padLng = (maxLng - minLng) * 0.2 + 1e-6;
  minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;

  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  const X = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * w;
  const Y = (lat: number) => h - ((lat - minLat) / (maxLat - minLat)) * h;

  // paper-toned ground with a faint grid, matching the app
  ctx.fillStyle = "#EDECE6";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 3;
  for (let i = 1; i < 6; i++) {
    ctx.beginPath(); ctx.moveTo((w / 6) * i, 0); ctx.lineTo((w / 6) * i, h); ctx.stroke();
  }
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(0, (h / 4) * i); ctx.lineTo(w, (h / 4) * i); ctx.stroke();
  }

  // route: white casing + turf stroke
  const draw = (width: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    path.forEach(([lat, lng], i) => {
      const x = X(lng), y = Y(lat);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };
  draw(11, "rgba(255,255,255,0.95)");
  draw(6, "#FF4E1A");

  // start (ink) and finish (red) markers
  const dot = (lat: number, lng: number, fill: string) => {
    ctx.beginPath(); ctx.arc(X(lng), Y(lat), 8, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF"; ctx.fill();
    ctx.beginPath(); ctx.arc(X(lng), Y(lat), 5.5, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
  };
  dot(path[0][0], path[0][1], "#0B0F17");
  dot(path[path.length - 1][0], path[path.length - 1][1], "#FF3B5C");

  return c.toDataURL("image/jpeg", 0.8);
}
