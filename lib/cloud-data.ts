import { sbAccessToken } from "./supabase-client";

// Account-owned keys. Auth/location/device UI flags are intentionally excluded.
export const ACCOUNT_KEYS = [
  "ml_sessions", "ml_activities", "ml_fuel", "ml_profile",
  "ml_goals", "ml_goals_history", "ml_muscle_attr", "ml_coin_ledger",
  "ml_coins_bonus", "ml_coins_spent", "ml_ornaments", "ml_daily_claims",
  "ml_daily_claim", "ml_ring_claims", "ml_streak", "ml_joined", "ml_preferences",
  "ml_medals_seen", "ml_public",
] as const;
const LOCAL_CLEAR_KEYS = [...ACCOUNT_KEYS, "ml_sessions_backup"] as const;

type Payload = Record<string, unknown>;
type BootstrapResult = { ok: boolean; isNew: boolean; migrated?: boolean; error?: string };
const ACCOUNT_BINDING_KEY = "ml_account_email";

async function headers(json = false): Promise<Record<string, string>> {
  const out: Record<string, string> = json ? { "Content-Type": "application/json" } : {};
  const token = await sbAccessToken();
  if (token) out.Authorization = `Bearer ${token}`;
  return out;
}

function compactValue(key: string, value: unknown): unknown {
  // Covers and route thumbnails are derivable artwork and can dominate an
  // otherwise small sync. Preserve reports and GPS paths — the actual record.
  if (key === "ml_sessions" && Array.isArray(value)) {
    return value.map(({ cover: _cover, ...session }) => session);
  }
  if (key === "ml_activities" && Array.isArray(value)) {
    return value.map(({ thumb: _thumb, ...activity }) => activity);
  }
  return value;
}

export function accountSnapshot(): Payload {
  const payload: Payload = {};
  for (const key of ACCOUNT_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw == null) continue;
    try { payload[key] = compactValue(key, JSON.parse(raw)); }
    catch { payload[key] = raw; }
  }
  return payload;
}

function hydrate(payload: Payload) {
  for (const key of LOCAL_CLEAR_KEYS) localStorage.removeItem(key);
  for (const [key, value] of Object.entries(payload)) {
    if (!(ACCOUNT_KEYS as readonly string[]).includes(key)) continue;
    localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  const sessions = localStorage.getItem("ml_sessions");
  if (sessions) localStorage.setItem("ml_sessions_backup", sessions);
  // The sessions module caches parsed data inside the tab.
  window.dispatchEvent(new StorageEvent("storage", { key: "ml_sessions" }));
  window.dispatchEvent(new Event("ml:sessions"));
}

async function upload(payload: Payload): Promise<boolean> {
  const response = await fetch("/api/account-data", { method: "POST", headers: await headers(true), body: JSON.stringify({ payload }) });
  if (!response.ok) return false;
  sessionStorage.setItem("ml_cloud_fingerprint", JSON.stringify(payload));
  return true;
}

let bootstrapInFlight: Promise<BootstrapResult> | null = null;

export async function bootstrapAccountData(): Promise<BootstrapResult> {
  if (bootstrapInFlight) return bootstrapInFlight;
  bootstrapInFlight = bootstrapAccountDataOnce();
  return bootstrapInFlight;
}

async function bootstrapAccountDataOnce(): Promise<BootstrapResult> {
  try {
    const response = await fetch("/api/account-data", { headers: await headers() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) return { ok: false, isNew: false, error: data.error ?? "sync-unavailable" };
    if (data.isNew) {
      // A genuinely new email starts clean even if this browser previously held
      // another account's data. Identity, not device storage, is authoritative.
      hydrate({});
      localStorage.setItem(ACCOUNT_BINDING_KEY, data.email);
      sessionStorage.setItem("ml_cloud_fingerprint", "{}");
      return { ok: true, isNew: true };
    }
    if (data.hasCloudData) {
      hydrate(data.payload ?? {});
      localStorage.setItem(ACCOUNT_BINDING_KEY, data.email);
      sessionStorage.setItem("ml_cloud_fingerprint", JSON.stringify(data.payload ?? {}));
      return { ok: true, isNew: false };
    }
    // Existing profile upgrading from the local-only version: migrate the
    // records on the original browser instead of declaring the account empty.
    const local = accountSnapshot();
    const boundEmail = localStorage.getItem(ACCOUNT_BINDING_KEY)?.toLowerCase();
    if (boundEmail && boundEmail !== data.email) {
      // This device currently holds another account. Its logout flush should
      // already have saved it; never copy it into the newly signed-in email.
      hydrate(data.legacyProfile ? { ml_profile: data.legacyProfile } : {});
      localStorage.setItem(ACCOUNT_BINDING_KEY, data.email);
      sessionStorage.setItem("ml_cloud_fingerprint", JSON.stringify(accountSnapshot()));
      return { ok: true, isNew: false, migrated: false };
    }
    if (!Object.keys(local).length) {
      // Old account opened first on a new/empty browser. Leave the cloud slot
      // absent so the original browser can still perform the one-time import.
      if (data.legacyProfile) localStorage.setItem("ml_profile", JSON.stringify(data.legacyProfile));
      localStorage.setItem(ACCOUNT_BINDING_KEY, data.email);
      sessionStorage.setItem("ml_cloud_fingerprint", JSON.stringify(accountSnapshot()));
      return { ok: true, isNew: false, migrated: false };
    }
    const migrated = await upload(local);
    if (migrated) localStorage.setItem(ACCOUNT_BINDING_KEY, data.email);
    return { ok: migrated, isNew: false, migrated, error: migrated ? undefined : "migration-failed" };
  } catch { return { ok: false, isNew: false, error: "sync-unavailable" }; }
}

export async function syncAccountData(): Promise<boolean> {
  const payload = accountSnapshot();
  const fingerprint = JSON.stringify(payload);
  if (sessionStorage.getItem("ml_cloud_fingerprint") === fingerprint) return true;
  try { return await upload(payload); } catch { return false; }
}
