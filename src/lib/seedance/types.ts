// ---------------------------------------------------------------------------
// Seedance Studio — a CapCut-style prompt builder for Seedance 2 video.
// A project is a song track + an ordered list of prompt "segments" that each
// generate one video clip. These types are shared by the UI, the repo and the
// /api/seedance route.
// ---------------------------------------------------------------------------

export type AspectRatio = "16:9" | "9:16" | "1:1";

export type SegmentStatus = "idle" | "generating" | "done" | "error";

/** "broll" = visual footage; "lipsync" = subject sings this slice of the song. */
export type SegmentType = "broll" | "lipsync";

/** How a clip was produced. "seedance" = real model; "placeholder" = no key. */
export type GenEngine = "seedance" | "placeholder";

export interface MediaRef {
  id: string;
  name: string;
  /** "image" or "video". */
  kind: "image" | "video";
  /** MIME type. */
  type: string;
  /** Object/data URL — session-only, never persisted to localStorage. */
  url?: string;
}

export interface Song {
  name: string;
  type: string;
  /** Object/data URL — session-only. */
  url?: string;
  durationSec?: number;
}

export interface Segment {
  id: string;
  prompt: string;
  mood: string;
  effect: string;
  type: SegmentType;
  durationSec: number;
  refs: MediaRef[];
  // ----- generation result (session-only) -----
  status: SegmentStatus;
  /** Data URL of the rendered clip when engine === "seedance". */
  videoUrl?: string;
  /** Hue (0–360) used to paint the placeholder clip when there's no key. */
  posterHue?: number;
  engine?: GenEngine;
  error?: string;
}

export interface SeedanceProject {
  id: string;
  name: string;
  basePrompt: string;
  globalMood: string;
  aspectRatio: AspectRatio;
  song: Song | null;
  segments: Segment[];
  created_at: string;
  updated_at: string;
}

/** Response shape from POST /api/seedance (stage "generate"). */
export interface GenerateResult {
  status: "done" | "error";
  engine: GenEngine;
  /** Present when engine === "seedance". */
  videoUrl?: string;
  /** Present when engine === "placeholder". */
  posterHue?: number;
  error?: string;
}
