// Brand icon set — replaces OS emoji in UI icon slots so every surface uses
// the same drawn language (uniform stroke, round caps, volt-green by default).
// Color comes from currentColor: wrap in a text-* class to tint.

type P = { size?: number; className?: string };

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };
}

export function PersonIcon({ size = 20, className }: P) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 19.5c1.2-3.5 4-5.3 7-5.3s5.8 1.8 7 5.3" />
    </svg>
  );
}

export function ChatIcon({ size = 20, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 7A2.8 2.8 0 0 1 6.8 4.2h10.4A2.8 2.8 0 0 1 20 7v6.4a2.8 2.8 0 0 1-2.8 2.8H9.6L5.4 19.6c-.6.5-1.4.1-1.4-.7V7z" />
      <path d="M8.5 10.7h7M8.5 13.4h4.5" />
    </svg>
  );
}

export function LogoutIcon({ size = 20, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M14.5 4.5h3A2.5 2.5 0 0 1 20 7v10a2.5 2.5 0 0 1-2.5 2.5h-3" />
      <path d="M9.5 8.5 6 12l3.5 3.5M6 12h9" />
    </svg>
  );
}

export function ClapperIcon({ size = 28, className }: P) {
  return (
    <svg {...base(size, className)}>
      {/* board */}
      <path d="M4 11h16v6.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5V11z" />
      {/* slate, hinged open */}
      <path d="M4.1 10.9 3.3 8a2 2 0 0 1 1.4-2.5l11.5-3.1a2 2 0 0 1 2.5 1.4l.8 2.9-15.4 4.2z" />
      {/* slate stripes */}
      <path d="m7.9 9.9-.7-2.7M12 8.8l-.7-2.7M16.1 7.7l-.7-2.7" />
    </svg>
  );
}

export function FilmIcon({ size = 22, className }: P) {
  return (
    <svg {...base(size, className)}>
      <rect x="3.2" y="4.8" width="17.6" height="14.4" rx="2" />
      <path d="M7.4 4.8v14.4M16.6 4.8v14.4M3.2 9.3h4.2M3.2 14.7h4.2M16.6 9.3h4.2M16.6 14.7h4.2" />
    </svg>
  );
}

export function MapPinIcon({ size = 18, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 20.8s-6.3-5-6.3-9.8a6.3 6.3 0 1 1 12.6 0c0 4.8-6.3 9.8-6.3 9.8z" />
      <circle cx="12" cy="10.6" r="2.2" />
    </svg>
  );
}

export function TrendIcon({ size = 28, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 4.8v14.4h16" />
      <path d="m6.8 14.6 4-4.2 2.8 2.8 5.4-5.8" />
      <path d="M15.6 7.4H19v3.4" />
    </svg>
  );
}

export function FriendsIcon({ size = 20, className }: P) {
  return (
    <svg {...base(size, className)}>
      <circle cx="9" cy="8.2" r="3.2" />
      <path d="M3.2 19c1-3 3.3-4.6 5.8-4.6s4.8 1.6 5.8 4.6" />
      <path d="M15.4 5.4a3.2 3.2 0 0 1 0 5.6M17.6 14.6c1.6.8 2.8 2.3 3.4 4.4" />
    </svg>
  );
}

export function LockIcon({ size = 20, className }: P) {
  return (
    <svg {...base(size, className)}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
      <path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" />
    </svg>
  );
}

export function DumbbellIcon({ size = 20, className }: P) {
  return (
    <svg {...base(size, className)}>
      <rect x="4.6" y="7.2" width="3.6" height="9.6" rx="1.6" />
      <rect x="15.8" y="7.2" width="3.6" height="9.6" rx="1.6" />
      <path d="M8.2 12h7.6M2.2 9.8v4.4M21.8 9.8v4.4" />
    </svg>
  );
}

export function CameraIcon({ size = 20, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 8.2A2.2 2.2 0 0 1 6.2 6h1.9l1.3-1.8h5.2L15.9 6h1.9A2.2 2.2 0 0 1 20 8.2v8.6a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 16.8V8.2z" />
      <circle cx="12" cy="12.4" r="3.1" />
    </svg>
  );
}

export function SearchIcon({ size = 18, className }: P) {
  return (
    <svg {...base(size, className)}>
      <circle cx="11" cy="11" r="6.4" />
      <path d="m16 16 4.4 4.4" />
    </svg>
  );
}

