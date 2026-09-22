#!/usr/bin/env node
// ---------------------------------------------------------------------------
// One MiniMax H3 render, two places to run it.
//
//   node tools/h3-render/render.mjs --where local  --ref henry.jpg --prompt-file shot.txt
//   node tools/h3-render/render.mjs --where runpod --ref henry.jpg --prompt-file shot.txt
//
//   --where local    free. WanGP on this PC (Pinokio install), driven over its
//                    MCP server. Ref2VA Pruned 20B int8 + 4-step turbo LoRA.
//   --where runpod   paid, per second. The owner's RunPod Serverless endpoint
//                    (runpod/h3-worker, ComfyUI). Reference mode when --ref is
//                    given, text/first-frame otherwise.
//
//   --ref <img>          reference image (the person/object to keep)
//   --prompt-file <txt>  H3 prompt; with --ref use Ref2VA's six-section form
//   --seed <n>           default 532071176
//   --out <file.mp4>     default tools/h3-render/out/<where>-<time>.mp4
//
// Both modes print the same timing/cost line so the two can be compared.
// Local needs WanGP's MCP server on :42004:
//   cd C:\pinokio\api\wan\app
//   venv\Scripts\python.exe wgp.py --mcp --mcp-transport streamable-http --mcp-port 42004 --mcp-allow-read-file-system
// ---------------------------------------------------------------------------

import http from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

const arg = (f, d) => {
  const i = process.argv.indexOf(f);
  return i > -1 ? process.argv[i + 1] : d;
};
const where = arg("--where");
const ref = arg("--ref");
const promptFile = arg("--prompt-file");
const seed = Number(arg("--seed", "532071176"));
const out = resolve(arg("--out", resolve(HERE, "out", `${where}-${Date.now()}.mp4`)));

if (!["local", "runpod"].includes(where) || !promptFile) {
  console.error("usage: render.mjs --where local|runpod --prompt-file <txt> [--ref <img>] [--seed n] [--out file.mp4]");
  process.exit(2);
}
for (const f of [promptFile, ref].filter(Boolean)) {
  if (!existsSync(f)) { console.error(`not found: ${f}`); process.exit(2); }
}
const prompt = readFileSync(promptFile, "utf8").replace(/\r/g, "").trim();
mkdirSync(dirname(out), { recursive: true });

const started = Date.now();
const secs = () => (Date.now() - started) / 1000;

// ----- local: WanGP MCP ------------------------------------------------------

// Raw node:http with no timeout: a render holds the request open for many
// minutes, and fetch/undici aborts at 300 s waiting for headers.
let sessionId = null;
let rpcId = 0;
function rpc(method, params, notify = false) {
  const body = JSON.stringify(notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++rpcId, method, params });
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "Content-Length": Buffer.byteLength(body) };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  return new Promise((ok, fail) => {
    const req = http.request({ host: "127.0.0.1", port: 42004, path: "/mcp", method: "POST", headers }, (res) => {
      if (res.headers["mcp-session-id"]) sessionId = res.headers["mcp-session-id"];
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (notify) return ok(null);
        const line = data.split("\n").filter((l) => l.startsWith("data:")).pop();
        try { ok(JSON.parse(line ? line.slice(5) : data)); } catch { ok({ raw: data.slice(0, 800) }); }
      });
    });
    req.setTimeout(0);
    req.on("error", fail);
    req.end(body);
  });
}

