import { SkelBar } from "./Skeleton";

export function AppLoading() {
  return (
    <div className="min-h-full bg-graphite px-5 pb-10 pt-7 text-white" aria-label="Loading page" aria-busy="true">
      <div className="flex items-center justify-between">
        <div>
          <span className="block h-2.5 w-20 animate-pulse rounded-full bg-signal-good/35" />
          <span className="mt-2 block h-7 w-36 animate-pulse rounded-lg bg-track" />
        </div>
        <span className="grid h-11 w-11 place-items-center rounded-full bg-track font-golden text-[13px] text-white ring-1 ring-inset ring-hair">ML</span>
      </div>
      <div className="relative mt-5 overflow-hidden rounded-3xl bg-panel p-5 ring-1 ring-inset ring-hair">
        <span className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-signal-good/20 blur-2xl" />
        <span className="relative block h-3 w-24 animate-pulse rounded bg-track" />
        <span className="relative mt-4 block h-10 w-40 animate-pulse rounded-xl bg-track" />
        <div className="relative mt-7 grid grid-cols-3 gap-2">
          <span className="h-12 animate-pulse rounded-xl bg-track" />
          <span className="h-12 animate-pulse rounded-xl bg-track" />
          <span className="h-12 animate-pulse rounded-xl bg-track" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-panel p-4 ring-1 ring-inset ring-hair"><SkelBar h={104} r={18} /></div>
        <div className="rounded-2xl bg-panel p-4 ring-1 ring-inset ring-hair"><SkelBar h={104} r={18} /></div>
      </div>
      <div className="mt-4 rounded-2xl bg-panel p-4 ring-1 ring-inset ring-hair"><SkelBar h={52} r={18} /></div>
    </div>
  );
}
