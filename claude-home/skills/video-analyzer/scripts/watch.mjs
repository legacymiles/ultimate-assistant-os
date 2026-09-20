#!/usr/bin/env node
// ---------------------------------------------------------------------------
// watch.mjs — have Gemini actually WATCH a video (frames + audio) and answer a
// prompt about it. No download, no yt-dlp, no Google key needed: OpenRouter's
// google/gemini-3.8-flash accepts a plain YouTube URL (or a local file, sent
// as base64) as a `video_url` content part. Verified 2026-09-13.
//
//   node watch.mjs <youtube-url | local-file> [prompt...]
//   node watch.mjs <url> --transcript
//   node watch.mjs <url> --json '{"shape": "..."}'   → asks for JSON only
//
// Key: OPENROUTER_API_KEY from the environment, else from the hub's .env.local
// (C:\Users\honey\OneDrive\Desktop\claude code files\.env.local).
// Model override: AI_VIDEO_MODEL. Prints the answer to stdout.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const HUB_ENV = "C:/Users/honey/OneDrive/Desktop/claude code files/.env.local";

function key() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  if (existsSync(HUB_ENV)) {
    const m = readFileSync(HUB_ENV, "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error("OPENROUTER_API_KEY is not set (env or the hub's .env.local).");
}

const MIME = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".m4v": "video/mp4" };

function videoPart(source) {
  if (/^https?:\/\//i.test(source)) return { type: "video_url", video_url: { url: source } };
  const file = resolve(source);
  if (!existsSync(file)) throw new Error(`No such file: ${file}`);
  const bytes = readFileSync(file);
  if (bytes.length > 20 * 1024 * 1024) throw new Error("Local videos over 20 MB are too big to inline; cut it down first.");
  const mime = MIME[extname(file).toLowerCase()] || "video/mp4";
  return { type: "video_url", video_url: { url: `data:${mime};base64,${bytes.toString("base64")}` } };
}

const args = process.argv.slice(2);
const source = args.shift();
if (!source) {
  console.error("usage: node watch.mjs <youtube-url | file> [prompt] [--transcript] [--json <shape>]");
  process.exit(2);
}
let json = null;
let transcript = false;
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--json") json = args[++i] ?? "{}";
  else if (args[i] === "--transcript") transcript = true;
  else rest.push(args[i]);
}
let prompt = rest.join(" ").trim();
if (transcript) prompt = "Write a verbatim transcript of everything spoken in this video, with [mm:ss] timestamps every few sentences and speaker labels if there is more than one speaker. Then list every on-screen text or UI label you can read, with timestamps.";
if (!prompt) prompt = "Describe this video in detail: what happens step by step with timestamps, what is on screen, what is said, and the key takeaways.";
if (json) prompt += `\n\nAnswer with ONE JSON object only, in this shape:\n${json}`;

const model = process.env.AI_VIDEO_MODEL || "google/gemini-3.8-flash";
const body = {
  model,
  temperature: 0.2,
  max_tokens: 8000,
  ...(json ? { response_format: { type: "json_object" } } : {}),
  messages: [{ role: "user", content: [{ type: "text", text: prompt }, videoPart(source)] }],
};

const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(300_000),
});
if (!res.ok) {
  console.error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 600)}`);
  process.exit(1);
}
const data = await res.json();
const reply = data?.choices?.[0]?.message?.content;
process.stdout.write((typeof reply === "string" ? reply : JSON.stringify(reply, null, 2)) + "\n");
if (data?.usage) console.error(`[watch] ${model} · ${data.usage.prompt_tokens} in / ${data.usage.completion_tokens} out`);
