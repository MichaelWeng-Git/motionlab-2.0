"use client";

// One-tap share poster: the real VIDEO frame on top (grabbed hi-res from the
// replay, never the tiny stored thumbnail), M2 logo, score ring, headline and
// the coach's findings — laid out edge to edge with no dead space, then handed
// to the native share sheet (AirDrop / WhatsApp / save).

import { useState } from "react";
import type { AnalysisResult } from "@/lib/analysis";

const INK = "#17271F";
const PAPER = "#F4F2ED";
const GOOD = SIGNAL.good;
import { qualityColor, SIGNAL } from "@/lib/palette";

const OKAY = SIGNAL.okay;
const WORK = SIGNAL.work;

// score → color, same bands as everywhere in the app (75+ IS green)
const scoreColor = qualityColor; // one shared scale (lib/palette)

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const loadImg = (src: string) =>
  new Promise<HTMLImageElement | null>((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });

// a sharp mid-video frame straight from the replay — full resolution, not the
// 240px session thumbnail that used to make posters blurry
async function hiResFrame(videoUrl: string): Promise<HTMLImageElement | null> {
  try {
    const video = document.createElement("video");
    video.src = videoUrl;
    video.muted = true;
    video.playsInline = true;
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error("video"));
    });
    await new Promise<void>((res) => {
      video.onseeked = () => res();
      video.currentTime = Math.max(0, (video.duration || 1) * 0.5);
    });
    const c = document.createElement("canvas");
    const W = Math.min(1280, video.videoWidth || 1280);
    c.width = W;
    c.height = Math.max(1, Math.round((W * video.videoHeight) / video.videoWidth));
    c.getContext("2d")!.drawImage(video, 0, 0, c.width, c.height);
    return await loadImg(c.toDataURL("image/jpeg", 0.9));
  } catch {
    return null;
  }
}

async function drawPoster(a: AnalysisResult, cover?: string, videoUrl?: string): Promise<Blob | null> {
  const img = (videoUrl ? await hiResFrame(videoUrl) : null) ?? (cover ? await loadImg(cover) : null);
  const logo = await loadImg("/logo-mark.png");
  const W = 1080;
  const n = Math.min(3, a.tips.length);
  const coverH = img ? 540 : 0;
  // every section stacked tight — total height leaves NO dead space
  const H = 204 + (img ? coverH + 56 : 0) + 264 + 34 + n * 78 + 30 + 88 + 148;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  const col = scoreColor(a.score);

  // paper background + white card
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
  roundRect(ctx, 54, 54, W - 108, H - 108, 44);
  ctx.fillStyle = "#FFFFFF"; ctx.fill();

  // header: the M2 mark alone — the logo IS the wordmark
  if (logo) {
    const lh = 62, lw = (logo.width / logo.height) * lh;
    ctx.drawImage(logo, 116, 112, lw, lh);
  }

  let y = 204;

  // the video frame — big, sharp, edge to edge of the card
  if (img) {
    const bw = W - 232, bh = coverH;
    ctx.save();
    roundRect(ctx, 116, y, bw, bh, 34);
    ctx.clip();
    const s = Math.max(bw / img.width, bh / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, 116 + (bw - dw) / 2, y + (bh - dh) / 2, dw, dh);
    ctx.restore();
    if (a.sport) {
      ctx.font = "700 36px -apple-system, system-ui, sans-serif";
      const tw = ctx.measureText(a.sport).width + 60;
      roundRect(ctx, 144, y + bh - 88, tw, 60, 30);
      ctx.fillStyle = "rgba(14,31,26,0.74)"; ctx.fill();
      ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(a.sport, 174, y + bh - 57);
    }
    y += bh + 56;
  }

  // score ring (left) + headline (right)
  const R = 122, cx = 116 + R, cy = y + R;
  ctx.lineWidth = 26; ctx.lineCap = "round";
  ctx.strokeStyle = "#ECEBE6";
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = col;
  ctx.beginPath();
  ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + (a.score / 100) * Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "800 100px -apple-system, system-ui, sans-serif";
  ctx.fillText(String(a.score), cx, cy - 8);
  ctx.font = "600 30px -apple-system, system-ui, sans-serif";
  ctx.fillStyle = "#5B6472";
  ctx.fillText("out of 100", cx, cy + 58);

  // headline beside the ring, wrapped up to 4 lines
  ctx.fillStyle = INK; ctx.textAlign = "left";
  ctx.font = "800 46px -apple-system, system-ui, sans-serif";
  const hx = cx + R + 48, hw = W - 116 - hx;
  const words = a.headline.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > hw && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 4);
  const hy = cy - ((shown.length - 1) * 58) / 2;
  shown.forEach((l, i) => ctx.fillText(l, hx, hy + i * 58));
  y += R * 2 + 34;

  // the coach's findings
  const dotCol: Record<string, string> = { good: GOOD, okay: OKAY, work: WORK };
  for (const t of a.tips.slice(0, 3)) {
    ctx.fillStyle = dotCol[t.rating] ?? OKAY;
    ctx.beginPath(); ctx.arc(146, y + 20, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = "700 40px -apple-system, system-ui, sans-serif";
    let title = t.title;
    while (ctx.measureText(title).width > W - 340 && title.length > 4) title = title.slice(0, -2);
    ctx.fillText(title === t.title ? title : title + "…", 186, y + 22);
    y += 78;
  }
  y += 30;

  // session chips
  const chips = [a.action ?? null, a.duration ? `${a.duration.toFixed(1)}s` : null].filter(Boolean) as string[];
  if (chips.length) {
    ctx.font = "700 34px -apple-system, system-ui, sans-serif";
    let x = 116;
    chips.forEach((t) => {
      const wch = ctx.measureText(t).width + 72;
      roundRect(ctx, x, y, wch, 82, 41);
      ctx.fillStyle = PAPER; ctx.fill();
      ctx.fillStyle = INK; ctx.textAlign = "center";
      ctx.fillText(t, x + wch / 2, y + 43);
      x += wch + 20;
    });
  }
  y += 88 + 30;

  // watermark
  ctx.font = "600 30px -apple-system, system-ui, sans-serif";
  ctx.fillStyle = "#9AA1AC";
  ctx.textAlign = "center";
  ctx.fillText("Analyzed on-device by MotionLab", W / 2, y + 16);

  return new Promise((resolve) => c.toBlob((b) => resolve(b), "image/png"));
}

async function exportPoster(a: AnalysisResult, cover: string | undefined, videoUrl: string | undefined) {
  const blob = await drawPoster(a, cover, videoUrl);
  if (!blob) return;
  const file = new File([blob], "motionlab-score.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: "My MotionLab score" });
  } else {
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url; el.download = "motionlab-score.png";
    el.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

export function ShareButton({ a, cover, videoUrl }: { a: AnalysisResult; cover?: string; videoUrl?: string }) {
  const [busy, setBusy] = useState(false);
  const share = async () => {
    if (busy) return;
    setBusy(true);
    try { await exportPoster(a, cover, videoUrl); } catch { /* share sheet dismissed */ }
    setBusy(false);
  };
  return (
    <button
      onClick={share}
      aria-label="Share your score"
      className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-paper text-ink transition active:scale-95"
    >
      {busy ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/15 border-t-ink" />
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3 v12 M7 8 l5 -5 5 5" />
          <path d="M5 14 v5 a2 2 0 0 0 2 2 h10 a2 2 0 0 0 2 -2 v-5" />
        </svg>
      )}
    </button>
  );
}
