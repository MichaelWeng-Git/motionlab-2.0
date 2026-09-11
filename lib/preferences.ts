export type UnitSystem = "metric" | "imperial";
export type Preferences = {
  units: UnitSystem;
  trainingReminders: boolean;
  recoveryAlerts: boolean;
};

const KEY = "ml_preferences";
const defaults: Preferences = { units: "metric", trainingReminders: false, recoveryAlerts: false };

export function getPreferences(): Preferences {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; }
  catch { return defaults; }
}

export function savePreferences(value: Preferences) {
  localStorage.setItem(KEY, JSON.stringify(value));
  window.dispatchEvent(new Event("ml:preferences"));
}

export const distanceValue = (meters: number, units: UnitSystem) =>
  units === "imperial" ? meters / 1609.344 : meters / 1000;
export const distanceUnit = (units: UnitSystem) => units === "imperial" ? "mi" : "km";

export const EXPORT_KEYS = [
  "ml_sessions", "ml_activities", "ml_fuel", "ml_profile", "ml_goals",
  "ml_goals_history", "ml_muscle_attr", "ml_coin_ledger", "ml_coin_bonus",
  "ml_pack_collection", "ml_preferences",
] as const;

export const TRAINING_KEYS = [
  "ml_sessions", "ml_sessions_backup", "ml_activities", "ml_fuel", "ml_goals",
  "ml_goals_history", "ml_muscle_attr", "ml_coin_ledger", "ml_coin_bonus",
  "ml_pack_collection", "ml_rec_checkpoint",
] as const;
