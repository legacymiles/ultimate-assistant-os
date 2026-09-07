// ---------------------------------------------------------------------------
// The contract every video backend implements.
//
// Auteur can render a shot through MiniMax's own API, through the Vercel AI
// Gateway, through the user's own H3 running on RunPod, or not at all (the
// animatic placeholder). The storyboard does not care which — it asks for a
// render, polls, and downloads. These types are that seam.
// ---------------------------------------------------------------------------

import "server-only";

import type { AspectRatio } from "../../types";

export type BackendId = "runpod" | "minimax" | "gateway" | "placeholder";

/** A reference file as it travels to a backend: labelled, typed, inline. */
export interface RenderReference {
  /** "Subject 1" / "Video 1" / "Audio 1" — the label used inside the prompt. */
  label: string;
  kind: "image" | "video" | "audio";
  dataUrl: string;
}

export interface RenderRequest {
  prompt: string;
  durationSec: number;
  aspectRatio: AspectRatio;
  resolution: "768P" | "2K";
  references: RenderReference[];
  /** First-frame image. Mutually exclusive with references on H3. */
  firstFrame?: string;
}

/**
 * What starting a render returns.
 *
 * "async" hands back a task id the client polls. "inline" already has the
 * bytes. "done" is the placeholder, which has nothing to fetch.
 */
export type StartResult =
  | { mode: "async"; taskId: string }
  | { mode: "inline"; videoBase64: string }
  | { mode: "done" };

export type TaskStatus = "queued" | "generating" | "done" | "error";

export interface TaskView {
  status: TaskStatus;
  /** Where the finished clip can be fetched, when the backend gives a URL. */
  url?: string;
  /** Some backends hand the bytes back in the status response instead. */
  videoBase64?: string;
  error?: string;
  /** Free-text progress, e.g. "loading model" during a cold start. */
  note?: string;
}

export interface VideoBackend {
  id: BackendId;
  /** Human-readable, shown in the studio so the user knows what rendered. */
  label: string;
  start(req: RenderRequest): Promise<StartResult>;
  /** Only async backends implement these two. */
  poll?(taskId: string): Promise<TaskView>;
  fetchVideo?(taskId: string): Promise<Response>;
}
