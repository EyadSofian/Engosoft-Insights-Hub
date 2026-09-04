import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    environment: "node",
    globals: false,
    // `.tsx` is included for the ENGO Nexus component suite. Those files opt
    // into jsdom with a per-file `@vitest-environment` docblock rather than
    // switching the whole suite: the server-side tests here deliberately run in
    // node, and giving them a DOM would hide a real class of bug.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    // The suite must never touch production. Anything that tries to open a real
    // socket should fail loudly rather than hang until CI times out.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
