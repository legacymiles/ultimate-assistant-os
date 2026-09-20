#!/usr/bin/env node
// plan.mjs — decide what each preview icon shows, and write a render plan.
//
//   node scripts/plan.mjs --catalog <catalog.ts> --out work/plan.json [--only slug,slug]
//   node scripts/plan.mjs --describe "what the thing does" --slug my-app --out work/plan.json
//
// The script owns the deterministic half of a prompt: archetype, camera, hues, house style and
// the negative prompt. It deliberately does NOT invent the subject — a concrete subject is
// creative work, and a heuristic one reads as generic stock footage, which is the exact failure
// this skill exists to avoid. Items without a subject are flagged `needsSubject` and render.mjs
// refuses to spend money on them.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.dirname(HERE);

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);

// --- house style, appended verbatim to every prompt (see references/house-style.md) ---------
const HOUSE_STYLE =
  'Shot on a macro lens, shallow depth of field, single subject centred with generous empty ' +
  'margin. Deep near-black background, no horizon, no set dressing. Lighting is a single soft ' +
  'key plus a hard rim; the only colours in frame are the two named hues against black. High ' +
  'contrast, fine film grain, no lens flare. One continuous camera move, no cuts, no speed ' +
  'ramps. Photoreal, physical materials, tactile surfaces. Silent.';

const NEGATIVE =
  'text, letters, words, numbers, watermark, logo, user interface, app window, browser, screen, ' +
  'monitor, phone, buttons, menus, cursor, human face, hands, crowd, fast cuts, camera shake, zoom blur';

// --- archetypes -----------------------------------------------------------------------------
const ARCHETYPES = {
  transformation: {
    camera: 'Camera locked off with the slowest possible push in. The subject carries the change.',
    resolution: 'The change completes and the subject settles into stillness.',
  },
  accumulation: {
    camera: 'Camera pulls back slowly, revealing the order as the frame widens.',
    resolution: 'The final piece lands and everything holds still.',
  },
  interrogation: {
    camera: 'Camera locked off. The sweep supplies all the motion.',
    resolution: 'The sweep exits frame and its marks fade out.',
  },
  emission: {
    camera: 'Camera locked off, or the gentlest drift. The empty frame is the first beat.',
    resolution: 'The form reaches coherence and holds.',
  },
  inhabitation: {
    camera: 'One continuous travelling camera move through the space, no cuts.',
    resolution: 'The move ends on a framing that matches where it began.',
  },
};

// Keyword signals. Tag text counts double: it is the one-line human summary and the most
// reliable statement of what the app actually does.
const SIGNALS = {
  inhabitation: ['game', 'playable', 'play as', 'first-person', 'level', 'world', 'escape', 'kart', 'racing', 'drive', 'cinematic', 'film', 'shooter', 'physics'],
  transformation: ['turn', 'turns', 'convert', 'redesign', 'restyle', 'reskin', 'rebuild', 'transform', 'into', 'remix', 'port', 'clone', 'translate', 'edit', 'rewrite', 'modernize', 'makeover'],
  interrogation: ['search', 'analys', 'analyz', 'score', 'rank', 'verify', 'check', 'detect', 'compare', 'audit', 'measure', 'review', 'watch', 'read', 'scan', 'find', 'triage', 'confidence', 'proof', 'test'],
  accumulation: ['collect', 'file', 'files', 'organis', 'organiz', 'folder', 'library', 'vault', 'inbox', 'catalog', 'index', 'track', 'log', 'board', 'list', 'capture', 'timeline', 'archive', 'sort'],
  emission: ['generate', 'create', 'produce', 'compose', 'render', 'synthes', 'write', 'song', 'prompt', 'from scratch', 'from nothing', 'studio', 'maker'],
};

// Category nudges, weaker than keywords but useful when a description is thin.
const CATEGORY_HINT = {
  Trading: 'interrogation',
  Utilities: 'accumulation',
  Music: 'emission',
  Image: 'emission',
  Video: 'emission',
  Websites: 'transformation',
};

// Deterministic tiebreak, most specific first.
const PRECEDENCE = ['inhabitation', 'transformation', 'interrogation', 'accumulation', 'emission'];

function inferArchetype({ tag = '', overview = '', category = '' }) {
  const strong = ` ${tag} `.toLowerCase();
  const weak = ` ${overview} `.toLowerCase();
  const scores = {};
  for (const [name, words] of Object.entries(SIGNALS)) {
    let s = 0;
    for (const w of words) {
      if (strong.includes(w)) s += 2;
      if (weak.includes(w)) s += 1;
    }
    scores[name] = s;
  }
  if (CATEGORY_HINT[category]) scores[CATEGORY_HINT[category]] += 1.5;
  let best = PRECEDENCE[0];
  for (const name of PRECEDENCE) if (scores[name] > scores[best]) best = name;
  return { archetype: best, scores };
}

// --- hues -------------------------------------------------------------------------------------
// Deliberately coarse. Precise colour names make video models literal-minded and they start
// painting objects instead of lighting them.
function hueName(h) {
  const x = ((h % 360) + 360) % 360;
  const table = [
    [15, 'red'], [40, 'amber'], [65, 'gold'], [100, 'lime green'], [150, 'green'],
    [175, 'teal'], [200, 'cyan'], [235, 'blue'], [260, 'indigo'], [290, 'violet'],
    [320, 'magenta'], [345, 'pink'], [361, 'red'],
  ];
  for (const [limit, name] of table) if (x < limit) return name;
  return 'white';
}

