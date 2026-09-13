// ---------------------------------------------------------------------------
// Photo fingerprints — "have I already got this picture?"
//
// The accident this prevents: picking the same photo twice, or re-importing a
// batch that half overlaps one already filed. An exact byte comparison misses
// most of those, because an iPhone re-exports a photo slightly differently each
// time it leaves the camera roll (HEIC → JPEG, re-compressed, metadata changed).
// So this compares what the picture LOOKS like, not its bytes.
//
// The method is a difference hash (dHash): shrink the image to 9×8 greys and
// record, for each row, whether each pixel is brighter than its right-hand
// neighbour. That gives 64 bits describing the picture's broad structure, which
// survives resizing, re-compression and small colour shifts. Two photos are
// look-alikes when their hashes differ in only a few of those bits.
//
// The trade-off, accepted on purpose: two burst shots taken a split second
// apart look alike and get flagged too. A flag is only a warning with a "Keep
// anyway" button, so a false alarm costs one tap, while a missed duplicate
// costs a cluttered library.
//
// Everything except `fingerprintImage` is pure, so the rule that decides what
// counts as a duplicate is tested directly rather than by eye.
// ---------------------------------------------------------------------------

const HASH_W = 9;
const HASH_H = 8;

/** Bits (out of 64) two fingerprints may differ by and still count as the same photo. */
export const LOOKALIKE_MAX_DISTANCE = 6;

/** Luminance of each RGBA pixel, as the eye weighs red, green and blue. */
export function grayFromRGBA(rgba: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    out.push(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  }
  return out;
}

/**
 * A 16-character hex fingerprint from a 9×8 greyscale grid, row by row.
 * Returns "" when the grid is the wrong size, so a bad input never matches.
 */
export function dHashFromGray(gray: ArrayLike<number>, width = HASH_W, height = HASH_H): string {
  if (width !== HASH_W || height !== HASH_H || gray.length !== width * height) return "";
  let hex = "";
  let nibble = 0;
  let bits = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const left = gray[y * width + x];
      const right = gray[y * width + x + 1];
      nibble = (nibble << 1) | (left > right ? 1 : 0);
      if (++bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return hex;
}

const POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** How many of the 64 bits differ. Infinity for malformed input, so it never matches. */
export function hammingHex(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16);
    const y = parseInt(b[i], 16);
    if (Number.isNaN(x) || Number.isNaN(y)) return Infinity;
    d += POPCOUNT[x ^ y];
  }
  return d;
}

export interface FingerprintCandidate {
  hash: string;
  /** Where the existing photo lives, for the warning message. */
  label: string;
  /** The photo this candidate IS, so a photo never matches itself. */
  id: string;
}

export interface DuplicateMatch {
  label: string;
  id: string;
  distance: number;
  /** True when the pictures are indistinguishable, not merely similar. */
  identical: boolean;
}

/**
 * The closest existing photo that counts as the same picture, or null.
 * The nearest match wins, so the message names the most likely original.
 */
export function findDuplicate(
  hash: string | undefined,
  candidates: readonly FingerprintCandidate[],
  selfId?: string,
): DuplicateMatch | null {
  if (!hash) return null;
  let best: DuplicateMatch | null = null;
  for (const c of candidates) {
    if (c.id === selfId) continue;
    const distance = hammingHex(hash, c.hash);
    if (distance > LOOKALIKE_MAX_DISTANCE) continue;
    if (!best || distance < best.distance) {
      best = { label: c.label, id: c.id, distance, identical: distance === 0 };
    }
  }
  return best;
}

/**
 * Fingerprint an image from any URL the browser can draw — a thumbnail data URL
 * included. Undefined when it cannot be decoded, which simply means "no check".
 *
 * Fingerprinting from the stored THUMBNAIL rather than the full file is what
 * lets photos filed before this feature existed be checked too: every one of
 * them already has a thumbnail, and none of them has a fingerprint.
 */
export function fingerprintImage(src: string | undefined): Promise<string | undefined> {
  if (!src || typeof window === "undefined") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onerror = () => resolve(undefined);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = HASH_W;
      canvas.height = HASH_H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return resolve(undefined);
      ctx.drawImage(img, 0, 0, HASH_W, HASH_H);
      const hash = dHashFromGray(grayFromRGBA(ctx.getImageData(0, 0, HASH_W, HASH_H).data));
      resolve(hash || undefined);
    };
    img.src = src;
  });
}
