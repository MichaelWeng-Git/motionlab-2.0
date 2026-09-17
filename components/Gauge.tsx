// THE metric visual — a semicircle pressure gauge, used identically across
// the app (home TODAY / FORM / LOAD, the weeks detail page) so everything
// reads as one system. Colors are per-context: pass color/track/valueColor.
export function Gauge({
  pct, value, unit, label, big, color = "#7C5CFF",
  // shell-aware defaults (app/globals.css SURFACES): the same dial reads right
  // on a light card and a dark one without the caller passing colours
  track = "var(--track)", valueColor = "var(--fg)", labelColor = "var(--fg-muted)",
  glow = false,
}: {
  pct: number; value: string; unit?: string; label?: string; big?: boolean;
  color?: string; track?: string; valueColor?: string; labelColor?: string;
  glow?: boolean; // dark surfaces only: the data arc emits light (never chrome)
}) {
  const p = Math.max(0, Math.min(1, pct));
  // The value is not always a two-digit number — callers pass words too
  // ("Moderate"). A fixed size overflowed the dial and printed the label across
  // the arc, so the type scales to what it is actually showing.
  const n = value.length;
  const valueSize = big
    ? n <= 3 ? "text-[46px]" : n <= 5 ? "text-[34px]" : n <= 8 ? "text-[24px]" : "text-[19px]"
    : n <= 3 ? "text-[30px]" : n <= 5 ? "text-[23px]" : n <= 8 ? "text-[17px]" : "text-[14px]";
  // even at zero the dial keeps its identity: the track is the gauge's own
  // color at low opacity unless a caller overrides it (dark cards do)
  const trackColor = track ?? `${color}24`;
  return (
    <div>
      <div className="relative">
        {/* overflow-visible is load-bearing: the glow's drop-shadow spills past
            the 100×52 box, and a clipped shadow shows as a hard straight edge */}
        <svg viewBox="0 0 100 52" className="w-full" style={{ overflow: "visible" }}>
          {/* stroke via style, not the attribute: a CSS variable only resolves
              inside style, and the default track is var(--track) */}
          <path d="M8 48 A42 42 0 0 1 92 48" fill="none" style={{ stroke: trackColor }} strokeWidth="11" strokeLinecap="round" />
          {p > 0 && (
            <path
              d="M8 48 A42 42 0 0 1 92 48"
              fill="none"
              stroke={color}
              strokeWidth="11"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={`${Math.max(4, p * 100)} 100`}
              style={{
                transition: "stroke-dasharray 0.9s cubic-bezier(0.22,1,0.36,1)",
                // two soft passes instead of one tight one — a wide, low-alpha
                // halo has no visible falloff edge
                ...(glow ? { filter: `drop-shadow(0 0 4px ${color}55) drop-shadow(0 0 14px ${color}33)` } : {}),
              }}
            />
          )}
        </svg>
        {/* the value sits INSIDE the arc, not on its baseline — nudged up so
            the dial reads as a dial rather than a number with a hat */}
        <div className={`absolute inset-x-0 ${big ? "bottom-[10%]" : "bottom-[8%]"} text-center`}>
          <p className={`${valueSize} font-golden leading-none`} style={{ color: valueColor }}>
            {value}
            {unit && <span className={`${big ? "text-sm" : "text-[11px]"} font-bold`} style={{ color: labelColor }}> {unit}</span>}
          </p>
        </div>
      </div>
      {label && (
        <p className="mt-1.5 text-center text-[11px] font-bold uppercase tracking-wide" style={{ color: labelColor }}>{label}</p>
      )}
    </div>
  );
}
