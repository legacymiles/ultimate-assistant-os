// ---------------------------------------------------------------------------
// The input contract for motion-reference generation.
//
// These are MiniMax H3's reference-generation limits (AI Gateway model card,
// checked 2026-09-13): reference video mp4/h264/h265, 2–15 s, ≤ 50 MB, URL
// only; character images ≥ 256 px, aspect 2:5–5:2; output 4–15 s. A provider
// with different limits would change this file, and the browser-side
// preprocessing follows it automatically.
//
// Pure — imported by the browser (to decide whether a clip needs cutting) and
// by the routes (to refuse what the model would reject after billing).
// ---------------------------------------------------------------------------

import type { AspectRatio, GenerationSettings, GenerationStatus, ProviderPricing } from "./types";

export const REF_MIN_SEC = 2;
export const REF_MAX_SEC = 15;
export const REF_MAX_BYTES = 50 * 1024 * 1024;
/** How big an original we'll download from a link before cutting it. */
export const SOURCE_MAX_BYTES = 150 * 1024 * 1024;
export const OUT_MIN_SEC = 4;
export const OUT_MAX_SEC = 15;

export const CHARACTER_MIN_PX = 256;
export const CHARACTER_MAX_PX = 2048;
export const CHARACTER_MAX_EXTRA = 8;

const ACTIVE: GenerationStatus[] = ["queued", "generating", "saving"];
export function isActive(status: GenerationStatus): boolean {
  return ACTIVE.includes(status);
}

/** The model output should keep the reference's framing, so the ratio follows the clip. */
export function aspectFor(width?: number | null, height?: number | null): AspectRatio {
  if (!width || !height) return "9:16";
  const r = width / height;
  if (r > 1.15) return "16:9";
  if (r < 0.87) return "9:16";
  return "1:1";
}

/** Output as long as the dance, within what the model renders. */
export function outputSeconds(referenceSec: number): number {
  return Math.min(OUT_MAX_SEC, Math.max(OUT_MIN_SEC, Math.round(referenceSec)));
}

/**
 * Why a clip must be cut or converted in the browser before upload, or null
 * when it can go as-is. Too SHORT is not here: no preprocessing fixes that.
 */
export function prepReason(p: { durationSec: number; sizeBytes?: number; contentType?: string }): string | null {
  if (p.durationSec > REF_MAX_SEC + 0.25) {
    return `It's ${Math.round(p.durationSec)}s long, and MiniMax H3 reads at most ${REF_MAX_SEC}s of motion — pick the part to use.`;
  }
  if (p.contentType && p.contentType !== "video/mp4") {
    return "It isn't an MP4, so it will be converted in your browser first.";
  }
  if (p.sizeBytes && p.sizeBytes > REF_MAX_BYTES) {
    return "It's over 50 MB, so it will be re-encoded smaller in your browser first.";
  }
  return null;
}

export function estimateCostUsd(
  pricing: ProviderPricing | undefined,
  settings: Pick<GenerationSettings, "resolution" | "durationSec">,
  referenceSec: number,
  imageCount: number,
): number | undefined {
  if (!pricing) return undefined;
  const out = pricing.outputPerSec[settings.resolution] * settings.durationSec;
  const ref = (pricing.referenceVideoPerSec ?? 0) * Math.min(REF_MAX_SEC, referenceSec);
  const img = (pricing.perImage ?? 0) * imageCount;
  return Math.round((out + ref + img) * 100) / 100;
}
