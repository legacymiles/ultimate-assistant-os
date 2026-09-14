// ---------------------------------------------------------------------------
// Turning an uploaded song into something small enough to send to a model.
// Pure — no Web Audio — so it is unit-tested; measure.ts does the decoding.
//
// A 4-minute WAV is ~40 MB and a request body tops out at 4.5 MB, so the model
// hears the loudest ~40 seconds (where the hook and the full arrangement
// usually are) as 16 kHz mono 16-bit — about 1.3 MB.
// ---------------------------------------------------------------------------

export const CLIP_SECONDS = 40;
export const CLIP_RATE = 16_000;

export function resampleLinear(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input.slice();
  const out = new Float32Array(Math.max(1, Math.floor((input.length * to) / from)));
  const step = from / to;
  for (let i = 0; i < out.length; i++) {
    const pos = i * step;
    const j = Math.floor(pos);
    const frac = pos - j;
    const a = input[j] ?? 0;
    const b = input[j + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Start (in seconds) of the loudest `seconds`-long window, scanned in `hopSec` steps. */
export function loudestWindow(samples: Float32Array, rate: number, seconds: number, hopSec = 2): number {
  const win = Math.floor(seconds * rate);
  if (samples.length <= win) return 0;
  const prefix = new Float64Array(samples.length + 1);
  for (let i = 0; i < samples.length; i++) prefix[i + 1] = prefix[i] + samples[i] * samples[i];
  const hop = Math.max(1, Math.floor(hopSec * rate));
  let best = 0;
  let bestEnergy = -1;
  for (let s = 0; s + win <= samples.length; s += hop) {
    const e = prefix[s + win] - prefix[s];
    if (e > bestEnergy) {
      bestEnergy = e;
      best = s;
    }
  }
  return best / rate;
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (off: number, s: string) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** "03 - Late Night_mix v2.wav" → "Late Night mix v2". */
export function titleFromFile(name: string): string {
  const t = name
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/^\s*\d{1,3}\s*[-.)]?\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return t || "Untitled";
}
