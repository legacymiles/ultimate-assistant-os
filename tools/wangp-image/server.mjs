#!/usr/bin/env node
// ---------------------------------------------------------------------------
// The free picture drawer, on the owner's own PC.
//
// A tiny HTTP service in front of WanGP's Python API (generate.py beside this
// file). The hub asks it for a picture; it draws one on the RTX 3050 with Flux
// 2 Klein and hands back the bytes. No key, no account, no spend.
//
// Why its own service and not a verb on jarvis-bridge: the bridge runs Claude
// Code threads and is under active work. An image drawer has a different
// lifetime (one GPU, one job at a time, minutes-long warmups) and a different
// failure mode, and wiring it into the bridge would mean a stuck render could
// take the harness down with it. Separate port, separate process, separate
// blast radius.
//
//   node tools/wangp-image/server.mjs            # 127.0.0.1:3391
//   node tools/wangp-image/server.mjs --port 4000
//
//   GET  /health    -> { ok, model, busy, root }
//   POST /generate  -> { ok, image: "data:image/png;base64,...", ms, model }
//
// Binds to 127.0.0.1 ONLY. It runs an expensive GPU job on an unauthenticated
// request, so it must never be reachable from outside this machine.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = Number(flag("port", process.env.WANGP_IMAGE_PORT || 3391));
const ROOT = flag("root", process.env.WANGP_ROOT || "C:/pinokio/api/wan/app");
const MODEL = flag("model", process.env.WANGP_IMAGE_MODEL || "flux2_klein_4b");
/** Model load plus four steps. Generous: the first call of the day is the slow one. */
const TIMEOUT_MS = Number(flag("timeout", process.env.WANGP_IMAGE_TIMEOUT || 10 * 60 * 1000));
const MAX_BODY = 32_000;

const pythonPath = () => {
  const venv = path.join(ROOT, "venv", "Scripts", "python.exe");
  if (existsSync(venv)) return venv;
  const nix = path.join(ROOT, "venv", "bin", "python");
  if (existsSync(nix)) return nix;
  // Falling back to a system python will almost certainly fail on the import,
  // but generate.py turns that into one plain sentence rather than a stack.
  return process.env.PYTHON || "python";
};

/**
 * One job at a time. A 6 GB card cannot hold two renders, and two at once
 * means both die of out-of-memory instead of one finishing.
 */
let busy = false;

// ----- the worker ----------------------------------------------------------
// ONE Python process, loaded once, kept alive. This is the whole performance
// story: the first picture measured 144 s on the owner's 3050 and nearly all
// of that was loading Flux and the Qwen3 text encoder. Spawning per request
// pays that every time; holding the process means only the first one does.
// WanGP's API is built for this — it keeps the last loaded model alive.

/** @type {{ proc: import("node:child_process").ChildProcess, ready: Promise<void>, jobs: Map<string, (r: any) => void> } | null} */
let worker = null;
let nextJobId = 1;

function startWorker() {
  const py = pythonPath();
  const proc = spawn(py, [path.join(HERE, "generate.py"), "--serve", "--root", ROOT], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const jobs = new Map();
  let buf = "";
  let settle;
  const ready = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });

  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.ready !== undefined) {
        if (msg.ready) settle.resolve();
        else settle.reject(new Error(msg.error || "WanGP could not start."));
        continue;
      }
      const done = msg.id && jobs.get(msg.id);
      if (done) {
        jobs.delete(msg.id);
        done(msg);
      }
    }
  });

  proc.stderr.on("data", (d) => {
    const text = d.toString();
    // WanGP's progress bars are noisy; keep only its real lines.
    if (/\[wangp-image\]|error|Traceback|saved to/i.test(text)) {
      process.stderr.write(text.slice(0, 2000));
    }
  });

  const die = (reason) => {
    for (const [, resolve] of jobs) resolve({ ok: false, error: reason });
    jobs.clear();
    if (worker && worker.proc === proc) worker = null;
    settle.reject(new Error(reason));
  };

  proc.on("error", (e) => die(`Couldn't start Python (${py}): ${e.message}`));
  proc.on("close", (code) => die(`The picture drawer stopped (exit ${code}). The next request restarts it.`));

  worker = { proc, ready, jobs };
  return worker;
}

/** Get a loaded worker, starting one if needed. */
async function getWorker() {
  if (!worker) startWorker();
  await worker.ready;
  return worker;
}

/** Send one job to the worker and wait for its line back. */
function askWorker(w, job) {
  return new Promise((resolve) => {
    const id = String(nextJobId++);
    const timer = setTimeout(() => {
      if (!w.jobs.has(id)) return;
      w.jobs.delete(id);
      // A render that overran has left the GPU in an unknown state; the only
      // safe thing is to take the worker down and reload on the next request.
      try { w.proc.kill("SIGKILL"); } catch {}
      resolve({
        ok: false,
        error: `The picture took longer than ${Math.round(TIMEOUT_MS / 60000)} minutes and was stopped.`,
      });
    }, TIMEOUT_MS);

    w.jobs.set(id, (result) => {
      clearTimeout(timer);
      resolve(result);
    });

    try {
      w.proc.stdin.write(JSON.stringify({ ...job, id }) + "\n");
    } catch (e) {
      clearTimeout(timer);
      w.jobs.delete(id);
      resolve({ ok: false, error: `Couldn't reach the picture drawer: ${e.message}` });
    }
  });
}

