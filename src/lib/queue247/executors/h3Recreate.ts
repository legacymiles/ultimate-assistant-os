// ---------------------------------------------------------------------------
// H3 Recreation Agent — a reference video in, a storyboard and MiniMax H3
// prompts out, with the owner's characters / outfits / places / style swapped.
//
// Reuses the H3 Prompt Lab end to end: the Lab's "Video Reverse Engineering"
// analysis (h3-lab/server/brain.ts analyzeAsk → askHub → parseAnalysis, with
// offlineAnalysis when no AI key), its recreate() + compileProduction() +
// lint() for the prompts. Only shot detection differs: ffmpeg's scene score on
// the worker instead of the browser's colour histograms.
//
// One phase per step (ctx.state.phase):
//   fetch      uploaded key checked, or a link imported and stored in Storage
//   detect     ffprobe + ffmpeg scene pass → shots (≤ 40)
//   frames     up to 3 keyframes per shot → Storage, keys in state (batched)
//   analyze    the Lab's vision analysis → blueprint.json in Storage
//   storyboard finding "h3-storyboard"
//   prompts    one finding "h3-prompt" per shot, with variations → done
//
// A step may run on a different machine from the last one, so nothing on
// local disk outlives a step: the video is re-downloaded from Storage when a
// step needs it, and the temp folder is removed at the end of every step.
// Needs: ffmpeg, ai, storage (+ ytdlp/web when config.url is set — the
// planner and h3TaskInput() set that).
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StepResult } from "../engine";
import { markStep } from "../engine";
import type { Executor, StepContext } from "./types";
import type { AnalyzeRequest } from "@/lib/h3-lab/api";
import type { Blueprint } from "@/lib/h3-lab/model";
import { analyzeAsk, askHub, offlineAnalysis, parseAnalysis, type AnalysisDraft } from "@/lib/h3-lab/server/brain";
import { DEFAULT_AGENT } from "@/lib/h3-lab/state";
import { GENRES, guessGenre } from "@/lib/h3-lab/genres";
import { aiConfigured } from "@/lib/ai/provider";
import { parseLink, PLATFORM_LABEL } from "@/lib/social-import/platform";
import { downloadVideo, VideoUnavailableError } from "@/lib/social-import/videoDownload";
import { keyframeArgs, keyframeTimes, parseProbe, parseSceneCuts, probeArgs, sceneDetectArgs, type ProbeInfo, type ShotSpan } from "../h3/scenes";
import { cleanChanges, describeChanges } from "../h3/changes";
import { blueprintFrom, buildRecreation, toStoryboard } from "../h3/storyboard";
import { variations } from "../h3/variations";
import { clampVariations, H3_DEFAULT_VARIATIONS, H3_STEPS } from "../h3/task";
import { frameKey, H3_BUCKET, MAX_UPLOAD_BYTES, ownsUpload, taskPrefix, UPLOAD_TYPES } from "../h3/upload";
import { downloadToFile, fileSize, getFile, putFile } from "../h3/blob";

type Phase = "fetch" | "detect" | "frames" | "analyze" | "storyboard" | "prompts";

interface H3State {
  phase?: Phase;
  videoKey?: string;
  videoName?: string;
  videoBytes?: number;
  probe?: ProbeInfo;
  shots?: ShotSpan[];
  /** Only the first MAX_ANALYZE_SEC were scanned. */
  limited?: boolean;
  frames?: string[][];
  frameCursor?: number;
  blueprintKey?: string;
  engine?: "ai" | "offline";
  answers?: { a: string }[];
}

/** Long references are scanned for their first 10 minutes — 40 shots fill up well before that. */
const MAX_ANALYZE_SEC = 600;
/** Leave headroom under the 4-minute step budget for uploads and the state write. */
const FRAME_BATCH_MS = 150_000;
/** The same ceiling the Lab's analyze route puts on keyframe bytes. */
const MAX_FRAME_BYTES = 4_000_000;

const ffmpegBin = () => process.env.FFMPEG_PATH || "ffmpeg";
const ffprobeBin = () => process.env.FFPROBE_PATH || "ffprobe";

// ----- small helpers -----------------------------------------------------------------

