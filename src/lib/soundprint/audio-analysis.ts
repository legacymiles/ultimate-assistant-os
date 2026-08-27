// ---------------------------------------------------------------------------
// Soundprint — actual audio analysis, in the browser, on the real waveform.
//
// This is the part that genuinely listens. Everything here is measured from
// the samples themselves via the Web Audio API: tempo, key, brightness,
// dynamics, percussion density. No model is guessing at the BPM — we compute
// it. The model's job downstream is musical interpretation, not measurement.
//
// It all runs locally, so it costs nothing and works with no API key.
// ---------------------------------------------------------------------------

"use client";

/** Analysis works at this rate — plenty for everything we measure, half the RAM. */
const TARGET_RATE = 22050;
const FRAME = 2048;
const HOP = 512;

export interface LoadedAudio {
  name: string;
  durationSec: number;
  sampleRate: number;
  /** Mono samples at TARGET_RATE. */
  samples: Float32Array;
  /** ~800 min/max pairs for drawing the waveform. */
  peaks: number[];
  /** 0 = mono/narrow, 1 = very wide. Measured across the whole file. */
  stereoWidth: number;
}

export interface AudioFeatures {
  startSec: number;
  endSec: number;
  bpm: number;
  bpmConfidence: number;
  key: string;
  keyConfidence: number;
  /** Spectral centroid in Hz. */
  brightnessHz: number;
  brightness: string;
  /** 0–1 density of high-frequency transients — i.e. is there a beat? */
  percussion: number;
  percussionLabel: string;
  /** Loudness spread in dB across the selection. */
  dynamicRangeDb: number;
  dynamics: string;
  density: string;
  stereoWidth: number;
  stereo: string;
  /** 48 normalised points for the energy sparkline. */
  energyCurve: number[];
  /** Which engine produced tempo/key — upgraded to essentia when available. */
  analyzer: "dsp" | "essentia";
  /** essentia only: groove strength. */
  danceability?: number;
  danceabilityLabel?: string;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

type AudioCtor = typeof AudioContext;

function audioContext(): AudioContext {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio is not available in this browser.");
  return new Ctor();
}

export async function loadAudio(file: File): Promise<LoadedAudio> {
  const ctx = audioContext();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const left = buf.getChannelData(0);
    const right = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;

    // Mid/side energy ratio gives a usable stereo-width number.
    let midSq = 0;
    let sideSq = 0;
    if (right) {
      for (let i = 0; i < left.length; i++) {
        const m = (left[i] + right[i]) * 0.5;
        const s = (left[i] - right[i]) * 0.5;
        midSq += m * m;
        sideSq += s * s;
      }
    }
    const stereoWidth = right
      ? Math.min(1, Math.sqrt(sideSq) / (Math.sqrt(midSq) + Math.sqrt(sideSq) + 1e-9) * 2)
      : 0;

    const mono = downmix(left, right);
    const samples = resample(mono, buf.sampleRate, TARGET_RATE);

    return {
      name: file.name,
      durationSec: buf.duration,
      sampleRate: TARGET_RATE,
      samples,
      peaks: buildPeaks(samples, 800),
      stereoWidth,
    };
  } finally {
    void ctx.close();
  }
}

function downmix(left: Float32Array, right: Float32Array | null): Float32Array {
  if (!right) return left;
  const out = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) out[i] = (left[i] + right[i]) * 0.5;
  return out;
}

