// ---------------------------------------------------------------------------
// Turning an analyser's raw bins into something worth drawing.
//
// The old meter read ONE number out of a 128-bin analyser: the peak of the
// time-domain waveform. Every frequency bin was computed by the browser and
// then thrown away, which is why the wave looked like a volume knob rather than
// like a voice — loudness has one dimension and speech has many.
//
// Three things in here, all pure, because they are the difference between a
// meter that reads as alive and one that reads as a progress bar:
//
//   1. LOG-SPACED bands. Human hearing is logarithmic and so is speech: with
//      linear buckets, almost all vocal energy lands in the first two or three
//      bars and the rest of the display is dead for the entire conversation.
//   2. ASYMMETRIC smoothing. Attack fast, decay slow. Symmetric smoothing makes
//      a meter feel like treacle; no smoothing makes it strobe.
//   3. A synthesised envelope for the one path that has no stream to read —
//      the browser's own speechSynthesis, which exposes no audio node at all.
// ---------------------------------------------------------------------------

/** How many bands the reactor draws. Enough to read as a spectrum, few enough to stay legible. */
export const BAND_COUNT = 28;

/**
 * Log-spaced band edges over `bins` analyser buckets.
 *
 * Computed once per (bins, count) pair and cached, because it never changes
 * while the analyser lives and recomputing 28 logarithms every frame is 28
 * logarithms of pure waste.
 */
const edgeCache = new Map<string, Int32Array>();

export function bandEdges(bins: number, count = BAND_COUNT): Int32Array {
  const key = `${bins}:${count}`;
  const hit = edgeCache.get(key);
  if (hit) return hit;

  const edges = new Int32Array(count + 1);
  // Start at bin 1: bin 0 is DC offset, which is not a sound and which sits at
  // a constant value, so including it pins the first band permanently open.
  const lo = 1;
  const hi = Math.max(lo + 1, bins);
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    edges[i] = Math.min(hi, Math.round(lo * Math.pow(hi / lo, t)));
  }
  // A log scale over few bins produces repeated edges at the bottom, which
  // would give those bands zero width and a permanent reading of nothing. They
  // are pushed apart where there are bins to spare.
  //
  // When there are genuinely fewer bins than bands the edges saturate and
  // neighbouring bands share a bin. That is the honest outcome at that
  // resolution — two bands reading the same value is true, and `bandsFrom`
  // guarantees every band still averages over at least one real bin.
  for (let i = 1; i <= count; i += 1) {
    if (edges[i] <= edges[i - 1]) edges[i] = Math.min(hi, edges[i - 1] + 1);
  }
  edgeCache.set(key, edges);
  return edges;
}

/**
 * Average each log-spaced band of a frequency snapshot into 0..1.
 *
 * `out` is reused between frames; allocating a Float32Array sixty times a
 * second is the kind of garbage that shows up as a stutter rather than as a
 * number in a profile.
 */
export function bandsFrom(bins: Uint8Array, count = BAND_COUNT, out?: Float32Array): Float32Array {
  const bands = out && out.length >= count ? out : new Float32Array(count);
  if (!bins.length) {
    bands.fill(0);
    return bands;
  }

  const edges = bandEdges(bins.length, count);
  for (let b = 0; b < count; b += 1) {
    // Clamped INSIDE the array. With fewer bins than bands the edges saturate
    // at the top, and an unclamped `from` then starts past the end — so those
    // bands would average nothing and read as permanently silent, which is the
    // one thing the log spacing exists to avoid.
    const from = Math.min(edges[b], bins.length - 1);
    const to = Math.min(bins.length, Math.max(from + 1, edges[b + 1]));
    let sum = 0;
    for (let i = from; i < to; i += 1) sum += bins[i];
    const mean = sum / Math.max(1, to - from) / 255;

    // Tilt the top end up. Speech energy falls away steeply with frequency, so
    // without this the upper two thirds of the display never move and the
    // spectrum reads as a slope rather than as a voice.
    const tilt = 1 + (b / count) * 1.6;
    bands[b] = Math.min(1, mean * tilt);
  }
  return bands;
}

/**
 * Move `current` toward `target`, faster going up than coming down.
 *
 * This asymmetry is the whole feel of a meter. A consonant is a few
 * milliseconds long: with a slow attack it never registers, and the display
 * misses the very thing that makes speech look like speech. A slow decay is
 * what stops the same display strobing between every syllable.
 */
