import { defineConfig } from "vitest/config";
import path from "node:path";

// src/lib/auteur/director/director.test.ts is excluded, not converted. It
// predates this config, is written against `node:test`, and already fails on
// its own because Node's ESM loader rejects the extensionless relative imports
// used throughout this codebase. Making it run would mean adding ".ts" to
// imports in production source, which is a large edit to app code in service of
// a test runner. Left exactly as found.
export default defineConfig({
  // The app uses the automatic JSX runtime (Next's default). Vitest's esbuild
  // defaults to the classic runtime, which fails on components that do not
  // import React — the profile render smoke tests are exactly those components.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    // tools/jarvis-bridge holds logic that runs UNATTENDED on the owner's
    // machine -- the 24/7 agent runner's permission policy above all -- so it
    // is tested like everything else rather than trusted for living outside
    // src. Scoped to that one folder on purpose: other tools (unreal-builder,
    // video-studio-runner) ship tests written against `node:test`, which
    // vitest collects and then reports as empty suites.
    include: ["src/**/*.test.ts", "tools/jarvis-bridge/*.test.mjs"],
    exclude: ["**/node_modules/**", "src/lib/auteur/director/director.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // See test/stubs/server-only.ts — without this, importing any
      // `server-only` module throws at collection time.
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
});
