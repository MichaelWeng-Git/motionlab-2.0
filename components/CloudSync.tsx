"use client";

import { useEffect } from "react";
import { syncAccountData } from "@/lib/cloud-data";

export function CloudSync() {
  useEffect(() => {
    if (!localStorage.getItem("ml_auth")) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { syncAccountData(); }, 1200);
    };
    const interval = setInterval(schedule, 8_000);
    const onVisibility = () => { if (document.visibilityState === "hidden") syncAccountData(); };
    window.addEventListener("ml:sessions", schedule);
    window.addEventListener("ml:profile", schedule);
    window.addEventListener("ml:preferences", schedule);
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("ml:sessions", schedule);
      window.removeEventListener("ml:profile", schedule);
      window.removeEventListener("ml:preferences", schedule);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return null;
}
