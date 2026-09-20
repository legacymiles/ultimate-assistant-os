// ---------------------------------------------------------------------------
// The brief: defaults, clamping and normalisation.
//
// Isomorphic — the form uses it to seed itself and the API uses it to refuse
// nonsense from a hand-rolled request. One definition, so the two can never
// disagree about what a valid brief is.
// ---------------------------------------------------------------------------

import { ASPECT_RATIOS, NARRATIONS, type AspectRatio, type Narration, type VideoBrief } from "./types";

export const MIN_DURATION = 3;
export const MAX_DURATION = 300;

export function emptyBrief(): VideoBrief {
  return {
    prompt: "",
    subject: "",
    durationSec: 20,
    style: "",
    audience: "",
    aspectRatio: "16:9",
    narration: "ai-voiceover",
    voiceNote: "",
    music: "",
    captions: true,
    notes: "",
  };
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

export function clampDuration(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 20;
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(n)));
}

function aspect(value: unknown): AspectRatio {
  return ASPECT_RATIOS.some((a) => a.id === value) ? (value as AspectRatio) : "16:9";
}

function narration(value: unknown): Narration {
  return NARRATIONS.some((n) => n.id === value) ? (value as Narration) : "ai-voiceover";
}

/** Take anything off the wire and return a brief that is safe to plan from. */
export function normaliseBrief(input: unknown): VideoBrief {
  const raw = (input ?? {}) as Record<string, unknown>;
  return {
    prompt: str(raw.prompt).slice(0, 4000),
    subject: str(raw.subject).slice(0, 200),
    durationSec: clampDuration(raw.durationSec),
    style: str(raw.style).slice(0, 200),
    audience: str(raw.audience).slice(0, 200),
    aspectRatio: aspect(raw.aspectRatio),
    narration: narration(raw.narration),
    voiceNote: str(raw.voiceNote).slice(0, 400),
    music: str(raw.music).slice(0, 400),
    captions: raw.captions !== false,
    notes: str(raw.notes).slice(0, 4000),
  };
}

/** Why this brief cannot be planned yet, or null when it can. */
export function briefProblem(brief: VideoBrief): string | null {
  if (brief.prompt.length < 8) return "Describe the video you want in a sentence or two.";
  return null;
}

/**
 * The brief rendered as the block every planner and optimiser reads. One
 * format, so an engine's optimiser never has to guess which fields exist.
 */
export function briefBlock(brief: VideoBrief): string {
  const lines = [
    `REQUEST: ${brief.prompt}`,
    `DURATION: ${brief.durationSec} seconds`,
    `ASPECT RATIO: ${brief.aspectRatio}`,
  ];
  if (brief.subject) lines.push(`SUBJECT: ${brief.subject}`);
  if (brief.style) lines.push(`VISUAL STYLE: ${brief.style}`);
  if (brief.audience) lines.push(`AUDIENCE: ${brief.audience}`);
  lines.push(`NARRATION: ${NARRATIONS.find((n) => n.id === brief.narration)?.label ?? brief.narration}`);
  if (brief.voiceNote) lines.push(`VOICE: ${brief.voiceNote}`);
  if (brief.music) lines.push(`MUSIC: ${brief.music}`);
  lines.push(`CAPTIONS: ${brief.captions ? "yes" : "no"}`);
  if (brief.notes) lines.push(`OTHER INSTRUCTIONS: ${brief.notes}`);
  return lines.join("\n");
}

/** A short title for a project, from the brief, without calling a model. */
export function titleFromBrief(brief: VideoBrief): string {
  const source = brief.subject || brief.prompt;
  const cleaned = source
    .replace(/^(create|make|build|generate|produce)\s+(me\s+)?(an?\s+)?/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Untitled video";
  const words = cleaned.split(" ").slice(0, 8).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1, 80);
}
