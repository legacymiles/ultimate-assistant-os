// ---------------------------------------------------------------------------
// Design fonts — every one is a committed, OFL-licensed woff2 in /public/fonts,
// so text renders identically in the editor, on the 3D garment and in the
// 300 DPI print file (and the build fetches nothing).
// ---------------------------------------------------------------------------

import type { FontId } from "./types";

export interface DesignFont {
  id: FontId;
  label: string;
  /** The family name registered with the FontFace API (scoped, never collides). */
  family: string;
  file: string | { weight: number; file: string }[];
  /** Variable range, or the discrete weights available. */
  weights: [number, number] | number[];
  feel: string;
}

export const DESIGN_FONTS: DesignFont[] = [
  { id: "geist", label: "Geist", family: "dtf-geist", file: "/fonts/geist-variable.woff2", weights: [100, 900], feel: "Clean modern sans" },
  { id: "inter", label: "Inter", family: "dtf-inter", file: "/fonts/inter-variable.woff2", weights: [100, 900], feel: "Neutral, readable" },
  { id: "space-grotesk", label: "Space Grotesk", family: "dtf-space-grotesk", file: "/fonts/space-grotesk-variable.woff2", weights: [300, 700], feel: "Techy grotesk" },
  { id: "syne", label: "Syne", family: "dtf-syne", file: "/fonts/syne-variable.woff2", weights: [400, 800], feel: "Wide, art-school" },
  { id: "oxanium", label: "Oxanium", family: "dtf-oxanium", file: "/fonts/oxanium-variable.woff2", weights: [200, 800], feel: "Futurist, squared" },
  {
    id: "chakra-petch",
    label: "Chakra Petch",
    family: "dtf-chakra-petch",
    file: [
      { weight: 500, file: "/fonts/chakra-petch-500.woff2" },
      { weight: 600, file: "/fonts/chakra-petch-600.woff2" },
      { weight: 700, file: "/fonts/chakra-petch-700.woff2" },
    ],
    weights: [500, 600, 700],
    feel: "Racing, motorsport",
  },
  { id: "archivo-black", label: "Archivo Black", family: "dtf-archivo-black", file: "/fonts/archivo-black-400.woff2", weights: [400], feel: "Heavy streetwear block" },
  { id: "instrument-serif", label: "Instrument Serif", family: "dtf-instrument-serif", file: "/fonts/instrument-serif-400.woff2", weights: [400], feel: "Editorial, luxury" },
  { id: "jetbrains-mono", label: "JetBrains Mono", family: "dtf-jetbrains-mono", file: "/fonts/jetbrains-mono-variable.woff2", weights: [100, 800], feel: "Monospace, utilitarian" },
];

export function getFont(id: FontId | string): DesignFont {
  return DESIGN_FONTS.find((f) => f.id === id) ?? DESIGN_FONTS[0];
}

/** Snap a requested weight to one the font can actually draw. */
export function snapWeight(font: DesignFont, weight: number): number {
  if (font.weights.length === 2 && !Array.isArray(font.file) && font.weights[0] < font.weights[1]) {
    const [lo, hi] = font.weights as [number, number];
    return Math.max(lo, Math.min(hi, Math.round(weight / 50) * 50));
  }
  const list = font.weights as number[];
  return list.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), list[0]);
}

let loading: Promise<void> | null = null;

/** Register every design font with the browser once. Safe to call repeatedly. */
export function loadDesignFonts(): Promise<void> {
  if (typeof window === "undefined" || typeof FontFace === "undefined") return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    const faces: FontFace[] = [];
    for (const f of DESIGN_FONTS) {
      if (Array.isArray(f.file)) {
        for (const w of f.file) faces.push(new FontFace(f.family, `url(${w.file}) format("woff2")`, { weight: String(w.weight) }));
      } else {
        const weight = f.weights.length === 2 && f.weights[0] !== f.weights[1] ? `${f.weights[0]} ${f.weights[1]}` : String(f.weights[0]);
        faces.push(new FontFace(f.family, `url(${f.file}) format("woff2")`, { weight }));
      }
    }
    await Promise.all(
      faces.map(async (face) => {
        try {
          await face.load();
          document.fonts.add(face);
        } catch {
          /* a missing face falls back to the system sans; the render still works */
        }
      }),
    );
  })();
  return loading;
}
