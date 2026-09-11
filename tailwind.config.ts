import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#17271F", // near-black forest — deep cold anchor on cool porcelain
          soft: "#26382E",
          muted: "#51604F",
        },
        paper: {
          DEFAULT: "#EDF1EE", // cool porcelain inset surface
          card: "#FFFFFF",
        },
        volt: {
          DEFAULT: "#17271F", // OUR identity: deep-green actions (orange stays only on flame/coins/route)
          deep: "#17271F",
          ink: "#FFFFFF",     // text on primary buttons
          glow: "#FF9A66",    // warm accent for dark surfaces (the one energy touch)
          mist: "#DFE9E2",    // soft green tint — selected states, matches the forest anchor
        },
        signal: {
          good: "#3BA55D",
          okay: "#E8A13C",
          work: "#E0523F",
        },
        // Card grounds. Kept byte-identical to lib/palette SURFACE — Tailwind
        // classes cannot read a TS constant, so the value lives in both places
        // and they must not drift.
        graphite: "#14181B",   // the one dark card ground (TODAY, GoalRing, heroes)
        cream: "#F3F0E8",      // warm paper — the day-intensity card
        // Podium ranks and medal tiers. See lib/palette AWARD for the
        // edge/light shades illustrated medals need.
        award: {
          gold: "#E8B23E",
          "gold-light": "#E8C76A",
          "gold-pale": "#FFE58E",    // deluxe pack trim
          "gold-wash": "#FFF4D6",    // palest gold — note/credit row tint
          silver: "#AFBBB4",
          bronze: "#C98658",
        },
        // Sequential ramp for DENSITY (activity heatmaps, streak calendars) —
        // "how much", not "how good". The signal scale is categorical and
        // cannot express this; reaching for it paints red squares on a
        // calendar, which reads as failure rather than volume.
        // Mirrors lib/palette HEAT.
        heat: {
          1: "#315741",
          2: "#4D8A5D",
          3: "#7FCF72",
          4: "#A8E89B",
        },
      },
      fontFamily: {
        // small/running text stays on the system stack — Lilita's tight
        // spacing reads badly at small sizes (user call). Headers + numbers
        // opt into the brand face via .font-golden.
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "Inter",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
      },
      borderRadius: {
        xl: "1.1rem",
        "2xl": "1.5rem",
        "3xl": "2rem",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(14,31,26,0.05), 0 10px 28px -12px rgba(14,31,26,0.18)",
        lift: "0 2px 4px rgba(14,31,26,0.09), 0 22px 52px -18px rgba(14,31,26,0.34)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scan": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(200%)" },
        },
        "pop": {
          "0%": { transform: "scale(0.9)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "bob": {
          "0%, 100%": { transform: "translate(-50%, 0)" },
          "50%": { transform: "translate(-50%, -8px)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s cubic-bezier(0.16,1,0.3,1) both",
        "scan": "scan 2.2s ease-in-out infinite",
        "pop": "pop 0.4s cubic-bezier(0.16,1,0.3,1) both",
        "bob": "bob 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
