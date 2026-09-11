// Coin economy shared by the Home daily-login reward and the Tree shop.
// Total coins = streak-day earnings (activeDays × 10, computed in /tree)
//             + claimed bonus coins (ml_coins_bonus)
//             − coins spent on packs (ml_coins_spent)

import { getSessions } from "@/lib/stats";

export const DAILY_COIN = 10;
export const RING_COIN = 10; // reward for completing one daily ring
const LEDGER_KEY = "ml_coin_ledger";

export type CoinTransaction = {
  id: string; date: string; amount: number; label: string; kind: "earn" | "spend";
};

function ledger(): CoinTransaction[] {
  try { return JSON.parse(localStorage.getItem(LEDGER_KEY) ?? "[]") as CoinTransaction[]; }
  catch { return []; }
}

function appendTransaction(amount: number, label: string) {
  const item: CoinTransaction = {
    id: `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    date: new Date().toISOString(), amount,
    label, kind: amount >= 0 ? "earn" : "spend",
  };
  localStorage.setItem(LEDGER_KEY, JSON.stringify([...ledger(), item].slice(-300)));
}

export function getBonusCoins(): number {
  return Number(localStorage.getItem("ml_coins_bonus") ?? 0) || 0;
}

export function addBonusCoins(n: number, label = "Bonus reward") {
  if (!(n > 0)) return;
  localStorage.setItem("ml_coins_bonus", String(getBonusCoins() + n));
  appendTransaction(n, label);
  notifyCoins();
}

export function spendCoins(n: number, label: string): boolean {
  if (!(n > 0) || getCoinBalance() < n) return false;
  const spent = Number(localStorage.getItem("ml_coins_spent") ?? 0) || 0;
  localStorage.setItem("ml_coins_spent", String(spent + n));
  appendTransaction(-n, label);
  notifyCoins();
  return true;
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

export function getCoinHistory(): CoinTransaction[] {
  const active = new Map<string, string>();
  try {
    const acts = JSON.parse(localStorage.getItem("ml_activities") ?? "[]") as { date: string }[];
    for (const date of [...getSessions().map((s) => s.date), ...acts.map((a) => a.date)]) {
      const day = date.slice(0, 10);
      if (!active.has(day) || date < active.get(day)!) active.set(day, date);
    }
  } catch {}
  const activityRows: CoinTransaction[] = [...active].map(([day, date]) => ({
    id: `active:${day}`, date, amount: DAILY_COIN, label: "Active day", kind: "earn",
  }));
  const rows = ledger();
  const recordedEarn = rows.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const recordedSpend = -rows.filter((x) => x.amount < 0).reduce((s, x) => s + x.amount, 0);
  const legacyEarn = Math.max(0, getBonusCoins() - recordedEarn);
  const spent = Number(localStorage.getItem("ml_coins_spent") ?? 0) || 0;
  const legacySpend = Math.max(0, spent - recordedSpend);
  const legacy: CoinTransaction[] = [];
  if (legacyEarn) legacy.push({ id: "legacy:earn", date: "", amount: legacyEarn, label: "Previous rewards", kind: "earn" });
  if (legacySpend) legacy.push({ id: "legacy:spend", date: "", amount: -legacySpend, label: "Previous pack spending", kind: "spend" });
  return [...activityRows, ...rows, ...legacy].sort((a, b) => b.date.localeCompare(a.date));
}

export const dayKey = (d: Date = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
