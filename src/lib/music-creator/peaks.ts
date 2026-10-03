// ---------------------------------------------------------------------------
// Peaks — the shape of a loaded clip, measured rather than drawn.
//
// The scanner's hidden layer is the waveform of the record you actually loaded.
// That is only worth revealing if it is the real thing, so this decodes the
// clip in the browser and takes an RMS per bucket. A decorative squiggle would
// have been three lines of code and a lie: it would look identical for a
// ballad and a drill beat, and the whole point of putting it under the plate is
// that it tells you which one you are holding.
//
// Decoding a 30-second preview costs a few milliseconds and the result is
// cached by clip identity, because the hero repaints on every blend change and
// re-decoding there would be audible as jank.
// ---------------------------------------------------------------------------

const cache = new Map<string, number[]>();

/** Rough bars across the width of a plate. */
const BUCKETS = 240;

/**
 * The clip's RMS envelope, normalised to 0-1.
 *
 * Returns an empty array when the browser cannot decode the file — a plate with
 * no waveform under it is a fine outcome, and throwing inside a paint callback
 * is not.
 */
export async function peaksOf(key: string, dataUrl: string, buckets = BUCKETS): Promise<number[]> {
  const cached = cache.get(key);
  if (cached) return cached;
  if (typeof window === "undefined") return [];

  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return [];

  let ctx: AudioContext | null = null;
  try {
    const bytes = await (await fetch(dataUrl)).arrayBuffer();
    ctx = new Ctor();
    const audio = await ctx.decodeAudioData(bytes);
    const left = audio.getChannelData(0);
    const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null;
    const per = Math.max(1, Math.floor(left.length / buckets));

    const out: number[] = [];
    let loudest = 0;
    for (let b = 0; b < buckets; b++) {
      const start = b * per;
      const end = Math.min(left.length, start + per);
      let sum = 0;
      for (let i = start; i < end; i++) {
        const sample = right ? (left[i] + right[i]) * 0.5 : left[i];
        sum += sample * sample;
      }
      const rms = end > start ? Math.sqrt(sum / (end - start)) : 0;
      loudest = Math.max(loudest, rms);
      out.push(rms);
    }
    // Normalising by the loudest bucket rather than by full scale: a quiet
    // master would otherwise reveal as a flat line, which reads as "nothing
    // loaded" instead of "a quiet record".
    const scaled = loudest > 0 ? out.map((v) => Math.min(1, v / loudest)) : out;
    cache.set(key, scaled);
    return scaled;
  } catch {
    return [];
  } finally {
    // The context is only needed for the decode; leaving it open burns one of
    // the browser's small supply of them per clip.
    void ctx?.close().catch(() => {});
  }
}

/** Forget a clip's measurement — used when a side's audio is replaced. */
export function forgetPeaks(key: string): void {
  cache.delete(key);
}
