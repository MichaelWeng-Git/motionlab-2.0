import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { SURFACE } from "@/lib/palette";

function uiSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return uiSources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("dark app bootstrap", () => {
  it("uses graphite before React and the route stylesheet are ready", () => {
    const appManifest = manifest();
    const layout = readFileSync("app/layout.tsx", "utf8");
    const globalCss = readFileSync("app/globals.css", "utf8");
    const offline = readFileSync("public/offline.html", "utf8").toUpperCase();

    expect(appManifest.background_color).toBe(SURFACE.graphite);
    expect(appManifest.theme_color).toBe(SURFACE.graphite);
    expect(layout).toContain("backgroundColor: SURFACE.graphite");
    expect(globalCss).toMatch(/\.ml-backdrop\s*{[^}]*background-color:\s*#14181B/i);
    expect(offline).toContain(`BACKGROUND:${SURFACE.graphite.toUpperCase()}`);
  });

  it("uses named surface tokens instead of hand-written dark alphas", () => {
    const files = [...uiSources("app"), ...uiSources("components")];
    const sources = files
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const authenticatedSources = files
      .filter((file) => !file.startsWith("app/login/") && !file.startsWith("app/onboarding/"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const nonOverlaySources = files
      .filter((file) => ![
        "app/activity/page.tsx",
        "app/history/page.tsx",
        "app/onboarding/page.tsx",
        "components/PoseAvatar3D.tsx",
        "components/VideoReplay.tsx",
      ].includes(file))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const globalCss = readFileSync("app/globals.css", "utf8");

    expect(sources).not.toMatch(/bg-white\/\[0\.(?:03|04|05|06|07|08|09)\]/);
    expect(sources).not.toMatch(/bg-white\/(?:8|10|15)\b/);
    expect(sources).not.toMatch(/ring-white\/(?:5|10|15)\b/);
    expect(sources).not.toMatch(/text-white\/(?:30|35|40|45)\b/);
    expect(sources).not.toMatch(/text-\[10px\]/);
    expect(authenticatedSources).not.toMatch(/bg-white(?!\/)[^\n]*(?:text-ink(?:-muted)?|text-graphite)/);
    expect(authenticatedSources).not.toMatch(/(?:text-ink(?:-muted)?|text-graphite)[^\n]*bg-white(?!\/)/);
    expect(sources).not.toMatch(/\bshadow-lift\b/);
    expect(nonOverlaySources).not.toMatch(/\bshadow-soft\b/);
    expect(globalCss).toMatch(/--track:\s*rgba\(255,\s*255,\s*255,\s*0\.10\)/);
  });
});
