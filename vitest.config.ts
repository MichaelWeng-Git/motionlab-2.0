import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    // lib/ is plain logic — no DOM, no React. The few modules that touch
    // localStorage get a stub from tests/setup.ts instead of jsdom, which keeps
    // the suite fast enough to run on every change.
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
  },
});
