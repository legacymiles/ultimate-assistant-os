#!/usr/bin/env node
// Generate one scene still through OpenRouter (image output).
//
//   node still.mjs --prompt-file scene0.txt --out scene0.png [--ref scene0.png]...
//                  [--aspect 16:9|9:16|1:1] [--model google/gemini-3.1-flash-image]
//
// Pass scene 0 as --ref when generating scenes 1..n so the whole world keeps
// one look. One image per request; refs are downscaled to keep requests small.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { args, die, env, ffmpegPath, imageDataUrl } from "./_env.mjs";

const a = args();
const key = env("OPENROUTER_API_KEY");
if (!key) die("OPENROUTER_API_KEY is not set (env or .env.local)");
if (!a["prompt-file"] || !a.out) die("need --prompt-file <p.txt> and --out <scene.png>");
if (!existsSync(a["prompt-file"])) die(`prompt file not found: ${a["prompt-file"]}`);

const prompt = readFileSync(a["prompt-file"], "utf8").trim();
const refs = [].concat(a.ref || []).filter((r) => typeof r === "string");
const aspect = String(a.aspect || "16:9");
const model = String(a.model || env("STILL_MODEL") || "google/gemini-3.1-flash-image");

const text = refs.length
  ? `${prompt}\n\nMatch the art direction, palette, lighting, materials and rendering style of the reference image${refs.length > 1 ? "s" : ""} exactly, so this reads as the same world. Do not copy the reference's composition.`
  : prompt;

const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": env("OPENROUTER_SITE_URL") || "https://localhost",
    "X-Title": "h3-scroll-world",
  },
  body: JSON.stringify({
    model,
    modalities: ["image", "text"],
    image_config: { aspect_ratio: aspect },
    messages: [
      {
        role: "user",
        content: [{ type: "text", text }, ...refs.map((r) => ({ type: "image_url", image_url: { url: imageDataUrl(r, 900_000) } }))],
      },
    ],
  }),
  signal: AbortSignal.timeout(180_000),
});
const json = await res.json().catch(() => ({}));
if (!res.ok) die(`OpenRouter ${res.status}: ${JSON.stringify(json.error || json).slice(0, 300)}`);

const msg = json.choices?.[0]?.message || {};
let url = (msg.images || []).map((i) => i?.image_url?.url).find(Boolean);
if (!url && Array.isArray(msg.content)) url = msg.content.find((p) => p?.type === "image_url")?.image_url?.url;
if (!url) die(`no image returned. Model said: ${typeof msg.content === "string" ? msg.content.slice(0, 300) : "(nothing)"}`);

const m = url.match(/^data:image\/(\w+);base64,(.+)$/);
let bytes = m ? Buffer.from(m[2], "base64") : Buffer.from(await (await fetch(url)).arrayBuffer());

// --fit WxH scales (no crop) to H3's native canvas, e.g. 1344x768 for 16:9
// 768P, so the still that seeds a chain is the exact size the clips come back at.
if (a.fit) {
  const [w, h] = String(a.fit).split("x").map(Number);
  const ff = ffmpegPath();
  if (!ff || !w || !h) die("--fit needs WxH and ffmpeg");
  bytes = execFileSync(ff, ["-v", "error", "-i", "pipe:0", "-vf", `scale=${w}:${h}:flags=lanczos`, "-f", "image2pipe", "-vcodec", "png", "-"], {
    input: bytes,
    maxBuffer: 64 * 1024 * 1024,
  });
}
writeFileSync(a.out, bytes);
console.log(JSON.stringify({ model, out: resolve(a.out), bytes: bytes.length, refs: refs.length }));
