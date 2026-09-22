#!/usr/bin/env node
// render.mjs — plan -> still -> clip, on the owner's own infrastructure.
//
//   Stage 1  OpenRouter image model      -> work/stills/<slug>.png
//   Stage 2  MiniMax H3 on the owner's   -> work/raw/<slug>.mp4
//            RunPod endpoint, animating
//            that still as first_frame
//
//   node scripts/render.mjs work/plan.json --only music-creator
//   node scripts/render.mjs work/plan.json --stills-only        # cheap, review before animating
//   node scripts/render.mjs work/plan.json --video-only --confirm
//   node scripts/render.mjs work/plan.json --confirm --full     # 768p instead of draft
//
// Both stages are separately resumable. That split is the point: stills are pennies and arrive in
// seconds, video costs real money and minutes, so the still is where a bad shot gets caught. Judge
// work/stills/<slug>-200.png first — if the icon does not read there, no amount of motion saves it.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.dirname(HERE);
const require = createRequire(import.meta.url);
const HUB_ENV = 'C:/Users/honey/OneDrive/Desktop/claude code files/.env.local';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- keys ---------------------------------------------------------------------------------------
// Horizontal whitespace only: \s would match the newline and swallow the next line when a key is
// left blank, which turns an empty value into whatever comment follows it.
function envKey(name) {
  if (process.env[name]?.trim()) return process.env[name].trim();
  const files = [path.join(process.cwd(), '.env.local'), HUB_ENV];
  for (const f of files) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(new RegExp(`^[ \\t]*${name}[ \\t]*=[ \\t]*["']?([^"'\\r\\n]*)`, 'm'));
      const v = m && m[1].trim();
      if (v) return v;
    } catch {}
  }
  return null;
}

const IMAGE_MODEL = arg('--image-model', 'google/gemini-3.1-flash-image');

// --- stage 1: the still, on OpenRouter ------------------------------------------------------------
async function makeStill(item, key) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://claude.ai/code',
      'X-Title': 'preview-icon',
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      messages: [{ role: 'user', content: [{ type: 'text', text: item.stillPrompt }] }],
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: '1:1' },
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const msg = json?.choices?.[0]?.message ?? {};

  // Models disagree on where the image lands: some use message.images[], some inline it into a
  // content array. Check both rather than assume one.
  let url = msg.images?.[0]?.image_url?.url;
  if (!url && Array.isArray(msg.content)) {
    url = msg.content.find((p) => p?.type === 'image_url')?.image_url?.url;
  }
  if (!url) {
    const text = typeof msg.content === 'string' ? msg.content : '';
    throw new Error(`no image returned${text ? ` — model said: ${text.slice(0, 160)}` : ''}`);
  }
  const m = url.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!m) throw new Error('image was not a data URL');
  return { buffer: Buffer.from(m[3], 'base64'), mime: m[1] };
}

// --- stage 2: the motion, on the owner's RunPod H3 endpoint --------------------------------------
async function makeClip(item, still, { key, endpoint, full }) {
  const base = `https://api.runpod.ai/v2/${endpoint}`;
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const input = {
    prompt: item.prompt,
    first_frame: `data:${still.mime};base64,${still.buffer.toString('base64')}`,
    duration: item.duration || 5,
    aspect_ratio: '1:1',
    resolution: full ? '768p' : '480p',
    turbo: true,
  };

  const sub = await fetch(`${base}/run`, { method: 'POST', headers, body: JSON.stringify({ input }) });
  if (!sub.ok) throw new Error(`RunPod submit ${sub.status}: ${(await sub.text()).slice(0, 200)}`);
  const { id } = await sub.json();
  if (!id) throw new Error('RunPod returned no job id');

  // Cold start is ~86s (44.5GB of weights), so silence early on is normal. Surface the worker's
  // own progress notes instead of printing nothing for two minutes.
  const deadline = Date.now() + 20 * 60_000;
  let lastNote = '';
  while (Date.now() < deadline) {
    await sleep(4000);
    const r = await fetch(`${base}/status/${id}`, { headers });
    if (!r.ok) continue;
    const d = await r.json();
    const note = d.output?.note || (Array.isArray(d.stream) ? d.stream.at(-1)?.output?.note : '') || '';
    if (note && note !== lastNote) { lastNote = note; process.stdout.write(`      ${note}\n`); }
    if (d.status === 'COMPLETED') {
      const out = d.output || {};
      if (out.error) throw new Error(out.error);
      if (out.video_base64) return Buffer.from(out.video_base64, 'base64');
      if (out.video_url) {
        const v = await fetch(out.video_url);
        if (!v.ok) throw new Error(`could not fetch video_url (${v.status})`);
        return Buffer.from(await v.arrayBuffer());
      }
      throw new Error('completed but returned no video');
    }
    if (d.status === 'FAILED' || d.status === 'CANCELLED') {
      throw new Error(`RunPod ${d.status}: ${JSON.stringify(d.error || d.output || {}).slice(0, 200)}`);
    }
  }
  throw new Error('timed out after 20 minutes');
}

// --- main ------------------------------------------------------------------------------------------
const planPath = path.resolve(process.argv[2] || path.join(SKILL, 'work', 'plan.json'));
if (!fs.existsSync(planPath)) { console.error(`No plan at ${planPath}. Run plan.mjs first.`); process.exit(2); }
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

