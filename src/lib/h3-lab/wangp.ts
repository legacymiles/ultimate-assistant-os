// ---------------------------------------------------------------------------
// WanGP settings for the owner's local MiniMax H3 — only what the install
// actually has (read 2026-11-24): pruned 20B int8 FL2VA / Ref2VA, the 4-step
// turbo LoRAs, the two-phase latent upscaler, the Q2_K text encoder.
// Shapes mirror tools/studio-bridge/server.mjs, which is proven against it.
// ---------------------------------------------------------------------------

import type { Compiled } from "./compile";
import { flatten } from "./compile";
import type { ShotSpec, WanSettings } from "./model";

const TURBO_REF2VA =
  "https://huggingface.co/DeepBeepMeep/MiniMax-H3/resolve/main/loras/minimax_h3_lightx2v_ref2v_turbo_4step_alpha8_v0.1_bf16.safetensors";
const TURBO_FL2VA =
  "https://huggingface.co/DeepBeepMeep/MiniMax-H3/resolve/main/loras/minimax_h3_lightx2v_fl2v_turbo_4step_alpha16_v0.1.safetensors";

const RESOLUTION: Record<ShotSpec["aspect"], string> = { "16:9": "832x480", "9:16": "480x832", "1:1": "640x640" };

export const FPS = 24;
export const MIN_FRAMES = 107;
export const FRAME_STEP = 17;
export const MAX_FRAMES = 362;

/** Frames for a duration on WanGP's H3 lattice (107 + 17k), at least 124 (H3's trained minimum window). */
export function framesFor(seconds: number): number {
  const want = Math.max(124, Math.round(seconds * FPS));
  const k = Math.ceil((want - MIN_FRAMES) / FRAME_STEP);
  return Math.min(MAX_FRAMES, MIN_FRAMES + Math.max(1, k) * FRAME_STEP);
}

export function secondsFor(frames: number): number {
  return frames / FPS;
}

export interface WanOptions {
  quality: "turbo" | "hi";
  seed: number;
}

export function wanSettings(spec: ShotSpec, compiled: Compiled, opts: WanOptions): WanSettings {
  const refs = compiled.mode === "ref2va";
  const base = RESOLUTION[spec.aspect] ?? RESOLUTION["16:9"];
  const [w, h] = base.split("x").map(Number);
  const hi = opts.quality === "hi";
  return {
    model_type: refs ? "minimax_h3_ref2va_pruned" : "minimax_h3_fl2va_pruned",
    prompt: flatten(compiled.prompt),
    // Two-phase asks for the FINAL size; WanGP renders phase 1 at half of it.
    resolution: hi ? `${w * 2}x${h * 2}` : base,
    video_length: framesFor(spec.durationSec),
    seed: opts.seed,
    num_inference_steps: hi ? 20 : 4,
    guidance_scale: 1,
    flow_shift: 12,
    ...(hi ? { guidance_phases: 2, switch_threshold: 0.9035 } : {}),
    loras_multipliers: "1.0",
    ...(hi ? {} : { activated_loras: [refs ? TURBO_REF2VA : TURBO_FL2VA] }),
    config: "gguf_q2_k,int8_convrot,lower_ram",
    ...(refs ? { image_refs: compiled.references.map((r) => r.image), video_prompt_type: "I" } : {}),
  };
}

/** The one figure measured before the lab existed: 5.7 min for a 124-frame turbo clip on the RTX 3050 (2026-09-21). */
const SEED_TURBO_SEC_PER_FRAME = (5.7 * 60) / 124;

/**
 * Minutes a render will take, from what this PC has actually rendered at that
 * quality (median seconds per frame). Turbo falls back to the one measured
 * figure; "hi" returns null until the lab has measured one — never a guess.
 */
export function estimateMinutes(
  spec: ShotSpec,
  quality: "turbo" | "hi",
  measured: { frames: number; seconds: number; quality: "turbo" | "hi" }[] = [],
): number | null {
  const frames = framesFor(spec.durationSec);
  const rates = measured
    .filter((m) => m.quality === quality && m.frames > 0 && m.seconds > 0)
    .map((m) => m.seconds / m.frames)
    .sort((a, b) => a - b);
  const rate = rates.length ? rates[Math.floor(rates.length / 2)] : quality === "turbo" ? SEED_TURBO_SEC_PER_FRAME : null;
  if (rate === null) return null;
  return Math.round(((frames * rate) / 60) * 10) / 10;
}
