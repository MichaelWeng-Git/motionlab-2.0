import type { MedalFamilyKey, MedalTier } from "@/lib/medals";

const METAL: Record<MedalTier, { edge: string; face: string; light: string }> = {
  bronze: { edge: "#8E5734", face: "#C98658", light: "#F1B486" },
  silver: { edge: "#718078", face: "#AFBBB4", light: "#E5ECE8" },
  gold: { edge: "#9B6A12", face: "#E8B23E", light: "#FFE38A" },
};

export function MedalArt({ family, tier = "bronze", earned = true, size = 82 }: { family: MedalFamilyKey; tier?: MedalTier; earned?: boolean; size?: number }) {
  const m = METAL[tier];
  return <svg width={size} height={size} viewBox="0 0 100 112" fill="none" style={!earned ? { filter: "grayscale(1)", opacity: .25 } : undefined}>
    <path d="M27 5h18l5 35-17 7z" fill="#203E32" stroke="#10271F" strokeWidth="3" /><path d="M73 5H55l-5 35 17 7z" fill="#315E4A" stroke="#10271F" strokeWidth="3" />
    <path d="M50 32 78 49v33L50 99 22 82V49z" fill={m.edge} stroke="#10271F" strokeWidth="4" strokeLinejoin="round" />
    <circle cx="50" cy="66" r="23" fill={m.face} stroke={m.light} strokeWidth="3" /><circle cx="50" cy="66" r="17" stroke={m.edge} strokeWidth="2" strokeDasharray="2 3" />
    <MedalGlyph family={family} color={m.light} />
  </svg>;
}

function MedalGlyph({ family, color }: { family: MedalFamilyKey; color: string }) {
  const common = { stroke: color, strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (family === "analyst") return <g {...common}><rect x="39" y="53" width="22" height="26" rx="3" /><path d="M44 49h12v7H44zM44 63h12M44 69h8" /></g>;
  if (family === "form") return <g {...common}><path d="M38 75a15 15 0 1 1 24 0" /><path d="m50 66 8-8" /><circle cx="50" cy="66" r="2" fill={color} /></g>;
  if (family === "streak") return <path d="M52 48c4 9-2 12 4 17 2-5 6-7 7-11 6 8 3 25-12 27-14-1-18-14-10-23 0 6 4 8 5 12 3-7-2-12 6-22z" fill="none" {...common} />;
  return <g {...common}><path d="M36 66h28M40 58v16M60 58v16M34 61v10M66 61v10" /></g>;
}
