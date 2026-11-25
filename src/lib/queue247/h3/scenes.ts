// ---------------------------------------------------------------------------
// Shot detection on the server — the pure half.
//
// The H3 Lab finds cuts in the browser from colour histograms
// (components/h3-lab/lab/research/shotDetect.ts). On the 24/7 worker there is
// no browser, so ffmpeg's own scene score does it:
//
//   ffmpeg -i in.mp4 -vf "scale=320:-2,select='gt(scene,0.32)',metadata=print,showinfo" -f null -
//
// This file turns that stderr (and ffprobe's JSON) into shots: cut times,
// too-short shots merged into a neighbour, at most MAX_SHOTS, and the moments
// to pull keyframes from. No Node APIs, so it is tested without ffmpeg.
// ---------------------------------------------------------------------------

export const SCENE_THRESHOLD = 0.32;
export const MAX_SHOTS = 40;
export const MIN_SHOT_SEC = 0.6;

export interface ShotSpan {
  start: number;
  end: number;
  /** ffmpeg's scene score at the cut that opens this shot (0..1). The first shot is 0. */
  cutStrength: number;
}

export interface ProbeInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** "Duration: 00:01:02.50," in ffmpeg's banner → seconds, or 0. */
export function parseFfmpegDuration(stderr: string): number {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** "30000/1001" → 29.97. */
function rate(s: unknown): number {
  const [a, b] = String(s ?? "").split("/").map(Number);
  if (!Number.isFinite(a) || a <= 0) return 0;
  return b && Number.isFinite(b) && b > 0 ? a / b : a;
}

/**
 * `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,avg_frame_rate,duration:format=duration -of json`
 * → duration / size / fps. Missing numbers come back as 0, never NaN.
 */
export function parseProbe(json: string): ProbeInfo {
  let j: { streams?: Record<string, unknown>[]; format?: Record<string, unknown> } = {};
  try {
    j = JSON.parse(json) as typeof j;
  } catch {
    return { duration: 0, width: 0, height: 0, fps: 0 };
  }
  const s = j.streams?.[0] ?? {};
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const duration = num(j.format?.duration) || num(s.duration);
  return {
    duration: round3(duration),
    width: num(s.width),
    height: num(s.height),
    fps: Math.round((rate(s.avg_frame_rate) || rate(s.r_frame_rate)) * 100) / 100,
  };
}

/**
 * Cut moments from ffmpeg's stderr. Each `showinfo` line with `pts_time:` is
 * a frame the select filter kept (a cut); a `lavfi.scene_score=` line printed
 * by `metadata=print` just before it gives that cut's strength.
 */
export function parseCutLines(stderr: string): { t: number; score: number }[] {
  const out: { t: number; score: number }[] = [];
  let score: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = /lavfi\.scene_score=([\d.]+)/.exec(line);
    if (s) {
      score = Number(s[1]);
      continue;
    }
    if (!/showinfo/i.test(line)) continue;
    const t = /pts_time:\s*(-?[\d.]+)/.exec(line);
    if (!t) continue;
    const time = Number(t[1]);
    if (!Number.isFinite(time)) continue;
    out.push({ t: time, score: score !== null && Number.isFinite(score) ? Math.min(1, score) : SCENE_THRESHOLD });
    score = null;
  }
  return out;
}

/**
 * ffmpeg scene-detect stderr → shots covering 0..duration.
 *
 *  - cuts at or before 0, or within MIN of the end, are dropped;
 *  - a shot shorter than `minShot` is merged into its neighbour by removing
 *    the weaker of the two cuts around it (the first/last shot only has one);
 *  - more than MAX_SHOTS: the weakest cuts go until 40 shots remain.
 *
 * `duration` 0 falls back to the banner's "Duration:", then to the last cut.
 */
