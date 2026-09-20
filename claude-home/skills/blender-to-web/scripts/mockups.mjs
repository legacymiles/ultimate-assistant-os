#!/usr/bin/env node
// Generate website mockup images for blender-to-web directions via OpenRouter (Gemini image).
//
// Usage:
//   node mockups.mjs --out <dir> --prompts <prompts.json> [--env <.env file>] [--model <id>]
//                    [--aspect 16:9] [--image <path|url>]...
//   node mockups.mjs --out <dir> --prompt "one prompt" [--name hero] [--image <path|url>]...
//
// prompts.json:
//   [{ "name": "a-paper-kiln", "prompt": "Website hero mockup, ...",
//      "images": ["refs/product-front.jpg", "https://example.com/logo.png"],   // optional
//      "aspect": "16:9" }, ...]                                                 // optional
//
// --image (repeatable) is attached to EVERY job (e.g. the user's product photos or logo);
// an entry's "images" are added to that job only (paths resolve relative to prompts.json).
// Local files are sent as data URLs, http(s) URLs as-is, both as image_url message parts.
// Supported local types: .png .jpg .jpeg .webp .gif. HEIC/HEIF (iPhone photos) is NOT supported:
// convert to JPEG first. A local image whose base64 exceeds ~4 MB prints a warning (the
// request may be rejected); resize it to ~2000 px on the long edge.
//
// Writes <dir>/<name>.<png|jpg|webp> per entry, in parallel (one image per request). Each job
// retries once on a transient failure (429, 5xx, timeout, network). Failed directions are
// listed by name at the end so only those fall back to HTML mockups.
// Needs OPENROUTER_API_KEY in the environment or in the --env file. Exit 0 all ok, 1 some
// failed, 2 bad usage / no key / bad reference image (checked before any request).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname, extname } from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const optAll = (k) => args.flatMap((a, i) => (a === `--${k}` && args[i + 1] ? [args[i + 1]] : []));

const envFile = opt("env");
if (envFile && existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error("No OPENROUTER_API_KEY. Pass --env <path to .env.local> or fall back to HTML mockups.");
  process.exit(2);
}

const out = resolve(opt("out", "mockups"));
const model = opt("model", "google/gemini-3.1-flash-image");
const aspect = opt("aspect", "16:9");
const globalImages = optAll("image").map((p) => ({ ref: p, base: process.cwd() }));

let jobs;
if (opt("prompts")) {
  const file = resolve(opt("prompts"));
  jobs = JSON.parse(readFileSync(file, "utf8")).map((j) => ({
    ...j,
    images: (j.images ?? []).map((p) => ({ ref: p, base: dirname(file) })),
  }));
} else if (opt("prompt")) {
  jobs = [{ name: opt("name", "mockup"), prompt: opt("prompt"), images: [] }];
} else {
  console.error("Give --prompts <file.json> or --prompt <text>.");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const MAX_B64 = 4 * 1024 * 1024;
const warned = new Set();
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
function toImageUrl({ ref, base }) {
  if (/^(https?:|data:)/i.test(ref)) return ref;
  const p = resolve(base, ref);
  if (!existsSync(p)) throw new Error(`reference image not found: ${p}`);
  const ext = extname(p).toLowerCase();
  if (ext === ".heic" || ext === ".heif")
    throw new Error(`HEIC/HEIF is not supported: ${p} — convert it to JPEG (or PNG) first`);
  const mime = MIME[ext];
  if (!mime) throw new Error(`unsupported reference image type: ${p} (use png, jpg, webp or gif)`);
  const b64 = readFileSync(p).toString("base64");
  if (b64.length > MAX_B64 && !warned.has(p)) {
    warned.add(p);
    console.error(`warn ${p}: ${(b64.length / 1048576).toFixed(1)} MB as base64 (> ~4 MB) — the request may be rejected; resize to ~2000 px on the long edge`);
  }
  return `data:${mime};base64,${b64}`;
}

// Validate every local reference before any request (HEIC, missing file, size warning).
try {
  for (const r of [...globalImages, ...jobs.flatMap((j) => j.images)]) toImageUrl(r);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

function extractImage(json) {
  const msg = json?.choices?.[0]?.message ?? {};
  for (const im of msg.images ?? []) if (im?.image_url?.url) return { url: im.image_url.url };
  let text = typeof msg.content === "string" ? msg.content : "";
  if (Array.isArray(msg.content)) {
    for (const p of msg.content) {
      if (p?.type === "image_url" && p.image_url?.url) return { url: p.image_url.url };
      if (p?.type === "text") text += p.text;
    }
  }
  return { text };
}

class HttpError extends Error {
  constructor(status, body, retryAfter) {
    super(`${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
const transient = (e) =>
  e instanceof HttpError
    ? e.status === 429 || e.status >= 500
    : e?.name === "TimeoutError" || e?.name === "AbortError" || e instanceof TypeError; // fetch network errors are TypeError

async function request(job) {
  const refs = [...globalImages, ...job.images].map(toImageUrl);
  const content = refs.length
    ? [{ type: "text", text: job.prompt }, ...refs.map((url) => ({ type: "image_url", image_url: { url } }))]
    : job.prompt;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
      image_config: { aspect_ratio: job.aspect ?? aspect },
    }),
    signal: AbortSignal.timeout(150_000),
  });
  if (!res.ok) throw new HttpError(res.status, await res.text(), Number(res.headers.get("retry-after")) || 0);
  const { url, text } = extractImage(await res.json());
  if (!url) throw new Error(`no image returned${text ? `: ${text.slice(0, 200)}` : ""}`);
  return url;
}

async function save(name, url) {
  let buf, mime;
  const m = url.match(/^data:(image\/[\w+.-]+);base64,(.*)$/s);
  if (m) {
    mime = m[1];
    buf = Buffer.from(m[2], "base64");
  } else {
    const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`image download ${r.status}`);
    mime = r.headers.get("content-type") ?? "image/png";
    buf = Buffer.from(await r.arrayBuffer());
  }
  const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
  const file = join(out, `${name}.${ext}`);
  writeFileSync(file, buf);
  return file;
}

async function run(job) {
  let url;
  try {
    url = await request(job);
  } catch (e) {
    if (!transient(e)) throw e;
    const wait = Math.min(Math.max((e.retryAfter ?? 0) * 1000, 3000), 30_000);
    console.error(`retry ${job.name} in ${wait / 1000}s (${e.message ?? e})`);
    await new Promise((r) => setTimeout(r, wait));
    url = await request(job);
  }
  return save(job.name, url);
}

const results = await Promise.allSettled(jobs.map(run));
const failed = [];
results.forEach((r, i) => {
  if (r.status === "fulfilled") console.log(`ok   ${jobs[i].name}  ${r.value}`);
  else {
    failed.push(jobs[i].name);
    console.error(`FAIL ${jobs[i].name}: ${r.reason?.message ?? r.reason}`);
  }
});
if (failed.length) console.error(`Fall back to HTML mockups for: ${failed.join(", ")}`);
process.exit(failed.length ? 1 : 0);
