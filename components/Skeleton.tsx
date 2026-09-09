// Instant route skeletons. Next renders these the moment a link is tapped
// (Suspense boundary), so navigation never feels like a dead pause — the
// shell appears at once and fills in when the page's data lands.

export function SkelBar({ w = "100%", h = 16, r = 8, className = "" }: { w?: string | number; h?: number; r?: number; className?: string }) {
  return (
    <span
      className={`skel block ${className}`}
      style={{ width: typeof w === "number" ? `${w}px` : w, height: h, borderRadius: r }}
    />
  );
}

export function SkelCard({ h = 96, className = "" }: { h?: number; className?: string }) {
  return <div className={`skel rounded-3xl ${className}`} style={{ height: h }} />;
}

// page header: back chip + title
export function SkelHeader() {
  return (
    <div className="mb-5 flex items-center gap-3">
      <SkelBar w={36} h={36} r={999} />
      <SkelBar w={140} h={26} r={10} />
    </div>
  );
}
