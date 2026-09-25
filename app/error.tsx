"use client";

// Without this file an unhandled render error in production is a blank white
// screen — no message, no way back, and the athlete's data still perfectly
// intact underneath but invisible. Next only shows its own overlay in dev.

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[app] unhandled:", error); }, [error]);

  return (
    <div className="grid min-h-full place-items-center bg-graphite px-8 text-white">
      <div className="w-full max-w-[330px] rounded-3xl bg-panel p-6 text-fg shadow-panel">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-signal-work/12 text-signal-work">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 8v5" /><circle cx="12" cy="16.5" r="1" /><path d="M10.3 3.6 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z" /></svg>
        </span>
        <h1 className="mt-3 font-golden text-2xl leading-none">SOMETHING BROKE</h1>
        <p className="mt-2.5 text-[13px] font-semibold leading-snug text-fg-soft">
          This screen failed to draw. Your training is stored on this device and
          has not been touched — nothing was lost.
        </p>
        <div className="mt-5 space-y-2.5">
          <button
            onClick={reset}
            className="w-full rounded-full bg-action py-3.5 font-golden text-[13px] text-on-action transition active:scale-[0.98]"
          >
            TRY AGAIN
          </button>
          <Link
            href="/"
            className="block w-full rounded-full bg-inset py-3.5 text-center text-[15px] font-bold text-fg transition active:scale-[0.98]"
          >
            Back to home
          </Link>
        </div>
        {/* the digest is the only handle on a production stack trace */}
        {error.digest && <p className="mt-4 text-center text-[11px] font-bold text-fg-muted">Reference {error.digest}</p>}
      </div>
    </div>
  );
}
