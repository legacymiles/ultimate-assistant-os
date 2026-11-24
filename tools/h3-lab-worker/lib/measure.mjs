// ---------------------------------------------------------------------------
// What ffmpeg can say about a clip — evidence, not opinion. Produces the hub's
// ClipMetrics (src/lib/h3-lab/model.ts) plus small JPEG frames for judging.
//
// Every step degrades on its own: if one ffmpeg call fails, that field gets a
// neutral value, its name goes in `unmeasured`, and the rest carry on.
//
// Passes (all on one clip, run side by side):
//   probe     ffprobe -show_entries stream=...:format=duration -of json
//   frames    6 x  ffmpeg -ss t -i f -frames:v 1 -vf signalstats,metadata=print,scale=384:-2 -q:v 5 x.jpg
//             (JPEG for judging + the YAVG luma of that same frame)
//   analysis  ffmpeg -i f -vf scale=192:H,format=gray -f rawvideo -pix_fmt gray -
//             → 12 evenly spaced frames → PGM files → 12 x ffmpeg -i a.pgm -i b.pgm -lavfi ssim
//             → the same frames halved to 96 px → lib/motion.mjs (camera move)
//   cuts      ffmpeg -i f -vf scdet=threshold=10,metadata=print:file=- -f null -
//   freezes   ffmpeg -i f -vf freezedetect=n=-60dB:d=0.5 -f null -   (parsed from stderr)
// ---------------------------------------------------------------------------

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { run, pool } from "./proc.mjs";
import { estimateMotion, classifyMove, summarizeMotion } from "./motion.mjs";

export const SAMPLE_COUNT = 6;
export const ANALYSIS_COUNT = 12;
export const MOTION_COUNT = 24;
export const ANALYSIS_WIDTH = 192;
export const CUT_THRESHOLD = 10;