function run(bin: string, args: string[], signal: AbortSignal, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { signal, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT") return reject(new Error(`${path.basename(bin)} is not installed on this worker.`));
      if (err && (err.name === "AbortError" || signal.aborted)) return reject(new Error("Stopped — the step was cancelled or ran out of time."));
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function setStep(ctx: StepContext, id: string, state: "active" | "done" | "failed" | "skipped", note?: string) {
  const next = markStep(ctx.steps, id, state, note, ctx.now());
  ctx.steps.splice(0, ctx.steps.length, ...next);
}

function tempDir(taskId: string): string {
  return path.join(os.tmpdir(), "queue247", taskId.replace(/[^A-Za-z0-9_-]/g, ""));
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

function extOf(key: string): string {
  return /\.([a-z0-9]{2,4})$/i.exec(key)?.[1]?.toLowerCase() ?? "mp4";
}

function configOf(ctx: StepContext) {
  const c = ctx.task.config;
  return {
    videoKey: typeof c.videoKey === "string" ? c.videoKey.trim() : "",
    url: typeof c.url === "string" ? c.url.trim() : "",
    changes: cleanChanges(c.changes),
    variations: c.variations === undefined ? H3_DEFAULT_VARIATIONS : clampVariations(c.variations),
    title: typeof c.title === "string" && c.title.trim() ? c.title.trim() : ctx.task.title.replace(/^Recreate “|” for H3$/g, ""),
    model: typeof c.model === "string" && c.model.trim() ? c.model.trim() : DEFAULT_AGENT.model,
    note: typeof c.note === "string" ? c.note : "",
  };
}

/** Download the stored video into a fresh temp folder, run `fn`, always clean up. */
async function withVideo<T>(ctx: StepContext, st: H3State, fn: (file: string) => Promise<T>): Promise<T> {
  const dir = tempDir(ctx.task.id);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(dir, { recursive: true });
  try {
    const file = path.join(dir, `source.${extOf(st.videoKey ?? "")}`);
    await downloadToFile(st.videoKey!, file, ctx.signal);
    return await fn(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ----- phases --------------------------------------------------------------------------

async function fetchPhase(ctx: StepContext, st: H3State): Promise<StepResult> {
  const cfg = configOf(ctx);
  const uid = ctx.task.user_id;
  setStep(ctx, "s1", "active");
  await ctx.progress(3, "Fetching the video");

  // The owner may have answered a "that link failed" question with another link or an upload key.
  const answer = String((st.answers ?? []).at(-1)?.a ?? "");
  const answeredKey = /uploads\/[^\s]+/.exec(answer)?.[0] ?? "";
  const answeredLink = parseLink(answer);
  const key = ownsUpload(uid, answeredKey) ? answeredKey : cfg.videoKey;
  const link = answeredLink && !answeredKey ? answeredLink : cfg.url && !key ? parseLink(cfg.url) : null;

  if (key && !link) {
    if (!ownsUpload(uid, key)) return { outcome: "failed", error: "That upload does not belong to this account.", retryable: false };
    const size = await fileSize(key, ctx.signal);
    if (size === null) {
      return { outcome: "needs_input", question: "The uploaded video isn't in Storage — the upload may not have finished. Upload it again from H3 Prompt Lab → Reverse Engineering → Run in 24/7 Queue, or answer with a link to the video." };
    }
    st.videoKey = key;
    st.videoName = key.split("/").pop() ?? "upload";
    st.videoBytes = size;
    await ctx.log(`Using the uploaded video (${mb(size)}).`, { key }, "step");
  } else if (link) {
    const site = PLATFORM_LABEL[link.platform];
    await ctx.log(`Importing the video from ${site}: ${link.url.href}`);
    let got;
    try {
      got = await downloadVideo(link.url, link.platform, { maxBytes: MAX_UPLOAD_BYTES });
    } catch (e) {
      const why = e instanceof VideoUnavailableError ? e.message : `Couldn't download a video from that ${site} link (${e instanceof Error ? e.message : String(e)}).`;
      if (e instanceof VideoUnavailableError) await ctx.log(`Tried: ${e.trail.join(" ")}`, { trail: e.trail }, "warn");
      return {
        outcome: "needs_input",
        question: `${why} Upload the file instead (H3 Prompt Lab → Reverse Engineering → Run in 24/7 Queue), or answer with a different link.`,
      };
    }
    const ext = Object.entries(UPLOAD_TYPES).find(([, t]) => t === got.contentType)?.[0] ?? (got.contentType.includes("webm") ? "webm" : "mp4");
    const storeKey = `${taskPrefix(uid, ctx.task.id)}/source.${ext}`;
    // Store it first: a later step may run on another machine and must find it.
    if (!(await putFile(storeKey, got.bytes, got.contentType))) {
      return { outcome: "failed", error: "Couldn't save the imported video to Storage (bucket queue-247).", retryable: true };
    }
    st.videoKey = storeKey;
    st.videoName = got.title || `${site} video`;
    st.videoBytes = got.bytes.length;
    await ctx.log(`Imported ${mb(got.bytes.length)} from ${site} via ${got.via} and stored it.`, { key: storeKey, trail: got.trail }, "step");
  } else {
    return { outcome: "needs_input", question: "There is no video to work from. Answer with a link to the video, or upload it from H3 Prompt Lab → Reverse Engineering → Run in 24/7 Queue." };
  }

  setStep(ctx, "s1", "done", `${st.videoName} · ${mb(st.videoBytes ?? 0)}`);
  st.phase = "detect";
  await ctx.progress(10, "Finding the shots");
  return { outcome: "continue" };
}

async function detectPhase(ctx: StepContext, st: H3State): Promise<StepResult> {
  setStep(ctx, "s2", "active");
  const res = await withVideo(ctx, st, async (file) => {
    const probe = await run(ffprobeBin(), probeArgs(file), ctx.signal, 60_000);
    const info = parseProbe(probe.stdout);
    if (!(info.duration > 0) || !info.width) return { error: `ffprobe could not read a video stream from this file${probe.stderr ? `: ${probe.stderr.trim().slice(0, 200)}` : "."}` };
    const limited = info.duration > MAX_ANALYZE_SEC;
    const scan = await run(ffmpegBin(), sceneDetectArgs(file, limited ? MAX_ANALYZE_SEC : undefined), ctx.signal, 200_000);
    if (scan.code !== 0) return { error: `ffmpeg's scene pass failed: ${scan.stderr.trim().split(/\r?\n/).slice(-2).join(" ").slice(0, 300)}` };
    const shots = parseSceneCuts(scan.stderr, limited ? MAX_ANALYZE_SEC : info.duration);
    return { info, shots, limited };
  });
  if ("error" in res) {
    setStep(ctx, "s2", "failed", res.error);
    return { outcome: "failed", error: res.error ?? "Shot detection failed.", retryable: false };
  }
  st.probe = res.info;
  st.shots = res.shots;
  st.limited = res.limited;
  const span = res.limited ? MAX_ANALYZE_SEC : res.info.duration;
  const line = `Found ${res.shots.length} shot${res.shots.length === 1 ? "" : "s"} in ${span.toFixed(1)} s`;
  await ctx.log(
    `${line} (${res.info.width}×${res.info.height}, ${res.info.fps} fps)${res.limited ? ` — the video is ${(res.info.duration / 60).toFixed(1)} min, so only the first 10 minutes were scanned` : ""}.`,
    { shots: res.shots.length, duration: res.info.duration },
    "step",
  );
  setStep(ctx, "s2", "done", line);
  st.phase = "frames";
  st.frames = [];
  st.frameCursor = 0;
  await ctx.progress(25, "Pulling keyframes");
  return { outcome: "continue" };
}

async function framesPhase(ctx: StepContext, st: H3State): Promise<StepResult> {
  setStep(ctx, "s3", "active");
  const shots = st.shots ?? [];
  const frames = st.frames ?? [];
  const started = Date.now();
  let made = 0;
  await withVideo(ctx, st, async (file) => {
    const dir = path.dirname(file);
    for (let i = st.frameCursor ?? 0; i < shots.length; i++) {
      if (ctx.signal.aborted || Date.now() - started > FRAME_BATCH_MS) break;
      const keys: string[] = [];
      const times = keyframeTimes(shots[i]);
      for (let k = 0; k < times.length; k++) {
        const out = path.join(dir, `f${i + 1}-${k + 1}.jpg`);
        const r = await run(ffmpegBin(), keyframeArgs(file, times[k], out), ctx.signal, 30_000);
        const bytes = r.code === 0 ? await fs.readFile(out).catch(() => null) : null;
        if (!bytes?.length) continue;
        const key = frameKey(ctx.task.user_id, ctx.task.id, i + 1, k + 1);
        if (await putFile(key, bytes, "image/jpeg")) {
          keys.push(key);
          made++;
        }
        await fs.unlink(out).catch(() => undefined);
      }
      frames[i] = keys;
      st.frameCursor = i + 1;
    }
  });
  st.frames = frames;
  const doneShots = st.frameCursor ?? 0;
  const total = frames.reduce((n, f) => n + (f?.length ?? 0), 0);
  await ctx.progress(25 + Math.round((doneShots / Math.max(1, shots.length)) * 20), `Pulling keyframes (${doneShots}/${shots.length} shots)`);
  if (doneShots < shots.length) {
    await ctx.log(`Pulled ${made} keyframes this step — ${doneShots} of ${shots.length} shots done.`);
    return { outcome: "continue" };
  }
  if (!total) {
    setStep(ctx, "s3", "failed", "no frames");
    return { outcome: "failed", error: "ffmpeg could not pull a single keyframe from this video.", retryable: false };
  }
  await ctx.log(`Pulled ${total} keyframes from ${shots.length} shots and stored them in ${H3_BUCKET}.`, { frames: total }, "step");
  setStep(ctx, "s3", "done", `${total} keyframes`);
  st.phase = "analyze";
  await ctx.progress(45, "Reverse-engineering each shot");
  return { outcome: "continue" };
}

/** Pick which of a shot's frames to send: all 3, first+last, or the middle one. */
export function pickFrames(keys: string[], perShot: number): string[] {
  if (keys.length <= perShot) return keys;
  if (perShot === 1) return [keys[Math.floor(keys.length / 2)]];
  return [keys[0], keys[keys.length - 1]];
}

async function analyzePhase(ctx: StepContext, st: H3State): Promise<StepResult> {
  setStep(ctx, "s4", "active");
  const cfg = configOf(ctx);
  const shots = st.shots ?? [];
  const frames = st.frames ?? [];
  const probe = st.probe ?? { duration: 0, width: 0, height: 0, fps: 0 };
  const name = st.videoName ?? cfg.title;
  const guessed = guessGenre(`${cfg.title} ${name} ${cfg.note}`);
  const base: AnalyzeRequest = {
    name,
    durationSec: st.limited ? MAX_ANALYZE_SEC : probe.duration,
    width: probe.width || 1920,
    height: probe.height || 1080,
    note: [cfg.note, `The owner will recreate it with these changes: ${describeChanges(cfg.changes)}.`].filter(Boolean).join(" "),
    shots: shots.map((s) => ({ start: s.start, end: s.end, cutStrength: s.cutStrength, frames: [] })),
  };

  let draft: AnalysisDraft = offlineAnalysis(base, guessed);
  let engine: "ai" | "offline" = "offline";
  let notice: string | undefined;

  if (!aiConfigured()) {
    notice = "No AI key on this worker (OPENROUTER_API_KEY or AI_GATEWAY_API_KEY), so the shots were NOT described — the storyboard has the measured cuts, timings and keyframes only, and the prompts carry camera timing but no action.";
    await ctx.log(notice, undefined, "warn");
  } else {
    // Load keyframes as data URLs, as many per shot as fit the Lab's 4 MB ceiling.
    const cache = new Map<string, string>();
    const urlOf = async (key: string) => {
      if (!cache.has(key)) {
        const b = await getFile(key);
        cache.set(key, b ? `data:image/jpeg;base64,${b.toString("base64")}` : "");
      }
      return cache.get(key)!;
    };
    let req: AnalyzeRequest = base;
    let size = 0;
    for (const per of [3, 2, 1]) {
      const withFrames = await Promise.all(base.shots.map(async (s, i) => ({ ...s, frames: (await Promise.all(pickFrames(frames[i] ?? [], per).map(urlOf))).filter(Boolean) })));
      size = withFrames.reduce((n, s) => n + s.frames.reduce((m, f) => m + f.length, 0), 0);
      req = { ...base, shots: withFrames };
      if (size <= MAX_FRAME_BYTES) break;
    }
    const sent = req.shots.reduce((n, s) => n + s.frames.length, 0);
    await ctx.log(`Sending ${sent} keyframes (${mb(size)}) for ${shots.length} shots to ${cfg.model}.`);
    try {
      ctx.meter.aiCalls++;
      const parsed = parseAnalysis(await askHub(analyzeAsk(req), cfg.model), shots.length);
      if (parsed) {
        draft = parsed;
        engine = "ai";
      } else {
        notice = "The vision model's answer could not be read — kept the measured shot structure only.";
        await ctx.log(notice, undefined, "warn");
      }
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      // A transient AI failure is worth a retry; the measured structure is the fallback only once retries are spent.
      if (ctx.task.attempts < ctx.task.max_attempts) {
        await ctx.log(`The vision model failed: ${why}`, undefined, "warn");
        return { outcome: "failed", error: `The vision model failed: ${why}`, retryable: true };
      }
      notice = `The vision model failed (${why}) — kept the measured shot structure only.`;
      await ctx.log(notice, undefined, "warn");
    }
  }
  if (!GENRES.some((g) => g.id === draft.genre)) draft = { ...draft, genre: guessed };

  const bp: Blueprint = blueprintFrom({
    id: `bp-${ctx.task.id.slice(0, 8)}`,
    name,
    probe: { ...probe, duration: base.durationSec },
    shots,
    frames,
    draft,
    engine,
    notice,
    now: ctx.now().toISOString(),
  });
  const key = `${taskPrefix(ctx.task.user_id, ctx.task.id)}/blueprint.json`;
  if (!(await putFile(key, Buffer.from(JSON.stringify(bp)), "application/json"))) {
    return { outcome: "failed", error: "Couldn't save the analysis to Storage (bucket queue-247).", retryable: true };
  }
  st.blueprintKey = key;
  st.engine = engine;
  const line =
    engine === "ai"
      ? `Described ${shots.length} shots: ${bp.characters.length} ${bp.characters.length === 1 ? "person" : "people"}, ${bp.environments.length} place${bp.environments.length === 1 ? "" : "s"}, genre ${bp.genre}.`
      : `Kept the measured structure of ${shots.length} shots (offline — not described).`;
  await ctx.log(line, { engine, characters: bp.characters.map((c) => c.label), environments: bp.environments.map((e) => e.label) }, "step");
  setStep(ctx, "s4", "done", engine === "ai" ? line : "offline — measured structure only");
  st.phase = "storyboard";
  await ctx.progress(70, "Building the storyboard");
  return { outcome: "continue" };
}

async function loadBlueprint(st: H3State): Promise<Blueprint | null> {
  if (!st.blueprintKey) return null;
  const b = await getFile(st.blueprintKey);
  if (!b) return null;
  try {
    return JSON.parse(b.toString("utf8")) as Blueprint;
  } catch {
    return null;
  }
}

async function storyboardPhase(ctx: StepContext, st: H3State): Promise<StepResult> {
  setStep(ctx, "s5", "active");
  const cfg = configOf(ctx);
  const bp = await loadBlueprint(st);
  if (!bp) {
    // The analysis file is gone: redo it rather than fail the task.
    st.phase = "analyze";
    await ctx.log("The saved analysis could not be read back — analysing again.", undefined, "warn");
    return { outcome: "continue" };
  }
  const sb = toStoryboard(bp);
  await ctx.finding({
    kind: "h3-storyboard",
    key: ctx.task.id,
    title: `Storyboard — ${cfg.title}`,
    summary: `${sb.shots.length} shots over ${sb.totalDuration.toFixed(1)} s · ${sb.pacing}${sb.style ? ` · ${sb.style}` : ""}${sb.engine === "offline" ? " · measured structure only (no AI)" : ""}`,
    data: { storyboard: sb, frameKeys: st.frames ?? [], bucket: H3_BUCKET, blueprintKey: st.blueprintKey, videoKey: st.videoKey, changes: cfg.changes },
    notable: true,
  });
  await ctx.log(`Storyboard saved: ${sb.shots.length} shots, ${sb.pacing}.`, undefined, "result");
  setStep(ctx, "s5", "done", `${sb.shots.length} shots`);
  st.phase = "prompts";
  await ctx.progress(80, "Writing the H3 prompts");
  return { outcome: "continue" };
}

async function promptsPhase(ctx: StepContext, st: H3State): Promise<StepResult> {
  setStep(ctx, "s6", "active");
  const cfg = configOf(ctx);
  const bp = await loadBlueprint(st);
  if (!bp) {
    st.phase = "analyze";
    await ctx.log("The saved analysis could not be read back — analysing again.", undefined, "warn");
    return { outcome: "continue" };
  }
  const rec = buildRecreation(bp, cfg.changes, cfg.title, ctx.now().toISOString());
  for (const line of rec.applied) await ctx.log(`Change applied: ${line}`);
  for (const line of rec.unmatched) await ctx.log(line, undefined, "warn");
  const sb = toStoryboard(bp);
  let variationCount = 0;
  let lintErrors = 0;
  for (const p of rec.prompts) {
    const vars = variations(p.prompt, cfg.variations);
    variationCount += vars.length;
    lintErrors += p.lint.filter((f) => f.level === "error").length;
    const shot = sb.shots[p.n - 1];
    await ctx.finding({
      kind: "h3-prompt",
      key: `${ctx.task.id}:shot${p.n}`,
      title: `Shot ${p.n} — ${cfg.title}`,
      summary: `${shot ? `${shot.start.toFixed(1)}–${shot.end.toFixed(1)} s · ${shot.movement}` : ""}${shot?.action ? ` · ${shot.action.slice(0, 140)}` : ""}`,
      data: { prompt: p.prompt, variations: vars, shot: shot ?? null, spec: p.spec, lint: p.lint, taskId: ctx.task.id },
    });
  }
  setStep(ctx, "s6", "done", `${rec.prompts.length} prompts${lintErrors ? ` · ${lintErrors} lint error${lintErrors === 1 ? "" : "s"}` : ""}`);
  setStep(ctx, "s7", "done", `${variationCount} variations`);
  await ctx.progress(100, "Finished");
  const summary = `${rec.prompts.length} shots, ${variationCount} prompt variations${bp.engine === "offline" ? " (measured structure only — no AI description)" : ""}.`;
  await ctx.log(`Wrote ${rec.prompts.length} H3 prompts and ${variationCount} variations${lintErrors ? `; the linter flagged ${lintErrors} error${lintErrors === 1 ? "" : "s"} to look at` : ""}.`, undefined, "result");
  await ctx.notify(`Your recreation of ${cfg.title} is ready`, `Your recreation of ${cfg.title} is ready: ${summary}`, "/apps/jarvis#queue");
  return { outcome: "done", summary };
}

async function runStep(ctx: StepContext): Promise<StepResult> {
  const st = ctx.state as H3State;
  if (!ctx.steps.length) ctx.steps.splice(0, 0, ...H3_STEPS.map((label, i) => ({ id: `s${i + 1}`, label, state: "pending" as const })));
  const phase: Phase = st.phase ?? "fetch";
  try {
    switch (phase) {
      case "fetch":
        return await fetchPhase(ctx, st);
      case "detect":
        return await detectPhase(ctx, st);
      case "frames":
        return await framesPhase(ctx, st);
      case "analyze":
        return await analyzePhase(ctx, st);
      case "storyboard":
        return await storyboardPhase(ctx, st);
      case "prompts":
        return await promptsPhase(ctx, st);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ctx.log(`${phase} step failed: ${msg}`, undefined, "error");
    return { outcome: "failed", error: msg, retryable: !/not installed/.test(msg) };
  } finally {
    await fs.rm(tempDir(ctx.task.id), { recursive: true, force: true }).catch(() => undefined);
  }
  return { outcome: "failed", error: `Unknown phase "${String(phase)}".`, retryable: false };
}

export const h3RecreateExecutor: Executor = {
  id: "h3-recreate",
  agent: "H3 Recreation Agent",
  describe:
    "Reverse-engineers a reference video (an upload or a social link) into a shot-by-shot storyboard and MiniMax H3 prompts, swapping in the owner's characters, outfits, locations and style, with N prompt variations per shot.",
  configHelp: {
    videoKey: "Storage key of an uploaded video in bucket queue-247 (uploads/<uid>/…), from POST /api/queue247/h3/upload.",
    url: "A YouTube / TikTok / Instagram / Facebook / X / Vimeo link to import instead (also needs ytdlp + web).",
    changes: "{characters:[{from,to}], outfits:[{from,to}], locations:[{from,to}], style, extra} — or the owner's plain words.",
    variations: `Prompt variations per shot, 1-6 (default ${H3_DEFAULT_VARIATIONS}).`,
    title: "Name for the recreation.",
  },
  needs: ["ffmpeg", "ai", "storage"],
  defaultKind: "once",
  concurrency: 1,
  initialSteps: () => H3_STEPS,
  run: runStep,
};
