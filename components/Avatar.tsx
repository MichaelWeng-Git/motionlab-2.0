"use client";

// One avatar renderer for the whole app: the user's uploaded photo when they
// set one, otherwise their chosen sport icon. Fills its (round) parent.

import { avatarIcon, type Profile } from "@/lib/profile";
import { SIcon } from "@/components/SIcon";

export function Avatar({ p, iconSize = 24 }: { p: Profile; iconSize?: number }) {
  if (p.photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={p.photo} alt="" className="h-full w-full rounded-full object-cover" />;
  }
  return <SIcon name={avatarIcon(p)} size={iconSize} />;
}
