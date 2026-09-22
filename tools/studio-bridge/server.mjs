#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Studio bridge — Jarvis Studio's free local video renderer.
//
//   node tools/studio-bridge/server.mjs          (or double-click start.cmd)
//
// Jarvis runs on Vercel, which can't reach this PC. The owner's browser can:
// when Studio renders a video, the page sends the job straight to this bridge
// on 127.0.0.1:42010, which renders it with MiniMax H3 in WanGP (the Pinokio
// install) — $0, on the RTX 3050 — and hands the MP4 back to the page.
//
// One GPU, so jobs run one at a time in arrival order. WanGP's MCP server is
// started on demand if it isn't already running on :42004.
//
//   GET  /health        { ok, wangp, queue }
//   POST /video         { prompt, refs: [{ label, dataUrl }], durationSec, aspectRatio } → { id }
//   GET  /job/:id       { status: queued|rendering|done|error, position?, error?, seconds? }
//   GET  /file/:id      the MP4
// ---------------------------------------------------------------------------

import http from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, openSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(join(OUT, "refs"), { recursive: true });

const PORT = Number(process.env.STUDIO_BRIDGE_PORT || 42010);
const WANGP_DIR = process.env.WANGP_DIR || "C:\\pinokio\\api\\wan\\app";
const WANGP_PORT = 42004;

// Pages allowed to send jobs: the live hub and any local dev server.
const ALLOWED = [/^https:\/\/ultimate-assistant-os\.vercel\.app$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

const jobs = new Map(); // id → { status, input, file?, error?, started?, finished? }
const queue = [];
let working = false;

// ----- WanGP over MCP (same protocol as tools/h3-render) --------------------

let sessionId = null;
let rpcId = 0;
function rpc(method, params, notify = false) {
  const body = JSON.stringify(notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++rpcId, method, params });
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "Content-Length": Buffer.byteLength(body),
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  return new Promise((ok, fail) => {
    const req = http.request({ host: "127.0.0.1", port: WANGP_PORT, path: "/mcp", method: "POST", headers }, (res) => {
      if (res.headers["mcp-session-id"]) sessionId = res.headers["mcp-session-id"];
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (notify) return ok(null);
        const line = data.split("\n").filter((l) => l.startsWith("data:")).pop();
        try {
          ok(JSON.parse(line ? line.slice(5) : data));
        } catch {
          ok({ raw: data.slice(0, 800) });
        }
      });
    });
    // A render holds the request open for many minutes.
    req.setTimeout(0);
    req.on("error", fail);
    req.end(body);
  });
}

async function wangpUp() {
  try {
    sessionId = null;
    await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "studio-bridge", version: "1" } });
    await rpc("notifications/initialized", {}, true);
    return true;
  } catch {
    return false;
  }
}

let starting = null;
/** WanGP's MCP server, started if needed (the first start loads ~20 GB and takes minutes). */
function ensureWanGP() {
  if (starting) return starting;
  starting = (async () => {
    if (await wangpUp()) return;
    const py = join(WANGP_DIR, "venv", "Scripts", "python.exe");
    if (!existsSync(py)) throw new Error(`WanGP not found at ${WANGP_DIR} (set WANGP_DIR).`);
    console.log("Starting WanGP's MCP server…");
    const log = openSync(join(OUT, "wangp.log"), "a");
    spawn(py, ["wgp.py", "--mcp", "--mcp-transport", "streamable-http", "--mcp-port", String(WANGP_PORT), "--mcp-allow-read-file-system"], {
      cwd: WANGP_DIR,
      detached: true,
      stdio: ["ignore", log, log],
      windowsHide: true,
    }).unref();
    for (let i = 0; i < 90; i += 1) {
      await new Promise((r) => setTimeout(r, 5000));
      if (await wangpUp()) return;
    }
    throw new Error("WanGP didn't come up within 7.5 minutes — see tools/studio-bridge/out/wangp.log.");
  })().finally(() => {
    starting = null;
  });
  return starting;
}

// H3 wants 107 + 17k frames at 24 fps.
function framesFor(seconds) {
  const want = Math.round(Math.min(15, Math.max(4, seconds || 5)) * 24);
  return 107 + 17 * Math.max(0, Math.ceil((want - 107) / 17));
}

const RESOLUTION = { "16:9": "832x480", "9:16": "480x832", "1:1": "640x640" };

function saveRef(id, i, dataUrl) {
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUrl || "");
  if (!m) return null;
  const file = join(OUT, "refs", `${id}-${i}.${m[1] === "jpeg" ? "jpg" : m[1]}`);
  writeFileSync(file, Buffer.from(m[2], "base64"));
  return file;
}

