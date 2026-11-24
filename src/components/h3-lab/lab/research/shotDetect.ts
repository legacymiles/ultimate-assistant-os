// ---------------------------------------------------------------------------
// Shot detection in the browser — colour histograms, no AI, no upload.
//
// The pure half (histogram, distance, threshold, detectShots) is what the
// tests pin down. The browser half (sampleVideo, grabKeyframes) seeks a
// hidden <video>, draws each sample to a tiny canvas and hands the pixels to
// the pure half.
//
// Calibration (chosen for H3-length clips and real edited references):
//  - sample every 0.25 s on a 64×36 canvas (fast seek, enough colour signal);
//  - 8×8×8 RGB histogram, normalised to sum 1;
//  - distance = half chi-square, bounded 0..1 (identical = 0, disjoint = 1);
//  - threshold = max(floor 0.18, median + k · 1.4826 · MAD) — a robust
//    "mean + k·sd" that the cuts themselves cannot inflate; k is the
//    owner's sensitivity slider (default 3);
//  - a cut must also be a local peak, so a dissolve yields one cut, not five;
//  - shots shorter than 0.5 s merge into a neighbour (the weaker cut goes);
//  - at most 40 shots (the strongest cuts win).
// ---------------------------------------------------------------------------

export const SAMPLE_STEP = 0.25;
export const SAMPLE_W = 64;
export const SAMPLE_H = 36;
export const BINS = 8;

export interface Sample {
  t: number;
  hist: Float32Array;
  /** Tiny JPEG of the sample, for the timeline strip. */
  thumb?: string;
}

export interface DetectedShot {
  start: number;
  end: number;
  /** How different this shot's first sample is from the previous shot's last (0..1). 0 for the first shot. */
  cutStrength: number;
}

export interface CutOptions {
  /** k in median + k·MAD. Higher = fewer cuts. */
  sensitivity: number;
  /** Absolute minimum distance for a cut. */
  floor: number;
  /** Shots shorter than this merge (seconds). */
  minShot: number;
  maxShots: number;
}

export const DEFAULT_CUT: CutOptions = { sensitivity: 3, floor: 0.18, minShot: 0.5, maxShots: 40 };

/** RGBA pixels → normalised bins³ RGB histogram. */
export function colorHistogram(rgba: ArrayLike<number>, bins = BINS): Float32Array {
  const h = new Float32Array(bins * bins * bins);
  const shift = 256 / bins;
  let n = 0;
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    const r = Math.min(bins - 1, Math.floor(rgba[i] / shift));
    const g = Math.min(bins - 1, Math.floor(rgba[i + 1] / shift));
    const b = Math.min(bins - 1, Math.floor(rgba[i + 2] / shift));
    h[(r * bins + g) * bins + b] += 1;
    n++;
  }
  if (n) for (let i = 0; i < h.length; i++) h[i] /= n;
  return h;
}

/** Half chi-square distance between two normalised histograms: 0 identical, 1 disjoint. */
export function histDistance(a: Float32Array, b: Float32Array): number {
  let d = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const s = a[i] + b[i];
    if (s > 0) d += ((a[i] - b[i]) * (a[i] - b[i])) / s;
  }
  return Math.max(0, Math.min(1, d / 2));
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Robust adaptive threshold: median + k · 1.4826 · MAD, never below the floor. */
export function threshold(distances: number[], sensitivity = DEFAULT_CUT.sensitivity, floor = DEFAULT_CUT.floor): number {
  if (!distances.length) return floor;
  const med = median(distances);
  const mad = median(distances.map((d) => Math.abs(d - med))) * 1.4826;
  return Math.max(floor, med + sensitivity * mad);
}

/** Distances between consecutive samples; distances[i] is between sample i-1 and i (distances[0] = 0). */
export function sampleDistances(samples: { hist: Float32Array }[]): number[] {
  return samples.map((s, i) => (i === 0 ? 0 : histDistance(samples[i - 1].hist, s.hist)));
}

/**
 * Cuts from per-sample distances. `times[i]` is the sample time; a cut between
 * sample i-1 and i is placed at their midpoint.
 */
