"use client";

// Small helpers the Prompt Builder's parts share: chip identity, the
// add/remove/toggle actions on the build, and the highlighter that finds each
// chip's words inside a prompt so the preview can glow them in place.

import { useCallback, useMemo, type CSSProperties } from "react";
import { mergeChips } from "@/lib/image-studio/inspire/assemble";
import type { DeliverableId } from "@/lib/image-studio/inspire/deliverables";
import type { GalleryCategoryId } from "@/lib/image-studio/inspire/taxonomy";
import type { Chip } from "@/lib/image-studio/inspire/types";
import { useInspire } from "../store";

export const MAX_REFS = 6;
export const MAX_PROMPT = 4000;

/** Two chips are the same ingredient when their words match, any case. */
export const chipKey = (c: Pick<Chip, "text">): string => c.text.trim().toLowerCase();

/** Strip display-only fields (a recommendation's reason, a library id). */
export function cleanChip(c: Chip): Chip {
  return c.why ? { text: c.text.trim(), category: c.category, why: c.why } : { text: c.text.trim(), category: c.category };
}

/** Stagger index for `.insp-seq` children. */
export function seq(i: number): CSSProperties {
  return { ["--i" as string]: Math.min(i, 24) } as CSSProperties;
}

export function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong. Try again.";
}

/** Which gallery category a build most likely belongs to. */
export const CATEGORY_FOR: Record<DeliverableId, GalleryCategoryId> = {
  tshirt: "tshirt",
  hoodie: "streetwear",
  poster: "poster",
  logo: "logo",
  social: "digital-art",
  album: "illustration",
  character: "character",
  product: "product",
  artwork: "digital-art",
  custom: "digital-art",
};

export function useBuild() {
  const { builder, setBuilder } = useInspire();
  const selected = useMemo(() => new Set(builder.chips.map(chipKey)), [builder.chips]);
  const has = useCallback((c: Pick<Chip, "text">) => selected.has(chipKey(c)), [selected]);
  const add = useCallback((chips: Chip[]) => setBuilder((b) => ({ ...b, chips: mergeChips(b.chips, chips.map(cleanChip)) })), [setBuilder]);
  const remove = useCallback((c: Pick<Chip, "text">) => setBuilder((b) => ({ ...b, chips: b.chips.filter((x) => chipKey(x) !== chipKey(c)) })), [setBuilder]);
  const toggle = useCallback(
    (c: Chip) =>
      setBuilder((b) =>
        b.chips.some((x) => chipKey(x) === chipKey(c)) ? { ...b, chips: b.chips.filter((x) => chipKey(x) !== chipKey(c)) } : { ...b, chips: [...b.chips, cleanChip(c)] },
      ),
    [setBuilder],
  );
  return { selected, has, add, remove, toggle };
}

export interface Segment {
  text: string;
  chip?: Chip;
}

const WORD = /[a-z0-9]/i;

/**
 * Split `text` into plain runs and chip runs. Each chip claims its first
 * whole-word occurrence that no longer chip already claimed, so "rim light"
 * inside "soft rim lighting" is left alone and "neon" never lights up "neonate".
 */
export function highlight(text: string, chips: Chip[]): Segment[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const taken: { start: number; end: number; chip: Chip }[] = [];
  const sorted = chips.filter((c) => c.text.trim()).sort((a, b) => b.text.trim().length - a.text.trim().length);
  for (const chip of sorted) {
    const needle = chipKey(chip);
    let from = 0;
    for (;;) {
      const i = lower.indexOf(needle, from);
      if (i < 0) break;
      const end = i + needle.length;
      const bounded = (i === 0 || !WORD.test(lower[i - 1])) && (end >= lower.length || !WORD.test(lower[end]));
      if (bounded && !taken.some((t) => i < t.end && end > t.start)) {
        taken.push({ start: i, end, chip });
        break;
      }
      from = i + 1;
    }
  }
  taken.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let at = 0;
  for (const t of taken) {
    if (t.start > at) out.push({ text: text.slice(at, t.start) });
    out.push({ text: text.slice(t.start, t.end), chip: t.chip });
    at = t.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
