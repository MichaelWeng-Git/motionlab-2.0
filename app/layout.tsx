import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { PwaRegister } from "@/components/PwaRegister";

export const metadata: Metadata = {
  title: "MotionLab — Your AI movement coach",
  description: "Upload a video of your movement — get plain-language coaching on what to improve.",
  applicationName: "MotionLab 2.0",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "MotionLab" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#14181B",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* The DOCUMENT never scrolls (see globals). Scrolling happens inside the shell's
          <main>, so the phone-shell width is constant on every OS/browser — no route
          change can ever shift it sideways. */}
      <body className="flex h-dvh justify-center overflow-hidden bg-graphite text-ink antialiased">
        <PwaRegister />
        {/* `isolate` gives the shell its own stacking context so the -z-10 wave
            paints above the shell's bg-paper fallback but below ALL content;
            `overflow-hidden` clips it to the phone frame (never bleeds outside) */}
        {/* clean solid backdrop — no imagery competing with the content */}
        {/* longevity-mood morning-light wash (see .ml-backdrop) — the calm
            depth the old wallpaper gave, without an image fighting content */}
        <div className="ml-backdrop relative isolate flex h-dvh w-full max-w-[430px] flex-col overflow-hidden shadow-lift">
          <AppShell>{children}</AppShell>
        </div>
      </body>
    </html>
  );
}
