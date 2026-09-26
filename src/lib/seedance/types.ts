// ---------------------------------------------------------------------------
// Music Video Studio — a music-video cutting room.
//
// Three lanes, and only three:
//
//   Video prompts  The film. An ordered run of prompt blocks laid end to end
//                  from the top of the song. THIS IS THE ONLY PLACE A PROMPT
//                  LIVES — the prompt, the camera deck, the reference images.
//   Song           The waveform, and the clock everything is measured on.
//   Lip sync       Plain ranges on the song. They carry no prompt and no look;
//                  they only say "sing here". A video block that overlaps one
//                  is lip-synced to that slice of the audio. Everything else
//                  plays under the music.
// ---------------------------------------------------------------------------

import type { CinemaSelection } from "@/lib/studio/cinema";

export type AspectRatio = "16:9" | "9:16" | "1:1";

export type BlockStatus = "idle" | "generating" | "done" | "error";

/** How a clip was produced. "seedance" = real model; "placeholder" = no key. */
export type GenEngine = "seedance" | "placeholder";

export interface MediaRef {
  id: string;
  name: string;
  kind: "image" | "video";
  /** MIME type. */
  type: string;
  /** Object/data URL — session-only, never persisted. */
  url?: string;
}

/** One block on the Video prompts lane. Everything a shot is lives here. */
export interface VideoPrompt {
  id: string;
  /** Free text. Camera moves live in here as "#dolly-in" tokens. */
  prompt: string;
  /** This block's overrides on the reel deck. rail id → option id. */
  cinema: CinemaSelection;
  /** The first image is the block's own artwork until a clip is rendered. */
  refs: MediaRef[];
  durationSec: number;
  // ----- render result (session-only) -----
  status: BlockStatus;
  videoUrl?: string;
  posterHue?: number;
  engine?: GenEngine;
  error?: string;
}

/** One range on the Lip sync lane. No prompt — it is a decision about audio. */
export interface LipRange {
  id: string;
  startSec: number;
  durationSec: number;
}

export interface Song {
  name: string;
  type: string;
  /** Object URL — session-only. */
  url?: string;
  durationSec: number;
  /** Normalised 0–1 peaks for the waveform. Session-only, recomputed on load. */
  peaks?: number[];
}

export interface Reel {
  id: string;
  name: string;
  /** The whole film in a sentence. Every block inherits it. */
  direction: string;
  /** The reel-level camera deck. A block's own `cinema` overrides a rail. */
  cinema: CinemaSelection;
  aspectRatio: AspectRatio;
  song: Song | null;
  prompts: VideoPrompt[];
  lipsync: LipRange[];
  created_at: string;
  updated_at: string;
}

/** A video block once its place in the run has been measured. */
export interface PlacedPrompt {
  block: VideoPrompt;
  index: number;
  startSec: number;
  durationSec: number;
  /** Seconds of this block covered by a lip-sync range. */
  lipSec: number;
  /** True when the block sings rather than plays under the music. */
  lipSynced: boolean;
}

export interface Interval {
  startSec: number;
  durationSec: number;
}

/** Response shape from POST /api/seedance (stage "generate"). */
export interface GenerateResult {
  status: "done" | "error";
  engine: GenEngine;
  videoUrl?: string;
  posterHue?: number;
  error?: string;
}
