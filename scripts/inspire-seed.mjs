#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Draws Image Studio › Inspire's starter set on the owner's own GPU.
//
//   node scripts/inspire-seed.mjs            draw every seed that has no file yet
//   node scripts/inspire-seed.mjs --force    draw them all again
//   node scripts/inspire-seed.mjs seed-koi-tee seed-ramen   just these
//
// Each image is drawn from the exact prompt in src/lib/image-studio/inspire/seed.ts
// with Flux 2 Klein on WanGP (tools/wangp-image, port 3391), so the prompt shown
// under a starter image is genuinely the one that made it. Free: no key, no
// account. Writes public/image-studio/inspire/seed/<id>.webp, <id>-thumb.webp
// and the tint list src/lib/image-studio/inspire/seed-tints.json.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { SEED, seedSize } from "../src/lib/image-studio/inspire/seed.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public", "image-studio", "inspire", "seed");
const TINTS = path.join(ROOT, "src", "lib", "image-studio", "inspire", "seed-tints.json");
const DRAWER = process.env.WANGP_IMAGE_URL || "http://127.0.0.1:3391";

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = new Set(args.filter((a) => !a.startsWith("--")));

mkdirSync(OUT, { recursive: true });
const tints = existsSync(TINTS) ? JSON.parse(readFileSync(TINTS, "utf8")) : {};

const health = await fetch(`${DRAWER}/health`).then((r) => r.json()).catch(() => null);
if (!health?.ok) {
  console.error(`The WanGP drawer is not answering at ${DRAWER}. Start tools/wangp-image/server.mjs (or WanGP in Pinokio) first.`);
  process.exit(2);
}

let drawn = 0;
for (const [i, s] of SEED.entries()) {
  if (only.size && !only.has(s.id)) continue;
  const full = path.join(OUT, `${s.id}.webp`);
  if (!force && existsSync(full) && tints[s.id]) continue;
  const { width, height } = seedSize(s.aspect);
  const started = Date.now();
  process.stdout.write(`[${i + 1}/${SEED.length}] ${s.id} ${width}x${height} … `);
  let data = null;
  for (let attempt = 0; attempt < 30 && !data; attempt++) {
    const res = await fetch(`${DRAWER}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: s.prompt, width, height, steps: 4, seed: 7000 + i, fresh: force }),
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 10_000));
      continue;
    }
    if (!json.ok) {
      console.log(`failed: ${json.error ?? res.status}`);
      break;
    }
    data = json;
  }
  if (!data) continue;
  const png = Buffer.from(data.image.split(",")[1], "base64");
  await sharp(png).webp({ quality: 82 }).toFile(full);
  await sharp(png).resize({ width: 480 }).webp({ quality: 74 }).toFile(path.join(OUT, `${s.id}-thumb.webp`));
  const { dominant } = await sharp(png).stats();
  tints[s.id] = `rgb(${dominant.r} ${dominant.g} ${dominant.b})`;
  writeFileSync(TINTS, JSON.stringify(tints, null, 2) + "\n");
  drawn++;
  console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
}
console.log(`Drew ${drawn} image${drawn === 1 ? "" : "s"}.`);