async function render(id, job) {
  const { prompt, refs = [], durationSec, aspectRatio } = job.input;
  await ensureWanGP();
  const files = refs.map((r, i) => saveRef(id, i, r.dataUrl)).filter(Boolean);
  const labels = refs.map((r, i) => `image ${i + 1} is ${r.label || `Subject ${i + 1}`}`).join("; ");
  const withRefs = files.length > 0;
  // WanGP reads every line break as a separate prompt; Studio prompts are one
  // prompt laid out over several lines (SUBJECT:, CAMERA:, …), so flatten them.
  const flat = (t) => t.replace(/\s*\r?\n+\s*/g, " ").trim();
  const source = {
    model_type: withRefs ? "minimax_h3_ref2va_pruned" : "minimax_h3_fl2va_pruned",
    prompt: flat(withRefs ? `${prompt} Reference images: ${labels}. Keep each one's identity and details exactly.` : prompt),
    resolution: RESOLUTION[aspectRatio] || RESOLUTION["16:9"],
    video_length: framesFor(durationSec),
    seed: Math.floor(Math.random() * 2 ** 31),
    num_inference_steps: 4,
    guidance_scale: 1,
    flow_shift: 12,
    loras_multipliers: "1.0",
    activated_loras: [
      withRefs
        ? "https://huggingface.co/DeepBeepMeep/MiniMax-H3/resolve/main/loras/minimax_h3_lightx2v_ref2v_turbo_4step_alpha8_v0.1_bf16.safetensors"
        : "https://huggingface.co/DeepBeepMeep/MiniMax-H3/resolve/main/loras/minimax_h3_lightx2v_fl2v_turbo_4step_alpha16_v0.1.safetensors",
    ],
    config: "gguf_q2_k,int8_convrot,lower_ram",
    ...(withRefs ? { image_refs: files.map((f) => resolve(f)), video_prompt_type: "I" } : {}),
  };
  const r = await rpc("tools/call", { name: "wangp_generate", arguments: { action: "generate", arguments: { source } } });
  const text = (r?.result?.content ?? []).map((c) => c.text).join("\n");
  let result;
  try {
    result = JSON.parse(text).result;
  } catch {
    throw new Error(`WanGP: ${text.slice(0, 400) || JSON.stringify(r).slice(0, 400)}`);
  }
  if (!result?.success) throw new Error(`WanGP failed: ${JSON.stringify(result?.errors ?? text).slice(0, 400)}`);
  const out = join(OUT, `${id}.mp4`);
  copyFileSync(result.generated_files[0], out);
  return out;
}

async function pump() {
  if (working) return;
  working = true;
  while (queue.length) {
    const id = queue.shift();
    const job = jobs.get(id);
    job.status = "rendering";
    job.started = Date.now();
    console.log(`▶ ${id} — ${job.input.durationSec ?? 5}s ${job.input.aspectRatio ?? "16:9"}, ${job.input.refs?.length ?? 0} ref(s)`);
    try {
      job.file = await render(id, job);
      job.status = "done";
      console.log(`✓ ${id} in ${Math.round((Date.now() - job.started) / 1000)}s`);
    } catch (e) {
      job.status = "error";
      job.error = e instanceof Error ? e.message : String(e);
      console.log(`✗ ${id}: ${job.error}`);
    }
    job.finished = Date.now();
  }
  working = false;
}

// ----- HTTP ----------------------------------------------------------------

function cors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED.some((re) => re.test(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    // Lets an https page reach this local address (Chrome's private-network check).
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    return true;
  }
  return !origin; // curl and the like
}

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  const allowed = cors(req, res);
  if (req.method === "OPTIONS") return res.writeHead(allowed ? 204 : 403).end();
  if (!allowed) return json(res, 403, { error: "origin not allowed" });
  const url = new URL(req.url, "http://x");

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, wangp: await wangpUp(), queue: queue.length + (working ? 1 : 0) });
  }

  if (req.method === "POST" && url.pathname === "/video") {
    let raw = "";
    for await (const c of req) {
      raw += c;
      if (raw.length > 40_000_000) return json(res, 413, { error: "too large" });
    }
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      return json(res, 400, { error: "bad json" });
    }
    if (typeof input.prompt !== "string" || !input.prompt.trim()) return json(res, 400, { error: "prompt required" });
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    jobs.set(id, { status: "queued", input: { ...input, refs: Array.isArray(input.refs) ? input.refs.slice(0, 6) : [] } });
    queue.push(id);
    void pump();
    return json(res, 200, { id });
  }

  const m = /^\/(job|file)\/([a-z0-9]+)$/.exec(url.pathname);
  const job = m && jobs.get(m[2]);
  if (m && !job) return json(res, 404, { error: "unknown job" });
  if (m && m[1] === "job") {
    return json(res, 200, {
      status: job.status,
      ...(job.status === "queued" ? { position: queue.indexOf(m[2]) + 1 } : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(job.started ? { seconds: Math.round(((job.finished ?? Date.now()) - job.started) / 1000) } : {}),
    });
  }
  if (m && m[1] === "file") {
    if (job.status !== "done") return json(res, 409, { error: "not ready" });
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": statSync(job.file).size });
    return createReadStream(job.file).pipe(res);
  }
  json(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Studio bridge on http://127.0.0.1:${PORT} — renders with WanGP (${WANGP_DIR}), free.`);
  console.log("Leave this window open while you make videos in Jarvis → Studio.");
});
