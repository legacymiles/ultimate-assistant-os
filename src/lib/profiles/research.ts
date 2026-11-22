// ---------------------------------------------------------------------------
// When the Profiles chat should look something UP rather than look it up.
//
// The chat was built as a librarian over the owner's own web of profiles: it
// answers "what's my son's teacher's email" from the outline and refuses to
// invent anything. That is right for facts about the owner's life, and useless
// the moment they ask "how do I set the white ink limit on my printer" — a
// question whose answer was never going to be in their own notes.
//
// So questions split in two:
//
//   LOOKUP    "where is / what's my / when did I"  → the outline, as before
//   RESEARCH  "how do I / why won't it / what should I set"  → the web, cited
//
// A research answer is only as good as the machine it is anchored to, which is
// why `gapsFor` exists: a profile holding nothing but a shop listing name
// cannot produce a correct answer about software or supplies, and the honest
// move is to name the two or three missing facts first rather than guess. That
// is the difference between an assistant and an autocomplete.
//
// Pure: no I/O, no React, so the prompt builder, the API route and the tests
// all share one definition of "is this a research question".
// ---------------------------------------------------------------------------

import { childrenOf } from "./tree";
import type { ProfileNode, ProfilesData } from "./types";

/** Asking about the owner's own records — answer from the outline. */
const LOOKUP =
  /^\s*(what(?:'s| is| are)? (?:my|our|his|her|their|the)\b|where(?:'s| is| are)?\b|when did (?:i|we)\b|who(?:'s| is)? (?:my|our|his|her|their)\b|show me\b|list\b|do i have\b|how many\b)/i;

/** Asking how something works, or why it is broken — the web can answer this. */
const RESEARCH =
  /\b(how (?:do|does|can|would|should) (?:i|we|you|it)|how to\b|what (?:setting|settings|temperature|temp|time|speed|profile|psi|dpi)|which (?:setting|software|ink|film|powder|blade|filament|driver)|why (?:is|isn't|won't|does|doesn't|do|did)|not working|won['’]?t\b|stopped working|keeps? (?:clogging|jamming|failing|smudging)|trouble ?shoot|fix|repair|calibrat|install|set ?up|configure|clean(?:ing)?|maintain|maintenance|replace|recommend|best (?:way|setting|practice)|compatible|supported|error|clog|jam|tutorial|guide|manual|step by step|walk me through|teach me|explain how)\b/i;

/**
 * Should this message be researched on the web?
 *
 * A plain record lookup wins even if it also contains a research word, because
 * "where is my printer's manual" is a question about their own notes first.
 */
export function needsResearch(message: string): boolean {
  const m = String(message ?? "").trim();
  if (!m) return false;
  if (LOOKUP.test(m)) return false;
  return RESEARCH.test(m);
}

/** The facts that make an answer about a machine correct rather than plausible. */
export const EQUIPMENT_FACTS = [
  { key: "model", label: "the model and serial on the machine's own plate", re: /\b(model|serial|s\/n|part ?number)\b/i },
  { key: "software", label: "the software that runs it, with its version", re: /\b(software|rip|driver|firmware|app|program|slicer)\b/i },
  { key: "supplies", label: "the ink, film, powder, blade, filament or thread brand it uses", re: /\b(ink|film|powder|blade|filament|thread|toner|paper|resin|consumable|supplies|media)\b/i },
  { key: "computer", label: "the computer and operating system it runs on", re: /\b(computer|laptop|desktop|pc|mac|windows|macos|os)\b/i },
] as const;

/** Every label=value row on a node, flattened, for matching against the facts above. */
function rowKeys(node: ProfileNode): string[] {
  return node.sections.flatMap((s) => s.items.map((i) => `${s.title} ${i.k}`));
}

/**
 * Which of the facts above this profile is missing.
 *
 * Returned in EQUIPMENT_FACTS order, most useful first, so a caller can ask
 * for the top one or two rather than reciting a form at the owner.
 */
export function gapsFor(node: ProfileNode | undefined): string[] {
  if (!node) return [];
  const keys = rowKeys(node);
  return EQUIPMENT_FACTS.filter((f) => !keys.some((k) => f.re.test(k))).map((f) => f.label);
}

/** Does this profile look like a machine — something with a model and settings? */
export function isEquipment(node: ProfileNode | undefined): boolean {
  if (!node || node.kind !== "thing") return false;
  if (/^equipment$/i.test(node.label)) return true;
  const hay = `${node.name} ${node.sub ?? ""} ${rowKeys(node).join(" ")}`;
  return /\b(model|serial|printer|press|machine|laser|cutter|plotter|cnc|shaker|firmware|rip)\b/i.test(hay);
}

/**
 * The machine a question is about: the profile being viewed, or the nearest
 * equipment profile inside it (a business with one printer needs no pointing).
 */
export function subjectOf(data: ProfilesData, here: string): ProfileNode | undefined {
  const at = data.nodes[here];
  if (!at) return undefined;
  if (isEquipment(at)) return at;
  const inside = childrenOf(data, at.id).filter((n) => !n.hidden && isEquipment(n));
  return inside.length === 1 ? inside[0] : undefined;
}

/**
 * A search query anchored to the real machine.
 *
 * The model row matters more than the profile's name: the owner may have
 * called it "the printer", and "the printer won't print white" finds nothing.
 */
export function researchQuery(message: string, node?: ProfileNode): string {
  const words = String(message ?? "")
    .replace(/\b(my|our|the|a|an|please|can you|could you|i|we)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!node) return words.slice(0, 200);
  const model = node.sections
    .flatMap((s) => s.items)
    .find((i) => !i.noAi && /\b(model|serial|part ?number)\b/i.test(i.k))?.v;
  const anchor = (model && model.length > 3 ? model : node.name).replace(/\s+/g, " ").trim();
  // Don't repeat the anchor if the owner already typed the model.
  const already = anchor && words.toLowerCase().includes(anchor.toLowerCase().slice(0, 12));
  return `${already ? "" : `${anchor} `}${words}`.trim().slice(0, 200);
}

export interface WebNote {
  title: string;
  url: string;
  snippet: string;
}

/** What the web turned up, as it goes into a brain's prompt. */
export function researchBlock(query: string, hits: WebNote[], pages: { url: string; text: string }[] = []): string {
  if (!hits.length && !pages.length) {
    return `FROM THE WEB\nNothing came back for "${query}". Say you couldn't find it rather than guessing.`;
  }
  const lines = [`FROM THE WEB (searched "${query}")`];
  hits.slice(0, 8).forEach((h, i) => {
    lines.push(`[${i + 1}] ${h.title} — ${h.url}`);
    if (h.snippet) lines.push(`    ${h.snippet.slice(0, 300)}`);
  });
  for (const p of pages.slice(0, 3)) {
    lines.push(`PAGE ${p.url}`, p.text.slice(0, 6_000));
  }
  return lines.join("\n");
}