const lighting = (hue) => {
  const [a, b] = Array.isArray(hue) && hue.length >= 2 ? hue : [200, 30];
  // Neutral phrasing on purpose: naming a temperature ("a cold amber rim") contradicts half the
  // hue pairs in the catalog, and a contradictory prompt makes the model pick one and drop the other.
  return `Lit by a deep ${hueName(a)} key light and a ${hueName(b)} rim light.`;
};

// --- catalog parsing ---------------------------------------------------------------------------
// Regex rather than a TS parse: the catalog is a hand-written literal with a stable shape, and a
// parser would drag a toolchain into a skill that otherwise needs none.
function parseCatalog(file) {
  // Normalise CRLF first: the catalog is edited on Windows, and \r between `{` and the newline
  // silently breaks the block split.
  const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const blocks = src.split(/\n\s*\{\n/).slice(1);
  const items = [];
  for (const b of blocks) {
    const slug = b.match(/slug:\s*"([^"]+)"/)?.[1];
    if (!slug) continue;
    const str = (field) => {
      const m = b.match(new RegExp(`${field}:\\s*((?:\\s*"(?:[^"\\\\]|\\\\.)*"\\s*\\+?)+)`));
      if (!m) return '';
      return [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)]
        .map((x) => x[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')).join('');
    };
    const hue = b.match(/hue:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/);
    items.push({
      slug,
      title: str('title'),
      tag: str('tag'),
      category: str('category'),
      overview: str('overview'),
      status: str('status') || 'live',
      hue: hue ? [Number(hue[1]), Number(hue[2])] : [200, 30],
    });
  }
  return items;
}

// --- prompt assembly ---------------------------------------------------------------------------
// Two prompts, because the pipeline has two stages with different jobs.
//
// The still is generated by an image model, which has no notion of a camera move — handing it
// "camera pulls back slowly" just spends attention on an instruction it cannot act on. It gets
// the subject at its opening moment, lit and framed.
//
// The video prompt goes to H3 with that still as the first frame, so it describes the motion the
// still should perform, not the scene again.
function buildPrompts(item) {
  const a = ARCHETYPES[item.archetype];
  const still = [item.subject, lighting(item.hue), HOUSE_STYLE].filter(Boolean).join(' ');
  const video = [item.subject, a.resolution, a.camera, lighting(item.hue), HOUSE_STYLE]
    .filter(Boolean).join(' ');
  return { still, video };
}

// --- main ----------------------------------------------------------------------------------------
const outPath = path.resolve(arg('--out', path.join(SKILL, 'work', 'plan.json')));
const overridesPath = path.join(SKILL, 'references', 'overrides.json');
const overrides = fs.existsSync(overridesPath)
  ? JSON.parse(fs.readFileSync(overridesPath, 'utf8')) : {};

let items = [];
const catalog = arg('--catalog');
const describe = arg('--describe');

if (catalog) {
  items = parseCatalog(path.resolve(catalog)).filter((i) => i.status === 'live');
  const only = arg('--only');
  if (only) {
    const want = new Set(only.split(',').map((s) => s.trim()));
    items = items.filter((i) => want.has(i.slug));
  }
} else if (describe) {
  items = [{
    slug: arg('--slug', 'preview-icon'),
    title: arg('--title', arg('--slug', 'preview-icon')),
    tag: describe,
    category: arg('--category', ''),
    overview: describe,
    status: 'live',
    hue: (arg('--hue', '200,30').split(',').map(Number)),
  }];
} else {
  console.error('Need --catalog <catalog.ts> or --describe "<what it does>".');
  process.exit(2);
}

for (const item of items) {
  const ov = overrides[item.slug] || {};
  const inferred = inferArchetype(item);
  item.archetype = ov.archetype || inferred.archetype;
  item.archetypeSource = ov.archetype ? 'override' : 'inferred';
  item.signals = inferred.scores;
  item.subject = ov.subject || '';
  item.needsSubject = !item.subject;
  item.engine = ov.engine || (item.archetype === 'inhabitation' ? 'h3' : 'wan');
  const prompts = item.subject ? buildPrompts(item) : { still: '', video: '' };
  item.stillPrompt = prompts.still;   // OpenRouter image model -> the first frame
  item.prompt = prompts.video;        // H3 on RunPod -> the motion, from that frame
  item.negative = NEGATIVE;
  item.aspect = '1:1';
  item.resolution = '720p';
  item.duration = 5;          // trimmed to 2.5s by finish.mjs — see references/engines.md
  delete item.overview;       // keep the plan readable; the prompt is what matters downstream
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ created: new Date().toISOString(), items }, null, 2));

const missing = items.filter((i) => i.needsSubject);
const counts = items.reduce((m, i) => ({ ...m, [i.archetype]: (m[i.archetype] || 0) + 1 }), {});

console.log(`Planned ${items.length} icon(s) -> ${outPath}`);
console.log(`Archetypes: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`Engines: wan ${items.filter((i) => i.engine === 'wan').length}, h3 ${items.filter((i) => i.engine === 'h3').length}`);
if (missing.length) {
  console.log(`\n${missing.length} item(s) need a concrete subject before rendering:`);
  for (const m of missing) console.log(`  ${m.slug.padEnd(24)} ${m.archetype.padEnd(15)} ${m.tag || ''}`);
  console.log(`\nWrite each subject into ${overridesPath}, then re-run this script.`);
  console.log('See references/archetypes.md for the vocabulary and worked examples.');
}
