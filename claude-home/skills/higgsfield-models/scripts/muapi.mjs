#!/usr/bin/env node
// Zero-install muapi.ai CLI (Node 18+). Same protocol as Open-Generative-AI's muapi.js:
//   POST /api/v1/<endpoint>  (x-api-key)  -> { request_id }
//   GET  /api/v1/predictions/<id>/result  -> poll until status completed/failed
//   POST /api/v1/upload_file (multipart "file") -> { url }
//
// Usage:
//   node muapi.mjs models <search>                      list matching endpoints from references/models.md
//   node muapi.mjs upload <file>                        prints hosted URL
//   node muapi.mjs gen <endpoint> '<json payload>' [--out file] [--no-wait]
//   node muapi.mjs poll <request_id> [--out file]
//
// Key: MUAPI_API_KEY env, else read from the nearest .env.local (cwd upwards), else the hub's .env.local.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://api.muapi.ai';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HUB_ENV = 'C:/Users/honey/OneDrive/Desktop/claude code files/.env.local';

function findKey() {
  if (process.env.MUAPI_API_KEY) return process.env.MUAPI_API_KEY.trim();
  const candidates = [];
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    candidates.push(path.join(dir, '.env.local'), path.join(dir, '.env'));
    if (path.dirname(dir) === dir) break;
  }
  candidates.push(HUB_ENV);
  for (const file of candidates) {
    try {
      // Horizontal whitespace only. \s matches newlines, so an empty `MUAPI_API_KEY=` line used
      // to swallow the following lines and return the next comment as the key, which surfaced
      // much later as an unreadable ByteString error when it hit the request header.
      const m = fs.readFileSync(file, 'utf8').match(/^[ \t]*MUAPI_API_KEY[ \t]*=[ \t]*["']?([^"'\r\n]*)/m);
      const v = m && m[1].trim();
      if (v && /^[\x21-\x7e]+$/.test(v)) return v;
    } catch {}
  }
  console.error('No MUAPI_API_KEY found. Add a line  MUAPI_API_KEY=  to .env.local (key from https://muapi.ai).');
  process.exit(2);
}

const arg = (flag) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : undefined; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(id, key, { interval = 3000, maxMinutes = 30 } = {}) {
  const deadline = Date.now() + maxMinutes * 60_000;
  let last = '';
  while (Date.now() < deadline) {
    await sleep(interval);
    let res;
    try { res = await fetch(`${BASE}/api/v1/predictions/${id}/result`, { headers: { 'x-api-key': key } }); }
    catch { continue; }
    if (!res.ok) {
      if (res.status >= 500) continue;
      throw new Error(`Poll failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = await res.json().catch(() => null);
    if (!data) continue;
    const status = String(data.status || '').toLowerCase();
    if (status !== last) { console.error(`[${id}] ${status || 'pending'}`); last = status; }
    if (['completed', 'succeeded', 'success'].includes(status)) return data;
    if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
      const msg = data.error?.message || data.error || data.message || 'unknown error';
      const refund = data.cost?.refunded ? ' (credits refunded)' : '';
      throw new Error(`Generation failed: ${msg}${refund}`);
    }
  }
  throw new Error(`Timed out. Resume with: node muapi.mjs poll ${id}`);
}

const outputUrl = (r) => r.outputs?.[0] || r.url || r.output?.url || r.images?.[0];

async function download(url, out) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}`);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.error(`saved ${out}`);
}

async function finish(result) {
  const url = outputUrl(result);
  const out = arg('--out');
  if (out && url) await download(url, out);
  console.log(JSON.stringify({ request_id: result.request_id || result.id, url, outputs: result.outputs, cost: result.cost }, null, 2));
}

const [cmd, a1, a2] = process.argv.slice(2);

if (cmd === 'models') {
  const q = (a1 || '').toLowerCase();
  const md = fs.readFileSync(path.join(HERE, '..', 'references', 'models.md'), 'utf8');
  let section = '';
  for (const line of md.split('\n')) {
    if (line.startsWith('## ')) section = line.slice(3);
    else if (line.startsWith('| ') && !line.startsWith('| Name') && line.toLowerCase().includes(q)) console.log(`${section.padEnd(24)} ${line}`);
  }
} else if (cmd === 'upload') {
  const key = findKey();
  const buf = fs.readFileSync(a1);
  const form = new FormData();
  form.append('file', new Blob([buf]), path.basename(a1));
  const res = await fetch(`${BASE}/api/v1/upload_file`, { method: 'POST', headers: { 'x-api-key': key }, body: form });
  const text = await res.text();
  if (!res.ok) { console.error(`Upload failed ${res.status}: ${text.slice(0, 300)}`); process.exit(1); }
  const data = JSON.parse(text);
  console.log(data.url || data.file_url || data.data?.url || text);
} else if (cmd === 'gen') {
  const key = findKey();
  if (!a1) { console.error('gen <endpoint> <json>'); process.exit(1); }
  const payload = a2 ? JSON.parse(a2.startsWith('@') ? fs.readFileSync(a2.slice(1), 'utf8') : a2) : {};
  const res = await fetch(`${BASE}/api/v1/${a1}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) { console.error(`Submit failed ${res.status}: ${text.slice(0, 500)}`); process.exit(1); }
  const data = JSON.parse(text);
  const id = data.request_id || data.id;
  if (!id) { await finish(data); process.exit(0); }
  console.error(`request_id ${id}`);
  if (process.argv.includes('--no-wait')) { console.log(id); process.exit(0); }
  await finish({ ...(await poll(id, key)), request_id: id });
} else if (cmd === 'poll') {
  const key = findKey();
  await finish({ ...(await poll(a1, key)), request_id: a1 });
} else {
  console.error(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 13).join('\n'));
  process.exit(1);
}
