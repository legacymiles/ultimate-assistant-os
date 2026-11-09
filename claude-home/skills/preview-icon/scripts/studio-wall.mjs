#!/usr/bin/env node
// studio-wall.mjs — the looping clip behind each of the seven Jarvis Studio cards.
//
// A third variant alongside plan/render (square hub icons) and studio-cards.mjs
// (3:4 workflow posters), for the same reason those two are separate: the
// geometry is different and the subject is different, while the discipline is
// identical. These cards are 9:15 PORTRAIT panels on a monitor wall, and there
// are only seven of them, so each one is looked at properly rather than scanned
// past — the subject is the VERB the whole studio performs, one level up from a
// single workflow's output.
//
// Free tier end to end. The still comes from OpenRouter (pennies); the motion is
// ffmpeg on that still, which is all these shots need because every move was
// chosen to be one the still already contains — a push, a drift, a light sweep.
// Nothing here calls a video model, so nothing here needs RunPod.
//
// The loop is a PING-PONG: the move runs out and then runs back. That is
// seamless by construction rather than by crossfading a one-way ramp over its
// own head, which is what the square pipeline has to do with generated footage
// and which always leaves a soft ghost at the seam.
//
//   node scripts/studio-wall.mjs --only video        # render one, LOOK at it
//   node scripts/studio-wall.mjs --confirm           # the other six (resumable)
//   node scripts/studio-wall.mjs --finish            # re-cut clips from existing stills
//   node scripts/studio-wall.mjs --print-prompt      # show prompts, spend nothing
//
// Resumable: a still already in work/wall/still/ is never re-rendered, so an
// interrupted run costs nothing to resume.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');
const WORK = path.join(SKILL, 'work', 'wall');
const STILL = path.join(WORK, 'still');
const READ = path.join(WORK, 'readtest');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);

const only = arg('--only');
const publicDir = arg('--public', 'C:/dev/claude-code-files/public/studio');
const IMAGE_MODEL = arg('--image-model', 'google/gemini-3.1-flash-image');

// 9:15, the card's aspect. 576x960 hits it exactly and stays inside the budget
// a wall of seven has to load.
const W = Number(arg('--w', '576'));
const H = Number(arg('--h', '960'));
const HALF = 1.25;              // seconds out; the clip is twice this, ping-ponged
// 20, not 24. These are slow continuous moves with heavy film grain, and grain
// is the most expensive thing a compressor can be handed: at 24fps a portrait
// card lands over budget even at crf 35, and four fewer frames a second is
// invisible on a push while it is worth ~20% of the file.
const FPS = 20;
const BUDGET_KB = Number(arg('--budget', '500'));

const ffmpeg = require('ffmpeg-static');

// --- the house style, verbatim from references/house-style.md ---------------
const HOUSE = `Shot on a macro lens, shallow depth of field, single subject centred with generous empty margin. `
  + `Deep near-black background, no horizon, no set dressing. Lighting is a single soft key plus a hard `
  + `rim; the only colours in frame are the two named hues against black. High contrast, fine film `
  + `grain, no lens flare. Photoreal, physical materials, tactile surfaces. Tall vertical composition, `
  + `9:16 portrait, the subject running up the frame.`;

const NEVER = `Absolutely no text, letters, numbers, watermarks or logos. No interfaces, app windows, `
  + `browsers, screens, monitors, phones, buttons, menus or cursors. No human faces or hands.`;

// --- the seven ---------------------------------------------------------------
// `move` is the ffmpeg motion: the still already contains it, which is why none
// of these needs a video model. One per card, deliberately different, so seven
// panels on one wall do not read as seven identical push-ins.
const CARDS = [
  {
    id: 'video',
    title: 'Video Studio',
    light: 'a deep indigo key and a cold violet rim',
    move: 'push',
    subject:
      'A single long strip of 35mm motion picture film arcing up through the dark like a ribbon, '
      + 'its sprocket holes catching the light, each frame on the strip glowing faintly brighter '
      + 'than the last as if the image were igniting along its length',
  },
  {
    id: 'image',
    title: 'Image Studio',
    light: 'a cold cyan key and a pale teal rim',
    move: 'reveal',
    subject:
      'A single sheet of photographic paper lying in a shallow tray of developer, the liquid '
      + 'perfectly still, a photographic image resolving up out of the blank white paper from the '
      + 'bottom of the sheet toward the top, grain and tone emerging from nothing',
  },
  {
    id: 'audio',
    title: 'Audio Studio',
    light: 'an emerald key and a cold green rim',
    move: 'drift-up',
    subject:
      'A large vintage ribbon studio microphone standing in the dark, fine dust suspended in the '
      + 'beam of light across it, and a thin ribbon of waveform-shaped light blooming outward from '
      + 'the grille in concentric rings',
  },
  {
    id: 'music-video',
    title: 'Music Video Studio',
    light: 'a hot magenta key and a cold pink rim',
    move: 'spin',
    subject:
      'A black vinyl record turning on a turntable seen from a low angle, its grooves throwing '
      + 'hard specular light, and at the outer edge the grooves lifting away from the disc and '
      + 'unrolling upward into a strip of film frames',
  },
  {
    id: 'game',
    title: 'Game Creator Studio',
    light: 'a warm amber key and a hot orange rim',
    move: 'through',
    subject:
      'A tall hollow wireframe cage of glowing orange lines in the dark, solid stone and metal '
      + 'matter locking into place inside it from the floor upward, a landscape building itself '
      + 'into the empty frame block by block',
  },
  {
    id: 'personas',
    title: 'Personas Studio',
    light: 'a violet key and a cold lilac rim',
    move: 'fan',
    subject:
      'A tall vertical spindle in the dark holding a dozen identical blank enamel badges stacked '
      + 'like records, fanning open into a spiral staircase of discs, the topmost one lifting clear '
      + 'and turning to catch the rim light along its edge',
  },
  {
    id: 'money',
    title: 'Money Agent Studio',
    light: 'a brass amber key and a cold green rim',
    move: 'settle',
    subject:
      'A tall brass balance scale in the dark, one pan carrying a neat stack of coins, the beam '
      + 'coming to rest exactly level, and a pair of polished steel calipers closing slowly around '
      + 'the stack to measure it without touching the coins',
  },
];

