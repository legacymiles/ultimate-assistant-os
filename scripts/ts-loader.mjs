// ---------------------------------------------------------------------------
// A resolver so plain `node` can import the app's TypeScript modules directly.
//
// Node 24 strips types on its own, but it still demands a file extension on
// relative imports, and the app's source is written the way TypeScript wants:
// `import { ... } from "./types"`. This maps those onto ./types.ts so the check
// scripts can exercise real source rather than a copy of it.
//
// Resolution only. Nothing here transforms code.
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      try {
        const url = new URL(candidate, context.parentURL);
        if (existsSync(fileURLToPath(url))) return nextResolve(candidate, context);
      } catch {
        // Not resolvable as a file URL — fall through to the default resolver.
      }
    }
  }
  return nextResolve(specifier, context);
}
