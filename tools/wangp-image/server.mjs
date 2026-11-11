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
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { shotAllowed } from "./guard.mjs";

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
/** Big enough for a reference screenshot (data URL) or a coded mockup's HTML. */
const MAX_BODY = 16 * 1024 * 1024;
/**
 * Finished pictures, by what drew them. A board drawn from the chat command
 * and the same board opened in the Redesigner ask for the same prompt, size,
 * seed and reference, so the second one is instant instead of another GPU
 * minute. Only seeded requests are cached: an unseeded one asked for a new
 * picture.
 */
const CACHE_DIR = process.env.WANGP_IMAGE_CACHE || path.join(homedir(), ".cache", "wangp-image");

/** A page gets this long to settle before it is photographed. */
const SHOT_BUDGET_MS = 7000;

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


// ----- photographing a page -------------------------------------------------
// A mockup of an EDIT has to start from the page as it is, so the drawer can
// photograph any page with the headless browser already on this PC (Edge,
// else Chrome). Doing it here rather than in the hub means it works for a
// client's cross-origin site too, which the hub's own page can never read.

const BROWSERS = [
  process.env.MOCKUP_BROWSER,
  // Chrome first: measured on the owner's PC, Edge's headless mode exits at
  // once (code 2) without writing a picture, while Chrome takes ~5 s.
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const browserPath = () => BROWSERS.find((b) => existsSync(b)) || "";

/** Run one headless browser once and return the PNG it wrote. */
function runOne(exe, args, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(exe, args, { windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new Error("The page took too long to load to photograph."));
    }, SHOT_BUDGET_MS + 25_000);
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", async () => {
      clearTimeout(timer);
      try {
        const bytes = await readFile(outPath);
        if (!bytes.length) throw new Error("empty");
        resolve(bytes);
      } catch {
        reject(new Error("The browser couldn't photograph that page."));
      }
    });
  });
}

/** Try each installed browser in turn: one that exits without a picture is not the end. */
async function runBrowser(args, outPath) {
  const found = BROWSERS.filter((b) => existsSync(b));
  if (!found.length) throw new Error("No Chrome or Edge on this PC to photograph the page with.");
  let last;
  for (const exe of found) {
    try {
      return await runOne(exe, args, outPath);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/**
 * Photograph a page (by address) or a piece of HTML, at a real device width.
 * `base` lets coded mockup HTML load the hub's own fonts.
 */
async function photograph({ url, html, base, width, height }, dir) {
  const out = path.join(dir, `shot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`);
  let target = url;
  if (!target) {
    const file = path.join(dir, `page-${Date.now()}.html`);
    let doc = String(html || "");
    if (base && /^https?:\/\//.test(base) && !/<base\s/i.test(doc)) {
      doc = doc.replace(/<head([^>]*)>/i, `<head$1><base href="${base.replace(/"/g, "")}">`);
    }
    await writeFile(file, doc, "utf8");
    target = pathToFileURL(file).href;
  }
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--mute-audio",
    `--user-data-dir=${path.join(dir, "profile")}`,
    `--window-size=${width},${height}`,
    `--virtual-time-budget=${SHOT_BUDGET_MS}`,
    `--screenshot=${out}`,
    target,
  ];
  return runBrowser(args, out);
}

/** A data URL to a file the Python worker can read. */
async function dataUrlToFile(dataUrl, dir, i) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m) throw new Error("A reference picture must be a PNG, JPEG or WebP data URL.");
  const file = path.join(dir, `ref-${i}.${m[1].toLowerCase().replace("jpeg", "jpg")}`);
  await writeFile(file, Buffer.from(m[2], "base64"));
  return file;
}

/**
 * Turn the caller's references into files: a picture, a page address, or a
 * piece of HTML. A page or HTML is photographed at the size being drawn, so
 * the reference and the result line up pixel for pixel.
 */
async function resolveRefs(refs, dir, size, origin) {
  const files = [];
  for (const [i, ref] of (Array.isArray(refs) ? refs : []).slice(0, 3).entries()) {
    if (!ref || typeof ref !== "object") continue;
    if (typeof ref.image === "string") {
      files.push(await dataUrlToFile(ref.image, dir, i));
      continue;
    }
    if (typeof ref.url === "string") {
      const why = shotAllowed(ref.url, origin);
      if (why) throw new Error(why);
    }
    if (typeof ref.url === "string" || typeof ref.html === "string") {
      const w = Number(ref.width) || size.width;
      const h = Number(ref.height) || size.height;
      const bytes = await photograph({ url: ref.url, html: ref.html, base: ref.base, width: w, height: h }, dir);
      const file = path.join(dir, `ref-${i}.png`);
      await writeFile(file, bytes);
      files.push(file);
    }
  }
  return files;
}


// ----- the picture cache ----------------------------------------------------

/** What a reference contributes to the cache key: a page by its address, a picture or HTML by its bytes. */
function refIdentity(refs) {
  return (Array.isArray(refs) ? refs : []).slice(0, 3).map((r) => {
    if (!r || typeof r !== "object") return "";
    if (typeof r.url === "string") return `u:${r.url}`;
    const h = createHash("sha1");
    h.update(String(r.image || r.html || ""));
    return `${r.image ? "i" : "h"}:${h.digest("hex")}`;
  });
}

