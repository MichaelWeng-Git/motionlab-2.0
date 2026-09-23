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
    const sources = [...uiSources("app"), ...uiSources("components")]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const globalCss = readFileSync("app/globals.css", "utf8");

    expect(sources).not.toMatch(/bg-white\/\[0\.(?:03|04|05|06|07|08|09)\]/);
    expect(sources).not.toMatch(/bg-white\/(?:8|10|15)\b/);
    expect(sources).not.toMatch(/ring-white\/(?:5|10|15)\b/);
    expect(globalCss).toMatch(/--track:\s*rgba\(255,\s*255,\s*255,\s*0\.10\)/);
  });
});
