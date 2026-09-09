import { SkelBar, SkelHeader } from "@/components/Skeleton";

// instant shell for the profile page — same layout as the real one, so the
// switch to real content is a fill-in, not a jump
export default function Loading() {
  return (
    <div className="px-5 pt-8">
      <SkelHeader />
      <div className="flex items-center gap-4">
        <SkelBar w={64} h={64} r={999} />
        <SkelBar w={120} h={22} r={8} />
      </div>
      <div className="mt-6 grid grid-cols-3 gap-2.5">
        {[0, 1, 2].map((i) => <SkelBar key={i} h={78} r={20} />)}
      </div>
      <div className="mt-6 space-y-4">
        <SkelBar h={58} r={20} />
        <SkelBar h={116} r={20} />
        <SkelBar h={58} r={20} />
        <SkelBar h={58} r={20} />
      </div>
    </div>
  );
}
