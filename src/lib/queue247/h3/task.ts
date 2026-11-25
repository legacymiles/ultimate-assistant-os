// ---------------------------------------------------------------------------
// One way to file an H3 recreation task.
//
// The 24/7 Queue page, Jarvis's planner and the H3 Prompt Lab's Reverse
// section all call h3TaskInput(), so a recreation filed from any of them has
// the same executor, needs, steps and config shape. Pure — safe in the browser.
// ---------------------------------------------------------------------------

import type { NewTaskInput } from "../engine";
import type { Capability } from "../types";
import { cleanChanges, describeChanges, parseChangeText, type H3Changes } from "./changes";
import { MAX_VARIATIONS } from "./variations";

export const H3_EXECUTOR = "h3-recreate";
export const H3_AGENT = "H3 Recreation Agent";
export const H3_APP = "h3-experiments";
export const H3_DEFAULT_VARIATIONS = 3;

export const H3_STEPS = [
  "Fetch the video",
  "Find the shots",
  "Pull keyframes",
  "Reverse-engineer each shot",
  "Build the storyboard",
  "Write the H3 prompts",
  "Make variations",
];

export interface H3TaskParams {
  /** Storage key of an uploaded file (bucket queue-247, `uploads/<uid>/…`). */
  videoKey?: string;
  /** A social / video link to import instead. */
  url?: string;
  /** Typed changes, or the owner's plain words (parsed with parseChangeText). */
  changes?: H3Changes | string;
  /** The owner's words verbatim, kept as the task's instruction. */
  changeText?: string;
  variations?: number;
  title?: string;
  /** File name of the upload, for the title when none is given. */
  fileName?: string;
  priority?: number;
  createdBy?: string;
}

export interface H3Config {
  videoKey?: string;
  url?: string;
  changes: H3Changes;
  variations: number;
  title: string;
}

function titleFrom(p: H3TaskParams): string {
  if (p.title?.trim()) return p.title.trim().slice(0, 120);
  if (p.fileName) return p.fileName.replace(/\.[a-z0-9]+$/i, "").slice(0, 100) || "Uploaded video";
  if (p.url) {
    try {
      const u = new URL(p.url);
      return `${u.hostname.replace(/^www\./, "")} video`;
    } catch {
      /* fall through */
    }
  }
  return "Reference video";
}

export function clampVariations(n: unknown): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(1, Math.min(MAX_VARIATIONS, v)) : H3_DEFAULT_VARIATIONS;
}

/** Throws a plain-English Error when there is no video to work from. */
export function h3TaskInput(p: H3TaskParams): NewTaskInput {
  const videoKey = p.videoKey?.trim() || undefined;
  const url = p.url?.trim() || undefined;
  if (!videoKey && !url) throw new Error("Upload a video or paste a link first.");
  const changes = typeof p.changes === "string" ? parseChangeText(p.changes) : cleanChanges(p.changes ?? p.changeText ?? "");
  const variations = p.variations === undefined ? H3_DEFAULT_VARIATIONS : clampVariations(p.variations);
  const title = titleFrom(p);
  const needs: Capability[] = ["ffmpeg", "ai", "storage", ...(url && !videoKey ? (["ytdlp", "web"] as Capability[]) : [])];
  const config: H3Config = { ...(videoKey ? { videoKey } : {}), ...(url && !videoKey ? { url } : {}), changes, variations, title };
  const words = (p.changeText ?? (typeof p.changes === "string" ? p.changes : "")).trim();
  return {
    title: `Recreate “${title}” for H3`,
    description: `Reverse-engineer ${videoKey ? "the uploaded video" : url} into a shot-by-shot storyboard and MiniMax H3 prompts (${variations} variation${variations === 1 ? "" : "s"} per shot). Changes: ${describeChanges(changes)}.`,
    instruction: words || `Recreate ${title} as H3 prompts.`,
    app: H3_APP,
    executor: H3_EXECUTOR,
    agent: H3_AGENT,
    kind: "once",
    priority: p.priority ?? 3,
    config: config as unknown as Record<string, unknown>,
    needs,
    steps: H3_STEPS,
    created_by: p.createdBy ?? "app:h3-experiments",
  };
}
