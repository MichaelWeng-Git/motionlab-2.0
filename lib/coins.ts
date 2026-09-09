// Coin economy shared by the Home daily-login reward and the Tree shop.
// Total coins = streak-day earnings (activeDays × 10, computed in /tree)
//             + claimed bonus coins (ml_coins_bonus)
//             − coins spent on packs (ml_coins_spent)

import { getSessions } from "@/lib/stats";

export const DAILY_COIN = 10;
export const RING_COIN = 10; // reward for completing one daily ring

export function getBonusCoins(): number {
  return Number(localStorage.getItem("ml_coins_bonus") ?? 0) || 0;
}

export function addBonusCoins(n: number) {
  localStorage.setItem("ml_coins_bonus", String(getBonusCoins() + n));
  notifyCoins();
}

// current spendable balance: streak-day earnings + claimed bonuses − shop spend
export function getCoinBalance(): number {
  try {
    const acts = JSON.parse(localStorage.getItem("ml_activities") ?? "[]") as { date: string }[];
    const days = new Set(
      [...getSessions().map((s) => s.date), ...acts.map((a) => a.date)].map((d) => d.slice(0, 10))
    ).size;
    const spent = Number(localStorage.getItem("ml_coins_spent") ?? 0) || 0;
    return Math.max(0, days * DAILY_COIN + getBonusCoins() - spent);
  } catch {
    return 0;
  }
}

// anything showing a balance (top bar, shop) listens for this
export function notifyCoins() {
  window.dispatchEvent(new Event("ml:coins"));
}

export const dayKey = (d: Date = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
