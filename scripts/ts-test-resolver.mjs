import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier) && context.parentURL) {
    const base = new URL(specifier, context.parentURL);
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      const candidate = new URL(base.href + ext);
      if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
    }
  }
  return next(specifier, context);
}
