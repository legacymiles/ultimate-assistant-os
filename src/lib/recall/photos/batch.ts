"use client";

// ---------------------------------------------------------------------------
// Photos — reading the user's instructions for a whole upload.
//
// "Make these into a collage and put a short quote about hard work across the
// bottom" is one sentence that means three things: combine the batch, write
// some words, and burn them into the result. This turns that sentence into a
// plan the composer can execute.
//
// The model is asked only to INTERPRET, never to draw: it returns a layout, a
// position and the actual words. That split is what keeps the feature working
// with no AI key — `readPlanLocally` below understands the common phrasings on
// its own, and only "write me a quote" genuinely needs a model, which it then
// says plainly instead of inventing something.
// ---------------------------------------------------------------------------

import { DEFAULT_CAPTION, DEFAULT_COLLAGE } from "./compose";
import type { CaptionSpec, CollageSpec } from "./compose";

export interface BatchPlan {
  /** Set when the pictures should be combined into one. */
  collage: CollageSpec | null;
  /** Set when words should be burned into the result. */
  caption: CaptionSpec | null;
  /** What to call the finished picture. */
  title?: string;
  /** The album the user named, in their own words. */
  album?: string | null;
  /** One line of plain English about what was understood. */
  note?: string;
  /** Anything the instructions asked for that could not be done. */
  couldNot: string[];
  engine: "ai" | "heuristic";
}

/** A plan that changes nothing — the instructions were only about filing. */
export const NO_EDITS: BatchPlan = { collage: null, caption: null, couldNot: [], engine: "heuristic" };

const COLLAGE_WORDS =
  /\b(collage|montage|stitch|stitched|combine|combined|merge|merged|grid|side by side|side-by-side|one image|single image|one picture|all together|into one)\b/i;

const ROW_WORDS = /\b(row|strip|side by side|side-by-side|horizontal|across)\b/i;
const COLUMN_WORDS = /\b(column|stack|stacked|vertical|down the)\b/i;
const TOP_WORDS = /\b(top|above|header|at the top)\b/i;
const CENTRE_WORDS = /\b(middle|centre|center|across the front)\b/i;
const BIG_WORDS = /\b(big|large|huge|bold|headline)\b/i;
const SMALL_WORDS = /\b(small|subtle|tiny|little)\b/i;
const NO_BAND = /\b(no band|no bar|no box|transparent|straight on the photo)\b/i;

/** Words the user typed inside quotes — the one thing we can use verbatim. */
function quotedText(prompt: string): string | null {
  const m = prompt.match(/["“”'']([^"“”'']{2,160})["“”'']/);
  return m ? m[1].trim() : null;
}

/** Does the instruction ask for words on the picture at all? */
const WANTS_WORDS =
  /\b(add|put|write|overlay|caption|title|label|stamp|say|text|words|quote|saying)\b/i;

/**
 * Understand an instruction without a model.
 *
 * Deliberately literal. It will combine pictures and it will place words the
 * user actually typed, but it will not compose a quote — being asked for "a
 * quote about hard work" and answering with a made-up one is worse than saying
 * it needs the AI key, which is what `couldNot` is for.
 */
export function readPlanLocally(prompt: string, fileCount: number): BatchPlan {
  const text = prompt.trim();
  if (!text) return NO_EDITS;

  const wantsCollage = COLLAGE_WORDS.test(text) && fileCount > 1;
  const collage: CollageSpec | null = wantsCollage
    ? {
        ...DEFAULT_COLLAGE,
        layout: ROW_WORDS.test(text) ? "row" : COLUMN_WORDS.test(text) ? "column" : "grid",
      }
    : null;

  const quoted = quotedText(text);
  const caption: CaptionSpec | null = quoted
    ? {
        ...DEFAULT_CAPTION,
        text: quoted,
        position: TOP_WORDS.test(text) ? "top" : CENTRE_WORDS.test(text) ? "center" : "bottom",
        size: BIG_WORDS.test(text) ? "large" : SMALL_WORDS.test(text) ? "small" : "medium",
        band: !NO_BAND.test(text),
      }
    : null;

  const couldNot: string[] = [];
  if (!caption && WANTS_WORDS.test(text)) {
    couldNot.push(
      "Writing the words needs the AI key. Put the exact text in quotes and it will be added without one.",
    );
  }
  if (!wantsCollage && COLLAGE_WORDS.test(text) && fileCount <= 1) {
    couldNot.push("A collage needs more than one picture.");
  }

  return {
    collage,
    caption,
    couldNot,
    engine: "heuristic",
    note: collage
      ? "Combining " + fileCount + " pictures into one"
      : caption
        ? "Adding your words to the picture"
        : undefined,
  };
}

/**
 * Ask the agent what the instructions mean. Never throws: a failure falls back
 * to the local reading, so a dropped request costs wording, not the upload.
 */
export async function readBatchPlan(prompt: string, files: File[]): Promise<BatchPlan> {
  const local = readPlanLocally(prompt, files.length);
  if (!prompt.trim()) return local;
  try {
    const res = await fetch("/api/recall/photos/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        fileNames: files.map((f) => f.name).slice(0, 40),
        fileCount: files.length,
      }),
    });
    if (!res.ok) return local;
    const data = (await res.json()) as { plan?: BatchPlan | null };
    return data.plan ?? local;
  } catch {
    return local;
  }
}