export function smoothTo(current: number, target: number, attack = 0.55, decay = 0.12): number {
  const rate = target > current ? attack : decay;
  return current + (target - current) * rate;
}

/** `smoothTo` across a whole band array, in place. */
export function smoothBands(current: Float32Array, target: Float32Array, attack = 0.55, decay = 0.12): Float32Array {
  const n = Math.min(current.length, target.length);
  for (let i = 0; i < n; i += 1) current[i] = smoothTo(current[i], target[i], attack, decay);
  return current;
}

/** Peak of a time-domain snapshot, 0..1. Still wanted: one number drives the core's size. */
export function peakOf(timeDomain: Uint8Array): number {
  let peak = 0;
  for (let i = 0; i < timeDomain.length; i += 1) {
    const v = Math.abs(timeDomain[i] - 128) / 128;
    if (v > peak) peak = v;
  }
  return Math.min(1, peak);
}

/** Root-mean-square of a time-domain snapshot. Steadier than peak; better for "is anyone talking". */
export function rmsOf(timeDomain: Uint8Array): number {
  if (!timeDomain.length) return 0;
  let sum = 0;
  for (let i = 0; i < timeDomain.length; i += 1) {
    const v = (timeDomain[i] - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / timeDomain.length));
}

/** The loudness the core reads, from bands rather than from the raw peak. */
export function loudness(bands: Float32Array): number {
  if (!bands.length) return 0;
  let sum = 0;
  for (let i = 0; i < bands.length; i += 1) sum += bands[i];
  return Math.min(1, sum / bands.length);
}

/**
 * A believable spectrum for a voice we cannot measure.
 *
 * The browser's `speechSynthesis` speaks through the system and exposes no
 * audio node whatsoever, so there is genuinely nothing to analyse on that path.
 * The options are a dead display or an honest synthesis, and a dead display
 * while Jarvis is audibly talking reads as broken.
 *
 * Deterministic in `t` — no Math.random — so it is testable, and so two
 * reactors on the same page agree rather than shimmering independently.
 */
export function speechEnvelope(t: number, out?: Float32Array, count = BAND_COUNT): Float32Array {
  const bands = out && out.length >= count ? out : new Float32Array(count);
  // Three detuned oscillators give a syllable rhythm without repeating on any
  // short loop; the ratios are irrational-ish so the pattern does not pulse.
  const syllable = 0.5 + 0.5 * Math.sin(t * 7.3);
  const phrase = 0.65 + 0.35 * Math.sin(t * 1.7 + 0.6);
  const breath = 0.85 + 0.15 * Math.sin(t * 0.41 + 2.1);
  const level = Math.max(0, syllable * phrase * breath);

  for (let b = 0; b < count; b += 1) {
    const x = b / Math.max(1, count - 1);
    // Voices are loudest in the lower-middle and fall away at both ends.
    const shape = Math.sin(Math.PI * Math.pow(x, 0.72));
    const flutter = 0.82 + 0.18 * Math.sin(t * 11 + b * 0.9);
    bands[b] = Math.min(1, level * shape * flutter * 0.92);
  }
  return bands;
}

/**
 * A slow idle shimmer for a microphone that is on and hearing nothing.
 *
 * Deliberately tiny. The point is that the reactor is clearly alive and
 * clearly not hearing anything — a flat line reads as broken, and anything
 * larger reads as a voice that is not there.
 */
export function idleEnvelope(t: number, out?: Float32Array, count = BAND_COUNT): Float32Array {
  const bands = out && out.length >= count ? out : new Float32Array(count);
  for (let b = 0; b < count; b += 1) {
    bands[b] = 0.02 + 0.018 * (0.5 + 0.5 * Math.sin(t * 1.1 + b * 0.55));
  }
  return bands;
}

/**
 * How loud something has to be before it counts as someone talking.
 *
 * Used only for the display's "is this a voice" cue, never for endpointing —
 * that lives in wake.ts and is a transcript decision, not a loudness one.
 */
export const VOICE_FLOOR = 0.045;

export function isVoice(level: number): boolean {
  return level > VOICE_FLOOR;
}