function cacheKeyOf(settings, refs) {
  return createHash("sha1")
    .update(JSON.stringify({ ...settings, refs: refIdentity(refs) }))
    .digest("hex");
}

/**
 * A picture painted from a page ADDRESS is keyed on the address, not the
 * screenshot (screenshots of one page never match byte for byte). So it can
 * outlive the page it shows: measured on stripe.com, the cache handed back a
 * picture of the nav as it was before the site changed. After this long the
 * page is photographed and painted again.
 */
const PAGE_PICTURE_TTL_MS = 6 * 60 * 60 * 1000;

const fromPage = (refs) => (Array.isArray(refs) ? refs : []).some((r) => r && typeof r.url === "string");

async function cacheRead(key, maxAgeMs = Infinity) {
  try {
    const file = path.join(CACHE_DIR, `${key}.img`);
    if (Number.isFinite(maxAgeMs) && Date.now() - (await stat(file)).mtimeMs > maxAgeMs) return null;
    return await readFile(file);
  } catch {
    return null;
  }
}

async function cacheWrite(key, bytes) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path.join(CACHE_DIR, `${key}.img`), bytes);
  } catch {
    /* a picture that can't be cached was still drawn */
  }
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
      // What this drawer can do beyond a prompt. Older drawers lack these, and
      // the hub falls back to text-only pictures when they are missing.
      refs: true,
      shot: Boolean(browserPath()),
    });
    return;
  }

  // Photograph a page or a piece of HTML. Not GPU work, so it doesn't wait on
  // `busy` -- a mockup board shows the "before" while the lanes are drawing.
  if (req.method === "POST" && url.pathname === "/shot") {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      send(res, 400, { ok: false, error: e instanceof Error ? e.message : "That request couldn't be read." });
      return;
    }
    const target = typeof body.url === "string" ? body.url.trim() : "";
    const html = typeof body.html === "string" ? body.html : "";
    if (!target && !html) {
      send(res, 400, { ok: false, error: "Send a page address (url) or some html to photograph." });
      return;
    }
    if (target) {
      const why = shotAllowed(target, req.headers.origin);
      if (why) {
        send(res, 403, { ok: false, error: why });
        return;
      }
    }
    const width = Math.max(320, Math.min(2560, Number(body.width) || 1280));
    const height = Math.max(320, Math.min(4000, Number(body.height) || 820));
    const started = Date.now();
    let dir = "";
    try {
      dir = await mkdtemp(path.join(tmpdir(), "wangp-shot-"));
      const bytes = await photograph({ url: target, html, base: body.base, width, height }, dir);
      send(res, 200, {
        ok: true,
        image: `data:${mimeOf(bytes)};base64,${bytes.toString("base64")}`,
        width,
        height,
        ms: Date.now() - started,
      });
    } catch (e) {
      send(res, 502, { ok: false, error: e instanceof Error ? e.message : "That page couldn't be photographed." });
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/generate") {
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

    // A seeded request already drawn is answered from disk, busy or not.
    const cacheKey = settings.seed >= 0 && !body.fresh ? cacheKeyOf(settings, body.refs) : "";
    if (cacheKey) {
      const hit = await cacheRead(cacheKey, fromPage(body.refs) ? PAGE_PICTURE_TTL_MS : Infinity);
      if (hit) {
        send(res, 200, {
          ok: true,
          image: `data:${mimeOf(hit)};base64,${hit.toString("base64")}`,
          bytes: hit.length,
          model: settings.model,
          width: settings.width,
          height: settings.height,
          cached: true,
          ms: 0,
        });
        return;
      }
    }

    if (busy) {
      send(res, 429, { ok: false, error: "Already drawing a picture. Try again in a moment." });
      return;
    }

    busy = true;
    const started = Date.now();
    let dir = "";
    try {
      dir = await mkdtemp(path.join(tmpdir(), "wangp-img-"));
      const outPath = path.join(dir, "out.png");
      let refs = [];
      try {
        refs = await resolveRefs(body.refs, dir, settings, req.headers.origin);
      } catch (e) {
        send(res, 400, { ok: false, error: e instanceof Error ? e.message : "The reference couldn't be read.", ms: Date.now() - started });
        return;
      }
      const result = await runPython({ ...settings, refs }, outPath);

      if (!result.ok) {
        send(res, 502, { ok: false, error: result.error || "The picture couldn't be drawn.", ms: Date.now() - started });
        return;
      }

      const bytes = await readFile(result.path || outPath);
      if (cacheKey) await cacheWrite(cacheKey, bytes);
      send(res, 200, {
        ok: true,
        image: `data:${mimeOf(bytes)};base64,${bytes.toString("base64")}`,
        bytes: bytes.length,
        model: settings.model,
        steps: settings.steps,
        width: settings.width,
        height: settings.height,
        refs: refs.length,
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
