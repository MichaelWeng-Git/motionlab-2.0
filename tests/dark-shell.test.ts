import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { SURFACE } from "@/lib/palette";

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
});
