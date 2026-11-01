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
//   GET  /health              { ok, wangp, queue, rate, quality }
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
//
// It also starts the OTHER thing on this PC that a page cannot start itself —
// the Realtime Lucy GPU server, so /apps/realtime-lucy is one button:
//
//   GET  /lucy/status         { installed, running, ready, starting, error, log }
//   POST /lucy/start          spawn it (tools/realtime-lucy/start.ps1)
//   POST /lucy/stop           kill it and hand the VRAM back
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
import { dirname, extname, join, resolve } from "node:path";
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

/**
 * Seconds per frame is not one number — it is one number PER CONFIGURATION.
 *
 * This was a single rolling average over every shot ever rendered, and the
 * moment the sampler went from 4 steps to 10 it began reporting a rate from a
 * different machine's worth of work: a 15-second render was announced at 33
 * minutes and had not finished at 68. Worse, it self-corrects over twenty
 * samples, so it is wrong in both directions for a whole evening after any
 * change.
 *
 * Steps, resolution, phase count and whether the shot carries reference images
 * each move the cost several-fold, so they are the key. An unseen combination
 * has no estimate at all, which is the honest answer — better than confidently
 * quoting a rate measured under settings that no longer apply.
 */
function rateKey(withRefs) {
  const res = process.env.STUDIO_RES || "table";
  return [STEPS, res, TWO_PHASE ? "2phase" : "1phase", withRefs ? "refs" : "norefs"].join("|");
}

function loadRates() {
  try {
    const r = JSON.parse(readFileSync(RATE_FILE, "utf8"));
    // Migrate the old single-average file by discarding it: it is an average
    // across configurations and cannot be attributed to any of them.
    if (r && typeof r === "object" && !r.byConfig) return {};
    return r.byConfig && typeof r.byConfig === "object" ? r.byConfig : {};
  } catch {
    return {};
  }
}

let rates = loadRates();

/** What a frame costs under the CURRENT settings, or null if never measured. */
function rateFor(withRefs = false) {
  const r = rates[rateKey(withRefs)];
  return r && Number.isFinite(r.secondsPerFrame) ? r.secondsPerFrame : null;
}

/**
 * For the places that must show something. Falls back to the slowest rate
 * measured under ANY configuration rather than the fastest or a stale mean —
 * an estimate that runs long is a disappointment, one that runs short is a
 * broken promise, and this whole change exists because of the second kind.
 */
function rateOrGuess(withRefs = false) {
  const exact = rateFor(withRefs);
  if (exact !== null) return exact;
  const seen = Object.values(rates).map((r) => r.secondsPerFrame).filter(Number.isFinite);
  return seen.length ? Math.max(...seen) : DEFAULT_RATE.secondsPerFrame;
}

