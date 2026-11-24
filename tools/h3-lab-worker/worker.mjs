#!/usr/bin/env node
// ---------------------------------------------------------------------------
// H3 Prompt Lab — the PC worker.
//
//   node worker.mjs                    keep polling the hub; render, think, tick
//   node worker.mjs --once             one claim cycle (and the job it hands out), then exit
//   node worker.mjs --doctor           check hub + token, WanGP, ffmpeg, claude
//   node worker.mjs --measure <file>   print the ClipMetrics ffmpeg measures on a clip
//   (--doctor --measure <file> does both)
//
// The hub owns the queue. This program asks for work every few seconds
// (POST /api/h3-lab/worker/claim — also its heartbeat), renders on the PC's
// existing MiniMax H3 install in WanGP over its MCP server, measures the clip
// with ffmpeg, uploads it and posts the result; runs reasoning prompts through
// `claude -p`; and nudges the lab's agent (POST /api/h3-lab/worker/tick) so it
// keeps advancing with no browser open. Zero npm dependencies.
// ---------------------------------------------------------------------------

import os from "node:os";
import path from "node:path";
import { promises as fs, mkdirSync } from "node:fs";

import { config, configProblem } from "./lib/env.mjs";
import { Hub, HubError } from "./lib/hub.mjs";
import { WanGP, prepareSettings } from "./lib/wangp.mjs";
import { measureClip, hasFfmpeg, ffmpegBin, ffprobeBin } from "./lib/measure.mjs";
import { findClaude, runThink } from "./lib/claude.mjs";
import { run } from "./lib/proc.mjs";

const VERSION = "1";
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};

const cfg = config();
const hub = new Hub(cfg);
const log = (...args) => console.log(new Date().toLocaleTimeString(), ...args);
const wangp = new WanGP(cfg, log);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errText = (err) => String(err?.message ?? err).slice(0, 1000);

const PENDING_DIR = path.join(cfg.outDir, "pending");
const REFS_DIR = path.join(cfg.outDir, "refs");
const THINK_DIR = path.join(cfg.outDir, "think");

// ----- capabilities, re-checked now and then -------------------------------------

const caps = { ffmpeg: false, claude: false, at: 0 };
async function refreshCaps(force = false) {
  if (!force && Date.now() - caps.at < 10 * 60_000) return caps;
  const [ff, cl] = await Promise.all([hasFfmpeg(), findClaude()]);
  caps.ffmpeg = ff;
  caps.claude = Boolean(cl);
  caps.at = Date.now();
  return caps;
}

// ----- what this worker is doing --------------------------------------------------

const state = {
  render: null, // Promise while a render runs
  current: null, // generation id
  think: null, // Promise while a think job runs
  lastTick: 0,
  wangpCache: null, // { at, value }
};

/** WorkerStatus (minus lastSeen, which the hub stamps). */
async function workerStatus() {
  let w;
  if (state.current) {
    // Never poke WanGP mid-job; it is ours and it is busy.
    const secs = wangp.rendering ? (Date.now() - wangp.rendering.since) / 1000 : 0;
    w = {
      wangp: "busy",
      wangpDetail: wangp.starting
        ? "Starting WanGP's render server for the next clip (the first start loads the model)."
        : wangp.rendering
          ? `Rendering ${state.current} on MiniMax H3 (${mmss(secs)} so far).`
          : `Working on ${state.current} (measuring / uploading).`,
      models: wangp.modelCache.list,
      canRender: false,
    };
  } else if (state.wangpCache && Date.now() - state.wangpCache.at < 15_000) {
    w = state.wangpCache.value;
  } else {
    try {
      w = await wangp.status();
    } catch (err) {
      w = { wangp: "unknown", wangpDetail: `Could not check WanGP: ${errText(err)}`, models: [], canRender: false };
    }
    state.wangpCache = { at: Date.now(), value: w };
  }
  return {
    status: {
      machine: os.hostname(),
      version: VERSION,
      wangp: w.wangp,
      wangpDetail: w.wangpDetail,
      ffmpeg: caps.ffmpeg,
      claude: caps.claude,
      current: state.current,
      models: w.models ?? [],
      queueDepth: 0,
    },
    canRender: !state.render && Boolean(w.canRender),
    canThink: caps.claude && !state.think,
  };
}

// ----- results that must not be lost -------------------------------------------------

/**
 * Post a result; if the hub is unreachable, keep it on disk and try again on
 * every later cycle. A finished render is too expensive to drop on a blip.
 */
