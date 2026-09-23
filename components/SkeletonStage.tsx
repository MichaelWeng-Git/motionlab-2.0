// A mock "video frame" with a pose skeleton drawn on top.
// In the real product this is the analyzed video with the pose overlay.
export function SkeletonStage({
  label = "Your analysis",
  highlight,
  compact = false,
}: {
  label?: string;
  highlight?: string;
  compact?: boolean;
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-well ${compact ? "aspect-[3/4]" : "aspect-[9/12]"}`}>
      {/* faux court / gradient backdrop */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,#1c2740_0%,#17271F_60%)]" />
      <div className="absolute inset-0 grain opacity-40" />

      {/* scanning line to imply "analyzing" quality */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-volt/25 to-transparent animate-scan" />

      {/* skeleton */}
      <svg viewBox="0 0 200 260" className="absolute inset-0 h-full w-full">
        <g stroke="#62D98B" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.95">
          {/* spine */}
          <line x1="100" y1="60" x2="100" y2="140" />
          {/* head */}
          <circle cx="100" cy="46" r="12" />
          {/* arms */}
          <line x1="100" y1="80" x2="70" y2="105" />
          <line x1="70" y1="105" x2="58" y2="140" />
          <line x1="100" y1="80" x2="135" y2="95" />
          <line x1="135" y1="95" x2="162" y2="78" />
          {/* hips + legs */}
          <line x1="100" y1="140" x2="82" y2="150" />
          <line x1="100" y1="140" x2="120" y2="150" />
          <line x1="82" y1="150" x2="78" y2="200" />
          <line x1="78" y1="200" x2="74" y2="244" />
          <line x1="120" y1="150" x2="126" y2="200" />
          <line x1="126" y1="200" x2="132" y2="244" />
        </g>
        {/* joints */}
        <g fill="#FFFFFF">
          {[
            [100, 60], [100, 80], [70, 105], [58, 140], [135, 95], [162, 78],
            [100, 140], [82, 150], [120, 150], [78, 200], [74, 244], [126, 200], [132, 244],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="3.5" />
          ))}
        </g>
        {/* highlight ring on the coached body part */}
        {highlight && (
          <g>
            <circle cx="100" cy="140" r="22" fill="none" stroke="#FF6B4A" strokeWidth="2.5" strokeDasharray="4 4" />
          </g>
        )}
      </svg>

      {/* labels */}
      <div className="absolute left-3 top-3 rounded-full bg-track px-3 py-1 text-[11px] font-semibold text-white backdrop-blur">
        {label}
      </div>
      {highlight && (
        <div className="absolute bottom-3 left-3 right-3 rounded-xl bg-signal-work/90 px-3 py-2 text-[12px] font-semibold text-white backdrop-blur">
          ← Watch this: {highlight}
        </div>
      )}
    </div>
  );
}