export function parseSceneCuts(stderr: string, duration: number, minShot = MIN_SHOT_SEC, maxShots = MAX_SHOTS): ShotSpan[] {
  let total = duration > 0 ? duration : parseFfmpegDuration(stderr);
  const raw = parseCutLines(stderr).sort((a, b) => a.t - b.t);
  if (!(total > 0)) total = raw.length ? raw[raw.length - 1].t + minShot : 0;
  if (!(total > 0)) return [];

  // De-duplicate (two frames of one cut) and keep cuts strictly inside the video.
  let cuts: { t: number; score: number }[] = [];
  for (const c of raw) {
    if (c.t <= 0.01 || c.t >= total - 0.01) continue;
    const last = cuts[cuts.length - 1];
    if (last && c.t - last.t < 0.05) {
      if (c.score > last.score) cuts[cuts.length - 1] = c;
      continue;
    }
    cuts.push(c);
  }

  // Merge too-short shots, shortest first, until none is left.
  for (;;) {
    const bounds = [0, ...cuts.map((c) => c.t), total];
    let worst = -1;
    let worstLen = Infinity;
    for (let i = 0; i < bounds.length - 1; i++) {
      const len = bounds[i + 1] - bounds[i];
      if (len < minShot && len < worstLen) {
        worst = i;
        worstLen = len;
      }
    }
    if (worst < 0 || !cuts.length) break;
    // Shot `worst` is opened by cut worst-1 and closed by cut worst.
    const opening = worst - 1 >= 0 ? worst - 1 : -1;
    const closing = worst < cuts.length ? worst : -1;
    const drop =
      opening < 0 ? closing : closing < 0 ? opening : cuts[opening].score <= cuts[closing].score ? opening : closing;
    cuts = cuts.filter((_, i) => i !== drop);
  }

  // Cap: keep the strongest cuts, in time order.
  if (cuts.length > maxShots - 1) {
    const keep = new Set(
      [...cuts]
        .sort((a, b) => b.score - a.score || a.t - b.t)
        .slice(0, maxShots - 1)
        .map((c) => c.t),
    );
    cuts = cuts.filter((c) => keep.has(c.t));
  }

  const bounds = [0, ...cuts.map((c) => c.t), total];
  return bounds.slice(0, -1).map((start, i) => ({
    start: round3(start),
    end: round3(bounds[i + 1]),
    cutStrength: i === 0 ? 0 : Math.round(cuts[i - 1].score * 100) / 100,
  }));
}

/**
 * When to grab a shot's keyframes: just after it opens, the middle, just
 * before it ends — inset so a frame never lands on the cut itself. A very
 * short shot gets fewer frames rather than three near-identical ones.
 */
export function keyframeTimes(shot: Pick<ShotSpan, "start" | "end">, k = 3): number[] {
  const d = Math.max(0, shot.end - shot.start);
  const inset = Math.min(0.15, d * 0.1);
  const n = d < 0.4 ? 1 : d < 0.9 ? Math.min(k, 2) : Math.max(1, Math.min(3, k));
  if (n === 1) return [round3(shot.start + d / 2)];
  if (n === 2) return [round3(shot.start + inset), round3(shot.end - inset)];
  return [round3(shot.start + inset), round3(shot.start + d / 2), round3(shot.end - inset)];
}

/** The ffmpeg arguments for the scene pass (exported so the test pins them). */
export function sceneDetectArgs(input: string, limitSec?: number): string[] {
  return [
    "-hide_banner",
    "-nostats",
    ...(limitSec ? ["-t", String(limitSec)] : []),
    "-i",
    input,
    "-an",
    "-vf",
    `scale=320:-2,select='gt(scene,${SCENE_THRESHOLD})',metadata=print,showinfo`,
    "-f",
    "null",
    "-",
  ];
}

/** One keyframe as a small JPEG (input seek, so it is fast on long files). */
export function keyframeArgs(input: string, t: number, out: string): string[] {
  return ["-hide_banner", "-loglevel", "error", "-ss", t.toFixed(3), "-i", input, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "5", "-y", out];
}

export function probeArgs(input: string): string[] {
  return ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,avg_frame_rate,duration:format=duration", "-of", "json", input];
}