async function deliver(kind, body) {
  const send = () => (kind === "result" ? hub.result(body) : hub.think(body));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await send();
      return true;
    } catch (err) {
      if (err instanceof HubError && !err.unreachable && !err.unauthorized) {
        log(`The hub refused the ${kind} for ${body.generationId ?? body.jobId}: ${err.message}`);
        return false; // a 4xx will not get better by retrying
      }
      await sleep(5000 * 2 ** attempt);
    }
  }
  mkdirSync(PENDING_DIR, { recursive: true });
  const id = String(body.generationId ?? body.jobId).replace(/[^\w.-]/g, "_");
  await fs.writeFile(path.join(PENDING_DIR, `${kind}-${id}.json`), JSON.stringify({ kind, body }));
  log(`Hub unreachable — kept the ${kind} for ${id} in out/pending; it is sent when the hub is back.`);
  return false;
}

async function flushPending() {
  let names = [];
  try {
    names = (await fs.readdir(PENDING_DIR)).filter((n) => n.endsWith(".json"));
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(PENDING_DIR, name);
    try {
      const { kind, body } = JSON.parse(await fs.readFile(file, "utf8"));
      await (kind === "result" ? hub.result(body) : hub.think(body));
      await fs.rm(file, { force: true });
      log(`Sent the kept ${kind} for ${body.generationId ?? body.jobId}.`);
    } catch (err) {
      if (err instanceof HubError && !err.unreachable && !err.unauthorized) {
        await fs.rename(file, `${file}.refused`).catch(() => {});
        log(`The hub refused kept ${name}: ${err.message}`);
      } else {
        return; // still down; try next cycle
      }
    }
  }
}

// ----- render ----------------------------------------------------------------------

const mmss = (s) => `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;

async function renderJob(gen) {
  const id = gen.id;
  state.current = id;
  state.wangpCache = null;
  const t0 = Date.now();
  let tempFiles = [];
  let renderSeconds;
  log(`Render ${id}: ${gen.seconds ?? "?"} s, ${gen.settings?.model_type ?? "model?"}`);
  try {
    await hub.progress(id, "rendering", "Worker picked it up; preparing WanGP.");
    const prepared = await prepareSettings(gen.settings, id, REFS_DIR);
    tempFiles = prepared.tempFiles;
    const source = prepared.source;
    if (!source.model_type) throw new Error("The hub sent settings without a model_type; nothing was rendered.");
    if (typeof source.prompt !== "string" || !source.prompt) source.prompt = String(gen.prompt ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();

    await wangp.ensure((waited) => {
      if (waited % 30 === 0) void hub.progress(id, "rendering", `Starting WanGP's render server (${mmss(waited)}; the first start loads the model).`);
    });

    const start = Date.now();
    const beat = setInterval(() => {
      void hub.progress(id, "rendering", `Rendering on MiniMax H3 — ${mmss((Date.now() - start) / 1000)} elapsed.`);
    }, 30_000);
    let file;
    try {
      await hub.progress(id, "rendering", "Rendering on MiniMax H3.");
      file = await wangp.generate(id, source);
    } finally {
      clearInterval(beat);
      renderSeconds = Math.round((Date.now() - start) / 1000);
    }
    log(`Render ${id}: WanGP finished in ${mmss(renderSeconds)} → ${file}`);

    await hub.progress(id, "measuring", "Measuring the clip with ffmpeg.");
    let metrics;
    let frames;
    try {
      ({ metrics, frames } = await measureClip(file));
    } catch (err) {
      log(`Render ${id}: measuring failed: ${errText(err)}`);
    }

    await hub.progress(id, "uploading", "Uploading the clip.");
    const bytes = (await fs.stat(file)).size;
    let clipKey = null;
    try {
      const up = await hub.upload(id);
      if (up?.url) {
        await hub.putClip(up.url, await fs.readFile(file));
        clipKey = up.key ?? null;
      }
    } catch (err) {
      log(`Render ${id}: upload failed, keeping the clip local: ${errText(err)}`);
    }

    await deliver("result", {
      generationId: id,
      ok: true,
      renderSeconds,
      clipKey,
      localPath: file,
      bytes,
      ...(metrics ? { metrics } : {}),
      ...(frames?.length ? { frames } : {}),
    });
    log(`Render ${id}: done in ${mmss((Date.now() - t0) / 1000)}${clipKey ? " (uploaded)" : " (kept local)"}.`);
  } catch (err) {
    log(`Render ${id} failed: ${errText(err)}`);
    await deliver("result", { generationId: id, ok: false, error: errText(err), ...(renderSeconds ? { renderSeconds } : {}) });
  } finally {
    await Promise.all(tempFiles.map((f) => fs.rm(f, { force: true }).catch(() => {})));
    state.current = null;
    state.wangpCache = null;
  }
}

