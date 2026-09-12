export type UnitSystem = "metric" | "imperial";
export type Preferences = {
  units: UnitSystem;
  trainingReminders: boolean;
  recoveryAlerts: boolean;
  cloud3d: boolean;
};

const KEY = "ml_preferences";
const LEGACY_CLOUD_KEY = "ml_cloud3d";
const defaults: Preferences = { units: "metric", trainingReminders: false, recoveryAlerts: false, cloud3d: false };

export function getPreferences(): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Preferences>;
    const cloud3d = typeof stored.cloud3d === "boolean"
      ? stored.cloud3d
      : localStorage.getItem(LEGACY_CLOUD_KEY) === "on";
    return { ...defaults, ...stored, cloud3d };
  }
  catch { return defaults; }
}

export function savePreferences(value: Preferences) {
  localStorage.setItem(KEY, JSON.stringify(value));
  localStorage.removeItem(LEGACY_CLOUD_KEY);
  window.dispatchEvent(new Event("ml:preferences"));
}

export const distanceValue = (meters: number, units: UnitSystem) =>
  units === "imperial" ? meters / 1609.344 : meters / 1000;
export const distanceUnit = (units: UnitSystem) => units === "imperial" ? "mi" : "km";

export const EXPORT_KEYS = [
  "ml_sessions", "ml_activities", "ml_fuel", "ml_profile", "ml_goals",
  "ml_goals_history", "ml_muscle_attr", "ml_coin_ledger", "ml_coins_bonus",
  "ml_coins_spent", "ml_ornaments", "ml_daily_claims", "ml_ring_claims",
  "ml_streak", "ml_preferences", "ml_medals_seen",
] as const;

export const TRAINING_KEYS = [
  "ml_sessions", "ml_sessions_backup", "ml_activities", "ml_fuel", "ml_goals",
  "ml_goals_history", "ml_muscle_attr", "ml_coin_ledger", "ml_coins_bonus",
  "ml_coins_spent", "ml_ornaments", "ml_daily_claims", "ml_daily_claim",
  "ml_ring_claims", "ml_streak", "ml_medals_seen", "ml_rec_checkpoint",
] as const;
