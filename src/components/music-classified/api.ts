"use client";

import type { Identity } from "@/lib/music-classified/identify";
import { measurePreview } from "@/lib/music-classified/measure";
import type { IdentifyResult } from "@/lib/music-classified/resolve";
import type { StyleResponse } from "@/lib/music-classified/style";
import type { ClassifyResult, LensId, Song, Tree } from "@/lib/music-classified/types";

export type Step = "idle" | "finding" | "measuring" | "filing" | "describing";

export const STEP_LABEL: Record<Exclude<Step, "idle">, string> = {
  finding: "Finding the exact recording…",
  measuring: "Measuring tempo & key from the 30s preview…",
  filing: "Listening and filing it…",
  describing: "Writing the style prompt & descriptions…",
};

export function describe(song: Song, lenses: LensId[], signal?: AbortSignal) {
  return postJson<{ descriptions: Song["descriptions"] }>(
    "/api/music-classified/describe",
    { song, lenses },
    signal,
  );
}

/** The song's generator style prompt — ≤1,000 characters, quality-checked on the server. */
export function writeStyle(song: Song, signal?: AbortSignal) {
  return postJson<StyleResponse>("/api/music-classified/style", { song }, signal);
}

export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

export function identify(input: string, signal?: AbortSignal) {
  return postJson<IdentifyResult>("/api/music-classified/identify", { input }, signal);
}

/** Measure the preview (best effort), then file. */
export async function fileIdentity(
  identity: Identity,
  tree: Tree,
  lenses: LensId[],
  onStep: (s: Step) => void,
  signal?: AbortSignal,
): Promise<ClassifyResult> {
  let measured = null;
  if (identity.previewUrl) {
    onStep("measuring");
    measured = await measurePreview(identity.previewUrl, signal);
  }
  onStep("filing");
  return postJson<ClassifyResult>(
    "/api/music-classified/classify",
    { identity, measured, tree, lenses },
    signal,
  );
}
