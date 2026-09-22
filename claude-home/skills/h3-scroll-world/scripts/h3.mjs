#!/usr/bin/env node
// Render one MiniMax H3 clip and save it as an mp4.
//
//   node h3.mjs --prompt-file brief.txt --out leg0.mp4 [--first-frame still.png]
//               [--last-frame end.png] [--duration 8] [--ratio 16:9]
//               [--resolution 768P] [--backend runpod|minimax|gateway] [--dry-run]
//   node h3.mjs --check
//
// Backends, in auto order:
//   runpod   the owner's own H3 on RunPod Serverless (RUNPOD_API_KEY + RUNPOD_ENDPOINT_ID).
//            first_frame only, NO last_frame. First job after idle = multi-minute cold start.
//   minimax  MiniMax's hosted v2 API (MINIMAX_API_KEY). first_frame AND last_frame.
//   gateway  Vercel AI Gateway minimax/minimax-h3 (AI_GATEWAY_API_KEY). first_frame only.
//            Uses the `ai` package from the hub's node_modules.
//
// Prints one JSON line on success: {"backend","out","seconds"}.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HUB, args, die, env, imageDataUrl, sleep } from "./_env.mjs";

const a = args();
const t0 = Date.now();
const log = (m) => console.error(`[h3 ${Math.round((Date.now() - t0) / 1000)}s] ${m}`);

const configured = {
  runpod: Boolean(env("RUNPOD_API_KEY") && env("RUNPOD_ENDPOINT_ID")),
  minimax: Boolean(env("MINIMAX_API_KEY")),
  gateway: Boolean(env("AI_GATEWAY_API_KEY")),
};