/**
 * What these bytes actually are.
 *
 * The out path is asked for as .png, but WanGP decides its own format and
 * hands back its own path -- measured: a JPEG. Declaring `image/png` on JPEG
 * bytes works in a browser, which sniffs, and breaks everything that trusts
 * the label: a Storage upload stores the wrong content type, and an image
 * library picks the wrong decoder. So read the magic bytes instead of assuming.
 */
function mimeOf(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.slice(0, 4).toString("ascii") === "RIFF" && bytes.slice(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  // Unknown: say so rather than lying about it.
  return "application/octet-stream";
}

function send(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("That request is too big.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Clamp to something the card can actually hold, in multiples of 16. */
function side(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(256, Math.min(1536, Math.round(n / 16) * 16));
}

/** Draw one picture on the live worker, loading it first if this is the first call. */
async function runPython(settings, outPath) {
  let w;
  try {
    w = await getWorker();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The picture drawer wouldn't start." };
  }
  return askWorker(w, { ...settings, out: outPath });
}

const server = createServer(async (req, res) => {
  // Same-machine only, belt and braces alongside the 127.0.0.1 bind.
  const remote = req.socket.remoteAddress || "";
  if (!remote.includes("127.0.0.1") && !remote.includes("::1")) {
    send(res, 403, { ok: false, error: "This drawer only answers its own computer." });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": req.headers.origin || "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      // Chrome asks this before a public page (the hosted hub) may call a
      // drawer on this machine. The 127.0.0.1 bind and the remote-address
      // check above still keep every other computer out.
      "Access-Control-Allow-Private-Network": "true",
    });
    res.end();
    return;
  }
  if (req.headers.origin) res.setHeader("Access-Control-Allow-Origin", req.headers.origin);

  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, {
      ok: true,
      model: MODEL,
      busy,
      root: ROOT,
      hasWanGP: existsSync(path.join(ROOT, "shared", "api.py")),
      // Whether the model is already in memory. The first picture after a cold
      // start takes minutes; every one after it is far quicker, and the UI
      // should be able to say which the caller is about to get.
      loaded: Boolean(worker),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/generate") {
    if (busy) {
      send(res, 429, { ok: false, error: "Already drawing a picture. Try again in a moment." });
      return;
    }

    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      send(res, 400, { ok: false, error: e instanceof Error ? e.message : "That request couldn't be read." });
      return;
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      send(res, 400, { ok: false, error: "Say what to draw." });
      return;
    }

    const settings = {
      prompt: prompt.slice(0, 2000),
      model: typeof body.model === "string" && body.model ? body.model : MODEL,
      width: side(body.width, 1024),
      height: side(body.height, 1024),
      steps: Math.max(1, Math.min(50, Number(body.steps) || 4)),
      seed: Number.isFinite(Number(body.seed)) ? Number(body.seed) : -1,
    };

    busy = true;
    const started = Date.now();
    let dir = "";
    try {
      dir = await mkdtemp(path.join(tmpdir(), "wangp-img-"));
      const outPath = path.join(dir, "out.png");
      const result = await runPython(settings, outPath);

      if (!result.ok) {
        send(res, 502, { ok: false, error: result.error || "The picture couldn't be drawn.", ms: Date.now() - started });
        return;
      }

      const bytes = await readFile(result.path || outPath);
      send(res, 200, {
        ok: true,
        image: `data:${mimeOf(bytes)};base64,${bytes.toString("base64")}`,
        bytes: bytes.length,
        model: settings.model,
        steps: settings.steps,
        width: settings.width,
        height: settings.height,
        ms: Date.now() - started,
      });
    } catch (e) {
      send(res, 500, {
        ok: false,
        error: e instanceof Error ? e.message : "Something went wrong drawing that.",
        ms: Date.now() - started,
      });
    } finally {
      busy = false;
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    return;
  }

  send(res, 404, { ok: false, error: "No such thing here." });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[wangp-image] drawing with ${MODEL} on http://127.0.0.1:${PORT}`);
  console.log(`[wangp-image] WanGP at ${ROOT}`);
  if (!existsSync(path.join(ROOT, "shared", "api.py"))) {
    console.log(`[wangp-image] WARNING: no WanGP install found at ${ROOT} — set WANGP_ROOT.`);
  }
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    // Ask the worker to stop first, so WanGP unloads the model cleanly rather
    // than leaving several GB pinned until the OS reclaims it.
    try {
      worker?.proc.stdin.write(JSON.stringify({ stop: true }) + "\n");
      worker?.proc.kill();
    } catch {}
    server.close(() => process.exit(0));
  });
}
