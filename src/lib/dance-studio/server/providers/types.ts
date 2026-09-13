// ---------------------------------------------------------------------------
// The seam every motion-reference video provider implements.
//
// The studio never talks to a model directly. It hands a provider two hosted
// links (the dance clip and the character's images), a prompt and settings,
// gets back an opaque operation it stores on the Generation, and later asks
// that same provider how the operation is going. Swapping MiniMax H3 for a
// different model is a new file here plus a line in index.ts — no route or
// screen changes.
// ---------------------------------------------------------------------------

import "server-only";

import type { GenerationSettings, ProviderInfo } from "../../types";

export interface MotionJob {
  /** Signed link to the clip. It is the motion — the provider must use it as a reference, never discard it. */
  referenceVideoUrl: string;
  referenceDurationSec: number;
  /** Signed links, primary image first. */
  characterImageUrls: string[];
  prompt: string;
  settings: GenerationSettings;
}

export interface StartedJob {
  /** JSON-serializable; persisted on the Generation and passed back to status(). */
  operation: unknown;
  warnings: string[];
}

export type JobStatus =
  | { state: "pending" }
  | { state: "completed"; fetchVideo: () => Promise<Buffer> }
  | { state: "error"; message: string };

export interface MotionProvider {
  info: ProviderInfo;
  start(job: MotionJob): Promise<StartedJob>;
  status(operation: unknown): Promise<JobStatus>;
}