if (a.check) {
  const out = { configured, runpodHealth: null };
  if (configured.runpod) {
    try {
      const r = await fetch(`https://api.runpod.ai/v2/${env("RUNPOD_ENDPOINT_ID")}/health`, {
        headers: { Authorization: `Bearer ${env("RUNPOD_API_KEY")}`, "User-Agent": "h3-scroll-world/1.0" },
        signal: AbortSignal.timeout(15000),
      });
      out.runpodHealth = r.ok ? await r.json() : `HTTP ${r.status}`;
    } catch (e) {
      out.runpodHealth = `unreachable: ${e.message}`;
    }
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const promptFile = a["prompt-file"];
const outFile = a.out;
if (!promptFile || !outFile) die("need --prompt-file <brief.txt> and --out <clip.mp4>");
if (!existsSync(promptFile)) die(`prompt file not found: ${promptFile}`);
const prompt = readFileSync(promptFile, "utf8").trim();
if (!prompt) die("prompt file is empty");

const duration = Math.max(4, Math.min(15, Number(a.duration) || 8));
const ratio = String(a.ratio || "16:9");
const resolution = String(a.resolution || "768P").toUpperCase() === "2K" ? "2K" : "768P";
const first = a["first-frame"] ? imageDataUrl(a["first-frame"]) : null;
const last = a["last-frame"] ? imageDataUrl(a["last-frame"]) : null;

let backend = a.backend ? String(a.backend) : null;
if (!backend) {
  // An end frame is only honoured by the hosted API, so it picks the backend.
  if (last) backend = "minimax";
  else backend = ["runpod", "minimax", "gateway"].find((b) => configured[b]);
}
if (!backend) die("no H3 backend configured (need RUNPOD_API_KEY+RUNPOD_ENDPOINT_ID, MINIMAX_API_KEY or AI_GATEWAY_API_KEY)");
if (!configured[backend]) die(`backend "${backend}" is not configured (missing key)`);
if (last && backend !== "minimax")
  die(`--last-frame needs --backend minimax (MINIMAX_API_KEY); "${backend}" supports a first frame only. Use architecture A.`);

// ---------------------------------------------------------------- runpod
async function runpod() {
  const base = `https://api.runpod.ai/v2/${env("RUNPOD_ENDPOINT_ID")}`;
  const headers = {
    Authorization: `Bearer ${env("RUNPOD_API_KEY")}`,
    "Content-Type": "application/json",
    "User-Agent": "h3-scroll-world/1.0", // default undici UA gets a Cloudflare 1010
  };
  const input = { prompt: prompt.slice(0, 7000), duration, resolution, aspect_ratio: ratio, references: [] };
  if (first) input.first_frame = first;
  if (a["dry-run"]) return dry({ input: { ...input, first_frame: first ? "<data url>" : undefined } });

  const res = await fetch(`${base}/run`, { method: "POST", headers, body: JSON.stringify({ input }) });
  const job = await res.json().catch(() => ({}));
  if (!res.ok || !job.id) die(`RunPod ${res.status}: ${JSON.stringify(job).slice(0, 300)}`);
  log(`job ${job.id} queued`);

  let lastNote = "";
  for (;;) {
    await sleep(5000);
    const s = await fetch(`${base}/status/${job.id}`, { headers }).then((r) => r.json()).catch(() => ({}));
    const status = String(s.status || "").toUpperCase();
    const streamOut = Array.isArray(s.stream) && s.stream.length ? s.stream[s.stream.length - 1]?.output : null;
    const note = (typeof streamOut === "string" ? streamOut : streamOut?.note) || s.output?.note || status;
    if (note && note !== lastNote) log((lastNote = note));
    if (status === "COMPLETED") {
      const o = s.output || {};
      if (o.error) die(`worker: ${o.error}`);
      if (o.video_base64) return Buffer.from(o.video_base64, "base64");
      const url = o.video_url || o.url;
      if (url) return download(url);
      die("worker returned no video");
    }
    if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(status)) die(`RunPod job ${status}: ${JSON.stringify(s.error || s.output || "").slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------- minimax
async function minimax() {
  const base = env("MINIMAX_API_BASE") || "https://api.minimax.io";
  const headers = { Authorization: `Bearer ${env("MINIMAX_API_KEY")}`, "Content-Type": "application/json" };
  const content = [{ type: "text", text: prompt.slice(0, 7000) }];
  if (first) content.push({ type: "image_url", role: "first_frame", image_url: { url: first } });
  if (last) content.push({ type: "image_url", role: "last_frame", image_url: { url: last } });
  const body = { model: env("MINIMAX_VIDEO_MODEL") || "MiniMax-H3", resolution, duration, ratio, content };
  if (a["dry-run"]) return dry({ ...body, content: content.map((c) => (c.image_url ? { ...c, image_url: { url: "<data url>" } } : c)) });

  const res = await fetch(`${base}/v2/video_generation`, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  const taskId = data.task_id || data.task?.id;
  if (!res.ok || !taskId) die(`MiniMax ${res.status}: ${JSON.stringify(data.base_resp || data.error || data).slice(0, 300)}`);
  log(`task ${taskId} created`);

  for (;;) {
    await sleep(8000);
    const q = await fetch(`${base}/v2/query/video_generation/${taskId}`, { headers }).then((r) => r.json()).catch(() => ({}));
    const task = q.task || q;
    const status = String(task.status || "").toLowerCase();
    log(status || "polling");
    if (["succeeded", "success"].includes(status)) {
      if (!task.content?.url) die("task succeeded without a url");
      return download(task.content.url);
    }
    if (["failed", "fail", "cancelled", "expired"].includes(status)) die(`MiniMax task ${status}: ${task.error?.message || ""}`);
  }
}

// ---------------------------------------------------------------- gateway
async function gateway() {
  if (a["dry-run"]) return dry({ model: "minimax/minimax-h3", duration, aspectRatio: ratio, firstFrame: Boolean(first) });
  const req = createRequire(resolve(HUB, "package.json"));
  let aiPath;
  try {
    aiPath = req.resolve("ai");
  } catch {
    die("gateway backend needs the `ai` package (hub node_modules not found)");
  }
  process.env.AI_GATEWAY_API_KEY ||= env("AI_GATEWAY_API_KEY");
  const { experimental_generateVideo: generateVideo } = await import(pathToFileURL(aiPath).href);
  log("rendering through the AI Gateway (synchronous)");
  const result = await generateVideo({
    model: "minimax/minimax-h3",
    duration,
    aspectRatio: ratio,
    prompt: first ? { image: first, text: prompt } : prompt,
    providerOptions: { minimax: { pollTimeoutMs: 900_000 } },
  });
  const v = result.videos?.[0];
  if (v?.uint8Array) return Buffer.from(v.uint8Array);
  if (v?.base64) return Buffer.from(v.base64, "base64");
  die("gateway returned no video");
}

async function download(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!r.ok) die(`download ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function dry(body) {
  console.log(JSON.stringify({ backend, dryRun: true, body }, null, 2));
  process.exit(0);
}

log(`backend=${backend} duration=${duration}s ratio=${ratio} res=${resolution} first=${Boolean(first)} last=${Boolean(last)}`);
const bytes = await { runpod, minimax, gateway }[backend]();
writeFileSync(outFile, bytes);
console.log(JSON.stringify({ backend, out: resolve(outFile), seconds: Math.round((Date.now() - t0) / 1000) }));
