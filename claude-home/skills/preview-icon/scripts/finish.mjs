#!/usr/bin/env node
// finish.mjs — raw generation -> grid-ready asset.
//
//   node scripts/finish.mjs work/plan.json --public "<repo>/public/hub/icons"
//   node scripts/finish.mjs work/plan.json --only music-creator
//
// Per clip: find the most loopable window, centre-crop square, crossfade the seam, compress to a
// size a grid can actually load, cut the poster, and render a 200px read-test frame.
//
// ffmpeg and ffprobe are vendored in this skill's node_modules (ffmpeg-static / ffprobe-static),
// so nothing has to be installed globally. `npm i` in the skill directory restores them.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.dirname(HERE);
const require = createRequire(import.meta.url);

let FFMPEG, FFPROBE;
try {
  FFMPEG = require('ffmpeg-static');
  FFPROBE = require('ffprobe-static').path;
} catch {
  console.error('ffmpeg-static / ffprobe-static missing. Run `npm i` inside ' + SKILL);
  process.exit(2);
}

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };

// Output contract (see SKILL.md). WINDOW - XFADE = the delivered duration.
const SIZE = 512;
const WINDOW = 3.0;
const XFADE = 0.5;
const OUT_SECONDS = WINDOW - XFADE;   // 2.5s
const MAX_KB = 400;
const POSTER_MAX_KB = 40;

const run = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const quiet = (args) => { try { run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args]); return true; } catch (e) { console.error(String(e.stderr || e.message).slice(0, 400)); return false; } };

function probe(file) {
  const out = run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,duration', '-show_entries', 'format=duration',
    '-of', 'json', file]);
  const j = JSON.parse(out);
  const s = j.streams?.[0] || {};
  return {
    width: Number(s.width) || 0,
    height: Number(s.height) || 0,
    duration: Number(s.duration) || Number(j.format?.duration) || 0,
  };
}

