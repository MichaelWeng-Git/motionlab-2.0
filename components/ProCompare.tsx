"use client";

// Side-by-side (stacked for portrait phones) synchronized comparison:
// the user's clip on top, the pro's official YouTube embed below.
// ONE control: play — both jump to 1.5s before their anchor moment and run
// at the same speed. Alignment = single-anchor (OnForm-validated pattern).

import { useEffect, useRef, useState } from "react";
import type { ProPack } from "@/lib/pros";

const LEAD_S = 1.5; // start this far before the anchor so the eye can settle

export default function ProCompare({
  videoUrl,
  userAnchorS,
  pack,
}: {
  videoUrl: string;
  userAnchorS: number;
  pack: ProPack;
}) {
  const vidRef = useRef<HTMLVideoElement>(null);
  const ytRef = useRef<HTMLIFrameElement>(null);
  const [playing, setPlaying] = useState(false);

  const yt = (func: string, args: unknown[] = []) =>
    ytRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args }),
      "*"
    );

  const playBoth = () => {
    const v = vidRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, userAnchorS - LEAD_S);
    yt("seekTo", [Math.max(pack.startS, pack.anchorS - LEAD_S), true]);
    yt("mute");
    v.play();
    yt("playVideo");
    setPlaying(true);
  };
  const pauseBoth = () => {
    vidRef.current?.pause();
    yt("pauseVideo");
    setPlaying(false);
  };

  // stop both at the end of the pro segment
  useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => {
      const v = vidRef.current;
      if (!v) return;
      const elapsed = v.currentTime - (userAnchorS - LEAD_S);
      if (v.ended || elapsed > pack.endS - (pack.anchorS - LEAD_S)) pauseBoth();
    }, 250);
    return () => clearInterval(iv);
  }, [playing, userAnchorS, pack]);

  return (
    <div className="overflow-hidden rounded-2xl bg-well">
      <div className="relative">
        <video ref={vidRef} src={videoUrl} muted playsInline className="w-full" />
        <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-bold text-white">You</span>
      </div>
      <div className="relative aspect-video w-full">
        <iframe
          ref={ytRef}
          className="absolute inset-0 h-full w-full"
          src={`https://www.youtube.com/embed/${pack.youtubeId}?enablejsapi=1&start=${Math.floor(pack.startS)}&rel=0&modestbranding=1&playsinline=1`}
          allow="autoplay; encrypted-media"
          title={`${pack.pro} — ${pack.action}`}
          // the site runs cross-origin-isolated (COEP) for multithreaded WASM —
          // without this attribute Chrome blanks out the YouTube embed entirely
          {...({ credentialless: "true" } as Record<string, string>)}
        />
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-bold text-white">
          {pack.pro}
        </span>
      </div>
      <button
        onClick={playing ? pauseBoth : playBoth}
        className="block w-full bg-action py-3 text-center text-[13px] font-bold text-on-action"
      >
        {playing ? "❚❚ Pause" : "▶ Play both — aligned at the key moment"}
      </button>
    </div>
  );
}
