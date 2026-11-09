// ---------------------------------------------------------------------------
// Downloads the webfonts this site uses into public/fonts/, once, by hand.
//
//   node scripts/fetch-fonts.mjs             # fetch anything missing
//   node scripts/fetch-fonts.mjs --force     # re-fetch everything
//   node scripts/fetch-fonts.mjs --check     # fail if a declared file is missing
//
// This is NOT part of the build, and must never become part of it. That is the
// whole point.
//
// Why: the site used `next/font/google`, which fetches font CSS and font files
// from Google *while compiling*. That made every build depend on a third-party
// request, and the failure mode was vicious — Next's loader threw
// `TypeError: Cannot read properties of null (reading '1')` naming a random app
// page, with no mention of fonts or the network. It failed roughly half the time
// on 2026-11-07, in a clean clone as readily as in a working checkout, which
// makes a repo nobody else can reliably build.
//
// So the files live in the repo and `next/font/local` reads them off disk. The
// build is now offline and deterministic. Run this script only to add a family
// or pick up an upstream revision, and commit what it writes.
//
// Only the `latin` subset is taken, because every call site asked for exactly
// `subsets: ["latin"]` — so this is byte-for-byte the same coverage the site
// already had, not a reduction.
// ---------------------------------------------------------------------------

import { writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(root, "public", "fonts");

// A modern desktop Chrome, so Google serves woff2 rather than ttf.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Each entry is one file in public/fonts/.
 *
 * `axis` is the css2 `wght` spec. A range (`200..800`) gets the single variable
 * font covering it, which is why most families are one file; a bare number gets
 * that static weight, for the families Google has no variable version of.
 *
 * The `weight` field is what `next/font/local` must be told, and it has to
 * match the file: a variable font takes the range as a string, a static file
 * takes its single weight.
 */
const FONTS = [
  // Variable — one file each, covering every weight the site asks for.
  { file: "jetbrains-mono-variable.woff2", family: "JetBrains Mono", axis: "100..800", weight: "100 800" },
  { file: "oxanium-variable.woff2", family: "Oxanium", axis: "200..800", weight: "200 800" },
  { file: "syne-variable.woff2", family: "Syne", axis: "400..800", weight: "400 800" },
  { file: "inter-variable.woff2", family: "Inter", axis: "100..900", weight: "100 900" },
  { file: "space-grotesk-variable.woff2", family: "Space Grotesk", axis: "300..700", weight: "300 700" },

  // Static only upstream. Chakra Petch is used at 500/600/700, so three files.
  { file: "chakra-petch-500.woff2", family: "Chakra Petch", axis: "500", weight: "500" },
  { file: "chakra-petch-600.woff2", family: "Chakra Petch", axis: "600", weight: "600" },
  { file: "chakra-petch-700.woff2", family: "Chakra Petch", axis: "700", weight: "700" },
  { file: "archivo-black-400.woff2", family: "Archivo Black", axis: "400", weight: "400" },
  { file: "instrument-serif-400.woff2", family: "Instrument Serif", axis: "400", weight: "400" },
];

/**
 * Geist ships its own files in the `geist` npm package, so it is copied rather
 * than downloaded — but it still belongs in public/fonts/, so the repo does not
 * depend on a node_modules path resolving at build time.
 */
const COPIES = [
  { file: "geist-variable.woff2", from: "geist/dist/fonts/geist-sans/Geist-Variable.woff2" },
  { file: "geist-mono-variable.woff2", from: "geist/dist/fonts/geist-mono/GeistMono-Variable.woff2" },
];

const cssUrl = ({ family, axis }) =>
  `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${axis}&display=swap`;

/** The `latin` @font-face block's woff2 URL, and nothing else. */
function latinWoff2From(css, family) {
  // Google labels each block with a subset comment above it.
  const blocks = css.split("/*").slice(1);
  for (const block of blocks) {
    const subset = block.slice(0, block.indexOf("*/")).trim();
    if (subset !== "latin") continue;
    const url = /src: url\((https:\/\/[^)]+\.woff2)\)/.exec(block)?.[1];
    if (url) return url;
  }
  throw new Error(
    `No latin woff2 in the CSS for ${family}. Google's response shape may have changed; ` +
      `fetch ${cssUrl({ family, axis: "400" })} and look.`,
  );
}

async function get(url, accept) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

const force = process.argv.includes("--force");
const check = process.argv.includes("--check");

if (check) {
  const missing = [...FONTS, ...COPIES]
    .map((f) => f.file)
    .filter((file) => {
      const path = join(OUT_DIR, file);
      return !existsSync(path) || statSync(path).size === 0;
    });
  if (missing.length) {
    console.error(
      `public/fonts/ is missing ${missing.length} file(s):\n  ${missing.join("\n  ")}\n` +
        `Run: node scripts/fetch-fonts.mjs`,
    );
    process.exit(1);
  }
  console.log(`public/fonts/ has all ${FONTS.length + COPIES.length} font files.`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });

let fetched = 0;
let copied = 0;
let skipped = 0;

for (const font of FONTS) {
  const dest = join(OUT_DIR, font.file);
  if (!force && existsSync(dest) && statSync(dest).size > 0) {
    skipped++;
    continue;
  }
  const css = await (await get(cssUrl(font), "text/css,*/*")).text();
  const url = latinWoff2From(css, font.family);
  const buf = Buffer.from(await (await get(url, "font/woff2,*/*")).arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`  ${font.file.padEnd(32)} ${(buf.length / 1024).toFixed(1)} KB  ${url}`);
  fetched++;
}

for (const copy of COPIES) {
  const dest = join(OUT_DIR, copy.file);
  if (!force && existsSync(dest) && statSync(dest).size > 0) {
    skipped++;
    continue;
  }
  const src = join(root, "node_modules", copy.from);
  if (!existsSync(src)) {
    throw new Error(`${copy.from} is not installed. Run npm ci first.`);
  }
  const { copyFileSync } = await import("node:fs");
  copyFileSync(src, dest);
  console.log(`  ${copy.file.padEnd(32)} copied from ${copy.from}`);
  copied++;
}

console.log(
  `public/fonts/: ${fetched} downloaded, ${copied} copied from node_modules, ${skipped} already present.`,
);
