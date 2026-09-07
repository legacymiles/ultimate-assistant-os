// Lets `node --test` run the hub's TypeScript directly.
//
// Node 24 strips types on its own, but its ESM resolver still wants explicit
// extensions, and the source uses the bundler-style extensionless imports
// Next.js expects. This hook maps a relative extensionless import to the
// `.ts` file when one exists, so the same files serve both. Usage:
//
//   node --import ./scripts/ts-test-hooks.mjs --test src/lib/auteur/director/director.test.ts
import { register } from "node:module";

register("./ts-test-resolver.mjs", import.meta.url);
