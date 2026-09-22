// ---------------------------------------------------------------------------
// Website Redesigner — URL fingerprint.
//
// The hero's WebGL field is seeded by whatever is in the URL box, so every
// site you paste gets its own flow, turbulence and ember bias before the tool
// has fetched a single byte. Pure + deterministic so the same URL always
// looks the same, and so the readout in the hero can show the real numbers.
// ---------------------------------------------------------------------------

export interface Fingerprint {
  /** Drives the shader's noise domain + scale. 0 for an empty box. */
  seed: number;
  /** Flow rate shown in the readout, 0..1. */
  flow: number;
  /** Turbulence shown in the readout, 0..1. */
  turbulence: number;
  /** `0x` + 4 hex digits — the readout's headline value. */
  label: string;
}

const EMPTY: Fingerprint = { seed: 0, flow: 0, turbulence: 0, label: "0x0000" };

/**
 * FNV-1a over the trimmed, lower-cased URL. Cheap, stable, and spreads
 * single-character edits across the whole hash — which is what makes typing
 * feel like it is doing something.
 */
export function fingerprint(raw: string): Fingerprint {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return EMPTY;

  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }

  // Three independent-enough readings out of one hash.
  const seed = (h % 100000) / 1000; // 0..100, the shader's domain offset
  const flow = ((h >>> 8) & 0xff) / 255;
  const turbulence = ((h >>> 19) & 0xff) / 255;

  return {
    seed,
    flow,
    turbulence,
    label: `0x${(h & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`,
  };
}

/** Hex colour → [r,g,b] in 0..1, or null when it isn't a hex colour. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
