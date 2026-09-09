"use client";

// Save celebration (Profile save only): a green "lava" sheet floods up from
// the bottom of the screen with a rolling liquid crest, then a checkmark
// draws in. Show it, wait ~1.45s, then navigate.
export function SaveSuccess({ show, label = "Saved" }: { show: boolean; label?: string }) {
  if (!show) return null;
  return (
    <div className="pointer-events-auto fixed inset-y-0 left-1/2 z-[70] w-full max-w-[430px] -translate-x-1/2 overflow-hidden">
      {/* rising liquid: ONE sheet, one big wild crest. Peaks are TALL and
          irregular — proper surf, not ripples — and fat droplets get thrown
          off the surface like colliding water. */}
      <div className="save-liquid absolute inset-x-0 bottom-0 h-full">
        <svg
          className="save-wave absolute -top-[138px] left-0 h-[140px] w-[200%]"
          viewBox="0 0 1200 140"
          preserveAspectRatio="none"
        >
          {/* tall crashing peaks, deep troughs, no two alike; seam-safe at 0/1200 */}
          <path
            d="M0 80 Q 50 14 110 66 Q 150 100 215 52 Q 270 8 340 74 Q 395 118 460 44 Q 505 4 585 70 Q 640 112 705 40 Q 750 6 830 76 Q 880 116 950 48 Q 1000 10 1070 78 Q 1120 118 1160 92 Q 1180 82 1200 80 V 140 H 0 Z"
            fill="#FF4E1A"
          />
          {/* fat droplets hanging over the peaks */}
          {[
            { cx: 105, cy: 34, r: 9 }, { cx: 255, cy: 18, r: 7 }, { cx: 425, cy: 26, r: 11 },
            { cx: 560, cy: 10, r: 7 }, { cx: 715, cy: 24, r: 9 }, { cx: 865, cy: 14, r: 8 },
            { cx: 1005, cy: 30, r: 10 }, { cx: 1130, cy: 44, r: 7 },
          ].map((d, i) => (
            <circle key={i} {...d} fill={i % 3 === 0 ? "#FF9A66" : "#FF4E1A"} />
          ))}
        </svg>
        {/* big splash droplets shooting up off the surface */}
        {[
          { left: "10%", size: 16, delay: 0.1, up: 130 },
          { left: "24%", size: 11, delay: 0.32, up: 170 },
          { left: "38%", size: 20, delay: 0.18, up: 110 },
          { left: "52%", size: 12, delay: 0.44, up: 185 },
          { left: "66%", size: 18, delay: 0.08, up: 145 },
          { left: "79%", size: 11, delay: 0.38, up: 125 },
          { left: "89%", size: 14, delay: 0.24, up: 160 },
        ].map((d, i) => (
          <span
            key={i}
            className="save-drop absolute rounded-full"
            style={{
              left: d.left,
              top: -16,
              width: d.size,
              height: d.size,
              background: i % 2 ? "#FF9A66" : "#FF4E1A",
              animationDelay: `${d.delay}s`,
              ["--drop-up" as string]: `${d.up}px`,
            }}
          />
        ))}
        <div className="h-full w-full bg-gradient-to-b from-[#FF4E1A] to-[#D63A00]" />
      </div>

      {/* checkmark + label, revealed once the flood has covered the screen */}
      <div className="save-flood-content absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center gap-3">
          <div className="grid h-24 w-24 place-items-center rounded-full bg-white/20 ring-2 ring-white/45">
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" className="check-draw" />
            </svg>
          </div>
          <p className="text-base font-extrabold text-white">{label}</p>
        </div>
      </div>
    </div>
  );
}