export function detectShots(times: number[], distances: number[], duration: number, opts: Partial<CutOptions> = {}): DetectedShot[] {
  const o = { ...DEFAULT_CUT, ...opts };
  const end = Math.max(duration, times[times.length - 1] ?? 0);
  if (times.length < 2) return [{ start: 0, end, cutStrength: 0 }];
  const thr = threshold(distances.slice(1), o.sensitivity, o.floor);

  // Candidate cuts: above threshold and a local peak.
  let cuts: { t: number; d: number }[] = [];
  for (let i = 1; i < distances.length; i++) {
    const d = distances[i];
    if (d < thr) continue;
    const prev = i > 1 ? distances[i - 1] : 0;
    const next = i + 1 < distances.length ? distances[i + 1] : 0;
    if (d < prev || d < next) continue;
    if (d === prev && i > 1) continue; // a flat plateau counts once
    cuts.push({ t: (times[i - 1] + times[i]) / 2, d });
  }

  // Merge shots shorter than minShot: drop the weaker of two close cuts.
  let changed = true;
  while (changed) {
    changed = false;
    const bounds = [0, ...cuts.map((c) => c.t), end];
    for (let k = 0; k < bounds.length - 1; k++) {
      if (bounds[k + 1] - bounds[k] >= o.minShot) continue;
      // Shot k spans bounds[k]..bounds[k+1]. Its cuts are cuts[k-1] (left) and cuts[k] (right).
      const left = k - 1 >= 0 ? k - 1 : -1;
      const right = k < cuts.length ? k : -1;
      let drop: number;
      if (left < 0) drop = right;
      else if (right < 0) drop = left;
      else drop = cuts[left].d <= cuts[right].d ? left : right;
      if (drop < 0) continue;
      cuts.splice(drop, 1);
      changed = true;
      break;
    }
  }

  // Cap: keep the strongest cuts.
  if (cuts.length > o.maxShots - 1) {
    cuts = [...cuts].sort((a, b) => b.d - a.d).slice(0, o.maxShots - 1).sort((a, b) => a.t - b.t);
  }

  const shots: DetectedShot[] = [];
  let start = 0;
  let strength = 0;
  for (const c of cuts) {
    shots.push({ start, end: c.t, cutStrength: round(strength) });
    start = c.t;
    strength = c.d;
  }
  shots.push({ start, end, cutStrength: round(strength) });
  return shots;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

// ----- browser half ------------------------------------------------------------

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const at = Math.max(0, Math.min(t, Math.max(0, (v.duration || 0) - 0.04)));
    if (Math.abs(v.currentTime - at) < 0.001 && v.readyState >= 2) {
      resolve();
      return;
    }
    const ok = () => {
      v.removeEventListener("seeked", ok);
      v.removeEventListener("error", bad);
      resolve();
    };
    const bad = () => {
      v.removeEventListener("seeked", ok);
      v.removeEventListener("error", bad);
      reject(new Error("The browser could not read that moment of the video."));
    };
    v.addEventListener("seeked", ok);
    v.addEventListener("error", bad);
    v.currentTime = at;
  });
}

export function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error("This browser cannot decode that file. Try an MP4 (H.264) or WebM."));
    v.src = url;
  });
}

export interface SampledVideo {
  duration: number;
  width: number;
  height: number;
  samples: Sample[];
}

/** Seek through the video every `step` seconds and histogram each frame. */
export async function sampleVideo(
  url: string,
  onProgress: (p: number) => void,
  isCancelled: () => boolean = () => false,
): Promise<SampledVideo> {
  const v = await loadVideo(url);
  const duration = Number.isFinite(v.duration) ? v.duration : 0;
  if (!duration) throw new Error("That video reports no length — it may be a live stream or a broken file.");
  // Long references: widen the step so a scan never takes more than ~2,400 seeks.
  const step = Math.max(SAMPLE_STEP, duration / 2400);
  const c = document.createElement("canvas");
  c.width = SAMPLE_W;
  c.height = SAMPLE_H;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("This browser cannot draw video frames.");
  const thumbC = document.createElement("canvas");
  thumbC.width = 96;
  thumbC.height = Math.max(1, Math.round((96 * v.videoHeight) / Math.max(1, v.videoWidth)));
  const tg = thumbC.getContext("2d");
  const samples: Sample[] = [];
  const count = Math.max(2, Math.floor(duration / step) + 1);
  for (let i = 0; i < count; i++) {
    if (isCancelled()) throw new Error("cancelled");
    const t = Math.min(duration - 0.04, i * step);
    await seek(v, t);
    g.drawImage(v, 0, 0, SAMPLE_W, SAMPLE_H);
    const px = g.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
    let thumb: string | undefined;
    if (tg) {
      tg.drawImage(v, 0, 0, thumbC.width, thumbC.height);
      thumb = thumbC.toDataURL("image/jpeg", 0.55);
    }
    samples.push({ t, hist: colorHistogram(px), thumb });
    onProgress((i + 1) / count);
  }
  const out = { duration, width: v.videoWidth, height: v.videoHeight, samples };
  v.removeAttribute("src");
  v.load();
  return out;
}

/** Keyframe times for a shot: start+0.15, middle, end−0.15 (n = 3), or start/end (n = 2), or middle (n = 1). */
export function keyframeTimes(shot: { start: number; end: number }, n: number): number[] {
  const a = Math.min(shot.end, shot.start + 0.15);
  const b = Math.max(shot.start, shot.end - 0.15);
  const mid = (shot.start + shot.end) / 2;
  if (n <= 1) return [mid];
  if (n === 2) return [a, b];
  return [a, mid, b];
}

/** JPEG keyframes for each shot at `width` px. */
export async function grabKeyframes(
  url: string,
  shots: { start: number; end: number }[],
  opts: { perShot: number; width: number; quality: number },
  onProgress: (p: number) => void,
): Promise<string[][]> {
  const v = await loadVideo(url);
  const c = document.createElement("canvas");
  c.width = opts.width;
  c.height = Math.max(1, Math.round((opts.width * v.videoHeight) / Math.max(1, v.videoWidth)));
  const g = c.getContext("2d");
  if (!g) throw new Error("This browser cannot draw video frames.");
  const out: string[][] = [];
  const total = shots.length * opts.perShot;
  let done = 0;
  for (const s of shots) {
    const frames: string[] = [];
    for (const t of keyframeTimes(s, opts.perShot)) {
      await seek(v, t);
      g.drawImage(v, 0, 0, c.width, c.height);
      frames.push(c.toDataURL("image/jpeg", opts.quality));
      done++;
      onProgress(done / total);
    }
    out.push(frames);
  }
  v.removeAttribute("src");
  v.load();
  return out;
}

export function timecode(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}
