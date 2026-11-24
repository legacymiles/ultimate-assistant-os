// ---------------------------------------------------------------------------
// Turning the builder's chips into a prompt someone can read, and the hidden
// technical layer the image model also gets.
//
// The visible prompt keeps the person's own order (they can drag chips), but
// reads as a sentence: the subject chips lead and are joined naturally, the
// rest follow as comma-separated ingredients. Free text the person typed sits
// right after the subject. The technical layer is the deliverable's rules plus
// one line per reference image, and it is never shown in the editable prompt.
// ---------------------------------------------------------------------------

import { deliverableById, type Deliverable } from "./deliverables";
import { groupOf } from "./taxonomy";
import type { Chip, ReferencePurpose } from "./types";

export interface BuilderReference {
  purpose: ReferencePurpose;
  name: string;
}

export interface Assembled {
  /** What the person sees and edits. */
  visible: string;
  /** The rules the deliverable adds, one per line. */
  technical: string[];
  /** What is actually sent to the image model. */
  final: string;
  deliverable: Deliverable;
}

const REF_LINE: Record<ReferencePurpose, string> = {
  style: "match the art style, medium and rendering technique of the style reference image",
  character: "keep the identity, face and proportions of the character reference image",
  clothing: "dress the subject in the garments shown in the clothing reference image",
  composition: "follow the framing and layout of the composition reference image",
  color: "use the colour palette of the colour reference image",
  environment: "place the subject in the setting shown in the environment reference image",
};

/** The visible prompt from chips plus optional free text. */
export function visiblePrompt(chips: Chip[], freeText = ""): string {
  const extra = freeText.replace(/\s+/g, " ").trim();
  const subject = chips.filter((c) => groupOf(c.category).id === "subject").map((c) => c.text);
  const rest = chips.filter((c) => groupOf(c.category).id !== "subject").map((c) => c.text);
  const lead = subject.length > 1 ? `${subject.slice(0, -1).join(", ")} with ${subject[subject.length - 1]}` : subject[0] ?? "";
  const parts = [lead, extra, ...rest].filter(Boolean);
  if (!parts.length) return "";
  const s = parts.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function technicalLayer(deliverableId: string, refs: BuilderReference[] = []): string[] {
  const d = deliverableById(deliverableId);
  const lines = [...d.rules];
  const seen = new Set<ReferencePurpose>();
  for (const r of refs) {
    if (seen.has(r.purpose)) continue;
    seen.add(r.purpose);
    lines.push(REF_LINE[r.purpose]);
  }
  return lines;
}

/**
 * Everything at once. `override` is the person's hand-edited prompt; when set
 * it replaces the chip-built sentence but the technical layer still applies.
 */
export function assemble(opts: {
  chips: Chip[];
  freeText?: string;
  override?: string | null;
  deliverable: string;
  refs?: BuilderReference[];
}): Assembled {
  const deliverable = deliverableById(opts.deliverable);
  const visible = opts.override?.trim() ? opts.override.trim() : visiblePrompt(opts.chips, opts.freeText);
  const technical = technicalLayer(deliverable.id, opts.refs);
  const final = technical.length && visible ? `${visible}.\n\nTechnical requirements: ${technical.join("; ")}.` : visible;
  return { visible, technical, final, deliverable };
}

/** Move one item in a list; used by drag and by the arrow buttons. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, it);
  return next;
}

/** Add chips, skipping ones already present (same words, any case). */
export function mergeChips(current: Chip[], incoming: Chip[]): Chip[] {
  const seen = new Set(current.map((c) => c.text.toLowerCase()));
  const out = [...current];
  for (const c of incoming) {
    const k = c.text.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}
