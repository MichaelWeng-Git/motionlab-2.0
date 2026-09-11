"use client";

import { useEffect } from "react";
import { bootstrapAccountData, getCloudState, syncAccountData } from "@/lib/cloud-data";

export function CloudSync() {
  useEffect(() => {
    if (!localStorage.getItem("ml_auth")) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let retryMs = 2_000;
    let stopped = false;
    const run = async () => {
      if (stopped) return;
      const ok = await syncAccountData();
      if (ok) { retryMs = 2_000; return; }
      // A conflict needs an explicit merge decision. Blind retries would only
      // hammer the server and must never turn into last-write-wins data loss.
      if (getCloudState() === "conflict") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, retryMs);
      retryMs = Math.min(retryMs * 2, 60_000);
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 1200);
    };
    let interval: ReturnType<typeof setInterval> | null = null;
    const onVisibility = () => { if (document.visibilityState === "hidden") syncAccountData(); };
    const onOnline = () => { retryMs = 2_000; schedule(); };
    window.addEventListener("ml:sessions", schedule);
    window.addEventListener("ml:profile", schedule);
    window.addEventListener("ml:preferences", schedule);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    // Older sessions predate revision tracking. Fetch once before their first
    // upload so they cannot collide with their own existing cloud record.
    void (async () => {
      if (!localStorage.getItem("ml_cloud_updated_at")) await bootstrapAccountData();
      if (stopped) return;
      interval = setInterval(schedule, 8_000);
      schedule();
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (interval) clearInterval(interval);
      window.removeEventListener("ml:sessions", schedule);
      window.removeEventListener("ml:profile", schedule);
      window.removeEventListener("ml:preferences", schedule);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, []);
  return null;
}
