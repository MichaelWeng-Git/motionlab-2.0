"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // A production preview can leave a service worker controlling localhost.
    // Next's dev asset URLs are stable, so that worker can otherwise keep
    // serving an old light stylesheet even after the source has changed.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
        const local = registrations.filter((registration) => {
          try {
            return new URL(registration.scope).origin === window.location.origin;
          } catch {
            return false;
          }
        });
        if (!local.length) return;
        await Promise.all(local.map((registration) => registration.unregister()));

        // An unregistered worker controls the current document until it is
        // reloaded. Reload once, guarded per tab, so preview never stays stale.
        if (navigator.serviceWorker.controller && !sessionStorage.getItem("ml_dev_sw_cleared")) {
          sessionStorage.setItem("ml_dev_sw_cleared", "1");
          window.location.reload();
        } else {
          sessionStorage.removeItem("ml_dev_sw_cleared");
        }
      }).catch(() => {});
      return;
    }

    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {});
  }, []);
  return null;
}
