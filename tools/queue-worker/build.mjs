// Bundle the 24/7 Queue worker (src/lib/queue247/worker/main.ts) and every
// executor it runs into ONE file, dist/worker.mjs, that needs only Node 22+.
// Path aliases (@/…) come from the root tsconfig; "server-only" and
// next/server are swapped for tiny shims because the worker is not Next.js.
//
//   node tools/queue-worker/build.mjs
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
let version = "dev";
try {
  version = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
} catch {}

await build({
  entryPoints: {
    worker: path.join(root, "src/lib/queue247/worker/main.ts"),
    cli: path.join(root, "src/lib/queue247/worker/cli.ts"),
  },
  outdir: path.join(here, "dist"),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  tsconfig: path.join(root, "tsconfig.json"),
  alias: {
    "server-only": path.join(here, "shims/empty.mjs"),
    "next/server": path.join(here, "shims/next-server.mjs"),
  },
  define: { "process.env.QUEUE_WORKER_VERSION": JSON.stringify(version) },
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
});
console.log(`built dist/worker.mjs + dist/cli.mjs (${version})`);
