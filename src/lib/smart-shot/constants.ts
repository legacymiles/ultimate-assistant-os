import type { AspectRatio, CameraMove, Framing, LookId, Quality, UploadRole } from "./types";

export const CUT_COUNTS = [3, 4, 5, 6] as const;
/** H3 renders one generation of 4–15 s; the film is that one generation. */
export const TOTAL_SECONDS = [6, 10, 15] as const;
export const ASPECTS: AspectRatio[] = ["16:9", "9:16", "1:1"];

/** Uploads per project. Nine is H3's image-reference ceiling. */
export const MAX_UPLOADS = 9;
export const MAX_PROMPT = 3000;
export const MAX_CUTS = 8;

export interface Look {
  id: LookId;
  name: string;
  /** Style sentence every image and video prompt opens with. */
  style: string;
}

export const LOOKS: Look[] = [
  {
    id: "live-action",
    name: "Live-action film",
    style: "Live-action, cinematic, anamorphic lens character with 2.39:1 composition, shallow depth of field, realistic film grain, natural light, no CGI plasticity",
  },
  {
    id: "commercial",
    name: "Commercial",
    style: "Live-action commercial, glossy and polished, crisp product-grade lighting, saturated but controlled colour, clean backgrounds, premium ad photography",
  },
  {
    id: "documentary",
    name: "Documentary",
    style: "Observational documentary, natural available light, handheld realism, honest colour, real textures, no stylisation",
  },
  {
    id: "anime",
    name: "Anime",
    style: "2D anime, clean line art, cel shading, painterly backgrounds, expressive faces, Makoto Shinkai-like light and sky",
  },
  {
    id: "3d-animation",
    name: "3D animation",
    style: "Stylised 3D animation, soft subsurface skin, rounded appealing character design, physically based lighting, Pixar-like render quality",
  },
];

export function lookById(id: string): Look {
  return LOOKS.find((l) => l.id === id) ?? LOOKS[0];
}

export const ROLE_LABEL: Record<UploadRole, string> = {
  character: "Character",
  location: "Environment",
  object: "Product / object",
  style: "Style",
};

export const QUALITY: Record<Quality, { name: string; resolution: "768P" | "2K"; label: string; hostedPerSec: number }> = {
  medium: { name: "Medium", resolution: "768P", label: "768p", hostedPerSec: 0.08 },
  high: { name: "High", resolution: "2K", label: "2K", hostedPerSec: 0.13 },
};

export const MOVES: CameraMove[] = [
  "static",
  "handheld",
  "dolly-in",
  "push-in",
  "pull-out",
  "track",
  "pan",
  "tilt",
  "crane-up",
  "crane-down",
  "arc",
  "orbit",
  "rack-focus",
  "dolly-zoom",
];

export const FRAMINGS: Framing[] = ["extreme wide", "wide", "medium", "two-shot", "close-up", "extreme close-up", "macro", "insert"];

export const LENSES = [24, 35, 40, 50, 75, 85, 90, 100, 135];
export const APERTURES = ["f/1.4", "f/2", "f/2.4", "f/2.8", "f/4", "f/5.6"];

export function clampCutCount(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 4;
  return Math.min(MAX_CUTS, Math.max(2, Math.round(v)));
}

export function clampTotal(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 15;
  return Math.min(15, Math.max(4, Math.round(v)));
}

/** Seconds each cut gets inside one generation: the film split evenly, never under 2 s. */
export function perCutSeconds(totalSec: number, cutCount: number): number {
  return Math.max(2, Math.round(totalSec / Math.max(1, cutCount)));
}

/** A cut rendered on its own must be at least H3's 4-second minimum. */
export function standaloneSeconds(cutSec: number): number {
  return Math.min(15, Math.max(4, Math.round(cutSec)));
}

/** Rough cost line, so the button can say what OpenArt's credit counter says. */
export function estimateCost(totalSec: number, quality: Quality): string {
  const hosted = (totalSec * QUALITY[quality].hostedPerSec).toFixed(2);
  return `≈ $${hosted} on MiniMax hosted · a few cents on your own RunPod H3`;
}
