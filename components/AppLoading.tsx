import { SkelBar } from "./Skeleton";

export function AppLoading() {
  return (
    <div className="px-5 pt-8" aria-label="Loading page" aria-busy="true">
      <div className="flex items-center justify-between"><SkelBar w={138} h={30} r={9} /><SkelBar w={42} h={42} r={999} /></div>
      <div className="mt-5 overflow-hidden rounded-2xl bg-graphite p-5"><span className="block h-3 w-24 animate-pulse rounded bg-white/10" /><span className="mt-4 block h-10 w-40 animate-pulse rounded-xl bg-white/10" /><span className="mt-7 block h-3 w-full animate-pulse rounded bg-white/10" /><span className="mt-2 block h-3 w-3/4 animate-pulse rounded bg-white/10" /></div>
      <div className="mt-4 grid grid-cols-2 gap-3"><SkelBar h={132} r={24} /><SkelBar h={132} r={24} /></div>
      <div className="mt-4"><SkelBar h={72} r={22} /></div>
    </div>
  );
}
