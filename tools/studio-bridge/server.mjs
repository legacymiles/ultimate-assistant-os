#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Studio bridge — Jarvis Studio's free local video renderer and edit bay.
//
//   node tools/studio-bridge/server.mjs          (or double-click start.cmd)
//
// Jarvis runs on Vercel, which can't reach this PC. The owner's browser can:
// when Studio renders, the page sends the job straight to this bridge on
// 127.0.0.1:42010, which renders it with MiniMax H3 in WanGP (the Pinokio
// install) — $0, on the RTX 3050 — and hands the MP4 back to the page.
//
// Two jobs:
//
//   /video   one clip, as before.
//   /film    a whole shot plan, rendered IN ORDER and cut together into one
//            continuous film. This is the part that matters. H3 makes 4–15
//            seconds at a time, so a film is a dozen generations, and three
//            things stop a dozen generations looking like a dozen generations:
//
//              1. The prompts already carry the continuity (see
//                 src/lib/studio/storyboard.ts — the page writes them).
//              2. A shot marked "continuous" is rendered from the LAST FRAME of
//                 the shot before it (H3 FL2VA with a start image), so the join
//                 is not a match, it is the same frame. WanGP shares exactly one
//                 frame with a start image, so the edit drops that duplicate.
//              3. ffmpeg cuts the finished clips together — frame-accurate, one
//                 pass, one encode — and lays the owner's track underneath.
//
//            (WanGP can also continue from a whole source video, image_prompt_
//            type "V". A start frame is used instead because exactly one frame
//            is shared, which is the only version this edit can trim precisely.)
//
// One GPU, so renders run one at a time in arrival order. WanGP's MCP server is
// started on demand if it isn't already running on :42004.
//
//   GET  /health              { ok, wangp, queue, rate }
//   POST /video               { prompt, refs, durationSec, aspectRatio } → { id }
//   GET  /job/:id             { status, position?, error?, seconds? }
//   GET  /file/:id            the MP4
//   POST /film                { title, aspectRatio, shots: [...], soundtrack? } → { id }
//   GET  /film/:id            the whole progress view, with an ETA
//   GET  /film/:id/file       the stitched film
//   GET  /film/:id/shot/:n    one finished clip (1-based)
//   POST /film/:id/cancel     stop after the shot in the machine
// ---------------------------------------------------------------------------

import http from "node:http";
import { spawn } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(join(OUT, "refs"), { recursive: true });
mkdirSync(join(OUT, "films"), { recursive: true });

const PORT = Number(process.env.STUDIO_BRIDGE_PORT || 42010);
const WANGP_DIR = process.env.WANGP_DIR || "C:\\pinokio\\api\\wan\\app";
const WANGP_PORT = 42004;
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