const promptFor = (c) =>
  `${c.subject}, lit by ${c.light}. ${HOUSE} ${NEVER}`;

// --- the key ----------------------------------------------------------------
// Horizontal whitespace only: \s matches newlines, so an empty KEY= line would
// otherwise swallow whatever follows it and surface as a bad-header error much
// later on.
function envKey(name) {
  if (process.env[name]) return process.env[name];
  for (const f of ['C:/dev/claude-code-files/.env.local', path.join(SKILL, '.env')]) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(
        new RegExp(`^[ \\t]*${name}[ \\t]*=[ \\t]*["']?([^"'\\r\\n]*)`, 'm'),
      );
      const v = m && m[1].trim();
      if (v) return v;
    } catch {}
  }
  return null;
}

async function makeStill(card, key) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://claude.ai/code',
      'X-Title': 'preview-icon studio-wall',
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      messages: [{ role: 'user', content: [{ type: 'text', text: promptFor(card) }] }],
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: '9:16' },
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const msg = json?.choices?.[0]?.message ?? {};
  // Models disagree on where the image lands: some use message.images[], some
  // inline it into a content array. Check both rather than assume one.
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
  return Buffer.from(m[3], 'base64');
}

// --- the motion -------------------------------------------------------------
// Each move is expressed as a zoompan over the still. `d` is the frame count of
// ONE direction; the ping-pong doubles it. Oversampling to 2x the output width
// first is what keeps a pan from going soft at the edges of the crop.
function moveFilter(move, frames) {
  const z = (expr) => `zoompan=z='${expr}':d=${frames}:x='${X[move] ?? X.push}':y='${Y[move] ?? Y.push}'`
    + `:s=${W}x${H}:fps=${FPS}`;
  const X = {
    push: 'iw/2-(iw/zoom/2)',
    reveal: 'iw/2-(iw/zoom/2)',
    'drift-up': 'iw/2-(iw/zoom/2)',
    spin: 'iw/2-(iw/zoom/2)+(on/' + frames + ')*(iw*0.04)',
    through: 'iw/2-(iw/zoom/2)',
    fan: 'iw/2-(iw/zoom/2)-(on/' + frames + ')*(iw*0.03)',
    settle: 'iw/2-(iw/zoom/2)',
  };
  const Y = {
    // A push holds its centre; everything else travels, and the direction is
    // the one the subject is built to be read in.
    push: 'ih/2-(ih/zoom/2)',
    reveal: 'ih*0.62-(ih/zoom/2)-(on/' + frames + ')*(ih*0.20)',
    'drift-up': 'ih*0.60-(ih/zoom/2)-(on/' + frames + ')*(ih*0.16)',
    spin: 'ih/2-(ih/zoom/2)',
    through: 'ih*0.70-(ih/zoom/2)-(on/' + frames + ')*(ih*0.26)',
    fan: 'ih*0.40-(ih/zoom/2)+(on/' + frames + ')*(ih*0.14)',
    settle: 'ih*0.44-(ih/zoom/2)+(on/' + frames + ')*(ih*0.10)',
  };
  const ZOOM = {
    push: '1.0+0.12*on/' + frames,
    reveal: '1.14-0.10*on/' + frames,
    'drift-up': '1.06+0.06*on/' + frames,
    spin: '1.08',
    through: '1.02+0.20*on/' + frames,
    fan: '1.16-0.12*on/' + frames,
    settle: '1.10-0.06*on/' + frames,
  };
  return z(ZOOM[move] ?? ZOOM.push);
}

