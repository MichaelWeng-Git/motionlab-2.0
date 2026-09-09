import { SkelBar } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="px-5 pt-2">
      <SkelBar w={40} h={24} r={8} />
      <div className="mt-1.5"><SkelBar h={230} r={24} /></div>
      <div className="mt-4"><SkelBar h={210} r={24} /></div>
      <div className="mt-6 space-y-2">
        <SkelBar h={56} r={16} />
        <SkelBar h={56} r={16} />
      </div>
    </div>
  );
}
