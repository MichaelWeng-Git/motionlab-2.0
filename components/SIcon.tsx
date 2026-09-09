/* eslint-disable @next/next/no-img-element */
// Hand-drawn icon set — transparent PNGs, floated directly on any surface.
// Baked into the app bundle; users never need the source files.

const ICONS = [
  "flame", "tennis", "run", "swim", "basketball", "golf", "strength", "ride",
  "trophy", "medal-1", "medal-2", "medal-3", "diamond", "rocket", "clapper",
] as const;
export type SIconName = (typeof ICONS)[number];

export function SIcon({
  name,
  size = 44,
  className = "",
}: {
  name: SIconName;
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={`/icons/${name}.png`}
      alt={name}
      width={size}
      height={size}
      className={`shrink-0 object-contain ${className}`}
    />
  );
}
