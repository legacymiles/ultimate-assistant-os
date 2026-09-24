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
//              2. A shot marked "continuous" is CONTINUED from the shot before
//                 it: handover.mjs reads where that shot really ended, a short
//                 run of its real frames is cut out there, and WanGP hands
//                 those frames to H3 as temporal context. Motion and sound
//                 cross the join instead of restarting, which a single still
//                 frame can never make them do.
//              3. ffmpeg cuts the finished clips together — frame-accurate, one
//                 pass, one encode — dropping each clip's duplicated handover
//                 head, its warm-up, and its landing, holding exposure steady
//                 across the cuts, and laying the owner's track underneath.
//
//            The boundary handover.mjs finds is used TWICE and must be: it is
//            both the last frame of a shot the audience sees and the last frame
//            the next shot continues from. If those two ever disagree, the film
//            continues from a moment nobody watched.
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
//   POST /composite           { base, plate|plateJob, corner, share, … } → { id }
//                             a cut-out matted over a video; polls on /job/:id like a clip
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
import { analyzeClip, probeClip } from "./handover.mjs";
import { stitchWindows } from "./windows.mjs";

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
/**
 * `timeoutMs` is 0 for a generation, which legitimately holds the request open
 * for many minutes. Everything else gets a deadline: WanGP can wedge — a client
 * that dies mid-render leaves a session it never finishes answering — and
 * without one, a question as small as "are you there?" hangs forever, which the
 * page reads as the whole renderer being dead rather than busy.
 */
function rpc(method, params, notify = false, timeoutMs = 0) {
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
    req.setTimeout(timeoutMs);
    if (timeoutMs) {
      req.on("timeout", () => {
        req.destroy(new Error(`WanGP didn't answer ${method} within ${Math.round(timeoutMs / 1000)}s.`));
      });
    }
    req.on("error", fail);
    req.end(body);
  });
}

/** Is WanGP answering? A probe, so it gets a short deadline rather than none. */
async function wangpUp() {
  try {
    sessionId = null;
    await rpc(
      "initialize",
      { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "studio-bridge", version: "1" } },
      false,
      8000,
    );
    await rpc("notifications/initialized", {}, true, 8000);
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
const MAX_FRAMES = 107 + 17 * 14; // 345, a shade over 14 s — H3's ceiling here.
/** The smallest window H3 will actually render that holds `frames`. */
const gridFrames = (frames) =>
  Math.min(MAX_FRAMES, 107 + 17 * Math.max(0, Math.ceil((frames - 107) / 17)));
function framesFor(seconds) {
  return gridFrames(Math.round(Math.min(15, Math.max(4, seconds || 5)) * FPS));
}

/**
 * How many frames of the previous shot a continuation carries.
 *
 * WanGP's sliding window takes 1 + 17k, and the overlap is real temporal
 * context: the model sees those frames and continues the motion in them instead
 * of starting from rest. 18 frames is three quarters of a second — enough for
 * the model to know which way everything was travelling, cheap enough that a
 * chained shot only costs about a minute and a half of extra GPU time.
 */
const OVERLAP = Number(process.env.STUDIO_OVERLAP || 18);

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
 * `chain` continues this clip from the one before it. It is a short run of the
 * previous clip's real frames, not a still: WanGP hands those frames to H3 as
 * temporal context, so motion and sound cross the join instead of restarting.
 * They come back at the head of the new clip, and the edit drops them.
 *
 * Because the overlap is spent on context rather than on new film, the window
 * asked for is the wanted length PLUS the overlap — otherwise every chained
 * shot lands short, and on a film cut to music that shortfall compounds.
 */
async function generate({ id, prompt, refFiles = [], durationSec, aspectRatio, chain = null }) {
  await ensureWanGP();
  const withRefs = refFiles.length > 0 && !chain;
  const frames = chain
    ? gridFrames(framesFor(durationSec) + chain.overlap)
    : framesFor(durationSec);
  const labels = refFiles.map((f, i) => `image ${i + 1} is ${f.label || `Subject ${i + 1}`}`).join("; ");
  const source = {
    model_type: withRefs ? "minimax_h3_ref2va_pruned" : "minimax_h3_fl2va_pruned",
    prompt: flat(withRefs && labels ? `${prompt} Reference images: ${labels}. Keep each one's identity and details exactly.` : prompt),
    resolution: RESOLUTION[aspectRatio] || RESOLUTION["16:9"],
    video_length: frames,
    seed: Math.floor(Math.random() * 2 ** 31),
    num_inference_steps: 4,
    guidance_scale: 1,
    flow_shift: 12,
    loras_multipliers: "1.0",
    activated_loras: [withRefs ? TURBO_REF2VA : TURBO_FL2VA],
    config: "gguf_q2_k,int8_convrot,lower_ram",
    ...(withRefs ? { image_refs: refFiles.map((f) => resolve(f.path)), video_prompt_type: "I" } : {}),
    ...(chain
      ? {
        video_source: resolve(chain.source),
        // Counted from frame 0 of the source, which is why the handover is cut
        // into its own file rather than pointing at the whole previous clip.
        keep_frames_video_source: String(chain.overlap),
        sliding_window_overlap: chain.overlap,
        sliding_window_size: frames,
        image_prompt_type: "V",
      }
      : {}),
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

function run(bin, args, { capture = false, captureErr = false } = {}) {
  return new Promise((ok, fail) => {
    const p = spawn(bin, args, { windowsHide: true });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += captureErr ? c.toString() : c.toString().slice(0, 2000)));
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
      code === 0 ? ok(captureErr ? err : capture ? out : "") : fail(new Error(`${bin} failed (${code}): ${err.trim().split("\n").pop() || "no output"}`)),
    );
  });
}

