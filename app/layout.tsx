import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { PwaRegister } from "@/components/PwaRegister";
import { SURFACE } from "@/lib/palette";

export const metadata: Metadata = {
  title: "MotionLab — Your AI movement coach",
  description: "Upload a video of your movement — get plain-language coaching on what to improve.",
  applicationName: "MotionLab 2.0",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "MotionLab" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: SURFACE.graphite,
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // These inline colours are intentional. Tailwind and globals.css arrive
    // after the browser's first document paint; without an inline canvas the
    // browser briefly uses its default white background on a cold load.
    <html lang="en" style={{ backgroundColor: SURFACE.graphite, colorScheme: "dark" }}>
      {/* The DOCUMENT never scrolls (see globals). Scrolling happens inside the shell's
          <main>, so the phone-shell width is constant on every OS/browser — no route
          change can ever shift it sideways. */}
      <body
        className="flex h-dvh justify-center overflow-hidden bg-graphite text-ink antialiased"
        style={{ backgroundColor: SURFACE.graphite }}
      >
        <PwaRegister />
        {/* This is the route-transition underlay. Keep it dark both inline and
            in CSS so an unmounted template can never expose a pale phone frame. */}
        <div
          className="ml-backdrop relative isolate flex h-dvh w-full max-w-[430px] flex-col overflow-hidden shadow-lift"
          style={{ backgroundColor: SURFACE.graphite }}
        >
          <AppShell>{children}</AppShell>
        </div>
      </body>
    </html>
  );
}