// ----- think -------------------------------------------------------------------------

async function thinkJob(job) {
  log(`Think ${job.id} (${job.step}) with ${job.images?.length ?? 0} image(s)…`);
  const r = await runThink({
    prompt: String(job.prompt ?? ""),
    images: Array.isArray(job.images) ? job.images : [],
    dir: path.join(THINK_DIR, String(job.id).replace(/[^\w.-]/g, "_")),
    timeoutMs: cfg.thinkTimeoutMin * 60_000,
    model: cfg.claudeModel,
  }).catch((err) => ({ ok: false, error: errText(err) }));
  await deliver("think", r.ok ? { jobId: job.id, ok: true, result: r.result } : { jobId: job.id, ok: false, error: r.error });
  log(`Think ${job.id}: ${r.ok ? `answered (${r.result.length} chars)` : `failed — ${r.error}`}`);
}

// ----- tick ------------------------------------------------------------------------------

async function tick(why) {
  state.lastTick = Date.now();
  try {
    const r = await hub.tick();
    const did = r?.step?.did ?? r?.did;
    log(`Agent tick (${why})${did ? `: ${did}` : "."}`);
  } catch (err) {
    log(`Agent tick failed: ${errText(err)}`);
  }
}

// ----- one cycle ---------------------------------------------------------------------------

/** Claim once and start whatever comes back. Throws HubError when the hub cannot be reached. */
async function cycle() {
  await refreshCaps();
  const { status, canRender, canThink } = await workerStatus();
  const work = await hub.claim({ status, canRender, canThink });
  await flushPending();
  if (!work) {
    if (Date.now() - state.lastTick >= cfg.tickEveryMin * 60_000) await tick("idle");
    return null;
  }
  if (work.kind === "render" && work.generation?.id) {
    if (state.render) {
      log(`The hub handed out ${work.generation.id} while ${state.current} is rendering; reporting it back.`);
      await deliver("result", { generationId: work.generation.id, ok: false, error: "The worker was already rendering another clip." });
      return null;
    }
    state.render = renderJob(work.generation).finally(() => (state.render = null));
    return state.render;
  }
  if (work.kind === "think" && work.job?.id) {
    if (state.think || !caps.claude) {
      await deliver("think", { jobId: work.job.id, ok: false, error: caps.claude ? "The worker was already thinking." : "Claude Code is not installed on this PC." });
      return null;
    }
    state.think = thinkJob(work.job).finally(() => (state.think = null));
    return state.think;
  }
  if (work.kind === "tick") {
    await tick("hub asked");
    return null;
  }
  log(`Ignoring an unknown claim response: ${JSON.stringify(work).slice(0, 200)}`);
  return null;
}

async function loop() {
  const problem = configProblem(cfg);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  mkdirSync(cfg.outDir, { recursive: true });
  await refreshCaps(true);
  log(`H3 Lab worker up on ${os.hostname()}. Hub ${cfg.hubUrl}. WanGP ${cfg.wangpApp} (MCP :${cfg.mcpPort}). ffmpeg ${caps.ffmpeg ? "yes" : "NO"}, claude ${caps.claude ? "yes" : "no"}.`);

  if (flag("--once")) {
    try {
      const job = await cycle();
      if (job) {
        // Keep the heartbeat going while the one job runs (it can take 15 min).
        const beat = setInterval(async () => {
          try {
            const { status } = await workerStatus();
            const extra = await hub.claim({ status, canRender: false, canThink: false });
            if (extra) log(`The hub handed out more work during --once; it stays queued: ${JSON.stringify(extra).slice(0, 120)}`);
          } catch {
            /* heartbeat only */
          }
        }, cfg.pollSeconds * 1000 * 3);
        try {
          await job;
        } finally {
          clearInterval(beat);
        }
      } else log("Nothing to do.");
    } catch (err) {
      log(errText(err));
      process.exitCode = 1;
    }
    return;
  }

  let failures = 0;
  let lastError = "";
  for (;;) {
    let delay = cfg.pollSeconds * 1000;
    try {
      await cycle();
      if (failures) log("Hub reachable again.");
      failures = 0;
      lastError = "";
    } catch (err) {
      failures += 1;
      const msg = errText(err);
      if (msg !== lastError) log(msg);
      lastError = msg;
      const unauthorized = err instanceof HubError && err.unauthorized;
      // Exponential backoff while the hub is away: 5 s, 10 s, 20 s … capped at 5 min.
      delay = unauthorized ? 60_000 : Math.min(5 * 60_000, cfg.pollSeconds * 1000 * 2 ** Math.min(failures, 6));
    }
    await sleep(delay);
  }
}