function cutClip(card, stillPath, dst) {
  const frames = Math.round(HALF * FPS);
  // Oversample, move, then ping-pong: forward, then the same frames reversed,
  // minus the duplicated hinge frames, so the wrap is exact rather than close.
  const filter = [
    `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,`
      // A light denoise before the move: it costs nothing visible on these
      // surfaces and gives the encoder grain it can actually spend bits on.
      + `crop=${W * 2}:${H * 2},hqdn3d=2:1.5:3:3,${moveFilter(card.move, frames)},setsar=1[fwd]`,
    `[fwd]split=2[a][b]`,
    `[b]reverse,trim=start_frame=1:end_frame=${frames - 1},setpts=PTS-STARTPTS[rev]`,
    `[a][rev]concat=n=2:v=1:a=0[out]`,
  ].join(';');

  const LADDER = [23, 26, 29, 32, 35, 38, 41];
  let last = LADDER[0];
  for (const crf of LADDER) {
    last = crf;
    execFileSync(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-loop', '1', '-t', String(HALF + 0.1), '-i', stillPath,
      '-filter_complex', filter, '-map', '[out]',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
      dst,
    ]);
    const kb = fs.statSync(dst).size / 1024;
    if (kb <= BUDGET_KB) return { kb, crf };
  }
  // Reporting the real crf, not a hardcoded one: an "over budget" line that
  // names the wrong setting sends you tuning a knob that was already at its
  // limit.
  return { kb: fs.statSync(dst).size / 1024, crf: last, over: true };
}

function poster(clip, dst) {
  execFileSync(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', clip, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '72', dst,
  ]);
}

function readTest(clip, dst) {
  // The read test is judged at the size the card is actually seen in the wall,
  // not at full size. A shot that only reads full size is too busy, and the fix
  // is fewer objects and a bigger subject rather than a better model.
  //
  // The middle of a ping-pong is its hinge — the far end of the move — which is
  // the frame worth judging, and it is HALF seconds in by construction. No
  // probe needed, and asking ffprobe cost a wrong-format error for a number
  // this file already knows.
  execFileSync(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', String(HALF), '-i', clip, '-frames:v', '1',
    '-vf', 'scale=260:-1:flags=lanczos', dst,
  ]);
}

// --- run --------------------------------------------------------------------
const todo = only ? CARDS.filter((c) => only.split(',').includes(c.id)) : CARDS;
if (todo.length === 0) {
  console.error(`No card matches --only ${only}. Ids: ${CARDS.map((c) => c.id).join(', ')}`);
  process.exit(1);
}

if (has('--print-prompt')) {
  for (const c of todo) console.log(`\n--- ${c.id} (${c.title}, move: ${c.move}) ---\n${promptFor(c)}`);
  process.exit(0);
}

for (const d of [STILL, READ, publicDir]) fs.mkdirSync(d, { recursive: true });

const needStill = todo.filter((c) => !fs.existsSync(path.join(STILL, `${c.id}.png`)));
if (!has('--finish') && needStill.length > 5 && !has('--confirm')) {
  console.error(
    `${needStill.length} stills would be generated (OpenRouter, pennies each).\n`
    + `Render ONE first and look at it: --only ${needStill[0].id}\n`
    + `Then pass --confirm for the batch.`,
  );
  process.exit(1);
}

const key = envKey('OPENROUTER_API_KEY');
if (!has('--finish') && needStill.length > 0 && !key) {
  console.error('OPENROUTER_API_KEY is not set, and these stills need it.');
  process.exit(1);
}

for (const card of todo) {
  const stillPath = path.join(STILL, `${card.id}.png`);
  process.stdout.write(`${card.id.padEnd(13)} `);

  if (!fs.existsSync(stillPath)) {
    if (has('--finish')) { console.log('no still yet — skipped'); continue; }
    try {
      process.stdout.write('still… ');
      fs.writeFileSync(stillPath, await makeStill(card, key));
      process.stdout.write(`ok (${Math.round(fs.statSync(stillPath).size / 1024)}KB) `);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      continue;
    }
  } else {
    process.stdout.write('still cached ');
  }

  const clip = path.join(publicDir, `${card.id}.mp4`);
  try {
    const { kb, crf, over } = cutClip(card, stillPath, clip);
    poster(clip, path.join(publicDir, `${card.id}.webp`));
    readTest(clip, path.join(READ, `${card.id}-260.png`));
    console.log(`→ ${card.id}.mp4 ${kb.toFixed(0)}KB crf${crf}${over ? ' (OVER BUDGET)' : ''}`);
  } catch (err) {
    console.log(`clip FAILED: ${err.message}`);
  }
}

console.log(`\nRead-test frames: ${READ}`);
console.log('Judge those, not the full-size renders.');