async function runLocal() {
  try {
    await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "h3-render", version: "1" } });
  } catch {
    throw new Error("WanGP MCP is not running on :42004 — start it (see the header of this file)");
  }
  await rpc("notifications/initialized", {}, true);

  const source = {
    model_type: ref ? "minimax_h3_ref2va_pruned" : "minimax_h3_fl2va_pruned",
    prompt,
    resolution: "832x480",
    video_length: 124, // ~5.2 s at 24 fps; H3 wants 107 + 17k frames
    seed,
    num_inference_steps: 4,
    guidance_scale: 1,
    flow_shift: 12,
    loras_multipliers: "1.0",
    activated_loras: [
      ref
        ? "https://huggingface.co/DeepBeepMeep/MiniMax-H3/resolve/main/loras/minimax_h3_lightx2v_ref2v_turbo_4step_alpha8_v0.1_bf16.safetensors"
        : "https://huggingface.co/DeepBeepMeep/MiniMax-H3/resolve/main/loras/minimax_h3_lightx2v_fl2v_turbo_4step_alpha16_v0.1.safetensors",
    ],
    // Text encoder, video VAE, denoising priority: the smallest of each, so a
    // 12 GB-RAM laptop survives. Order matters (system_configs 1..3).
    config: "gguf_q2_k,int8_convrot,lower_ram",
    ...(ref ? { image_refs: [resolve(ref)], video_prompt_type: "I" } : {}),
  };
  console.log(`local WanGP: ${source.model_type}, 4 turbo steps, 832x480…`);
  const r = await rpc("tools/call", { name: "wangp_generate", arguments: { action: "generate", arguments: { source } } });
  const text = (r?.result?.content ?? []).map((c) => c.text).join("\n");
  let result;
  try { result = JSON.parse(text).result; } catch { throw new Error(`WanGP: ${text.slice(0, 600)}`); }
  if (!result?.success) throw new Error(`WanGP failed: ${JSON.stringify(result?.errors ?? text).slice(0, 600)}`);
  const file = result.generated_files[0];
  copyFileSync(file, out);
  const gen = readFileSync(file).toString("latin1").match(/"generation_time":\s*(\d+)/);
  return { cost: 0, renderS: gen ? Number(gen[1]) : null };
}

// ----- runpod: the owner's serverless endpoint --------------------------------

function env(name) {
  if (process.env[name]) return process.env[name];
  const p = resolve(ROOT, ".env.local");
  if (!existsSync(p)) return "";
  const m = readFileSync(p, "utf8").match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

// RunPod bills worker seconds; this is the rate runpod/README.md measured on.
const RUNPOD_USD_PER_HOUR = 1.58;

async function runRunpod() {
  const key = env("RUNPOD_API_KEY");
  const id = env("RUNPOD_ENDPOINT_ID");
  if (!key || !id) throw new Error("need RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID in .env.local");
  const base = `https://api.runpod.ai/v2/${id}`;
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  const references = ref
    ? [{
        label: "Subject 1",
        kind: "image",
        data_url: `data:${{ ".png": "image/png", ".webp": "image/webp" }[extname(ref).toLowerCase()] || "image/jpeg"};base64,${readFileSync(ref).toString("base64")}`,
      }]
    : undefined;

  const res = await fetch(`${base}/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: { prompt, references, duration: 5, aspect_ratio: "16:9", resolution: "draft", turbo: true, seed } }),
  });
  const job = await res.json();
  if (!res.ok || !job.id) throw new Error(`submit failed: ${res.status} ${JSON.stringify(job).slice(0, 400)}`);
  console.log(`runpod job ${job.id} (${ref ? "reference" : "text"} mode, draft 864x480, turbo)…`);

  let last = "";
  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000));
    const d = await (await fetch(`${base}/status/${job.id}`, { headers })).json().catch(() => ({}));
    const stream = Array.isArray(d.stream) ? d.stream : [];
    const note = stream.at(-1)?.output?.note ?? d.output?.note ?? "";
    if (note && note !== last) console.log(`  [${(secs() / 60).toFixed(1)}m] ${(last = note)}`);

    if (d.status === "COMPLETED") {
      if (d.output?.error) throw new Error(`worker: ${d.output.error}`);
      if (!d.output?.video_base64) throw new Error(`no video in output: ${JSON.stringify(d.output).slice(0, 300)}`);
      writeFileSync(out, Buffer.from(d.output.video_base64, "base64"));
      const billedS = (Number(d.delayTime || 0) + Number(d.executionTime || 0)) / 1000;
      return { cost: billedS * (RUNPOD_USD_PER_HOUR / 3600), renderS: Number(d.executionTime || 0) / 1000, billedS, boot: d.output.boot };
    }
    if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(d.status)) throw new Error(`${d.status}: ${JSON.stringify(d).slice(0, 600)}`);
    if (secs() > 45 * 60) throw new Error(`gave up after 45 min; job ${job.id} may still be running`);
  }
}

// ----- main -------------------------------------------------------------------

try {
  const r = where === "local" ? await runLocal() : await runRunpod();
  console.log(`\nDONE ${out}`);
  console.log(
    `  where=${where}  wall=${(secs() / 60).toFixed(1)} min` +
      (r.renderS != null ? `  render=${(r.renderS / 60).toFixed(1)} min` : "") +
      (r.billedS != null ? `  billed=${r.billedS.toFixed(0)} s` : "") +
      `  cost=$${r.cost.toFixed(3)}` +
      (r.boot ? `  boot=${JSON.stringify(r.boot)}` : ""),
  );
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}