// Pages allowed to send jobs: the live hub and any local dev server.
const ALLOWED = [/^https:\/\/ultimate-assistant-os\.vercel\.app$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

const jobs = new Map(); // id → { status, input, file?, error?, started?, finished? }
const films = new Map(); // id → film state
const queue = [];
let working = false;

// ----- how long a render takes here, learned ---------------------------------
//
// The ETA is only honest if it comes from this PC. Every finished shot updates
// a rolling seconds-per-frame kept on disk, so the second film of the week
// already knows what the first one measured.

const RATE_FILE = join(OUT, "rate.json");
const DEFAULT_RATE = { secondsPerFrame: 2.76, samples: 0 };

function loadRate() {
  try {
    const r = JSON.parse(readFileSync(RATE_FILE, "utf8"));
    if (Number.isFinite(r.secondsPerFrame) && r.secondsPerFrame > 0.05 && r.secondsPerFrame < 60) {
      return { secondsPerFrame: r.secondsPerFrame, samples: Number(r.samples) || 1 };
    }
  } catch {
    /* first run */
  }
  return { ...DEFAULT_RATE };
}

let rate = loadRate();

/** A finished shot is evidence. Twenty of them is enough of an average. */
function learnRate(seconds, frames) {
  if (!frames || seconds < 2) return;
  const observed = seconds / frames;
  const n = Math.min(20, rate.samples);
  rate = {
    secondsPerFrame: (rate.secondsPerFrame * n + observed) / (n + 1),
    samples: n + 1,
  };
  try {
    writeFileSync(RATE_FILE, JSON.stringify(rate));
  } catch {
    /* the estimate is worth having even if it cannot be kept */
  }
}

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
const FPS = 24;
function framesFor(seconds) {
  const want = Math.round(Math.min(15, Math.max(4, seconds || 5)) * FPS);
  return 107 + 17 * Math.max(0, Math.ceil((want - 107) / 17));
}

const RESOLUTION = { "16:9": "832x480", "9:16": "480x832", "1:1": "640x640" };

const TURBO_REF2VA =
  "https://huggingface.co/DeepBeepMeep/MiniMax-H3/resolve/main/loras/minimax_h3_lightx2v_ref2v_turbo_4step_alpha8_v0.1_bf16.safetensors";
const TURBO_FL2VA =
  "https://huggingface.co/DeepBeepMeep/MiniMax-H3/resolve/main/loras/minimax_h3_lightx2v_fl2v_turbo_4step_alpha16_v0.1.safetensors";

function saveDataUrl(file, dataUrl) {
  const m = /^data:([\w/+-]+);base64,(.+)$/.exec(dataUrl || "");
  if (!m) return null;
  writeFileSync(file, Buffer.from(m[2], "base64"));
  return file;
}

/** The owner's track, kept with an extension so ffmpeg knows what it is. */
function saveTrack(dir, dataUrl) {
  const m = /^data:audio\/([\w.+-]+);base64,/.exec(typeof dataUrl === "string" ? dataUrl : "");
  if (!m) return null;
  const ext = { mpeg: "mp3", "x-m4a": "m4a", mp4: "m4a", "x-wav": "wav", vnd_wave: "wav" }[m[1]] ?? m[1].replace(/[^a-z0-9]/g, "");
  return saveDataUrl(join(dir, `track.${ext || "mp3"}`), dataUrl);
}

function saveRef(id, i, dataUrl) {
  const m = /^data:image\/(png|jpeg|webp);base64,/.exec(dataUrl || "");
  if (!m) return null;
  return saveDataUrl(join(OUT, "refs", `${id}-${i}.${m[1] === "jpeg" ? "jpg" : m[1]}`), dataUrl);
}

// WanGP reads every line break as a separate prompt; a Studio prompt is one
// prompt laid out over several lines (subject_definitions:, summary:, …), so it
// is flattened before it is sent.
const flat = (t) => String(t).replace(/\s*\r?\n+\s*/g, " ").trim();

/**
 * One H3 generation.
 *
 * `startFrame` chains this clip onto the one before it: WanGP shares exactly
 * one frame with a start image, so the new clip opens on the old clip's last
 * frame and the edit drops the duplicate.
 */
async function generate({ id, prompt, refFiles = [], durationSec, aspectRatio, startFrame = null }) {
  await ensureWanGP();
  const withRefs = refFiles.length > 0 && !startFrame;
  const labels = refFiles.map((f, i) => `image ${i + 1} is ${f.label || `Subject ${i + 1}`}`).join("; ");
  const source = {
    model_type: withRefs ? "minimax_h3_ref2va_pruned" : "minimax_h3_fl2va_pruned",
    prompt: flat(withRefs && labels ? `${prompt} Reference images: ${labels}. Keep each one's identity and details exactly.` : prompt),
    resolution: RESOLUTION[aspectRatio] || RESOLUTION["16:9"],
    video_length: framesFor(durationSec),
    seed: Math.floor(Math.random() * 2 ** 31),
    num_inference_steps: 4,
    guidance_scale: 1,
    flow_shift: 12,
    loras_multipliers: "1.0",
    activated_loras: [withRefs ? TURBO_REF2VA : TURBO_FL2VA],
    config: "gguf_q2_k,int8_convrot,lower_ram",
    ...(withRefs ? { image_refs: refFiles.map((f) => resolve(f.path)), video_prompt_type: "I" } : {}),
    ...(startFrame ? { image_start: [resolve(startFrame)], image_prompt_type: "S" } : {}),
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

// ----- the edit bay ---------------------------------------------------------

function run(bin, args, { capture = false } = {}) {
  return new Promise((ok, fail) => {
    const p = spawn(bin, args, { windowsHide: true });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c.toString().slice(0, 2000)));
    p.on("error", (e) =>
      fail(
        new Error(
          e.code === "ENOENT"
            ? `${bin} isn't on this PC's PATH, so clips can't be cut together. Install ffmpeg, or set FFMPEG_PATH.`
            : e.message,
        ),
      ),
    );
    p.on("close", (code) =>
      code === 0 ? ok(capture ? out : "") : fail(new Error(`${bin} failed (${code}): ${err.trim().split("\n").pop() || "no output"}`)),
    );
  });
}

/** The exact frame a clip ends on — the next shot's opening frame. */
async function lastFrame(clip, to) {
  // -sseof seeks from the end; -update keeps overwriting, so the file left
  // behind is the final decoded frame rather than the first of the tail.
  await run(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-sseof", "-0.3", "-i", clip, "-update", "1", "-q:v", "2", to]);
  if (!existsSync(to)) throw new Error("Couldn't read the last frame of the previous shot.");
  return to;
}

async function hasAudio(clip) {
  try {
    const out = await run(FFPROBE, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", clip], {
      capture: true,
    });
    return out.trim().length > 0;
  } catch {
    // No ffprobe is not a reason to refuse the edit; assume H3's audio is there.
    return true;
  }
}

/**
 * Cut the finished clips together.
 *
 * One ffmpeg pass, one encode: trimming per clip and concatenating in the same
 * filter graph is the only way to drop the shared frame of a chained shot
 * frame-accurately. `trims[i]` is how many frames to drop off the front of clip
 * i — 1 for a chained shot, 0 for a cut.
 */
async function stitch(clips, trims, out) {
  if (clips.length === 1 && !trims[0]) {
    copyFileSync(clips[0], out);
    return out;
  }
  const audio = await Promise.all(clips.map(hasAudio));
  const silent = audio.some((a) => !a);
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const c of clips) args.push("-i", c);
  // One silent source stands in for any clip that came back without sound, so
  // the concat still has an audio pair per segment and stays in sync.
  if (silent) args.push("-f", "lavfi", "-t", "0.1", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  const nullIndex = clips.length;

  const parts = [];
  const streams = [];
  clips.forEach((_, i) => {
    const drop = trims[i] > 0;
    const vTrim = drop ? `trim=start_frame=${trims[i]},` : "";
    const aTrim = drop ? `atrim=start=${(trims[i] / FPS).toFixed(4)},` : "";
    parts.push(`[${i}:v]${vTrim}setpts=PTS-STARTPTS,fps=${FPS}[v${i}]`);
    parts.push(audio[i] ? `[${i}:a]${aTrim}asetpts=PTS-STARTPTS[a${i}]` : `[${nullIndex}:a]asetpts=PTS-STARTPTS[a${i}]`);
    streams.push(`[v${i}][a${i}]`);
  });
  parts.push(`${streams.join("")}concat=n=${clips.length}:v=1:a=1[v][a]`);

  args.push(
    "-filter_complex",
    parts.join(";"),
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    out,
  );
  await run(FFMPEG, args);
  return out;
}

async function durationOf(file) {
  try {
    const out = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { capture: true });
    const n = Number(out.trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Lay the owner's track under the finished film, leaving H3's own sound audible. */
async function scoreFilm(film, track, out) {
  const seconds = await durationOf(film);
  // Looped if it is shorter than the film, ducked well under the scene, and
  // faded out rather than chopped off at the last frame.
  const fade = seconds > 3 ? `,afade=t=out:st=${(seconds - 1.5).toFixed(2)}:d=1.5` : "";
  await run(FFMPEG, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", film,
    "-stream_loop", "-1", "-i", track,
    "-filter_complex",
    `[1:a]volume=0.35${fade}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`,
    "-map", "0:v",
    "-map", "[a]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    out,
  ]);
  return out;
}

// ----- one clip at a time ----------------------------------------------------

async function render(id, job) {
  const { prompt, refs = [], durationSec, aspectRatio } = job.input;
  const refFiles = refs
    .map((r, i) => ({ path: saveRef(id, i, r.dataUrl), label: r.label }))
    .filter((f) => f.path);
  return generate({ id, prompt, refFiles, durationSec, aspectRatio });
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
      const secs = Math.round((Date.now() - job.started) / 1000);
      learnRate(secs, framesFor(job.input.durationSec));
      console.log(`✓ ${id} in ${secs}s`);
    } catch (e) {
      job.status = "error";
      job.error = e instanceof Error ? e.message : String(e);
      console.log(`✗ ${id}: ${job.error}`);
    }
    job.finished = Date.now();
  }
  working = false;
}

