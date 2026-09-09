"use client";

// Count-up numbers: roll from 0 to the target on mount (ease-out, ~0.9s).
// Respects prefers-reduced-motion by jumping straight to the value.

import { useEffect, useState } from "react";

export function useCountUp(target: number, duration = 900) {
  const [v, setV] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || target === 0) {
      setV(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setV(Math.round(target * e));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return v;
}

export function AnimatedNumber({ value, duration }: { value: number; duration?: number }) {
  return <>{useCountUp(value, duration)}</>;
}