/** Box-average decimation — good enough and much cheaper than a proper filter. */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return input;
  const ratio = from / to;
  const len = Math.floor(input.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function buildPeaks(samples: Float32Array, buckets: number): number[] {
  const size = Math.max(1, Math.floor(samples.length / buckets));
  const peaks: number[] = [];
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * size;
    const end = Math.min(samples.length, start + size);
    for (let j = start; j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  const ceiling = Math.max(...peaks, 1e-6);
  return peaks.map((p) => p / ceiling);
}

// ---------------------------------------------------------------------------
// FFT (iterative radix-2 Cooley–Tukey, in place)
// ---------------------------------------------------------------------------

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < half; j++) {
        const ar = re[i + j];
        const ai = im[i + j];
        const br = re[i + j + half] * cr - im[i + j + half] * ci;
        const bi = re[i + j + half] * ci + im[i + j + half] * cr;
        re[i + j] = ar + br;
        im[i + j] = ai + bi;
        re[i + j + half] = ar - br;
        im[i + j + half] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const HANN = (() => {
  const w = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  return w;
})();

/** Magnitude spectra for every frame in the slice. */
function spectra(samples: Float32Array, from: number, to: number): Float32Array[] {
  const frames: Float32Array[] = [];
  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const bins = FRAME >> 1;

  for (let pos = from; pos + FRAME <= to; pos += HOP) {
    for (let i = 0; i < FRAME; i++) {
      re[i] = samples[pos + i] * HANN[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(bins);
    for (let i = 0; i < bins; i++) mag[i] = Math.hypot(re[i], im[i]);
    frames.push(mag);
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------

const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function analyzeRange(audio: LoadedAudio, startSec: number, endSec: number): AudioFeatures {
  const rate = audio.sampleRate;
  const from = Math.max(0, Math.floor(startSec * rate));
  const to = Math.min(audio.samples.length, Math.floor(endSec * rate));
  const frames = spectra(audio.samples, from, to);

  if (frames.length < 4) {
    return emptyFeatures(startSec, endSec, audio.stereoWidth);
  }

  const binHz = rate / FRAME;
  const frameRate = rate / HOP;

  // --- spectral centroid (brightness) --------------------------------------
  let centroidSum = 0;
  let centroidWeight = 0;
  for (const mag of frames) {
    let num = 0;
    let den = 0;
    for (let i = 1; i < mag.length; i++) {
      num += i * binHz * mag[i];
      den += mag[i];
    }
    if (den > 1e-6) {
      centroidSum += num / den;
      centroidWeight++;
    }
  }
  const brightnessHz = centroidWeight ? centroidSum / centroidWeight : 0;

  // --- spectral flux → onset novelty ---------------------------------------
  // 5.5 kHz and up: above where a guitar or piano puts meaningful harmonics,
  // squarely where cymbals and snare noise live.
  const hiBin = Math.floor(5500 / binHz);
  const flux: number[] = [];
  const hiFlux: number[] = [];
  let hfEnergy = 0;
  let totalEnergy = 0;
  for (let t = 1; t < frames.length; t++) {
    let f = 0;
    let hf = 0;
    for (let i = 1; i < frames[t].length; i++) {
      const d = frames[t][i] - frames[t - 1][i];
      if (d > 0) {
        f += d;
        if (i >= hiBin) hf += d;
      }
      const e = frames[t][i] * frames[t][i];
      totalEnergy += e;
      if (i >= hiBin) hfEnergy += e;
    }
    flux.push(f);
    hiFlux.push(hf);
  }

  const bpmResult = estimateTempo(flux, frameRate);

  // --- percussion density --------------------------------------------------
  const hfRatio = totalEnergy > 0 ? hfEnergy / totalEnergy : 0;
  const percussion = transientDensity(hiFlux, frameRate, hfRatio);

  // --- chroma → key --------------------------------------------------------
  const chroma = new Array(12).fill(0);
  const loBin = Math.max(1, Math.floor(55 / binHz));
  const topBin = Math.min(frames[0].length - 1, Math.floor(2000 / binHz));
  for (const mag of frames) {
    for (let i = loBin; i <= topBin; i++) {
      const freq = i * binHz;
      const midi = 69 + 12 * Math.log2(freq / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += mag[i];
    }
  }
  const keyResult = estimateKey(chroma);

  // --- loudness envelope ---------------------------------------------------
  const rms: number[] = [];
  for (let pos = from; pos + HOP <= to; pos += HOP) {
    let sum = 0;
    for (let i = 0; i < HOP; i++) sum += audio.samples[pos + i] ** 2;
    rms.push(Math.sqrt(sum / HOP));
  }
  const db = rms.map((v) => 20 * Math.log10(v + 1e-6));
  const sorted = [...db].sort((a, b) => a - b);
  const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? -60;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? -6;
  const dynamicRangeDb = Math.max(0, p95 - p10);

  return {
    startSec,
    endSec,
    bpm: bpmResult.bpm,
    bpmConfidence: bpmResult.confidence,
    key: keyResult.key,
    keyConfidence: keyResult.confidence,
    brightnessHz,
    brightness: labelBrightness(brightnessHz),
    percussion,
    percussionLabel: labelPercussion(percussion),
    dynamicRangeDb,
    dynamics: labelDynamics(dynamicRangeDb),
    density: labelDensity(percussion, brightnessHz),
    stereoWidth: audio.stereoWidth,
    stereo: labelStereo(audio.stereoWidth),
    energyCurve: resampleCurve(rms, 48),
    analyzer: "dsp",
  };
}

function estimateTempo(flux: number[], frameRate: number): { bpm: number; confidence: number } {
  if (flux.length < 32) return { bpm: 0, confidence: 0 };

  const mean = flux.reduce((a, b) => a + b, 0) / flux.length;
  const centred = flux.map((v) => v - mean);

  const minLag = Math.floor((frameRate * 60) / 190);
  const maxLag = Math.min(Math.floor((frameRate * 60) / 55), Math.floor(flux.length / 2));
  if (maxLag <= minLag) return { bpm: 0, confidence: 0 };

  let best = 0;
  let bestLag = 0;
  let total = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < centred.length; i++) sum += centred[i] * centred[i + lag];
    sum /= centred.length - lag;
    total += Math.abs(sum);
    if (sum > best) {
      best = sum;
      bestLag = lag;
    }
  }
  if (!bestLag) return { bpm: 0, confidence: 0 };

  let bpm = (60 * frameRate) / bestLag;
  // Fold obvious octave errors into a musically sensible window.
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;

  const avg = total / (maxLag - minLag + 1);
  const confidence = Math.max(0, Math.min(1, avg > 0 ? (best / avg - 1) / 4 : 0));
  return { bpm: Math.round(bpm), confidence };
}

function estimateKey(chroma: number[]): { key: string; confidence: number } {
  const total = chroma.reduce((a, b) => a + b, 0);
  if (total < 1e-6) return { key: "", confidence: 0 };
  const norm = chroma.map((v) => v / total);

  let best = { key: "", score: -Infinity, runner: -Infinity };
  for (let rot = 0; rot < 12; rot++) {
    for (const [profile, mode] of [
      [KS_MAJOR, "major"],
      [KS_MINOR, "minor"],
    ] as const) {
      let score = 0;
      for (let i = 0; i < 12; i++) score += norm[(i + rot) % 12] * profile[i];
      if (score > best.score) {
        best = { key: `${NOTES[rot]} ${mode}`, score, runner: best.score };
      } else if (score > best.runner) {
        best.runner = score;
      }
    }
  }
  const confidence =
    best.runner > 0 ? Math.max(0, Math.min(1, (best.score / best.runner - 1) * 12)) : 0.5;
  return { key: best.key, confidence };
}

/**
 * How much of a drum kit is playing, 0–1.
 *
 * Counting transients alone isn't enough: every plucked guitar note is a
 * transient, so an arpeggiated intro reads as a beat. The thing that actually
 * separates a kit from a pitched instrument is broadband energy up top —
 * cymbals and snares are noise, and noise fills the 5.5 kHz+ band. Pitched
 * instruments leave it nearly empty. So the transient rate only counts to the
 * extent that band carries real energy.
 */
function transientDensity(hiFlux: number[], frameRate: number, hfRatio: number): number {
  if (!hiFlux.length) return 0;
  const mean = hiFlux.reduce((a, b) => a + b, 0) / hiFlux.length;
  const sd = Math.sqrt(hiFlux.reduce((a, b) => a + (b - mean) ** 2, 0) / hiFlux.length);
  const threshold = mean + sd * 1.2;

  let hits = 0;
  for (let i = 1; i < hiFlux.length - 1; i++) {
    if (hiFlux[i] > threshold && hiFlux[i] >= hiFlux[i - 1] && hiFlux[i] > hiFlux[i + 1]) hits++;
  }
  const perSecond = hits / (hiFlux.length / frameRate);
  // ~4+ sharp transients a second reads as a full kit.
  const rate = Math.max(0, Math.min(1, perSecond / 4));
  const gate = Math.max(0, Math.min(1, (hfRatio - 0.004) / 0.03));
  return rate * gate;
}

function resampleCurve(values: number[], points: number): number[] {
  if (!values.length) return new Array(points).fill(0);
  const out: number[] = [];
  const size = values.length / points;
  for (let i = 0; i < points; i++) {
    const start = Math.floor(i * size);
    const end = Math.max(start + 1, Math.floor((i + 1) * size));
    let max = 0;
    for (let j = start; j < end && j < values.length; j++) max = Math.max(max, values[j]);
    out.push(max);
  }
  const ceiling = Math.max(...out, 1e-6);
  return out.map((v) => v / ceiling);
}

// ---------------------------------------------------------------------------
// Plain-English labels — these are what the model actually reads
// ---------------------------------------------------------------------------

function labelBrightness(hz: number): string {
  if (hz < 700) return "dark and warm, very little top end";
  if (hz < 1300) return "warm midrange focus";
  if (hz < 2200) return "balanced, natural top end";
  if (hz < 3200) return "bright and present";
  return "very bright, airy and cymbal-heavy";
}

function labelPercussion(score: number): string {
  if (score < 0.12) return "no drums — nothing percussive in this section";
  if (score < 0.3) return "barely any percussion, maybe a soft pulse";
  if (score < 0.55) return "light percussion, restrained kit";
  if (score < 0.78) return "a full kit driving the track";
  return "dense, busy percussion";
}

function labelDynamics(db: number): string {
  if (db < 8) return "heavily compressed, flat and loud throughout";
  if (db < 16) return "moderately compressed, modern master";
  if (db < 26) return "open dynamics, room to breathe";
  return "very wide dynamics — quiet passages and big swells";
}

function labelDensity(percussion: number, brightness: number): string {
  if (percussion < 0.2 && brightness < 1600) return "sparse and intimate";
  if (percussion < 0.35) return "spacious, few elements";
  if (percussion < 0.65) return "a full but uncluttered arrangement";
  return "dense, layered arrangement";
}

function labelStereo(width: number): string {
  if (width < 0.15) return "narrow, almost mono";
  if (width < 0.35) return "moderate stereo image";
  if (width < 0.6) return "wide stereo image";
  return "very wide, heavily spread";
}

function emptyFeatures(startSec: number, endSec: number, stereoWidth: number): AudioFeatures {
  return {
    startSec,
    endSec,
    bpm: 0,
    bpmConfidence: 0,
    key: "",
    keyConfidence: 0,
    brightnessHz: 0,
    brightness: "",
    percussion: 0,
    percussionLabel: "",
    dynamicRangeDb: 0,
    dynamics: "",
    density: "",
    stereoWidth,
    stereo: labelStereo(stereoWidth),
    energyCurve: new Array(48).fill(0),
    analyzer: "dsp",
  };
}

/** Compact summary handed to the model as measured ground truth. */
export function featuresToBrief(f: AudioFeatures): string {
  const engine = f.analyzer === "essentia" ? "essentia.js MIR" : "in-browser DSP";
  const lines: string[] = [
    `Analysed range: ${fmt(f.startSec)}–${fmt(f.endSec)} (${(f.endSec - f.startSec).toFixed(1)}s), via ${engine}`,
  ];
  if (f.bpm) lines.push(`Tempo: ~${f.bpm} BPM (confidence ${(f.bpmConfidence * 100).toFixed(0)}%)`);
  if (f.key) lines.push(`Key: ${f.key} (confidence ${(f.keyConfidence * 100).toFixed(0)}%)`);
  if (f.danceabilityLabel) lines.push(`Groove: ${f.danceabilityLabel}`);
  if (f.brightness) lines.push(`Tone: ${f.brightness} (centroid ${Math.round(f.brightnessHz)} Hz)`);
  if (f.percussionLabel) lines.push(`Percussion: ${f.percussionLabel}`);
  if (f.dynamics) lines.push(`Dynamics: ${f.dynamics} (${f.dynamicRangeDb.toFixed(1)} dB spread)`);
  if (f.density) lines.push(`Arrangement: ${f.density}`);
  if (f.stereo) lines.push(`Stereo: ${f.stereo}`);
  return lines.join("\n");
}

export function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