/** A finished shot is evidence. Twenty of them is enough of an average. */
function learnRate(seconds, frames, withRefs = false) {
  if (!frames || seconds < 2) return;
  const key = rateKey(withRefs);
  const prev = rates[key] ?? { secondsPerFrame: seconds / frames, samples: 0 };
  const n = Math.min(20, prev.samples);
  rates[key] = {
    secondsPerFrame: (prev.secondsPerFrame * n + seconds / frames) / (n + 1),
    samples: n + 1,
  };
  try {
    writeFileSync(RATE_FILE, JSON.stringify({ byConfig: rates }));
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
const OVERLAP = Number(process.env.STUDIO_OVERLAP || 35);

/**
 * The seam settings, straight off Herrgott's recommended v1.4 baseline.
 *
 * 4 frames of video and 15 ms of audio, blending the two renderings of the
 * moments the outgoing and incoming shots have in common. Set STUDIO_BLEND=0 to
 * cut hard instead — on this pipeline the two renderings are much closer than
 * they are in his (WanGP hands the previous clip's real frames forward rather
 * than decoding a second latent), so this is worth A/B-ing rather than assuming.
 */
const BLEND_FRAMES = Number(process.env.STUDIO_BLEND ?? 4);
const DECLICK_MS = Number(process.env.STUDIO_DECLICK ?? 15);

const RESOLUTION = { "16:9": "832x480", "9:16": "480x832", "1:1": "640x640" };

/**
 * What to ask WanGP for. In two-phase mode the request is the FINAL size and
 * WanGP halves it for phase 1, so doubling the known-good size here keeps phase
 * 1 exactly where it has always rendered and makes phase 2 pure gain.
 */
function outputSize(aspectRatio) {
  // STUDIO_RES=1248x720 overrides the table outright. Resolution is the axis
  // that falls off a cliff rather than scaling on a 6 GB card — once the working
  // set stops fitting in VRAM it thrashes against system RAM — so it is worth
  // being able to find that edge empirically instead of assuming it.
  // An explicit STUDIO_RES is the FINAL output size, in both modes. Only the
  // table default gets doubled for two-phase, so that phase 1 lands on the
  // 832x480 that is known to render cleanly — asking for a size and silently
  // rendering twice that is the kind of surprise that costs an afternoon.
  if (process.env.STUDIO_RES) return process.env.STUDIO_RES;
  const base = RESOLUTION[aspectRatio] || RESOLUTION["16:9"];
  if (!TWO_PHASE) return base;
  const [w, h] = base.split("x").map(Number);
  return `${w * 2}x${h * 2}`;
}

/**
 * Sampling quality. Every axis of this render was set to its cheapest value at
 * once, which is why the footage read as test footage rather than as film:
 *
 *   weights      rank-8 PRUNED 20B        (the full model is 33B)
 *   sampler      4-step turbo LoRA        (WanGP's own H3 default is 20 steps)
 *   resolution   832x480, one phase       (H3 has a learned 3D latent upscaler)
 *   text encoder Qwen3-VL-32B at GGUF Q2_K (the 2-bit rung of four)
 *
 * None of that is the engine being bad. It is the engine being run in preview
 * mode on five axes simultaneously.
 *
 *   turbo  what we have been shipping. 4 steps, 832x480, one phase. Fast.
 *   hi     20 steps, NO turbo LoRA, two-phase to 1664x960 through the learned
 *          upscaler. Everything it needs is already on disk.
 *   pdd    8-step PDD distillation, one phase. Reuses the same 20 GB weights
 *          (`URLs: minimax_h3_<arch>_pruned`) plus a small module it downloads.
 *          PDD locks guidance to one phase, so it cannot be combined with "hi".
 *
 * STUDIO_QUALITY=turbo|hi|pdd.
 */
const QUALITY = process.env.STUDIO_QUALITY || "turbo";
const PDD = QUALITY === "pdd";
/**
 * Two-phase generation. Phase 1 renders at half the requested size and phase 2
 * is a genuine learned enhancement pass over it, not a resize — H3 ships
 * `minimax_h3_latent_upscaler_3d_bf16.safetensors` for exactly this and it is
 * already downloaded. H3_TWO_PHASE_SCALE is 2.0 in WanGP, so asking for
 * 1664x960 puts phase 1 on the 832x480 that is known to render cleanly here and
 * then enhances it, rather than gambling a new phase-1 resolution.
 *
 * Phase 2 runs its own fixed 3-step sigma schedule (H3_PHASE_2_SIGMAS) with a
 * phase-two turbo LoRA WanGP loads by itself, so it costs no step budget and
 * needs no LoRA of ours.
 */
const TWO_PHASE = QUALITY === "hi";
/**
 * WanGP's H3 default is 20, and the turbo LoRA exists to cut that to 4. Steps
 * are close to linear in render time, so this is the dial to turn when a run has
 * to fit in an evening: STUDIO_STEPS=10 is a real middle rung, not a fudge.
 * PDD ignores it — its schedule is fixed at 8 by the distillation.
 */
const STEPS = PDD ? 8 : Number(process.env.STUDIO_STEPS) || (TWO_PHASE ? 20 : 4);
/**
 * The turbo LoRA is a FOUR-step distillation, so it belongs to a four-step
 * schedule and nothing else. Raising STUDIO_STEPS therefore drops it on its own
 * rather than leaving a 4-step shortcut sampling a 10-step trajectory — that
 * combination renders worse than either end and would read as "more steps did
 * not help".
 */
const USE_TURBO = !PDD && !TWO_PHASE && STEPS <= 4;
/**
 * The text encoder is Qwen3-VL-32B and it is what turns the prompt into
 * conditioning, so its quantization is prompt ADHERENCE, not picture quality.
 * Only the 2-bit rung is on disk; gguf_q4_k_m and nvfp4_awq are downloads.
 * STUDIO_TEXT_ENCODER=gguf_q2_k|gguf_q4_k_m|nvfp4_awq|bf16.
 */
const TEXT_ENCODER = process.env.STUDIO_TEXT_ENCODER || "gguf_q2_k";

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
function saveTrack(dir, dataUrl, stem = "track") {
  const m = /^data:audio\/([\w.+-]+);base64,/.exec(typeof dataUrl === "string" ? dataUrl : "");
  if (!m) return null;
  const ext = { mpeg: "mp3", "x-m4a": "m4a", mp4: "m4a", "x-wav": "wav", vnd_wave: "wav" }[m[1]] ?? m[1].replace(/[^a-z0-9]/g, "");
  return saveDataUrl(join(dir, `${stem}.${ext || "mp3"}`), dataUrl);
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
async function generate({ id, prompt, refFiles = [], durationSec, aspectRatio, chain = null, startImage = null, audioGuide = null }) {
  await ensureWanGP();
  // A start image is literally the first frame of the output, so it is not a
  // suggestion the model can weigh against others the way a reference is.
  // Chaining wins over it (real frames beat one still), and it wins over
  // references (you cannot both start from this picture and re-compose the
  // shot around a pile of others).
  // A start image can travel WITH a video continuation: image_prompt_type is a
  // flag string over TSEVL, not one value ("VE" and "SE" are documented), so
  // "SV" is start-frame plus video-source. Together they give the next shot the
  // composition AND the motion it is continuing.
  const withStart = Boolean(startImage);
  const withRefs = refFiles.length > 0 && !chain && !withStart;
  const frames = chain
    ? gridFrames(framesFor(durationSec) + chain.overlap)
    : framesFor(durationSec);
  const labels = refFiles.map((f, i) => `image ${i + 1} is ${f.label || `Subject ${i + 1}`}`).join("; ");
  const source = {
    model_type: `minimax_h3_${withRefs ? "ref2va" : "fl2va"}_pruned${PDD ? "_pdd" : ""}`,
    prompt: flat(withRefs && labels ? `${prompt} Reference images: ${labels}. Keep each one's identity and details exactly.` : prompt),
    resolution: outputSize(aspectRatio),
    video_length: frames,
    seed: Math.floor(Math.random() * 2 ** 31),
    num_inference_steps: STEPS,
    guidance_scale: 1,
    flow_shift: 12,
    // Phase 2 only exists when this is 2; switch_threshold is the noise level
    // it takes over at, and 0.9035 is WanGP's measured default for H3.
    ...(TWO_PHASE ? { guidance_phases: 2, switch_threshold: 0.9035 } : {}),
    loras_multipliers: "1.0",
    // The turbo LoRA is trained FOR 4 steps, so it belongs to the 4-step path
    // only. PDD brings its own distillation module through the model
    // definition, and "hi" spends real steps instead of a shortcut — stacking
    // turbo on either would fight the schedule it is sampling against.
    ...(USE_TURBO ? { activated_loras: [withRefs ? TURBO_REF2VA : TURBO_FL2VA] } : {}),
    config: `${TEXT_ENCODER},int8_convrot,lower_ram`,
    ...(withRefs ? { image_refs: refFiles.map((f) => resolve(f.path)), video_prompt_type: "I" } : {}),
    // An array, not a path: WanGP takes a list here.
    ...(withStart ? { image_start: [resolve(startImage)] } : {}),
    ...(chain
      ? {
        video_source: resolve(chain.source),
        // Counted from frame 0 of the source, which is why the handover is cut
        // into its own file rather than pointing at the whole previous clip.
        keep_frames_video_source: String(chain.overlap),
        sliding_window_overlap: chain.overlap,
        sliding_window_size: frames,
      }
      : {}),
    // Set last, from what was actually supplied, so the two can combine.
    ...(withStart || chain ? { image_prompt_type: `${withStart ? "S" : ""}${chain ? "V" : ""}` } : {}),
    // An audio guide is not a soundtrack. `soundtrack` lays a track UNDER the
    // finished cut; this hands the track to H3 as conditioning, and the model
    // matches mouth movement and action to it — "A" in WanGP's own words is
    // "condition on audio_guide". That is what makes a clip lip-sync to a
    // supplied voice rather than inventing its own.
    ...(audioGuide ? { audio_guide: resolve(audioGuide), audio_prompt_type: "A" } : {}),
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

// ----- stills -----------------------------------------------------------------
//
// A Studio image used to be painted by Nano Banana (google/gemini-3.1-flash-image)
// on OpenRouter, at real money per picture. Flux 2 Klein 4B is already on this PC
// inside WanGP — the same engine the video path uses — and it shot all 123 Studio
// cards for nothing. So a still renders here by default and only reaches a paid
// model when this bridge is not running.
//
// 4 steps and no guidance_scale: Klein is a DISTILLED model. Given a "better"
// step count it returns washed-out mush, so these are WanGP's own defaults
// (app/defaults/flux2_klein_4b.json), not a knob.

const IMAGE_MODEL = process.env.STUDIO_IMAGE_MODEL || "flux2_klein_4b";
const IMAGE_STEPS = Number(process.env.STUDIO_IMAGE_STEPS) || 4;

// ~1 megapixel at each aspect the hub offers, every side a multiple of 16.
const IMAGE_RESOLUTION = {
  "1:1": "1024x1024",
  "4:5": "896x1120",
  "3:4": "864x1152",
  "2:3": "832x1248",
  "9:16": "768x1360",
  "16:9": "1360x768",
  "3:2": "1248x832",
  "4:3": "1152x864",
  "21:9": "1568x672",
};

// Klein will letter a sign or a UI if the prompt leaves it any room, and a
// storyboard frame with invented text on it is worse than no frame.
const IMAGE_NEGATIVE =
  "text, letters, words, numbers, captions, subtitles, watermark, logo, signature, "
  + "user interface, app window, browser, buttons, menus, cursor, collage, split screen, "
  + "multiple panels, borders, blurry, low contrast, washed out, deformed hands, extra limbs";

/** One local still. Returns the path of a PNG in OUT. */
// Editing a picture is NOT the same call as drawing one from references.
// WanGP gates it behind flags in video_prompt_type, and the letters are not the
// ones the UI labels suggest: "V" enables Control Image (the picture being
// edited, passed as image_guide) and "A" enables its mask. The qwen handler
// spells the working combination out for the Plus models as
// inpaint_video_prompt_type = "VAG", with image refs allowed on top because
// inpaint_with_image_ref is set. Without "V" the model treats the source as mere
// inspiration and repaints the whole frame, which is exactly what it did three
// times before these flags were found.
async function generateImage({ id, prompt, refFiles = [], aspectRatio, sourceSize = null, editGuide = null, editMask = null }) {
  await ensureWanGP();
  const withRefs = refFiles.length > 0;
  // Flux reads a reference's ROLE from the prompt, not from the argument order,
  // so the labels have to be said out loud or it composes a stranger.
  const labels = refFiles.map((f, i) => `image ${i + 1} is ${f.label || `Subject ${i + 1}`}`).join("; ");
  const source = {
    model_type: IMAGE_MODEL,
    prompt: flat(
      withRefs && !editGuide
        ? `${prompt} Reference images: ${labels}. Keep each one's exact face, features and details.`
        : prompt,
    ),
    negative_prompt: IMAGE_NEGATIVE,
    resolution: sourceSize ?? IMAGE_RESOLUTION[aspectRatio] ?? IMAGE_RESOLUTION["1:1"],
    num_inference_steps: IMAGE_STEPS,
    seed: Math.floor(Math.random() * 2 ** 31),
    ...(editGuide
      ? {
        image_guide: resolve(editGuide),
        ...(editMask ? { image_mask: resolve(editMask) } : {}),
        ...(withRefs ? { image_refs: refFiles.map((f) => resolve(f.path)) } : {}),
        // Only the masked pixels may change, so the background survives by
        // construction rather than by asking the model nicely.
        video_prompt_type: (editMask ? "VAG" : "V") + (withRefs ? "I" : ""),
        // Without this, "V" resolves to Control VIDEO and WanGP rejects the job
        // asking for a video it was never going to get: image_output is
        // `model_def.image_outputs or image_mode > 0`, and the qwen handler
        // registers inpainting as image_mode 2.
        image_mode: editMask ? 2 : 1,
        denoising_strength: 1,
      }
      : withRefs
        ? { image_refs: refFiles.map((f) => resolve(f.path)), video_prompt_type: "I" }
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
  // WanGP decides the format — measured: a Flux 2 Klein still comes back as
  // JPEG, not PNG. Naming the file .png here made /file label it image/png and
  // every caller build a data URL that misdescribed its own bytes.
  const src = result.generated_files[0];
  const ext = (extname(src) || ".jpg").toLowerCase();
  const out = join(OUT, `${id}${ext}`);
  copyFileSync(src, out);
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

/**
 * The seam between two shots of one take, as Herrgott's suite makes it.
 *
 * Not a dissolve. The last `n` frames of the outgoing shot and the last `n`
 * frames of the incoming shot's duplicated head are THE SAME MOMENTS, rendered
 * and decoded twice, so blending them washes out the difference between the two
 * decodes without softening any motion. The segment is exactly `n` frames long
 * and replaces `n` frames of the outgoing shot, so the film's length is
 * untouched — which is the whole reason it can be done at all.
 *
 * The curve is theirs: a raised cosine, so the handover starts and ends flat
 * instead of stepping at either end.
 *
 * Audio gets the same treatment over a much shorter window — 15 ms, a de-click
 * rather than a crossfade, because a long blend on speech smears it.
 */
async function blendSeam(a, b, { aFrom, n, bHeadEnd, declickMs = 15 }, to) {
  const alpha = (i) => (n <= 1 ? 0.5 : 0.5 - 0.5 * Math.cos((Math.PI * i) / (n - 1)));
  // ffmpeg evaluates this per frame; A and B are the two pictures' pixel
  // values. N is documented as starting at 0 and does not — measured here it
  // arrives as 1 on the first frame, which without the offset shifts the whole
  // ramp forward and makes the last frame fall BACK toward the outgoing shot
  // instead of landing on the incoming one. That is a visible hitch at the one
  // moment this exists to smooth, so the offset is not cosmetic.
  const curve = n <= 1 ? "0.5" : `(0.5-0.5*cos(PI*(N-1)/${n - 1}))`;
  const secs = (f) => (f / FPS).toFixed(5);
  const d = Math.min(declickMs / 1000, n / FPS);
  const parts = [
    `[0:v]trim=start_frame=${aFrom}:end_frame=${aFrom + n},setpts=PTS-STARTPTS[av]`,
    `[1:v]trim=start_frame=${bHeadEnd - n}:end_frame=${bHeadEnd},setpts=PTS-STARTPTS[bv]`,
    `[av][bv]blend=all_expr='A*(1-${curve})+B*${curve}'[v]`,
    // The outgoing sound runs the whole segment and only lets go at the very end.
    `[0:a]atrim=start=${secs(aFrom)}:end=${secs(aFrom + n)},asetpts=PTS-STARTPTS,`
    + `afade=t=out:st=${(n / FPS - d).toFixed(5)}:d=${d.toFixed(5)}:curve=tri[aa]`,
    // The incoming sound is only the few milliseconds of its reused head that
    // land on the same instant, held back so the two meet exactly at the join.
    `[1:a]atrim=start=${(bHeadEnd / FPS - d).toFixed(5)}:end=${secs(bHeadEnd)},asetpts=PTS-STARTPTS,`
    + `afade=t=in:d=${d.toFixed(5)}:curve=tri,adelay=${Math.round((n / FPS - d) * 1000)}:all=1[ba]`,
    "[aa][ba]amix=inputs=2:duration=first:normalize=0[a]",
  ];
  await run(FFMPEG, [
    "-y", "-hide_banner", "-loglevel", "error", "-i", a, "-i", b,
    "-filter_complex", parts.join(";"),
    "-map", "[v]", "-map", "[a]",
    // Near-lossless: this is four frames sitting at the most scrutinised moment
    // in the film, and it is about to be re-encoded once more by the concat.
    "-c:v", "libx264", "-crf", "10", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-r", String(FPS), to,
  ]);
  return { file: to, frames: n, firstAlpha: alpha(0), lastAlpha: alpha(n - 1) };
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
  // A still shares the queue with the clips on purpose: there is one 6 GB card,
  // and a Flux render started underneath an H3 render is how both of them die.
  if (job.kind === "image") {
    return generateImage({
      id, prompt, refFiles, aspectRatio,
      sourceSize: job.input.sourceSize ?? null,
      editGuide: job.input.editGuide ? saveRef(`${id}-edit`, "guide", job.input.editGuide) : null,
      editMask: job.input.editMask ? saveRef(`${id}-edit`, "mask", job.input.editMask) : null,
    });
  }
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
    console.log(
      job.kind === "image"
        ? `▶ ${id} — still, ${job.input.aspectRatio ?? "1:1"}, ${job.input.refs?.length ?? 0} ref(s)`
        : `▶ ${id} — ${job.input.durationSec ?? 5}s ${job.input.aspectRatio ?? "16:9"}, ${job.input.refs?.length ?? 0} ref(s)`,
    );
    try {
      job.file = await render(id, job);
      job.status = "done";
      const secs = Math.round((Date.now() - job.started) / 1000);
      // The measured rate is seconds PER FRAME of video. A still has no frames,
      // so feeding it in would teach the clips' ETA a number from another job.
      if (job.kind !== "image") learnRate(secs, framesFor(job.input.durationSec));
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
    console.log(`▶ ${id} shot ${i + 1}/${film.shots.length} — ${shot.link}, ${shot.durationSec}s${shot.startFrame ? ", from a start frame" : ""}`);
    try {
      // A chained shot continues the one before it from where that shot really
      // ended — the boundary its own reading produced, not the end of its file.
      // Without a previous clip there is nothing to continue, so it falls back
      // to a cut.
      const previous = shot.link === "continuous" ? previousClip : null;
      // Two ways to continue, and they are not the same trade.
      //
      //   "video" hands over OVERLAP real frames: motion and audio cross the
      //     join, the seam is invisible and the next shot needs no warm-up —
      //     but you are stuck with whatever the previous clip ended on. When a
      //     shot drifted onto an empty room, the next one inherited furniture
      //     and invented a new cast.
      //
      //   "frame" hands over ONE frame, as a start image. The next shot starts
      //     from rest, but you get to CHOOSE the frame — the last one where the
      //     subject is actually visible — instead of taking the ending you were
      //     given.
      //
      // STUDIO_CHAIN picks. Default "frame": being able to choose the handover
      // is worth more than a free warm-up when identity keeps getting lost.
      // "both" does NOT work: WanGP's docs say image_prompt_type flags combine
      // ("VE", "SE" are documented) but "SV" crashes inside its own generation
      // path — `cannot access local variable 'source_overlap'`. So it is one or
      // the other, and "video" wins on measurement: the seam is invisible, the
      // next generation needs no warm-up, and motion AND audio cross the join.
      // "frame" trades all of that for the ability to choose the handover, which
      // only matters when the previous generation ends badly — and that is a
      // planning problem, fixed by making it end on the subject.
      const chainMode = previous ? (process.env.STUDIO_CHAIN || "video") : null;
      const chain = previous && (chainMode === "video" || chainMode === "both")
        ? {
          source: await handoverClip(previous.file, previous.read.handoverEndFrame, OVERLAP, join(dir, `link-${i}.mp4`)),
          overlap: OVERLAP,
        }
        : null;
      // The frame the previous shot really ended on, with whoever is in it.
      const carriedFrame = previous && (chainMode === "frame" || chainMode === "both")
        ? await frameAt(previous.file, previous.read.handoverEndFrame, join(dir, `start-${i}.png`))
        : null;
      const refFiles = (shot.refs ?? [])
        .map((r, k) => ({ path: saveRef(`${id}-${i}`, k, r.dataUrl), label: r.label }))
        .filter((f) => f.path);
      // An explicit start frame from the caller wins; otherwise the frame
      // carried out of the previous shot.
      // Never alongside a video chain: "SV" crashes WanGP.
      const startImage = chain
        ? null
        : (shot.startFrame ? saveRef(`${id}-${i}`, "start", shot.startFrame) : null) ?? carriedFrame;
      const clip = shot.reuse
        ? (console.log(`= ${id} shot ${i + 1} reused from ${shot.reuse}`), shot.reuse)
        : await generate({
        ...(startImage ? { startImage } : {}),
        id: `${id}-${i}`,
        prompt: shot.prompt,
        refFiles,
        durationSec: shot.durationSec,
        aspectRatio: film.aspectRatio,
        chain,
        ...(shot.audioGuideFile ? { audioGuide: shot.audioGuideFile } : {}),
      });
      const kept = join(dir, `shot-${i + 1}.mp4`);
      copyFileSync(clip, kept);
      shot.file = kept;
      shot.chained = Boolean(chain) || Boolean(carriedFrame);
      shot.chainMode = chain && carriedFrame ? "both" : chain ? "video" : carriedFrame ? "frame" : "none";
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
      learnRate(shot.seconds, framesFor(shot.durationSec) + (chain ? chain.overlap : 0), Boolean(shot.refs?.length) && !chain);
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
    const windows = stitchWindows(done, {
      // A score's clips are cut back to the slots they were planned for; an
      // ordinary film's run to wherever each shot really ends.
      slotFrames: (s) => (film.audioMode === "master" ? Math.round(s.durationSec * FPS) : 0),
      blendFrames: BLEND_FRAMES,
    });

    // Every shot's body, and between the ones that run together, the blended
    // frames they share. Built as its own list because a blend is a segment of
    // the film in its own right, not a property of either shot.
    const segments = [];
    const windowsOut = [];
    for (const [i, w] of windows.entries()) {
      segments.push(done[i].file);
      windowsOut.push({ from: w.from, frames: w.frames, gain: w.gain });
      if (!w.blendAfter) continue;
      const seam = await blendSeam(
        done[i].file,
        done[i + 1].file,
        { aFrom: w.from + w.frames, n: w.blendAfter, bHeadEnd: done[i + 1].overlap, declickMs: DECLICK_MS },
        join(dir, `seam-${i + 1}.mp4`),
      );
      segments.push(seam.file);
      // The blend is already the two shots averaged, so it takes the gain of
      // the run it sits inside — which both of them share anyway.
      windowsOut.push({ from: 0, frames: seam.frames, gain: w.gain });
    }

    const cut = await stitch(segments, windowsOut, join(dir, "film-cut.mp4"));
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
      : Math.max(0, Math.round(remainingFrames * rateOrGuess() - elapsedOnCurrent + (film.shots.length > 1 ? 8 : 0)));
  return {
    status: film.status,
    error: film.error,
    title: film.title,
    current: film.current,
    doneShots,
    etaSeconds: eta,
    elapsedSeconds: film.startedAt ? Math.round(((film.finishedAt ?? Date.now()) - film.startedAt) / 1000) : 0,
    secondsPerFrame: Math.round(rateOrGuess() * 100) / 100,
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
            ? Math.min(97, Math.round(((Date.now() - s.startedAt) / 1000 / (framesFor(s.durationSec) * rateOrGuess())) * 100))
            : 0,
      error: s.error,
      // A shot that rendered fine and still has nothing happening in it is not
      // an error, and the owner should not have to find it by watching.
      warning: s.warning,
    })),
  };
}

// ----- Realtime Lucy, started when the page asks ----------------------------
//
// /apps/realtime-lucy is only a WebRTC client. With no GPU server running the
// page shows the webcam, nothing is generated, and it reads as "the prompt does
// nothing". A page cannot spawn a process, so it asks this bridge — already
// running on this PC for Studio — to start one. That is the whole of the page's
// one button.
//
// The model holds ~5.2 GB of VRAM while it is up, so it is deliberately NOT
// started at login: it starts when the page asks, and /lucy/stop hands the card
// back to whatever else wants it.

const LUCY_PORT = Number(process.env.LUCY_PORT || 8765);
const LUCY_DIR = resolve(HERE, "..", "realtime-lucy");
const LUCY_START = join(LUCY_DIR, "start.ps1");
// The venv and the 18 GB of weights live outside the repo, so OneDrive never
// tries to sync them (tools/realtime-lucy/README.md).
const LUCY_PY = join(process.env.USERPROFILE || "", "realtime-lucy", "venv", "Scripts", "python.exe");
const LUCY_LOG = join(OUT, "lucy.log");

let lucy = null; // { pid, startedAt, exit: null | { code, message? } }

/** Ask the Lucy server itself. Short deadline — the page polls this. */
async function lucyHealth(timeoutMs = 2500) {
  try {
    const res = await fetch(`http://127.0.0.1:${LUCY_PORT}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function lucyLogTail(bytes = 1200) {
  try {
    return readFileSync(LUCY_LOG, "utf8").slice(-bytes);
  } catch {
    return "";
  }
}

function startLucy() {
  if (lucy && lucy.exit === null) return { pid: lucy.pid, already: true };
  if (!existsSync(LUCY_PY)) {
    throw new Error(`No Python environment at ${LUCY_PY} — the one-time install is in tools/realtime-lucy/README.md.`);
  }
  if (!existsSync(LUCY_START)) throw new Error(`Missing ${LUCY_START}.`);
  // A fresh log per start: when this fails the owner wants THIS run's reason.
  writeFileSync(LUCY_LOG, `--- starting Lucy on port ${LUCY_PORT} at ${new Date().toISOString()}\n`);
  const log = openSync(LUCY_LOG, "a");
  // Through start.ps1 on purpose: it owns the one setting that decides whether
  // this works at all. On a 6 GB card the 384x288 config spills into system RAM
  // and a chunk takes 21 s instead of 2.6 — which looks like a broken app, not
  // a slow one. That choice stays in one place.
  //
  // NOT detached, unlike WanGP above. Measured: `detached: true` on a
  // powershell.exe child hands the script to a new console, our own pid exits 0
  // within a second, the log file stays empty and taskkill on that pid leaves
  // the real process running. The bridge would then report "the engine stopped"
  // while the model was in fact loading. Attached, the log fills, the exit code
  // is the script's own, and the pid is the tree we can actually kill.
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", LUCY_START, "-Port", String(LUCY_PORT)],
    { cwd: LUCY_DIR, stdio: ["ignore", log, log], windowsHide: true },
  );
  const state = { pid: child.pid, startedAt: Date.now(), exit: null };
  lucy = state;
  child.on("exit", (code) => {
    state.exit = { code };
  });
  child.on("error", (e) => {
    state.exit = { code: -1, message: e.message };
  });
  child.unref();
  console.log(`Starting Realtime Lucy (pid ${child.pid}) — log in out/lucy.log`);
  return { pid: child.pid, already: false };
}

/** Kill it however it was started: our own tree, then whatever holds the port. */
async function stopLucy() {
  const kill = (bin, args) =>
    new Promise((done) => {
      const p = spawn(bin, args, { windowsHide: true, stdio: "ignore" });
      p.on("error", () => done(false));
      p.on("close", (code) => done(code === 0));
    });
  if (lucy && lucy.exit === null && lucy.pid) {
    // /T because the model runs in powershell's python child, not in powershell.
    await kill("taskkill.exe", ["/PID", String(lucy.pid), "/T", "/F"]);
  }
  lucy = null;
  await kill("powershell.exe", [
    "-NoProfile",
    "-Command",
    `$p=(Get-NetTCPConnection -LocalPort ${LUCY_PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess; if($p){ $p | Select-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force } }`,
  ]);
  return !(await lucyHealth(1500));
}

/** Everything the page needs to decide what its one button says. */
async function lucyStatus() {
  const health = await lucyHealth();
  return {
    installed: existsSync(LUCY_PY),
    python: LUCY_PY,
    port: LUCY_PORT,
    running: !!health,
    ready: !!health?.ready,
    starting: !!lucy && lucy.exit === null && !health,
    // A start that died (no venv, CUDA out of memory, a bad flag) must not read
    // as "still loading" forever — but a server that is answering is up, whatever
    // the last spawn did.
    exited: health ? null : (lucy?.exit ?? null),
    startedAt: lucy?.startedAt ?? null,
    error: health?.error || lucy?.exit?.message || null,
    log: lucyLogTail(),
    health,
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

/** Content type from the extension, so a still is served as what it actually is. */
const MEDIA_TYPE = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
};

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
      quality: QUALITY,
      queue: queue.length + (working ? 1 : 0) + filmQueue.length + (filming ? 1 : 0),
      rate: Math.round(rateOrGuess() * 100) / 100,
      rateMeasured: rateFor() !== null,
      films: films.size,
      // What the page needs to know before it decides where to send a still:
      // that this bridge can paint one at all, and with what.
      image: true,
      imageModel: IMAGE_MODEL,
    });
  }

  // Realtime Lucy's one button: the page asks, this starts the GPU server.
  if (req.method === "GET" && url.pathname === "/lucy/status") {
    return json(res, 200, await lucyStatus());
  }

  if (req.method === "POST" && url.pathname === "/lucy/start") {
    try {
      // Answer the moment it is spawned; the page watches Lucy's own /health
      // for the 20–30 s of model loading that follows.
      return json(res, 200, { ...startLucy(), starting: true });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/lucy/stop") {
    return json(res, 200, { stopped: await stopLucy() });
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

  // One still, free, on this PC. Same queue as /video — one GPU.
  if (req.method === "POST" && url.pathname === "/image") {
    let input;
    try {
      input = await readBody(req, 40_000_000);
    } catch (e) {
      return json(res, e.message === "too large" ? 413 : 400, { error: e.message === "too large" ? "too large" : "bad json" });
    }
    if (typeof input.prompt !== "string" || !input.prompt.trim()) return json(res, 400, { error: "prompt required" });
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    jobs.set(id, {
      status: "queued",
      kind: "image",
      input: {
        ...input,
        refs: Array.isArray(input.refs) ? input.refs.slice(0, 6) : [],
        // An edit must be rendered at the size of the picture it edits.
        sourceSize: /^\d{2,4}x\d{2,4}$/.test(String(input.sourceSize ?? "")) ? String(input.sourceSize) : null,
        // The picture being edited, and which of its pixels may change.
        editGuide: typeof input.editGuide === "string" && input.editGuide.startsWith("data:image/") ? input.editGuide : null,
        editMask: typeof input.editMask === "string" && input.editMask.startsWith("data:image/") ? input.editMask : null,
      },
    });
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
        // The composition this shot opens on, as a picture. Unlike a
        // reference, the model has no say in it: it IS frame one.
        startFrame: typeof s.startFrame === "string" && s.startFrame.startsWith("data:image/") ? s.startFrame : null,
        // An already-rendered clip for this shot. Iterating on the LAST
        // generation of a film should not cost a re-render of the first one:
        // three of today's runs spent 25 minutes each re-making a clip that was
        // already on disk and already good.
        reuse: typeof s.reuse === "string" && existsSync(s.reuse) ? s.reuse : null,
        // A voice or music track for THIS shot to lip-sync and move to. Kept as
        // the raw data URL here and written to a file once the film has a
        // directory, a few lines below.
        audioGuide: typeof s.audioGuide === "string" && s.audioGuide.startsWith("data:audio/") ? s.audioGuide : null,
        status: "queued",
      }));
    if (!shots.length) return json(res, 400, { error: "a film needs at least one shot with a prompt" });
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const dir = filmDir(id);
    // Now there is a directory, each shot's audio guide becomes a file on disk,
    // which is what WanGP's `audio_guide` wants.
    for (const [i, shot] of shots.entries()) {
      shot.audioGuideFile = shot.audioGuide ? saveTrack(dir, shot.audioGuide, `guide-${i}`) : null;
      delete shot.audioGuide;
    }
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
      ...(job.status === "rendering" && job.kind !== "composite" && job.kind !== "image"
        ? { etaSeconds: Math.max(0, Math.round(framesFor(job.input.durationSec) * rateOrGuess() - (Date.now() - job.started) / 1000)) }
        : {}),
      ...(job.kind === "composite" ? { kind: "composite", ...(job.placed ? { placed: job.placed, key: job.key, cropped: job.cropped } : {}) } : {}),
    });
  }
  if (m && m[1] === "file") {
    if (job.status !== "done") return json(res, 409, { error: "not ready" });
    return sendFile(res, job.file, MEDIA_TYPE[extname(job.file).toLowerCase()] ?? "application/octet-stream");
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
  const here = rateFor();
  console.log(
    here === null
      ? `No rate measured yet for ${rateKey(false)} — the first render of these settings is the measurement.`
      : `Measured render rate: ${here.toFixed(2)} s/frame for ${rateKey(false)}.`,
  );
  console.log("Ready for Jarvis -> Studio. If this is a visible window, leave it open.");
});

/**
 * One frame out of a clip, as a PNG — the handover, when it travels as a still.
 *
 * Seeks by time rather than using a `select` filter: a filter expression needs
 * its comma escaped, the escape has to survive both the shell and a JS template
 * literal, and when it does not ffmpeg reads the comma as a filter separator and
 * fails with "Filter not found". Output-side `-ss` is frame-accurate and has
 * nothing to escape.
 */
async function frameAt(clip, frame, to) {
  await run(FFMPEG, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", clip, "-ss", (frame / FPS).toFixed(4), "-frames:v", "1",
    // PNG, because this becomes the literal first frame of the next generation
    // and JPEG artefacts would be generated forward into it.
    "-c:v", "png", to,
  ]);
  if (!existsSync(to)) throw new Error("Couldn't take the handover frame out of the previous shot.");
  return to;
}
