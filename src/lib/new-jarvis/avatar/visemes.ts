// ---------------------------------------------------------------------------
// Mouth shapes from speech.
//
// Two sources, best first:
//
//   1. The real audio. useWakeVoice routes Jarvis's own voice (/api/tts)
//      through an AnalyserNode, so the spectrum of what is being said right
//      now is there every frame. Low energy opens the jaw; strong high
//      formants (ee, ih) spread the lips; a low-mid peak with little top end
//      (oh, oo) rounds them. That is a viseme, measured, not guessed.
//   2. The text. The browser's own voice exposes no audio node at all, but it
//      does fire word boundaries — so the mouth walks the sentence's letters
//      from the last boundary at speaking pace.
//
// Pure, tested in visemes.test.ts.
// ---------------------------------------------------------------------------

export interface Viseme {
  /** 0–1 jaw open. */
  open: number;
  /** 0–1 lips spread (ee). */
  wide: number;
  /** 0–1 lips rounded (oo). */
  round: number;
}

export const REST: Viseme = { open: 0, wide: 0, round: 0 };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Mean of `data` between two frequencies, 0–1. */
function bandEnergy(data: ArrayLike<number>, sampleRate: number, fftSize: number, lo: number, hi: number): number {
  const binHz = sampleRate / fftSize;
  const a = Math.max(0, Math.floor(lo / binHz));
  const b = Math.min(data.length - 1, Math.ceil(hi / binHz));
  if (b < a) return 0;
  let sum = 0;
  for (let i = a; i <= b; i += 1) sum += data[i];
  return sum / (b - a + 1) / 255;
}

/** A viseme from one frame of `getByteFrequencyData`. */
export function visemeFromSpectrum(data: ArrayLike<number>, sampleRate = 48000, fftSize = 512): Viseme {
  const low = bandEnergy(data, sampleRate, fftSize, 90, 400);
  const lowMid = bandEnergy(data, sampleRate, fftSize, 400, 1000);
  const high = bandEnergy(data, sampleRate, fftSize, 1800, 4000);
  const loud = Math.max(low, lowMid, high);
  if (loud < 0.08) return REST;
  const open = clamp01((low * 0.6 + lowMid * 0.8) * 1.6 - 0.08);
  const wide = clamp01((high / (lowMid + 0.05) - 0.5) * 0.9);
  const round = clamp01((lowMid / (high + 0.05) - 1.6) * 0.35) * (1 - wide);
  return { open, wide, round };
}

/** The mouth for one letter. */
export function visemeForChar(ch: string): Viseme {
  const c = ch.toLowerCase();
  if ("a".includes(c)) return { open: 0.9, wide: 0.4, round: 0 };
  if ("ei".includes(c)) return { open: 0.45, wide: 0.9, round: 0 };
  if ("y".includes(c)) return { open: 0.35, wide: 0.7, round: 0 };
  if ("ouw".includes(c)) return { open: 0.55, wide: 0, round: 0.9 };
  if ("mbp".includes(c)) return { open: 0, wide: 0.2, round: 0 };
  if ("fv".includes(c)) return { open: 0.12, wide: 0.55, round: 0 };
  if ("lnt dszkgcjrhqx".includes(c) && c !== " ") return { open: 0.3, wide: 0.35, round: 0 };
  return REST;
}

/**
 * Where in `text` the voice probably is: from the last word boundary the
 * browser reported (if any), advancing at speaking pace since then.
 */
export function charIndexAt(text: string, elapsedMs: number, boundary?: { charIndex: number; atMs: number }, charsPerSecond = 14): number {
  if (!text) return -1;
  const from = boundary ? boundary.charIndex + Math.max(0, (elapsedMs - boundary.atMs) / 1000) * charsPerSecond : (Math.max(0, elapsedMs) / 1000) * charsPerSecond;
  const i = Math.floor(from);
  return i >= text.length ? -1 : i;
}

/** The mouth for the text at a moment, or rest once it has all been said. */
export function visemeFromText(text: string, elapsedMs: number, boundary?: { charIndex: number; atMs: number }): Viseme {
  const i = charIndexAt(text, elapsedMs, boundary);
  if (i < 0) return REST;
  return visemeForChar(text[i] ?? " ");
}

/** Ease `cur` toward `target`, frame-rate independent. `rate` is per second. */
export function approach(cur: number, target: number, rate: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-rate * Math.max(0, dt)));
}