// ----- a whole film ----------------------------------------------------------

const filmQueue = [];
let filming = false;

function filmDir(id) {
  const dir = join(OUT, "films", id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function renderFilm(id) {
  const film = films.get(id);
  const dir = filmDir(id);
  film.status = "rendering";
  film.startedAt = Date.now();

  let previousClip = null;
  for (const [i, shot] of film.shots.entries()) {
    if (film.cancelled) {
      shot.status = "cancelled";
      continue;
    }
    shot.status = "rendering";
    shot.startedAt = Date.now();
    film.current = i;
    console.log(`▶ ${id} shot ${i + 1}/${film.shots.length} — ${shot.link}, ${shot.durationSec}s`);
    try {
      // A chained shot opens on the frame the last one closed on. Without a
      // previous clip there is nothing to chain to, so it falls back to a cut.
      const chain = shot.link === "continuous" && previousClip;
      const startFrame = chain ? await lastFrame(previousClip, join(dir, `link-${i}.jpg`)) : null;
      const refFiles = (shot.refs ?? [])
        .map((r, k) => ({ path: saveRef(`${id}-${i}`, k, r.dataUrl), label: r.label }))
        .filter((f) => f.path);
      const clip = await generate({
        id: `${id}-${i}`,
        prompt: shot.prompt,
        refFiles,
        durationSec: shot.durationSec,
        aspectRatio: film.aspectRatio,
        startFrame,
      });
      const kept = join(dir, `shot-${i + 1}.mp4`);
      copyFileSync(clip, kept);
      shot.file = kept;
      shot.chained = Boolean(startFrame);
      shot.status = "done";
      shot.seconds = Math.round((Date.now() - shot.startedAt) / 1000);
      learnRate(shot.seconds, framesFor(shot.durationSec));
      previousClip = kept;
      console.log(`✓ ${id} shot ${i + 1} in ${shot.seconds}s${startFrame ? " (chained)" : ""}`);
    } catch (e) {
      shot.status = "error";
      shot.error = e instanceof Error ? e.message : String(e);
      console.log(`✗ ${id} shot ${i + 1}: ${shot.error}`);
      // A lost shot must not lose the film: the rest still renders, and the
      // edit cuts what landed. The next shot has no frame to chain from.
      previousClip = null;
    }
  }

  const done = film.shots.filter((s) => s.status === "done");
  if (!done.length) {
    film.status = "error";
    film.error = film.shots.find((s) => s.error)?.error ?? "Nothing rendered.";
    film.finishedAt = Date.now();
    return;
  }

  film.current = film.shots.length;
  film.status = "stitching";
  try {
    const cut = await stitch(
      done.map((s) => s.file),
      // Only a chained shot shares a frame with the one before it, and only
      // when that shot is actually the one it follows in the finished cut.
      done.map((s, i) => (i > 0 && s.chained ? 1 : 0)),
      join(dir, "film-cut.mp4"),
    );
    film.file = film.soundtrackFile ? await scoreFilm(cut, film.soundtrackFile, join(dir, "film.mp4")) : cut;
    film.status = "done";
    console.log(`✓ ${id} cut together: ${done.length} shot(s) → ${film.file}`);
  } catch (e) {
    // The clips are real even when the edit fails; say so rather than binning them.
    film.status = "error";
    film.error = e instanceof Error ? e.message : String(e);
    console.log(`✗ ${id} edit: ${film.error}`);
  }
  film.finishedAt = Date.now();
}

async function pumpFilms() {
  if (filming) return;
  filming = true;
  while (filmQueue.length) {
    const id = filmQueue.shift();
    try {
      await renderFilm(id);
    } catch (e) {
      const film = films.get(id);
      if (film) {
        film.status = "error";
        film.error = e instanceof Error ? e.message : String(e);
        film.finishedAt = Date.now();
      }
    }
  }
  filming = false;
}

/** What the page's progress bar reads. */
function filmView(id) {
  const film = films.get(id);
  const doneShots = film.shots.filter((s) => s.status === "done").length;
  const running = film.shots.find((s) => s.status === "rendering");
  const elapsedOnCurrent = running ? Math.round((Date.now() - running.startedAt) / 1000) : 0;
  const remainingFrames = film.shots
    .filter((s) => s.status === "queued" || s.status === "rendering")
    .reduce((t, s) => t + framesFor(s.durationSec), 0);
  const eta =
    film.status === "done" || film.status === "error"
      ? 0
      : Math.max(0, Math.round(remainingFrames * rate.secondsPerFrame - elapsedOnCurrent + (film.shots.length > 1 ? 8 : 0)));
  return {
    status: film.status,
    error: film.error,
    title: film.title,
    current: film.current,
    doneShots,
    etaSeconds: eta,
    elapsedSeconds: film.startedAt ? Math.round(((film.finishedAt ?? Date.now()) - film.startedAt) / 1000) : 0,
    secondsPerFrame: Math.round(rate.secondsPerFrame * 100) / 100,
    queue: filmQueue.length,
    shots: film.shots.map((s, i) => ({
      n: i + 1,
      title: s.title,
      status: s.status,
      link: s.link,
      chained: Boolean(s.chained),
      durationSec: s.durationSec,
      seconds: s.startedAt ? Math.round(((s.finishedAt ?? Date.now()) - s.startedAt) / 1000) : 0,
      // Inside a running shot the only honest signal is the clock, held just
      // short of 1 so a slow render never claims to have finished.
      percent:
        s.status === "done"
          ? 100
          : s.status === "rendering"
            ? Math.min(97, Math.round(((Date.now() - s.startedAt) / 1000 / (framesFor(s.durationSec) * rate.secondsPerFrame)) * 100))
            : 0,
      error: s.error,
    })),
  };
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

async function readBody(req, limit = 120_000_000) {
  let raw = "";
  for await (const c of req) {
    raw += c;
    if (raw.length > limit) throw new Error("too large");
  }
  return JSON.parse(raw);
}

function sendFile(res, file, type) {
  res.writeHead(200, { "Content-Type": type, "Content-Length": statSync(file).size });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const allowed = cors(req, res);
  if (req.method === "OPTIONS") return res.writeHead(allowed ? 204 : 403).end();
  if (!allowed) return json(res, 403, { error: "origin not allowed" });
  const url = new URL(req.url, "http://x");

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      wangp: await wangpUp(),
      queue: queue.length + (working ? 1 : 0) + filmQueue.length + (filming ? 1 : 0),
      rate: Math.round(rate.secondsPerFrame * 100) / 100,
      films: films.size,
    });
  }

  if (req.method === "POST" && url.pathname === "/video") {
    let input;
    try {
      input = await readBody(req, 40_000_000);
    } catch (e) {
      return json(res, e.message === "too large" ? 413 : 400, { error: e.message === "too large" ? "too large" : "bad json" });
    }
    if (typeof input.prompt !== "string" || !input.prompt.trim()) return json(res, 400, { error: "prompt required" });
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    jobs.set(id, { status: "queued", input: { ...input, refs: Array.isArray(input.refs) ? input.refs.slice(0, 6) : [] } });
    queue.push(id);
    void pump();
    return json(res, 200, { id });
  }

  if (req.method === "POST" && url.pathname === "/film") {
    let input;
    try {
      input = await readBody(req);
    } catch (e) {
      return json(res, e.message === "too large" ? 413 : 400, { error: e.message === "too large" ? "too large" : "bad json" });
    }
    const shots = (Array.isArray(input.shots) ? input.shots : [])
      .slice(0, 24)
      .filter((s) => s && typeof s.prompt === "string" && s.prompt.trim())
      .map((s, i) => ({
        title: typeof s.title === "string" ? s.title.slice(0, 90) : `Cut ${i + 1}`,
        prompt: s.prompt,
        durationSec: Math.min(15, Math.max(4, Number(s.durationSec) || 5)),
        link: i > 0 && s.link === "continuous" ? "continuous" : "cut",
        refs: Array.isArray(s.refs) ? s.refs.slice(0, 6) : [],
        status: "queued",
      }));
    if (!shots.length) return json(res, 400, { error: "a film needs at least one shot with a prompt" });
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const dir = filmDir(id);
    films.set(id, {
      title: typeof input.title === "string" ? input.title.slice(0, 120) : "Untitled film",
      aspectRatio: RESOLUTION[input.aspectRatio] ? input.aspectRatio : "16:9",
      shots,
      status: "queued",
      current: 0,
      soundtrackFile: saveTrack(dir, input.soundtrack),
    });
    filmQueue.push(id);
    void pumpFilms();
    return json(res, 200, { id, shots: shots.length });
  }

  const filmMatch = /^\/film\/([a-z0-9]+)(?:\/(file|cancel|shot\/\d+))?$/.exec(url.pathname);
  if (filmMatch) {
    const film = films.get(filmMatch[1]);
    if (!film) return json(res, 404, { error: "unknown film" });
    const tail = filmMatch[2];
    if (!tail) return json(res, 200, filmView(filmMatch[1]));
    if (tail === "cancel" && req.method === "POST") {
      film.cancelled = true;
      return json(res, 200, { ok: true });
    }
    if (tail === "file") {
      if (film.status !== "done" || !film.file) return json(res, 409, { error: "not ready" });
      return sendFile(res, film.file, "video/mp4");
    }
    const n = Number(tail.split("/")[1]);
    const shot = film.shots[n - 1];
    if (!shot?.file) return json(res, 409, { error: "that shot isn't ready" });
    return sendFile(res, shot.file, "video/mp4");
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
      // The page's ETA for a single clip comes from the same measured rate.
      ...(job.status === "rendering"
        ? { etaSeconds: Math.max(0, Math.round(framesFor(job.input.durationSec) * rate.secondsPerFrame - (Date.now() - job.started) / 1000)) }
        : {}),
    });
  }
  if (m && m[1] === "file") {
    if (job.status !== "done") return json(res, 409, { error: "not ready" });
    return sendFile(res, job.file, "video/mp4");
  }
  json(res, 404, { error: "not found" });
});

// Since install-autostart.cmd starts one at login, double-clicking start.cmd
// afterwards is the normal way to meet this — and finding one already running
// is good news, not a crash.
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.log(`A Studio bridge is already running on 127.0.0.1:${PORT}. Nothing to do.`);
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, "127.0.0.1", () => {
  // Plain ASCII: this also goes to out\bridge.log when the hidden copy starts
  // it, and a log full of mojibake is a log nobody reads.
  console.log(`Studio bridge on http://127.0.0.1:${PORT} - renders with WanGP (${WANGP_DIR}), free.`);
  console.log(`Measured render rate: ${rate.secondsPerFrame.toFixed(2)} s/frame from ${rate.samples} shot(s).`);
  console.log("Ready for Jarvis -> Studio. If this is a visible window, leave it open.");
});
