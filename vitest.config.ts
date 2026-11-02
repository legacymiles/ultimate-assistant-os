import { defineConfig } from "vitest/config";
import path from "node:path";

// src/lib/auteur/director/director.test.ts is excluded, not converted. It
// predates this config, is written against `node:test`, and already fails on
// its own because Node's ESM loader rejects the extensionless relative imports
// used throughout this codebase. Making it run would mean adding ".ts" to
// imports in production source, which is a large edit to app code in service of
// a test runner. Left exactly as found.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
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
