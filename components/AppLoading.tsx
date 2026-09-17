import { SkelBar } from "./Skeleton";

export function AppLoading() {
  return (
    <div className="min-h-full bg-graphite px-5 pb-10 pt-7 text-white" aria-label="Loading page" aria-busy="true">
      <div className="flex items-center justify-between">
        <div>
          <span className="block h-2.5 w-20 animate-pulse rounded-full bg-signal-good/35" />
          <span className="mt-2 block h-7 w-36 animate-pulse rounded-lg bg-white/10" />
        </div>
        <span className="grid h-11 w-11 place-items-center rounded-full bg-white/10 font-golden text-[13px] text-white ring-1 ring-inset ring-white/15">ML</span>
      </div>
      <div className="relative mt-5 overflow-hidden rounded-3xl bg-white/[0.07] p-5 ring-1 ring-inset ring-white/15">
        <span className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-signal-good/20 blur-2xl" />
        <span className="relative block h-3 w-24 animate-pulse rounded bg-white/15" />
        <span className="relative mt-4 block h-10 w-40 animate-pulse rounded-xl bg-white/15" />
        <div className="relative mt-7 grid grid-cols-3 gap-2">
          <span className="h-12 animate-pulse rounded-xl bg-white/10" />
          <span className="h-12 animate-pulse rounded-xl bg-white/10" />
          <span className="h-12 animate-pulse rounded-xl bg-white/10" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white/[0.07] p-4 ring-1 ring-inset ring-white/15"><SkelBar h={104} r={18} /></div>
        <div className="rounded-2xl bg-white/[0.07] p-4 ring-1 ring-inset ring-white/15"><SkelBar h={104} r={18} /></div>
      </div>
      <div className="mt-4 rounded-2xl bg-white/[0.07] p-4 ring-1 ring-inset ring-white/15"><SkelBar h={52} r={18} /></div>
    </div>
  );
}
