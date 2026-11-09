#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Build the standalone EA Lab page into tools/ea-lab-runner/ui/.
//
//   node tools/ea-lab-runner/build-ui.mjs      (run on the PC, inside the repo)
//
// The output is committed, so the VPS needs only Node and this folder - no
// npm install, no hub. Rebuild after changing anything under
// src/components/ea-lab or src/lib/ea-lab.
//
// The colour tokens are read out of src/app/globals.css at build time rather
// than copied, so the VPS page and the hub page can never drift apart.
// ---------------------------------------------------------------------------

import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const OUT = join(HERE, "ui");
mkdirSync(OUT, { recursive: true });

// ----- script ---------------------------------------------------------------
await build({
  entryPoints: [join(HERE, "ui-src", "main.tsx")],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2020",
  jsx: "automatic",
  outfile: join(OUT, "app.js"),
  alias: { "@": join(REPO, "src") },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
  // "use client" means nothing outside Next; it is safe to drop.
  logOverride: { "unsupported-directive": "silent" },
});

// ----- styles ---------------------------------------------------------------
const globals = readFileSync(join(REPO, "src", "app", "globals.css"), "utf8");
const theme = globals.match(/@theme\s*\{[\s\S]*?\n\}/)?.[0];
if (!theme) throw new Error("could not find the @theme block in src/app/globals.css");

const rel = (p) => join(REPO, p).replace(/\\/g, "/");
const source = `
@import "tailwindcss" source(none);
@source "${rel("src/components/ea-lab")}";
@source "${rel("src/lib/ea-lab")}";
${theme}
html, body { margin: 0; padding: 0; height: 100%; }
body {
  background: var(--color-canvas);
  color: var(--color-ink);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  color-scheme: dark;
}
`;
const css = await postcss([tailwind({ base: REPO, optimize: { minify: true } })])
  .process(source, { from: join(HERE, "ui-src", "app.css") });
writeFileSync(join(OUT, "app.css"), css.css);

// ----- page -----------------------------------------------------------------
writeFileSync(join(OUT, "index.html"), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EA Lab</title>
<meta name="description" content="Upload a MetaTrader Expert Advisor and it is backtested headless on this machine.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%236366f1'/%3E%3Cpath d='M7 22l6-7 4 4 8-10' stroke='white' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="root"></div>
<noscript>EA Lab needs JavaScript.</noscript>
<script type="module" src="/app.js"></script>
</body>
</html>
`);

const kb = (f) => Math.round(readFileSync(join(OUT, f)).length / 1024);
console.log(`built ui/  app.js ${kb("app.js")} KB · app.css ${kb("app.css")} KB`);
