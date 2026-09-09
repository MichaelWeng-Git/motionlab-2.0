import { SkelBar } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="px-5 pt-8">
      <SkelBar w={150} h={30} r={10} />
      <div className="mt-5"><SkelBar h={72} r={24} /></div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <SkelBar h={160} r={24} />
        <SkelBar h={160} r={24} />
      </div>
      <div className="mt-5"><SkelBar h={96} r={24} /></div>
    </div>
  );
}
