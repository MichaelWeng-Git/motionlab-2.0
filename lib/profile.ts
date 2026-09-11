// User profile helpers — single source for avatar/name across the app.

export type Profile = {
  name?: string;
  avatar?: string;
  photo?: string; // user-uploaded avatar image (small data URL); wins over icon
  gender?: string;
  height?: number;
  weight?: number;
  level?: string;
  goal?: string;
};

export function getProfile(): Profile {
  try {
    return JSON.parse(localStorage.getItem("ml_profile") ?? "{}");
  } catch {
    return {};
  }
}

// hand-drawn icon for each avatar choice — replaces Apple emoji everywhere
import type { SIconName } from "@/components/SIcon";
export const AVATAR_ICON: Record<string, SIconName> = {
  tennis: "tennis",
  run: "run",
  swim: "swim",
  ball: "basketball",
  lift: "strength",
  bolt: "flame",
};
export function avatarIcon(p: Profile): SIconName {
  return (p.avatar && AVATAR_ICON[p.avatar]) || "tennis";
}