export function SproutIcon({ size = 22, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 20.5v-7" />
      <path d="M12 13.5C12 9.5 9.5 7 5.5 7c0 4 2.5 6.5 6.5 6.5z" />
      <path d="M12 11.5c0-3.6 2.3-5.9 5.9-5.9 0 3.6-2.3 5.9-5.9 5.9z" />
    </svg>
  );
}

export function TrophyIcon({ size = 22, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M8 4.5h8v5a4 4 0 0 1-8 0v-5z" />
      <path d="M8 6H5.2a0 0 0 0 0 0 0c0 2.6 1.2 4.1 2.8 4.4M16 6h2.8c0 2.6-1.2 4.1-2.8 4.4" />
      <path d="M12 13.5v3M8.8 19.5h6.4M10 16.5h4a0 0 0 0 1 0 0l.6 3h-5.2l.6-3z" />
    </svg>
  );
}

export function TargetIcon({ size = 20, className }: P) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="4.6" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ShieldIcon({ size = 20, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 3.2 5 6v5.4c0 4.4 2.9 7.4 7 9.4 4.1-2 7-5 7-9.4V6l-7-2.8z" />
      <path d="m8.8 11.8 2.2 2.2 4.2-4.4" />
    </svg>
  );
}

export function MedalIcon({ size = 20, className }: P) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="14.6" r="4.6" />
      <path d="m9 11 -3-6.5M15 11l3-6.5M9.8 4.5h4.4" />
    </svg>
  );
}

export function SmileIcon({ size = 20, className }: P) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M8.6 14.2c.8 1.3 2 2 3.4 2s2.6-.7 3.4-2" />
      <path d="M9.3 9.6h.01M14.7 9.6h.01" strokeWidth="2.6" />
    </svg>
  );
}

export function RocketIcon({ size = 22, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 3.2c2.8 1.6 4.4 4.6 4.4 8.2l-.1 2.4-4.3 4.3-4.3-4.3-.1-2.4c0-3.6 1.6-6.6 4.4-8.2z" />
      <circle cx="12" cy="9.8" r="1.7" />
      <path d="M7.7 13.4 5.4 15c-.6.4-.9 1.1-.8 1.8l.3 2.3 3-1.3M16.3 13.4l2.3 1.6c.6.4.9 1.1.8 1.8l-.3 2.3-3-1.3" />
      <path d="M12 18.4v2.4" />
    </svg>
  );
}

export function FlameIcon({ size = 22, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 3.4c.6 2.6 1.9 4.1 3.6 5.8 1.6 1.6 2.6 3.2 2.6 5.2a6.2 6.2 0 0 1-12.4 0c0-2.5 1.3-4.2 2.6-5.7C10 7 11.6 5.6 12 3.4z" />
      <path d="M12 20.4a3 3 0 0 1-3-3c0-1.2.6-2 1.4-2.9.7-.7 1.3-1.3 1.6-2.3.3 1 .9 1.6 1.6 2.3.8.9 1.4 1.7 1.4 2.9a3 3 0 0 1-3 3z" />
    </svg>
  );
}

export function DiamondIcon({ size = 22, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M7.2 4.6h9.6l3.6 5-8.4 10.6L3.6 9.6l3.6-5z" />
      <path d="M3.6 9.6h16.8M9.2 9.6 12 20.2 14.8 9.6M7.2 4.6l2 5 2.8-5 2.8 5 2-5" />
    </svg>
  );
}

// gold coin — fixed colors on purpose (it's currency, not a stroke glyph)
export function CoinIcon({ size = 16, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="10" fill="#F5B23D" />
      <circle cx="12" cy="12" r="7" fill="none" stroke="#C98F1B" strokeWidth="1.6" />
      <path d="M12 8.2v7.6M9.6 10.4h4.2a1.7 1.7 0 0 1 0 3.4H9.9" stroke="#C98F1B" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function PlayIcon({ size = 16, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <path
        d="M8.6 6.1v11.8c0 .8.9 1.3 1.6.9l9.2-5.9c.7-.4.7-1.4 0-1.8L10.2 5.2c-.7-.4-1.6.1-1.6.9z"
        fill="currentColor"
      />
    </svg>
  );
}
