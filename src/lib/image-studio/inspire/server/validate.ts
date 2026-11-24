// Turning a browser's request body into trusted fields.

import "server-only";

import { sanitizeChips } from "../extract";
import { ART_STYLES, SUBJECTS, isGalleryCategory, type GalleryCategoryId } from "../taxonomy";
import { REFERENCE_PURPOSES, type ReferencePurpose, type Visibility } from "../types";
import { str } from "./access";

export const MAX_PROMPT = 4000;

export function visibility(v: unknown): Visibility {
  return v === "public" ? "public" : "private";
}

export function category(v: unknown, fallback: GalleryCategoryId = "digital-art"): GalleryCategoryId {
  return isGalleryCategory(v) ? v : fallback;
}

export function style(v: unknown): string {
  const s = str(v, 40);
  return (ART_STYLES as readonly string[]).includes(s) ? s : s ? s : "Digital";
}

export function subject(v: unknown): string {
  const s = str(v, 40);
  return (SUBJECTS as readonly string[]).includes(s) ? s : s || "Abstract";
}

export function purpose(v: unknown): ReferencePurpose {
  return REFERENCE_PURPOSES.some((p) => p.id === v) ? (v as ReferencePurpose) : "style";
}

/** The creator's prompt, kept byte-for-byte apart from trimming and a length cap. */
export function prompt(v: unknown): string {
  return typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, MAX_PROMPT) : "";
}

export { sanitizeChips as chips };
