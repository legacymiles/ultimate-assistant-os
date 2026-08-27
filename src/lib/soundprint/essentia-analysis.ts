// ---------------------------------------------------------------------------
// Soundprint — richer audio analysis via essentia.js (MTG, UPF).
//
// essentia.js is the WebAssembly build of Essentia, a serious music-information-
// retrieval library. It gives far better tempo/key estimates than a hand-rolled
// FFT, plus features we couldn't compute before (danceability, dynamic
// complexity). Those go to the LLM as stronger ground truth.
//
// Loading: we use Essentia's official *web* build, served from /public/essentia
// and injected as <script> tags at runtime. That deliberately sidesteps the
// bundler — the emscripten module locates its .wasm via document.currentScript,
// and Turbopack never has to deal with a 2 MB base64 blob. If anything here
// fails, callers fall back to the built-in DSP, so the app never breaks.
// ---------------------------------------------------------------------------

"use client";

const WASM_SRC = "/essentia/essentia-wasm.web.js";
const CORE_SRC = "/essentia/essentia.js-core.js";

// essentia works at its native default; resampling the (short) selection to
// 44.1 kHz lets us call every algorithm with its defaults, no per-call params.
const ESSENTIA_RATE = 44100;

export interface EssentiaFeatures {
  bpm: number;
  /** e.g. "A minor". */
  key: string;
  /** 0–1 confidence in the key. */
  keyStrength: number;
  /** Essentia's danceability (roughly 0–3+; higher = groovier). */
  danceability: number;
  /** Dynamic complexity in dB — spread between quiet and loud passages. */
  dynamicComplexity: number;
}

// Minimal shape of the bits of the Essentia instance we touch.
interface EssentiaInstance {
  version: string;
  arrayToVector(a: Float32Array): unknown;
  PercivalBpmEstimator(v: unknown): { bpm: number };
  KeyExtractor(v: unknown): { key: string; scale: string; strength: number };
  Danceability(v: unknown): { danceability: number };
  DynamicComplexity(v: unknown): { dynamicComplexity: number; loudness: number };
}

type EssentiaWindow = Window & {
  EssentiaWASM?: (() => Promise<unknown>) | unknown;
  Essentia?: new (backend: unknown) => EssentiaInstance;
};

let scriptPromise: Promise<void> | null = null;
let instancePromise: Promise<EssentiaInstance | null> | null = null;

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-ess="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded) resolve();
      else {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error(`load ${src}`)), { once: true });
      }
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.ess = src;
    s.addEventListener("load", () => {
      s.dataset.loaded = "1";
      resolve();
    });
    s.addEventListener("error", () => reject(new Error(`load ${src}`)));
    document.head.appendChild(s);
  });
}

async function loadScripts(): Promise<void> {
  // Order matters: the wasm factory must exist before core uses it.
  await injectScript(WASM_SRC);
  await injectScript(CORE_SRC);
}

/** Load + instantiate once, cached. Resolves to null on any failure. */
export async function getEssentia(): Promise<EssentiaInstance | null> {
  if (typeof window === "undefined") return null;
  if (!instancePromise) {
    instancePromise = (async () => {
      try {
        if (!scriptPromise) scriptPromise = loadScripts();
        await scriptPromise;

        const w = window as EssentiaWindow;
        if (!w.EssentiaWASM || !w.Essentia) throw new Error("essentia globals missing");

        // The web build's EssentiaWASM is a factory returning a promise.
        const backend =
          typeof w.EssentiaWASM === "function"
            ? await (w.EssentiaWASM as () => Promise<unknown>)()
            : w.EssentiaWASM;

        const wasmBackend =
          (backend as { EssentiaWASM?: unknown }).EssentiaWASM ?? backend;

        const instance = new w.Essentia(wasmBackend);
        // Touch version so a broken instance throws here, not mid-analysis.
        void instance.version;
        return instance;
      } catch (err) {
        console.warn("essentia.js unavailable, using built-in DSP:", err);
        return null;
      }
    })();
  }
  return instancePromise;
}

/** Linear resample to 44.1 kHz. Fine for BPM/key/loudness (no HF needed). */
function toEssentiaRate(samples: Float32Array, fromRate: number): Float32Array {
  if (fromRate === ESSENTIA_RATE) return samples;
  const ratio = ESSENTIA_RATE / fromRate;
  const out = new Float32Array(Math.floor(samples.length * ratio));
  for (let i = 0; i < out.length; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const frac = src - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

const NOTE_LONG: Record<string, string> = {
  A: "A", "A#": "A#", Bb: "A#", B: "B", C: "C", "C#": "C#", Db: "C#",
  D: "D", "D#": "D#", Eb: "D#", E: "E", F: "F", "F#": "F#", Gb: "F#",
  G: "G", "G#": "G#", Ab: "G#",
};

/**
 * Analyse a mono slice. `samples` are at `sampleRate`; we resample internally.
 * Returns null if essentia isn't available or the slice is too short.
 */
export async function analyzeWithEssentia(
  samples: Float32Array,
  sampleRate: number,
): Promise<EssentiaFeatures | null> {
  const essentia = await getEssentia();
  if (!essentia) return null;
  if (samples.length < sampleRate * 2) return null; // need a couple of seconds

  const signal = toEssentiaRate(samples, sampleRate);
  let vec: unknown = null;
  try {
    vec = essentia.arrayToVector(signal);

    const bpm = round(essentia.PercivalBpmEstimator(vec).bpm);
    const k = essentia.KeyExtractor(vec);
    const dance = essentia.Danceability(vec).danceability;
    const dyn = essentia.DynamicComplexity(vec).dynamicComplexity;

    const note = NOTE_LONG[k.key] ?? k.key;
    return {
      bpm: bpm > 0 ? bpm : 0,
      key: note ? `${note} ${k.scale}` : "",
      keyStrength: clamp01(k.strength),
      danceability: Number.isFinite(dance) ? dance : 0,
      dynamicComplexity: Number.isFinite(dyn) ? dyn : 0,
    };
  } catch (err) {
    console.warn("essentia analysis failed, using built-in DSP:", err);
    return null;
  } finally {
    // Emscripten vectors are manually managed — free it.
    const v = vec as { delete?: () => void } | null;
    v?.delete?.();
  }
}

/** Words for the danceability scale, for the LLM + UI. */
export function danceabilityLabel(d: number): string {
  if (d < 0.8) return "not danceable, free-flowing rhythm";
  if (d < 1.4) return "a gentle, swaying pulse";
  if (d < 2.2) return "a solid, danceable groove";
  return "a strong, propulsive dance groove";
}

function round(n: number): number {
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
