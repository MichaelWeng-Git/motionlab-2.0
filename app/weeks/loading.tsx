import { SkelBar } from "@/components/Skeleton";

// mirrors the real Activity layout so the swap to content is a fill-in, not a
// jump: back chip + week header, the 7-day strip, then the graphite day card
export default function Loading() {
  return (
    <div className="px-5 pt-8">
      <div className="mb-5 flex items-center gap-3">
        <SkelBar w={36} h={36} r={999} />
        <SkelBar w={120} h={26} r={10} />
      </div>
      <div className="flex items-center justify-between">
        <SkelBar w={36} h={36} r={999} />
        <SkelBar w={150} h={22} r={8} />
        <SkelBar w={36} h={36} r={999} />
      </div>
      <div className="mt-4"><SkelBar h={72} r={24} /></div>
      {/* the day card: graphite block with a ring-sized hole on the left */}
      <div className="mt-4 flex items-center gap-5 rounded-2xl bg-graphite px-5 py-4">
        <span className="h-[132px] w-[132px] shrink-0 rounded-full ring-[12px] ring-white/[0.06]" />
        <div className="flex-1 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div className="flex justify-between">
                <span className="h-3 w-14 rounded bg-white/10" />
                <span className="h-3 w-10 rounded bg-white/10" />
              </div>
              <span className="mt-1.5 block h-[6px] w-full rounded-full bg-white/[0.07]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
