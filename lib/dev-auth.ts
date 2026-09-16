/**
 * Local preview convenience only. Production builds compile NODE_ENV to
 * "production", so this path cannot bypass the deployed auth gate.
 *
 * The hostname check keeps a development server opened through a LAN address
 * behind the real gate as well. No auth marker is written and cloud sync stays
 * disabled unless the user has genuinely authenticated before.
 */
export function isLocalDevAuthBypass(): boolean {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}