// How well would the clip loop if cut at `start`? Compare the frame there with the frame one
// window later: the closer they are, the less visible the wrap. Generated clips almost always
// have one clean stretch and some drift, which is the whole reason to ask for 5s and pick 3.
function loopScore(file, start) {
  const a = path.join(SKILL, 'work', '.tmp-a.png');
  const b = path.join(SKILL, 'work', '.tmp-b.png');
  if (!quiet(['-ss', String(start), '-i', file, '-frames:v', '1', a])) return -1;
  if (!quiet(['-ss', String(start + WINDOW), '-i', file, '-frames:v', '1', b])) return -1;
  try {
    const out = execFileSync(FFMPEG, ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const m = (out + '').match(/All:([\d.]+)/);
    return m ? Number(m[1]) : -1;
  } catch (e) {
    const m = String(e.stderr || '').match(/All:([\d.]+)/);
    return m ? Number(m[1]) : -1;
  } finally {
    for (const f of [a, b]) { try { fs.unlinkSync(f); } catch {} }
  }
}

function bestStart(file, duration) {
  const latest = duration - WINDOW;
  if (latest <= 0.05) return 0;
  let best = { start: 0, score: -1 };
  for (let s = 0; s <= latest + 1e-6; s += 0.25) {
    const score = loopScore(file, Math.round(s * 100) / 100);
    if (score > best.score) best = { start: Math.round(s * 100) / 100, score };
  }
  return best.start;
}

// Square centre-crop, scale, then blend the tail over the head so the wrap is invisible.
// Output length is WINDOW - XFADE: the blended seam plus the untouched body.
function filterGraph(start) {
  const crop = `crop='min(iw,ih)':'min(iw,ih)',scale=${SIZE}:${SIZE}:flags=lanczos,fps=24,setsar=1`;
  const s = start;
  return [
    `[0:v]${crop},split=3[c1][c2][c3]`,
    `[c1]trim=${s}:${s + XFADE},setpts=PTS-STARTPTS[head]`,
    `[c2]trim=${s + WINDOW - XFADE}:${s + WINDOW},setpts=PTS-STARTPTS[tail]`,
    `[c3]trim=${s + XFADE}:${s + WINDOW - XFADE},setpts=PTS-STARTPTS[body]`,
    `[tail][head]blend=all_expr='A*(1-T/${XFADE})+B*(T/${XFADE})'[seam]`,
    `[seam][body]concat=n=2:v=1:a=0[out]`,
  ].join(';');
}

function encode(src, dst, start) {
  // Walk CRF up until the file fits the grid budget. Quality loss at 512px is slight; a grid that
  // will not load is not.
  for (const crf of [26, 30, 34, 38]) {
    const okRun = quiet(['-i', src, '-filter_complex', filterGraph(start), '-map', '[out]',
      '-an', '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
      '-crf', String(crf), '-preset', 'slow', '-movflags', '+faststart',
      '-t', String(OUT_SECONDS), dst]);
    if (!okRun) return null;
    const kb = fs.statSync(dst).size / 1024;
    if (kb <= MAX_KB || crf === 38) return { crf, kb: Math.round(kb) };
  }
  return null;
}

function poster(src, dst) {
  for (const q of [80, 68, 55, 42]) {
    if (!quiet(['-i', src, '-frames:v', '1', '-c:v', 'libwebp', '-quality', String(q), dst])) return null;
    const kb = fs.statSync(dst).size / 1024;
    if (kb <= POSTER_MAX_KB || q === 42) return { q, kb: Math.round(kb) };
  }
  return null;
}

// --- main -------------------------------------------------------------------------------------
const planPath = path.resolve(process.argv[2] || path.join(SKILL, 'work', 'plan.json'));
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const publicDir = arg('--public');
const outDir = publicDir ? path.resolve(publicDir) : path.join(SKILL, 'work', 'out');
const readDir = path.join(SKILL, 'work', 'readtest');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(readDir, { recursive: true });
fs.mkdirSync(path.join(SKILL, 'work'), { recursive: true });

let items = plan.items.filter((i) => i.raw);
const only = arg('--only');
if (only) {
  const want = new Set(only.split(',').map((s) => s.trim()));
  items = items.filter((i) => want.has(i.slug));
}
if (!items.length) { console.log('No rendered clips in the plan. Run render.mjs first.'); process.exit(0); }

const rows = [];
for (const item of items) {
  const src = path.join(SKILL, item.raw);
  if (!fs.existsSync(src)) { console.log(`${item.slug}: raw clip missing, skipped`); continue; }

  const info = probe(src);
  if (info.duration < WINDOW) {
    console.log(`${item.slug}: source is ${info.duration.toFixed(1)}s, shorter than the ${WINDOW}s window — skipped`);
    continue;
  }

  const start = bestStart(src, info.duration);
  const mp4 = path.join(outDir, `${item.slug}.mp4`);
  const webp = path.join(outDir, `${item.slug}.webp`);

  const enc = encode(src, mp4, start);
  if (!enc) { console.log(`${item.slug}: encode failed`); continue; }
  const pos = poster(mp4, webp);
  quiet(['-ss', String(OUT_SECONDS / 2), '-i', mp4, '-frames:v', '1',
    '-vf', 'scale=200:200:flags=lanczos', path.join(readDir, `${item.slug}-200.png`)]);

  const pi = plan.items.find((i) => i.slug === item.slug);
  pi.output = { src: `/hub/icons/${item.slug}.mp4`, poster: `/hub/icons/${item.slug}.webp` };
  pi.loopStart = start;
  rows.push({ slug: item.slug, start, kb: enc.kb, crf: enc.crf, posterKb: pos ? pos.kb : '-' });
  console.log(`${item.slug.padEnd(24)} loop@${String(start).padEnd(5)} ${String(enc.kb).padStart(4)}KB (crf ${enc.crf})  poster ${pos ? pos.kb : '?'}KB`);
}

fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

const over = rows.filter((r) => r.kb > MAX_KB);
console.log(`\nFinished ${rows.length} icon(s) -> ${outDir}`);
if (over.length) console.log(`Over the ${MAX_KB}KB budget even at crf 38: ${over.map((r) => r.slug).join(', ')} — simplify the shot.`);
console.log(`Read test frames in ${readDir} — judge the icons there, not at full size.`);
console.log('\nCatalog lines to add:');
for (const r of rows) {
  console.log(`  ${r.slug}: previewIcon: { src: "/hub/icons/${r.slug}.mp4", poster: "/hub/icons/${r.slug}.webp" },`);
}
