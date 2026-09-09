import { SkelBar, SkelHeader } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="px-5 pt-8">
      <SkelHeader />
      <div className="mt-2 space-y-3">
        <SkelBar h={84} r={24} />
        <SkelBar h={84} r={24} />
        <SkelBar h={84} r={24} />
      </div>
    </div>
  );
}