export function ffmpegBin() {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

export function ffprobeBin() {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const ff = process.env.FFMPEG_PATH;
  if (ff && /ffmpeg(\.exe)?$/i.test(ff)) return ff.replace(/ffmpeg(\.exe)?$/i, (_, ext) => `ffprobe${ext ?? ""}`);
  return "ffprobe";
}

/** Is ffmpeg runnable? */
export async function hasFfmpeg() {
  const r = await run(ffmpegBin(), ["-hide_banner", "-version"], { timeoutMs: 15_000 });
  return r.ok;
}

const r3 = (v) => Math.round(v * 1000) / 1000;

function parseRate(text) {
  if (!text) return 0;
  const [n, d] = String(text).split("/").map(Number);
  if (!d) return Number(n) || 0;
  return n / d;
}

/** ffprobe: duration, size, fps, frame count. Throws when the file is not a video. */
export async function probe(file) {
  const r = await run(ffprobeBin(), [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,avg_frame_rate,r_frame_rate,nb_frames,duration:format=duration",
    "-of", "json",
    file,
  ], { timeoutMs: 30_000 });
  if (!r.ok) throw new Error(`ffprobe failed: ${r.stderr.trim().slice(0, 300) || `exit ${r.code}`}`);
  const j = JSON.parse(r.stdout.toString() || "{}");
  const s = j.streams?.[0];
  if (!s) throw new Error("ffprobe found no video stream.");
  const fps = parseRate(s.avg_frame_rate) || parseRate(s.r_frame_rate) || 24;
  const durationSec = Number(s.duration) || Number(j.format?.duration) || 0;
  const frames = Number(s.nb_frames) || Math.round(durationSec * fps);
  return { durationSec: r3(durationSec), width: Number(s.width) || 0, height: Number(s.height) || 0, fps: r3(fps), frames };
}

/** The six judging times: (i + 0.5) / 6 of the way through, never exactly 0 or the end. */
export function sampleTimesFor(durationSec, count = SAMPLE_COUNT) {
  return Array.from({ length: count }, (_, i) => r3(((i + 0.5) / count) * durationSec));
}

/**
 * One JPEG (384 px wide) per time, as data URLs, and the mean luma (YAVG,
 * 0-255 video range) of each. A failed frame is "" and its luma is null.
 */
export async function extractFrames(file, times, tmp) {
  const tasks = times.map((t, i) => async () => {
    const out = path.join(tmp, `sample-${i}.jpg`);
    const r = await run(ffmpegBin(), [
      "-hide_banner", "-nostats", "-loglevel", "error",
      "-ss", String(t), "-i", file,
      "-frames:v", "1",
      "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-,scale=384:-2",
      "-q:v", "5", "-y", out,
    ], { timeoutMs: 60_000 });
    let url = "";
    try {
      const bytes = await fs.readFile(out);
      if (bytes.length) url = `data:image/jpeg;base64,${bytes.toString("base64")}`;
    } catch {
      /* no frame */
    }
    const m = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(r.stdout.toString());
    return { url, luma: m ? Math.round(Number(m[1]) * 10) / 10 : null };
  });
  return pool(tasks, 3);
}

/** Decode the whole clip once as small grayscale frames. */
export async function decodeGray(file, width, height, srcW, srcH) {
  const w = width;
  const h = Math.max(2, Math.round((width * (srcH || 9)) / (srcW || 16) / 2) * 2) || height;
  const r = await run(ffmpegBin(), [
    "-hide_banner", "-nostats", "-loglevel", "error",
    "-i", file, "-an",
    "-vf", `scale=${w}:${h}:flags=area,format=gray`,
    "-f", "rawvideo", "-pix_fmt", "gray", "-",
  ], { timeoutMs: 180_000 });
  const size = w * h;
  const n = Math.floor(r.stdout.length / size);
  if (!n) throw new Error(`gray decode produced no frames: ${r.stderr.trim().slice(0, 300)}`);
  const frames = [];
  for (let i = 0; i < n; i += 1) frames.push(new Uint8Array(r.stdout.buffer, r.stdout.byteOffset + i * size, size));
  return { frames, w, h };
}

/** Halve a gray plane with a 2x2 box filter. */
export function halve(plane, w, h) {
  const w2 = Math.floor(w / 2);
  const h2 = Math.floor(h / 2);
  const out = new Uint8Array(w2 * h2);
  for (let y = 0; y < h2; y += 1) {
    for (let x = 0; x < w2; x += 1) {
      const i = 2 * y * w + 2 * x;
      out[y * w2 + x] = (plane[i] + plane[i + 1] + plane[i + w] + plane[i + w + 1] + 2) >> 2;
    }
  }
  return { plane: out, w: w2, h: h2 };
}

function pgm(plane, w, h) {
  return Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`, "ascii"), Buffer.from(plane)]);
}

/** ffmpeg's SSIM (the "All:" value) between two PGM files; null when it fails. */
export async function ssimPair(a, b) {
  const r = await run(ffmpegBin(), ["-hide_banner", "-nostats", "-i", a, "-i", b, "-lavfi", "ssim", "-f", "null", "-"], { timeoutMs: 30_000 });
  const m = /All:\s*([\d.]+)/.exec(r.stderr);
  return m ? Number(m[1]) : null;
}

/** Scene-change scores at or above the threshold (unintended cuts inside one shot). */
export async function detectCuts(file, threshold = CUT_THRESHOLD) {
  const r = await run(ffmpegBin(), [
    "-hide_banner", "-nostats", "-loglevel", "error",
    "-i", file, "-an",
    "-vf", `scdet=threshold=${threshold},metadata=print:file=-`,
    "-f", "null", "-",
  ], { timeoutMs: 180_000 });
  const text = r.stdout.toString();
  if (!r.ok && !text) throw new Error(`scdet failed: ${r.stderr.trim().slice(0, 300)}`);
  const cuts = [];
  let t = 0;
  for (const line of text.split(/\r?\n/)) {
    const pt = /pts_time:([\d.eE+-]+)/.exec(line);
    if (pt) {
      t = Number(pt[1]);
      continue;
    }
    const sc = /lavfi\.scd\.score=([\d.]+)/.exec(line);
    if (sc && t > 0 && Number(sc[1]) >= threshold) cuts.push({ t: r3(t), score: Math.round(Number(sc[1]) * 10) / 10 });
  }
  return cuts;
}

/** Frozen stretches of at least half a second. */
export async function detectFreezes(file, durationSec) {
  const r = await run(ffmpegBin(), [
    "-hide_banner", "-nostats",
    "-i", file, "-an",
    "-vf", "freezedetect=n=-60dB:d=0.5",
    "-f", "null", "-",
  ], { timeoutMs: 180_000 });
  if (!r.ok) throw new Error(`freezedetect failed: ${r.stderr.trim().slice(-300)}`);
  const freezes = [];
  let start = null;
  for (const line of r.stderr.split(/\r?\n/)) {
    const s = /freeze_start:\s*([\d.]+)/.exec(line);
    if (s) {
      start = Number(s[1]);
      continue;
    }
    const e = /freeze_end:\s*([\d.]+)/.exec(line);
    if (e && start !== null) {
      freezes.push({ start: r3(start), end: r3(Number(e[1])) });
      start = null;
    }
  }
  if (start !== null) freezes.push({ start: r3(start), end: r3(durationSec) });
  return freezes;
}

/** SSIM + camera motion from 12 evenly spaced gray frames. */
async function analyse(file, info, tmp) {
  const { frames: all, w, h } = await decodeGray(file, ANALYSIS_WIDTH, 0, info.width, info.height);
  const n = all.length;
  const count = Math.min(ANALYSIS_COUNT, n);
  const idx = Array.from({ length: count }, (_, i) => Math.min(n - 1, Math.floor(((i + 0.5) / count) * n)));
  const effFps = info.durationSec > 0 ? n / info.durationSec : info.fps || 24;
  const times = idx.map((i) => r3(i / effFps));
  const picked = idx.map((i) => all[i]);

  // --- SSIM, by ffmpeg, on 192 px grayscale PGMs ---
  let ssim = null;
  try {
    const files = await Promise.all(
      picked.map(async (p, i) => {
        const f = path.join(tmp, `a-${String(i).padStart(2, "0")}.pgm`);
        await fs.writeFile(f, pgm(p, w, h));
        return f;
      }),
    );
    const pairs = files.slice(1).map((f, i) => () => ssimPair(files[i], f));
    pairs.push(() => ssimPair(files[0], files[files.length - 1]));
    const values = await pool(pairs, 4);
    const firstLast = values.pop();
    const adj = values.map((v, i) => ({ v, at: times[i + 1] })).filter((x) => x.v !== null);
    if (adj.length) {
      const min = adj.reduce((m, x) => (x.v < m.v ? x : m), adj[0]);
      ssim = {
        ssimAdjacent: r3(adj.reduce((s, x) => s + x.v, 0) / adj.length),
        ssimMin: r3(min.v),
        ssimMinAt: min.at,
        ssimFirstLast: firstLast === null ? null : r3(firstLast),
      };
    }
  } catch {
    ssim = null;
  }

  // --- camera motion, our own maths on frames halved to ~96 px ---
  // Twice as many frames as SSIM uses: a fast H3 push-in moves more than the
  // ±8 px / ±8 % a single pair can see when the pairs are 0.4 s apart.
  let motion = null;
  try {
    const mc = Math.min(MOTION_COUNT, n);
    const midx = Array.from({ length: mc }, (_, i) => Math.min(n - 1, Math.floor(((i + 0.5) / mc) * n)));
    const small = midx.map((i) => halve(all[i], w, h));
    const est = estimateMotion(small.map((s) => s.plane), small[0].w, small[0].h, { radius: 8, srcWidth: info.width || small[0].w });
    // Each pair remembers its time span, so pairs across a cut can be dropped later.
    est.pairs.forEach((p, i) => {
      p.t0 = midx[i] / effFps;
      p.t1 = midx[i + 1] / effFps;
    });
    motion = { est, srcWidth: info.width || small[0].w };
  } catch {
    motion = null;
  }
  return { ssim, motion, analysisTimes: times };
}

/**
 * Measure a clip. Returns { metrics: ClipMetrics, frames: string[] }.
 * Only a file ffprobe cannot read at all throws.
 */
export async function measureClip(file, { withFrames = true } = {}) {
  const info = await probe(file);
  const sampleTimes = sampleTimesFor(info.durationSec);
  const tmp = path.join(os.tmpdir(), `h3-lab-measure-${randomBytes(4).toString("hex")}`);
  await fs.mkdir(tmp, { recursive: true });
  const unmeasured = [];
  const guard = (name, p, fallback) =>
    p.catch(() => {
      unmeasured.push(name);
      return fallback;
    });
  try {
    const [samples, analysis, cuts, freezes] = await Promise.all([
      // Always extracted: the luma comes from the same frames, even when the JPEGs are not wanted.
      guard("frames", extractFrames(file, sampleTimes, tmp), []),
      guard("analysis", analyse(file, info, tmp), { ssim: null, motion: null }),
      guard("cuts", detectCuts(file), []),
      guard("freezes", detectFreezes(file, info.durationSec), []),
    ]);
    const luma = samples.map((s) => s.luma).filter((v) => v !== null);
    if (luma.length < sampleTimes.length && !unmeasured.includes("frames")) unmeasured.push("luma");
    if (!analysis.ssim) unmeasured.push("ssim");
    else if (analysis.ssim.ssimFirstLast === null) unmeasured.push("ssimFirstLast");
    if (!analysis.motion) unmeasured.push("motion");
    // A pair that straddles a cut compares two unrelated pictures: leave it out of the camera move.
    let move = null;
    if (analysis.motion) {
      const { est, srcWidth } = analysis.motion;
      const kept = est.pairs.filter((p) => !cuts.some((c) => c.t > p.t0 && c.t <= p.t1 + 1e-6));
      const sum = summarizeMotion(kept, est.w, est.h, srcWidth);
      move = { motion: sum.motion, measuredMove: classifyMove(sum) };
    }
    const s = analysis.ssim ?? {};
    /** @type {import("../../../src/lib/h3-lab/model").ClipMetrics} */
    const metrics = {
      durationSec: info.durationSec,
      width: info.width,
      height: info.height,
      fps: info.fps,
      frames: info.frames,
      cuts,
      // Neutral when unmeasured: 1 = "no change seen", so a missing measurement never reads as a defect.
      ssimAdjacent: s.ssimAdjacent ?? 1,
      ssimMin: s.ssimMin ?? 1,
      ssimMinAt: s.ssimMinAt ?? 0,
      ssimFirstLast: s.ssimFirstLast ?? 1,
      freezes,
      luma,
      motion: move?.motion ?? null,
      measuredMove: move?.measuredMove ?? "unknown",
      sampleTimes,
    };
    if (unmeasured.length) metrics.unmeasured = unmeasured;
    const frames = withFrames ? samples.map((x) => x.url) : [];
    return { metrics, frames };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** ClipMetrics only. */
export async function measure(file) {
  return (await measureClip(file, { withFrames: false })).metrics;
}
