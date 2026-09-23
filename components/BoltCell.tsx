// BOLT CELL — CHARGE's identity object: the brand bolt as a glass vessel
// inside a small cinematic dark chamber (same ambient family as the TODAY
// card). The energy liquid GLOWS — glow belongs to data, never chrome.

const BOLT = "M37 6 L13 56 h14 L23 94 L49 40 h-15 Z";

export function BoltCell({ value, color }: { value: number; color: string }) {
  const v = Math.max(0, Math.min(100, value));
  const surfaceY = 6 + ((94 - 6) * (100 - v)) / 100; // liquid surface within the bolt's span
  return (
    <div
      className="relative grid h-[124px] w-[100px] place-items-center overflow-hidden rounded-2xl"
      style={{ background: "radial-gradient(130% 100% at 50% 0%, #26473A 0%, #0E1811 65%)" }}
    >
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-hair" />
      {/* ambient pool under the bolt, in the state color */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-12"
        style={{ background: `radial-gradient(60% 90% at 50% 100%, ${color}33 0%, transparent 70%)` }}
      />
      <svg viewBox="0 0 60 100" className="relative h-[96px] w-[58px]">
        <defs>
          <clipPath id="boltclip">
            <path d={BOLT} />
          </clipPath>
          <linearGradient id="boltliquid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
            <stop offset="18%" stopColor={color} />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        {/* glass vessel */}
        <path d={BOLT} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinejoin="round" />
        {/* glowing energy */}
        <g clipPath="url(#boltclip)" style={{ filter: `drop-shadow(0 0 7px ${color})` }}>
          <rect
            x="0"
            y={surfaceY}
            width="60"
            height={100 - surfaceY}
            fill="url(#boltliquid)"
            style={{ transition: "y 0.8s cubic-bezier(0.22,1,0.36,1), height 0.8s cubic-bezier(0.22,1,0.36,1)" }}
          />
        </g>
        {/* glass shine + crisp rim */}
        <path d="M33 12 L18 44" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" fill="none" />
        <path d={BOLT} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