const stillsOnly = has('--stills-only');
const videoOnly = has('--video-only');
const full = has('--full');
const stillsDir = path.join(SKILL, 'work', 'stills');
const rawDir = path.join(SKILL, 'work', 'raw');
fs.mkdirSync(stillsDir, { recursive: true });
fs.mkdirSync(rawDir, { recursive: true });

let items = plan.items;
const only = arg('--only');
if (only) {
  const want = new Set(only.split(',').map((s) => s.trim()));
  items = items.filter((i) => want.has(i.slug));
}
const blocked = items.filter((i) => i.needsSubject || !i.prompt);
if (blocked.length) {
  console.error(`Skipping ${blocked.length} item(s) with no subject: ${blocked.map((b) => b.slug).join(', ')}`);
  console.error('Add subjects to references/overrides.json and re-run plan.mjs.\n');
  items = items.filter((i) => !i.needsSubject && i.prompt);
}
if (!items.length) { console.log('Nothing to render.'); process.exit(0); }

const orKey = envKey('OPENROUTER_API_KEY');
const rpKey = envKey('RUNPOD_API_KEY');
const rpEndpoint = envKey('RUNPOD_ENDPOINT_ID');
if (!videoOnly && !orKey) { console.error('OPENROUTER_API_KEY not found in .env.local.'); process.exit(2); }
if (!stillsOnly && (!rpKey || !rpEndpoint)) {
  console.error('RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID are both needed in .env.local for the video stage.');
  process.exit(2);
}

// The video stage is the one that costs real money and worker minutes.
const needVideo = stillsOnly ? [] : items.filter((i) => !fs.existsSync(path.join(rawDir, `${i.slug}.mp4`)));
if (needVideo.length > 5 && !has('--confirm')) {
  const each = full ? 0.05 : 0.023;
  console.error(`\n${needVideo.length} clips would render on your RunPod endpoint`);
  console.error(`(~$${(needVideo.length * each).toFixed(2)} at the measured ${full ? '768p' : '480p draft'} rate, plus one cold start).`);
  console.error('Run --stills-only first and look at work/stills/*-200.png, then re-run with --confirm.');
  process.exit(3);
}

let ffmpeg = null;
try { ffmpeg = require('ffmpeg-static'); } catch {}

let stills = 0; let clips = 0; let failed = 0;
for (const [n, item] of items.entries()) {
  const stillPath = path.join(stillsDir, `${item.slug}.png`);
  const rawPath = path.join(rawDir, `${item.slug}.mp4`);
  const planItem = plan.items.find((i) => i.slug === item.slug);
  console.log(`\n[${n + 1}/${items.length}] ${item.slug}  (${item.archetype})`);

  let still = null;
  try {
    if (fs.existsSync(stillPath) && !has('--restill')) {
      still = { buffer: fs.readFileSync(stillPath), mime: 'image/png' };
      console.log('  still  cached');
    } else if (!videoOnly) {
      process.stdout.write(`  still  ${IMAGE_MODEL} ... `);
      still = await makeStill(item, orKey);
      fs.writeFileSync(stillPath, still.buffer);
      // The 200px copy is the read test, available before a cent is spent on motion.
      if (ffmpeg) {
        try {
          execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', stillPath,
            '-vf', 'scale=200:200:flags=lanczos', path.join(stillsDir, `${item.slug}-200.png`)]);
        } catch {}
      }
      console.log(`ok (${Math.round(still.buffer.length / 1024)}KB)`);
      planItem.still = `work/stills/${item.slug}.png`;
      stills++;
    }
  } catch (e) {
    console.log(`failed — ${e.message}`);
    planItem.error = `still: ${e.message}`.slice(0, 500);
    failed++;
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
    continue;
  }

  if (stillsOnly) continue;
  if (fs.existsSync(rawPath)) { console.log('  clip   cached'); continue; }
  if (!still) { console.log('  clip   skipped (no still)'); continue; }

  try {
    console.log(`  clip   H3 on RunPod (${full ? '768p' : '480p draft'}) ...`);
    const video = await makeClip(item, still, { key: rpKey, endpoint: rpEndpoint, full });
    fs.writeFileSync(rawPath, video);
    planItem.raw = `work/raw/${item.slug}.mp4`;
    planItem.renderedAt = new Date().toISOString();
    planItem.engineUsed = `h3-runpod-${full ? '768p' : '480p'}`;
    delete planItem.error;
    console.log(`         ok (${Math.round(video.length / 1024)}KB)`);
    clips++;
  } catch (e) {
    console.log(`         failed — ${e.message}`);
    planItem.error = `clip: ${e.message}`.slice(0, 500);
    failed++;
  }
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
}

console.log(`\nStills ${stills}, clips ${clips}, failed ${failed}.`);
if (stillsOnly) {
  console.log(`Review work/stills/*-200.png. Icons that read there are worth animating:`);
  console.log(`  node scripts/render.mjs ${path.relative(SKILL, planPath).replace(/\\/g, '/')} --confirm`);
} else if (clips) {
  console.log(`Next: node scripts/finish.mjs ${path.relative(SKILL, planPath).replace(/\\/g, '/')}`);
}