// ----- doctor / measure ---------------------------------------------------------------------

async function measureCommand(file) {
  const t0 = Date.now();
  try {
    const { metrics, frames } = await measureClip(path.resolve(file));
    const seconds = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(JSON.stringify(metrics, null, 2));
    console.log(`frames: ${frames.length} JPEG data URLs (${frames.map((f) => `${Math.round(f.length / 1024)} KB`).join(", ")})`);
    console.log(`measured in ${seconds} s`);
    return true;
  } catch (err) {
    console.log(`Could not measure ${file}: ${errText(err)}`);
    return false;
  }
}

async function doctor() {
  const ok = (b) => (b ? "OK  " : "FAIL");
  console.log("H3 Lab worker — doctor\n");
  console.log(`Machine   ${os.hostname()}  (node ${process.version})`);
  console.log(`Hub       ${cfg.hubUrl}`);
  console.log(`Token     ${cfg.token ? `set (${cfg.token.slice(0, 4)}…, ${cfg.token.length} chars)` : "NOT SET — mint one in the lab's H3 Connection page"}`);
  console.log(`WanGP     ${cfg.wangpApp}  (MCP http://${cfg.mcpHost}:${cfg.mcpPort}${cfg.mcpPath})\n`);

  // Hub + token: a claim that can take nothing.
  if (!cfg.token) {
    console.log(`${ok(false)} hub       skipped: no H3LAB_TOKEN`);
  } else {
    try {
      const r = await hub.claim({
        status: { machine: os.hostname(), version: VERSION, current: null, queueDepth: 0 },
        canRender: false,
        canThink: false,
      });
      console.log(`${ok(true)} hub       reachable, token accepted${r ? ` (it answered ${JSON.stringify(r).slice(0, 80)})` : ", nothing handed out"}`);
    } catch (err) {
      console.log(`${ok(false)} hub       ${errText(err)}`);
    }
  }

  // WanGP
  try {
    const w = await wangp.status();
    console.log(`${ok(w.wangp === "ready")} wangp     ${w.wangp}: ${w.wangpDetail}`);
    if (w.models?.length) console.log(`          H3 models: ${w.models.join(", ")}`);
    if (w.wangp === "ready") console.log(`          wangp_generate takes ${wangp.generateShape === "settings" ? "{ settings }" : "{ action:'generate', arguments:{ source } }"}`);
  } catch (err) {
    console.log(`${ok(false)} wangp     ${errText(err)}`);
  }

  // ffmpeg / ffprobe
  const ffv = await run(ffmpegBin(), ["-hide_banner", "-version"], { timeoutMs: 15_000 });
  console.log(`${ok(ffv.ok)} ffmpeg    ${ffv.ok ? ffv.stdout.toString().split(/\r?\n/)[0] : `not runnable as "${ffmpegBin()}" (set FFMPEG_PATH)`}`);
  const fpv = await run(ffprobeBin(), ["-hide_banner", "-version"], { timeoutMs: 15_000 });
  console.log(`${ok(fpv.ok)} ffprobe   ${fpv.ok ? fpv.stdout.toString().split(/\r?\n/)[0] : `not runnable as "${ffprobeBin()}" (set FFPROBE_PATH)`}`);

  // claude
  const cl = await findClaude();
  console.log(`${ok(Boolean(cl))} claude    ${cl ?? "not found — think jobs stay with the hub's own AI"}`);

  const file = valueOf("--measure");
  if (file) {
    console.log(`\nMeasuring ${file} …`);
    await measureCommand(file);
  }
}

// ----- entry ------------------------------------------------------------------------------------

let stopping = false;
process.on("SIGINT", async () => {
  if (stopping) process.exit(130);
  stopping = true;
  if (state.current) {
    log(`Stopping mid-render of ${state.current}; telling the hub.`);
    await Promise.race([
      hub.result({ generationId: state.current, ok: false, error: "The PC worker was stopped during the render." }).catch(() => null),
      sleep(4000),
    ]);
  }
  process.exit(130);
});
process.on("unhandledRejection", (err) => log(`Unhandled: ${errText(err)}`));

if (flag("--doctor")) {
  await doctor();
} else if (flag("--measure")) {
  const file = valueOf("--measure");
  if (!file) {
    console.error("Usage: node worker.mjs --measure <clip.mp4>");
    process.exitCode = 2;
  } else if (!(await measureCommand(file))) {
    process.exitCode = 1;
  }
} else {
  await loop();
}
