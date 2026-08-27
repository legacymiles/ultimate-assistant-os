// ---------------------------------------------------------------------------
// Seedance Studio — client helpers: the generate call + small browser utils.
// ---------------------------------------------------------------------------

"use client";

import { composePrompt, moodHue } from "./constants";
import type { GenerateResult, MediaRef, SeedanceProject, Segment } from "./types";

/**
 * Generate one segment's clip. Sends the composed prompt + first image ref to
 * /api/seedance. On any failure, degrades to a deterministic placeholder so the
 * editor never dead-ends.
 */
export async function generateSegment(
  project: SeedanceProject,
  segment: Segment,
): Promise<GenerateResult> {
  const prompt = composePrompt({
    basePrompt: project.basePrompt,
    prompt: segment.prompt,
    mood: segment.mood,
    effect: segment.effect,
    type: segment.type,
  });
  const imageRef = segment.refs.find((r) => r.kind === "image" && r.url);

  try {
    const res = await fetch("/api/seedance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: "generate",
        prompt,
        aspectRatio: project.aspectRatio,
        durationSec: segment.durationSec,
        image: imageRef?.url ?? null,
        moodHue: moodHue(segment.mood),
      }),
    });
    if (!res.ok) throw new Error(`Seedance API ${res.status}`);
    return (await res.json()) as GenerateResult;
  } catch (err) {
    console.error("Seedance generate failed, using placeholder:", err);
    return { status: "done", engine: "placeholder", posterHue: moodHue(segment.mood) };
  }
}

// ----- upload → MediaRef ---------------------------------------------------

export function fileToMediaRef(file: File): Promise<MediaRef> {
  return new Promise((resolve, reject) => {
    const kind: MediaRef["kind"] = file.type.startsWith("video/") ? "video" : "image";
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        id: `ref_${Math.random().toString(36).slice(2, 9)}`,
        name: file.name,
        kind,
        type: file.type,
        url: String(reader.result),
      });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function fileToObjectUrl(file: File): { url: string; type: string; name: string } {
  return { url: URL.createObjectURL(file), type: file.type, name: file.name };
}
