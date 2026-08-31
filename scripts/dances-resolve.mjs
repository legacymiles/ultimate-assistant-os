// ---------------------------------------------------------------------------
// Regenerate src/lib/dances/seed.generated.ts.
//
//   node scripts/dances-resolve.mjs           resolve every unresolved name
//   node scripts/dances-resolve.mjs --all     re-resolve everything from scratch
//   node scripts/dances-resolve.mjs --name X  re-resolve one dance
//
// Reads the editorial list from seed.names.ts, resolves each name to a
// verified playable video through the same gate the app uses at runtime, and
// writes the result as a committed TypeScript file. The app therefore ships
// with real videos and does zero resolution at runtime.
//
// Names that resolve to nothing are reported and DROPPED. Shipping an empty
// tile is the one outcome this script exists to prevent.
//
// Node 24 strips TypeScript natively, so the .ts sources import directly.
// ---------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { SEED_NAMES } from "../src/lib/dances/seed.names.ts";
import { danceQuery, resolveVideo } from "../src/lib/dances/resolve.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src/lib/dances/seed.generated.ts");

const args = process.argv.slice(2);
const only = args.includes("--name") ? args[args.indexOf("--name") + 1] : null;
const redoAll = args.includes("--all");

/** Keep videos we already verified unless asked to redo them. */
async function existing() {
  if (redoAll) return new Map();
  try {
    const mod = await import(path.join(ROOT, "src/lib/dances/seed.generated.ts"));
    return new Map(mod.GENERATED_SEED.map((d) => [d.name, d]));
  } catch {
    return new Map();
  }
}

const prior = await existing();
const used = new Set();
for (const d of prior.values()) if (d.video?.ref) used.add(d.video.ref);

const resolved = [];
const failed = [];

for (const seed of SEED_NAMES) {
  const keep = prior.get(seed.name);
  const skip = keep?.video && !(only ? seed.name === only : false);
  if (skip) {
    resolved.push({ ...seed, video: keep.video });
    continue;
  }
  if (only && seed.name !== only) {
    if (keep) resolved.push(keep);
    continue;
  }

  const query = seed.query ?? danceQuery(seed.name);
  process.stdout.write(`  ${seed.name.padEnd(28)} `);
  const video = await resolveVideo(query, { exclude: used });
  if (video) {
    used.add(video.ref);
    resolved.push({ ...seed, video });
    console.log(`ok  ${video.ref}  ${video.channel}`);
  } else {
    failed.push(seed.name);
    console.log("NO PLAYABLE MATCH — dropped");
  }
  // Be a polite scraper. This is someone else's search page.
  await new Promise((r) => setTimeout(r, 400));
}

const body = resolved.map((d) => {
  const { query: _q, ...rest } = d;
  return rest;
});

const header = `// ---------------------------------------------------------------------------
// GENERATED FILE — do not edit by hand.
//
// Written by scripts/dances-resolve.mjs. Every entry below passed the same
// three-stage gate the app uses at runtime: YouTube search, keyless oEmbed,
// and a playableInEmbed check. Names that resolved to nothing playable were
// dropped rather than shipped as empty tiles.
//
// Regenerate with:  node scripts/dances-resolve.mjs --all
//
// Resolved ${body.length}/${SEED_NAMES.length} names.
// ---------------------------------------------------------------------------

import type { SeedDance } from "./seed.names";
import type { DanceVideo } from "./types";

export interface GeneratedDance extends Omit<SeedDance, "query"> {
  video: DanceVideo;
}

export const GENERATED_SEED: GeneratedDance[] = `;

await writeFile(OUT, header + JSON.stringify(body, null, 2) + ";\n", "utf8");

console.log(`\nResolved ${body.length}/${SEED_NAMES.length} → ${path.relative(ROOT, OUT)}`);
if (failed.length) console.log(`Dropped (no playable match): ${failed.join(", ")}`);
