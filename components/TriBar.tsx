import { RING_COLORS } from "@/lib/goals";

// The three-goal progress bar: one third per goal (Move / Analyze / Workout),
// each segment fills in its own color by that goal's completion — all three
// done = the whole bar reads full in three colors.
export function TriBar({
  pcts,
  track = "rgba(14,31,26,0.1)",
  height = 6,
}: {
  pcts: [number, number, number];
  track?: string;
  height?: number;
}) {
  const colors = [RING_COLORS.exercise, RING_COLORS.analyses, RING_COLORS.workouts];
  return (
    <div className="flex w-full gap-1">
      {pcts.map((p, i) => (
        <div key={i} className="flex-1 overflow-hidden rounded-full" style={{ height, background: track }}>
          <div
            className="h-full rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${Math.max(0, Math.min(1, p)) * 100}%`, background: colors[i] }}
          />
        </div>
      ))}
    </div>
  );
}