/**
 * The handover: the last `frames` frames of a clip, ending where the clip
 * really ends rather than where its file does.
 *
 * H3 does not stop a clip, it lands one — the ending decelerates and can settle
 * into a repeated final image. Hand the next shot a single still frame from
 * inside that landing and it opens on a picture that has already stopped, so
 * the model has no motion to continue and invents its own. A run of real frames
 * carries velocity, and carries the audio with it, which one frame can never do.
 *
 * `endFrame` comes from handover.mjs and is the SAME frame the visible clip is
 * trimmed to. If those two ever disagree, the next shot continues from a moment
 * the audience never saw.
 */
async function handoverClip(clip, endFrame, frames, to) {
  const from = Math.max(0, endFrame - frames + 1);
  await run(FFMPEG, [
    "-y", "-hide_banner", "-loglevel", "error", "-i", clip,
    "-vf", `trim=start_frame=${from}:end_frame=${endFrame + 1},setpts=PTS-STARTPTS`,
    "-af", `atrim=start=${(from / FPS).toFixed(4)}:end=${((endFrame + 1) / FPS).toFixed(4)},asetpts=PTS-STARTPTS`,
    // Near-lossless: this is temporal context for a generation, so its own
    // compression artefacts would be handed straight to the next shot.
    "-c:v", "libx264", "-crf", "12", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", to,
  ]);
  if (!existsSync(to)) throw new Error("Couldn't cut the handover out of the previous shot.");
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
 * One ffmpeg pass, one encode: trimming, exposure-matching and concatenating in
 * the same filter graph is the only way to do all three frame-accurately and
 * still pay for a single encode.
 *
 * `windows[i]` says what to use of clip i:
 *
 *   from    frames to drop off the front. The duplicated handover head of a
 *           chained shot, or the warm-up of a shot that starts something —
 *           H3 spends its opening frames establishing before anything moves,
 *           and a film cut on file boundaries stalls at every join because of
 *           it.
 *   frames  how many to keep after that (0 = to the end). This is where the
 *           landing gets dropped, and where a film cut to a song gets every
 *           clip pulled back to the slot it was planned for: H3 renders in
 *           whole latent windows (107 frames, then 17 at a time), so a clip
 *           asked for as 5.00 s comes back as 5.167 s. Invisible once; over a
 *           dozen shots it puts the picture most of a second behind the music.
 *   gain    a flat RGB gain, to hold exposure steady across a cut. Separately
 *           generated clips drift in brightness — measured on a real film,
 *           consecutive shots ran 0.24 → 0.40 → 0.28 mean luma, so the film
 *           visibly pumped at every join. Shots inside one continuous run share
 *           a gain, so a correction can never introduce a step where the
 *           picture was already unbroken.
 */
async function stitch(clips, windows, out) {
  const win = (i) => ({ from: 0, frames: 0, gain: 1, ...(windows[i] || {}) });
  const untouched = clips.every((_, i) => {
    const w = win(i);
    return !w.from && !w.frames && Math.abs(w.gain - 1) < 0.005;
  });
  if (clips.length === 1 && untouched) {
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
    const w = win(i);
    const from = w.from > 0 ? Math.round(w.from) : 0;
    // A length is expressed as an end FRAME rather than a duration, because the
    // concat downstream is frame-based and a fractional duration would round
    // differently in the video and the audio halves of the same segment.
    const want = w.frames > 0 ? Math.max(1, Math.round(w.frames)) : 0;
    const vTrim = from || want ? `trim=${from ? `start_frame=${from}` : ""}${
      from && want ? ":" : ""
    }${want ? `end_frame=${from + want}` : ""},` : "";
    const aTrim = from || want ? `atrim=${from ? `start=${(from / FPS).toFixed(4)}` : ""}${
      from && want ? ":" : ""
    }${want ? `end=${((from + want) / FPS).toFixed(4)}` : ""},` : "";
    // A flat multiplier on all three channels: an exposure correction, not a
    // grade. Anything big enough to need more than this is a shot that came out
    // wrong, and pushing it further only crushes or blows it.
    const g = Math.abs(w.gain - 1) < 0.005 ? "" : `colorchannelmixer=rr=${w.gain.toFixed(4)}:gg=${w.gain.toFixed(4)}:bb=${w.gain.toFixed(4)},`;
    parts.push(`[${i}:v]${vTrim}${g}setpts=PTS-STARTPTS,fps=${FPS}[v${i}]`);
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

/**
 * Read a finished clip: where it really ends, its warm-up, its exposure, and
 * whether it is a shot at all.
 *
 * Diagnostics must never be able to lose a film. If the read fails — no ffmpeg,
 * a clip that will not decode — the film falls back to using the whole clip as
 * it always did, which is the behaviour this replaced and is merely worse, not
 * broken.
 */
async function readEnding(clip) {
  try {
    const { _firstFrameGray, _lastFrameGray, ...read } = await analyzeClip(clip);
    return read;
  } catch (e) {
    console.log(`  (couldn't read ${clip}: ${e instanceof Error ? e.message : e})`);
    const { frames } = await probeClip(clip).catch(() => ({ frames: 0 }));
    return {
      frames,
      handoverEndFrame: Math.max(0, frames - 1),
      tailFrames: 0,
      headTrim: 0,
      meanLuma: 0,
      dead: false,
      reason: "unread",
      motion: {},
    };
  }
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

/**
 * Lay the owner's track OVER the finished film, as the master.
 *
 * The other mode (`scoreFilm`, below) treats the track as a bed: ducked to a
 * third, looped to fit, mixed under whatever sound the clips generated. That is
 * right for a film that happens to have music on it and exactly wrong for a
 * film that was cut TO a piece of audio — there the track is not
 * accompaniment, it is the thing the picture was measured against, so it plays
 * at its own level, unlooped, from the second the film starts at, and the
 * clips' own invented audio is dropped rather than fighting it.
 *
 * `-shortest` is the safety net: picture and track were planned to the same
 * length, and if a lost shot made the cut shorter, the file ends with the
 * picture instead of running on over black.
 */
async function masterFilm(film, track, out, fromSec = 0) {
  const from = Number.isFinite(fromSec) && fromSec > 0 ? fromSec : 0;
  await run(FFMPEG, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", film,
    ...(from ? ["-ss", from.toFixed(3)] : []),
    "-i", track,
    "-map", "0:v",
    "-map", "1:a",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "256k",
    "-shortest",
    "-movflags", "+faststart",
    out,
  ]);
  return out;
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

// ----- the edit bay: a cut-out over a video ----------------------------------
//
// The reaction format (src/lib/studio/skills/reaction-video.md): the source
// video plays full frame and the rendered plate is matted over it — a cut-out
// standing in the picture, never one half of a split screen.
//
// Both numbers that decide the result are easy to get wrong in a way that
// still SUCCEEDS, which is why they are computed here instead of trusted:
//
//   THE HEIGHT is a share of the SOURCE's height, and the obvious
//   `scale=-1:ih*0.32` reads `ih` as the PLATE's own height. A 480-tall plate
//   over a 1920-tall video puts the reactor at 154px instead of 614, and
//   ffmpeg reports nothing. So the base is probed and the scale is in pixels.
//   (`scale2ref` does the arithmetic properly, but only with `ref_h` —
//   `main_h` is the same trap again — and it is now deprecated.)
//
//   THE KEY is whatever green the renderer actually produced, which is never
//   the textbook chroma value. Keying against a colour that is not in the
//   picture removes nothing and, again, succeeds. So it is sampled.

/** Where the cut-out stands. `i` is the inset, as a share of the frame width. */
const CORNERS = {
  "bottom-left": (i) => ({ x: `W*${i}`, y: "H-h" }),
  "bottom-right": (i) => ({ x: `W-w-W*${i}`, y: "H-h" }),
  "top-left": (i) => ({ x: `W*${i}`, y: `H*${i}` }),
  "top-right": (i) => ({ x: `W-w-W*${i}`, y: `H*${i}` }),
};

async function videoSize(file) {
  const out = await run(
    FFPROBE,
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file],
    { capture: true },
  );
  const [w, h] = out.trim().split("x").map(Number);
  if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h)) throw new Error("Couldn't read that video's size.");
  return { w, h };
}

/**
 * The key colour, sampled off the plate rather than assumed.
 *
 * Four corners, greenest wins: the subject is in the middle of the frame so a
 * corner is background, but which corner is clear depends on where they stand.
 * If nothing is convincingly green the plate is not keyable, and saying so
 * beats laying a green rectangle over the owner's video.
 */
async function sampleKey(plate, dir) {
  const { w, h } = await videoSize(plate);
  const s = Math.max(4, Math.min(24, Math.round(Math.min(w, h) / 24)));
  let best = null;
  for (const [x, y] of [[0, 0], [w - s, 0], [0, h - s], [w - s, h - s]]) {
    const raw = join(dir, `key-${x}x${y}.raw`);
    await run(FFMPEG, [
      "-y", "-hide_banner", "-loglevel", "error", "-i", plate,
      "-vf", `crop=${s}:${s}:${x}:${y},scale=1:1`,
      "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw,
    ]);
    const px = readFileSync(raw);
    const greenness = px[1] - Math.max(px[0], px[2]);
    if (!best || greenness > best.greenness) best = { r: px[0], g: px[1], b: px[2], greenness };
  }
  if (!best || best.greenness < 24) {
    throw new Error(
      "The plate has no green background to cut out of. Render the reactor against a flat chroma-green field, "
      + "or send an explicit key colour.",
    );
  }
  return `0x${[best.r, best.g, best.b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Where the reactor actually is inside the plate.
 *
 * Without this, `share` is the share of frame height the PLATE occupies and
 * the reactor is whatever fraction of that they happen to fill — so a 16:9
 * plate over a 9:16 video gets clamped to fit the width and the reactor
 * arrives half the size that was asked for, with nothing reporting a problem.
 *
 * The key has already decided what is background, so the alpha channel IS the
 * cut-out: cropdetect over it returns the box the reactor moves within across
 * the whole clip. Returns null when it cannot tell, and the caller then scales
 * the whole frame as before rather than refusing to composite.
 */
async function reactorBox(plate, key, similarity, blend) {
  const chain = [
    key ? `chromakey=${key}:${similarity}:${blend}` : null,
    // alphaextract cannot pick its own format here, and chromakey's output
    // has to be named for it or the graph fails to configure at all.
    "format=yuva420p",
    "alphaextract",
    "format=gray",
    "cropdetect=limit=0.08:round=2:reset=0",
  ]
    .filter(Boolean)
    .join(",");
  try {
    // Three seconds covers the range of their movement, and cropdetect
    // accumulates across frames rather than resetting.
    const err = await run(
      FFMPEG,
      ["-hide_banner", "-v", "info", "-i", plate, "-vf", chain, "-frames:v", "72", "-f", "null", "-"],
      { captureErr: true },
    );
    const all = [...err.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
    if (!all.length) return null;
    const [, w, h, x, y] = all[all.length - 1].map(Number);
    return w > 8 && h > 8 ? { w, h, x, y } : null;
  } catch {
    return null;
  }
}

async function compose(id, job) {
  const dir = join(OUT, "composites", id);
  mkdirSync(dir, { recursive: true });
  const base = saveDataUrl(join(dir, "base.mp4"), job.input.base);
  const plate = job.input.plateJob
    ? jobs.get(job.input.plateJob)?.file
    : saveDataUrl(join(dir, "plate.mp4"), job.input.plate);
  if (!base) throw new Error("The source video didn't arrive.");
  if (!plate || !existsSync(plate)) throw new Error("The reactor plate didn't arrive.");

  const { share, corner, inset, similarity, blend, audio } = job.input;
  const baseSize = await videoSize(base);
  const key = job.input.key === "none" ? null : job.input.key === "auto" ? await sampleKey(plate, dir) : job.input.key;
  job.key = key;

  // `share` is the REACTOR's share of the frame, so the plate is trimmed to
  // the reactor first — otherwise the surrounding green counts toward their
  // height and they arrive smaller than asked for.
  const box = await reactorBox(plate, key, similarity, blend);
  const plateSize = box ? { w: box.w, h: box.h } : await videoSize(plate);
  job.cropped = Boolean(box);

  // A share of the BASE height, in pixels, and never wider than the frame it
  // is standing in. Even numbers only: an odd one breaks yuv420p.
  let height = Math.round(baseSize.h * share);
  const widthAt = (px) => Math.round((px * plateSize.w) / plateSize.h);
  const room = Math.round(baseSize.w * (1 - 2 * inset));
  if (widthAt(height) > room) height = Math.round((room * plateSize.h) / plateSize.w);
  height = Math.max(2, height - (height % 2));
  job.placed = { height, width: widthAt(height), of: baseSize };

  const { x, y } = CORNERS[corner](inset);
  const cut =
    (key ? `chromakey=${key}:${similarity}:${blend},` : "")
    + (box ? `crop=${box.w}:${box.h}:${box.x}:${box.y},` : "")
    + (key ? "despill," : "");
  // eof_action=pass: when the plate runs out the source keeps playing rather
  // than the whole thing ending on the reactor's last frame.
  const chains = [`[1:v]${cut}scale=-1:${height}[r]`, `[0:v][r]overlay=${x}:${y}:eof_action=pass[v]`];

  const [baseHasAudio, plateHasAudio] = await Promise.all([hasAudio(base), hasAudio(plate)]);
  const want = { base: baseHasAudio, plate: plateHasAudio, both: baseHasAudio || plateHasAudio }[audio];
  const mixBoth = audio === "both" && baseHasAudio && plateHasAudio;
  if (mixBoth) {
    chains.push("[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]");
  }
  const track = !want ? [] : mixBoth ? ["-map", "[a]"] : ["-map", audio === "plate" && plateHasAudio ? "1:a" : "0:a"];

  const out = join(dir, "out.mp4");
  await run(FFMPEG, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", base, "-i", plate,
    "-filter_complex", chains.join(";"),
    "-map", "[v]", ...track,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    ...(want ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
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

/**
 * Composites run immediately rather than joining the queue: the queue exists
 * because there is one GPU, and this never touches it. Waiting six minutes
 * behind a render for a few seconds of ffmpeg would be a queue for its own
 * sake.
 */
async function runComposite(id) {
  const job = jobs.get(id);
  job.status = "rendering";
  job.started = Date.now();
  console.log(`▶ ${id} — composite`);
  try {
    job.file = await compose(id, job);
    job.status = "done";
    console.log(
      `✓ ${id} composite in ${Math.round((Date.now() - job.started) / 1000)}s — cut-out `
      + `${job.placed.width}x${job.placed.height} over ${job.placed.of.w}x${job.placed.of.h}`
      + `${job.key ? `, key ${job.key}` : ", alpha"}${job.cropped ? "" : " (whole frame — reactor bounds not found)"}`,
    );
  } catch (e) {
    job.status = "error";
    job.error = e instanceof Error ? e.message : String(e);
    console.log(`✗ ${id}: ${job.error}`);
  }
  job.finished = Date.now();
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
      // A chained shot continues the one before it from where that shot really
      // ended — the boundary its own reading produced, not the end of its file.
      // Without a previous clip there is nothing to continue, so it falls back
      // to a cut.
      const previous = shot.link === "continuous" ? previousClip : null;
      const chain = previous
        ? {
          source: await handoverClip(previous.file, previous.read.handoverEndFrame, OVERLAP, join(dir, `link-${i}.mp4`)),
          overlap: OVERLAP,
        }
        : null;
      const refFiles = (shot.refs ?? [])
        .map((r, k) => ({ path: saveRef(`${id}-${i}`, k, r.dataUrl), label: r.label }))
        .filter((f) => f.path);
      const clip = await generate({
        id: `${id}-${i}`,
        prompt: shot.prompt,
        refFiles,
        durationSec: shot.durationSec,
        aspectRatio: film.aspectRatio,
        chain,
      });
      const kept = join(dir, `shot-${i + 1}.mp4`);
      copyFileSync(clip, kept);
      shot.file = kept;
      shot.chained = Boolean(chain);
      shot.overlap = chain ? chain.overlap : 0;
      // Read the finished clip once, here, while it is the only thing going on:
      // where it really ends, how long it takes to get moving, how bright it is,
      // and whether anything happened in it at all. The edit needs all four, and
      // so does the next shot.
      shot.read = await readEnding(kept);
      if (shot.read.dead) {
        shot.warning = "This shot barely moves — H3 made a still picture of the scene rather than "
          + "something happening in it. Give it an action that has to finish inside the shot, name a "
          + "camera move, and render it again.";
        console.log(`! ${id} shot ${i + 1} barely moves (${shot.read.motion.whole})`);
      }
      shot.status = "done";
      shot.seconds = Math.round((Date.now() - shot.startedAt) / 1000);
      learnRate(shot.seconds, framesFor(shot.durationSec) + (chain ? chain.overlap : 0));
      previousClip = shot;
      console.log(
        `✓ ${id} shot ${i + 1} in ${shot.seconds}s${chain ? ` (continued from ${chain.overlap}f)` : ""}`
        + ` — ends at ${shot.read.handoverEndFrame}/${shot.read.frames} (${shot.read.reason})`,
      );
    } catch (e) {
      shot.status = "error";
      shot.error = e instanceof Error ? e.message : String(e);
      console.log(`✗ ${id} shot ${i + 1}: ${shot.error}`);
      // A lost shot must not lose the film: the rest still renders, and the
      // edit cuts what landed. The next shot has nothing to continue from.
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
      stitchWindows(done, {
        // A score's clips are cut back to the slots they were planned for; an
        // ordinary film's run to wherever each shot really ends.
        slotFrames: (s) => (film.audioMode === "master" ? Math.round(s.durationSec * FPS) : 0),
      }),
      join(dir, "film-cut.mp4"),
    );
    film.file = !film.soundtrackFile
      ? cut
      : film.audioMode === "master"
        ? await masterFilm(cut, film.soundtrackFile, join(dir, "film.mp4"), film.soundtrackFromSec)
        : await scoreFilm(cut, film.soundtrackFile, join(dir, "film.mp4"));
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
      // A shot that rendered fine and still has nothing happening in it is not
      // an error, and the owner should not have to find it by watching.
      warning: s.warning,
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

  if (req.method === "POST" && url.pathname === "/composite") {
    let input;
    try {
      input = await readBody(req);
    } catch (e) {
      return json(res, e.message === "too large" ? 413 : 400, { error: e.message === "too large" ? "too large" : "bad json" });
    }
    if (typeof input.base !== "string" || !input.base.startsWith("data:video/")) {
      return json(res, 400, { error: "base must be the source video as a data URL" });
    }
    const fromJob = typeof input.plateJob === "string" ? jobs.get(input.plateJob) : null;
    if (input.plateJob && (!fromJob || fromJob.status !== "done")) {
      return json(res, 400, { error: "that plate job isn't finished" });
    }
    if (!input.plateJob && (typeof input.plate !== "string" || !input.plate.startsWith("data:video/"))) {
      return json(res, 400, { error: "plate must be a data URL, or plateJob the id of a finished render" });
    }
    const corner = CORNERS[input.corner] ? input.corner : "bottom-left";
    const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    jobs.set(id, {
      status: "queued",
      kind: "composite",
      input: {
        base: input.base,
        ...(input.plateJob ? { plateJob: input.plateJob } : { plate: input.plate }),
        corner,
        // A reactor under a tenth of the frame is unreadable and over half is
        // not a cut-out any more; the default is the placement the skill uses.
        share: num(input.share, 0.1, 0.5, 0.32),
        inset: num(input.inset, 0, 0.3, 0.06),
        similarity: num(input.similarity, 0.01, 0.5, 0.12),
        blend: num(input.blend, 0, 0.5, 0.04),
        key: typeof input.key === "string" && /^(auto|none|0x[0-9a-f]{6})$/i.test(input.key) ? input.key : "auto",
        audio: ["base", "plate", "both"].includes(input.audio) ? input.audio : "both",
      },
    });
    void runComposite(id);
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
      // "master" = the film was cut TO this track (Seedance Studio): the track
      // plays at its own level and every clip is trimmed to its planned slot.
      // Anything else keeps the old behaviour, a bed ducked under the clips.
      audioMode: input.audioMode === "master" ? "master" : "under",
      soundtrackFromSec: Math.max(0, Number(input.soundtrackFromSec) || 0),
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
      // A composite has no frames to render and no rate to predict from — it is
      // ffmpeg on finished files — so it reports none rather than borrowing the
      // GPU's arithmetic and promising five minutes of nothing.
      ...(job.status === "rendering" && job.kind !== "composite"
        ? { etaSeconds: Math.max(0, Math.round(framesFor(job.input.durationSec) * rate.secondsPerFrame - (Date.now() - job.started) / 1000)) }
        : {}),
      ...(job.kind === "composite" ? { kind: "composite", ...(job.placed ? { placed: job.placed, key: job.key, cropped: job.cropped } : {}) } : {}),
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
