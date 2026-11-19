// ---------------------------------------------------------------------------
// AI Rankings — where new models come from, and what each source can see.
//
// The board had one pair of eyes: Hugging Face trending. That is the best feed
// in the world for open weights and completely blind to everything else — Veo,
// Kling, Seedance, GPT, Gemini and every other hosted model has no HF repo to
// trend, so the daily check could never find one. A board that silently cannot
// see half its own field is worse than one that says so.
//
// So discovery runs from two feeds, and this file is also the published list:
// the app renders SOURCES on the page and in the inbox, with what each one
// covers, how often it is read and a link to check it by hand. A category with
// no automatic feed says that out loud rather than looking merely quiet.
// ---------------------------------------------------------------------------

import { AA_BOARDS } from "./scores";
import { CATEGORIES, findExisting } from "./leaderboard";
import type { InboxItem, PublicBoard } from "./leaderboard";
import type { AaEntry } from "./scores";
import type { AaLlmEntry } from "./metrics";

export type SourceKind = "releases" | "scores" | "measurements";

export interface Source {
  id: string;
  /** What it is called, as the page shows it. */
  name: string;
  /** What this board uses it for, in one line. */
  what: string;
  /** What it can and cannot see — the honest half. */
  covers: string;
  kind: SourceKind;
  /** How often the daily job reads it. */
  cadence: string;
  url: string;
}

/**
 * Every feed behind the board, in the order they matter to a reader.
 *
 * Kept here rather than in the page so the list cannot drift from the code
 * that actually does the reading: each entry names a real call made by
 * /api/ai-rankings/sweep.
 */
export const SOURCES: Source[] = [
  {
    id: "hf",
    name: "Hugging Face trending",
    what: "Finds new open-weight releases and files them in the inbox",
    covers: "Open weights only — a hosted model has no repo to trend",
    kind: "releases",
    cadence: "Every day",
    url: "https://huggingface.co/models?sort=trending",
  },
  {
    id: "aa-releases",
    name: "Artificial Analysis boards",
    what: "Finds models that appear on an arena but not on this board",
    covers: "Hosted and closed models the trending feed cannot see",
    kind: "releases",
    cadence: "Every day",
    url: "https://artificialanalysis.ai",
  },
  {
    id: "aa-scores",
    name: "Artificial Analysis arenas",
    what: "Re-reads the arena score each of six categories ranks on",
    covers: "Speech, image, image editing, both video arenas and music",
    kind: "scores",
    cadence: "Every day, each board at most once in 20 hours",
    url: "https://artificialanalysis.ai/leaderboards",
  },
  {
    id: "aa-metrics",
    name: "Artificial Analysis model data",
    what: "Re-reads measured prices, throughput and context windows",
    covers: "Language models; a measurement typed in by hand is never overwritten",
    kind: "measurements",
    cadence: "Every day",
    url: "https://artificialanalysis.ai/models",
  },
  {
    id: "lmarena",
    name: "LMArena",
    what: "The Elo the LLM category ranks on",
    covers: "Read by hand — LMArena has no free API this board can call",
    kind: "scores",
    cadence: "By hand",
    url: "https://lmarena.ai/leaderboard",
  },
  {
    id: "owner",
    name: "Paste a link",
    what: "Any model, read off its own page and filled in for you",
    covers: "Everything — the way anything with no feed gets on the board",
    kind: "releases",
    cadence: "Whenever you paste one",
    url: "",
  },
];

/** The categories no automatic feed covers, so the page can say which. */
export function categoriesWithoutFeed(): string[] {
  const covered = new Set(AA_BOARDS.map((b) => b.category));
  return CATEGORIES.filter((c) => c.hfPipelines.length === 0 && !covered.has(c.id)).map((c) => c.label);
}

// ----- discovery from the arenas --------------------------------------------

/** Where an Artificial Analysis entry can be seen. */
export const AA_MODEL_PAGE = "https://artificialanalysis.ai/models";

/** A model name reduced to what two feeds would have to agree on. */
export function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Arena entries that are not on the board yet, as inbox suggestions.
 *
 * The entries are already in hand — the score refresh fetched them — so this
 * costs no extra call. Everything it finds is a suggestion the owner approves
 * or dismisses, exactly like a trending repo, and nothing about it is
 * assumed: an arena entry says a model exists and nothing about whether its
 * weights are open, so an approved one starts as hosted and paid for the
 * owner to correct.
 */
export function discoveriesFrom(
  entries: { name: string; maker: string; slug?: string }[],
  categoryId: string,
  url: string,
  board: PublicBoard,
  now: number,
  seen: Set<string>,
): InboxItem[] {
  const dismissed = new Set(board.dismissed.map((d) => d.toLowerCase()));
  const inInbox = new Set(board.inbox.map((i) => i.hfId.toLowerCase()));
  const out: InboxItem[] = [];

  for (const e of entries) {
    const name = e.name.trim();
    if (!name) continue;
    // No HF repo to key on, so the key is the arena's own slug.
    const key = `aa:${(e.slug || name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    // `seen` carries both keys and name keys, so the same model found by the
    // trending feed and by an arena in one run is suggested once.
    const nk = nameKey(name);
    if (seen.has(key) || seen.has(nk) || dismissed.has(key) || inInbox.has(key)) continue;
    if (findExisting(board.models, { name })) continue;

    seen.add(key);
    seen.add(nk);
    out.push({
      id: key,
      hfId: key,
      name,
      maker: e.maker.trim(),
      category: categoryId,
      url: e.slug ? `${AA_MODEL_PAGE}/${e.slug}` : url,
      // An arena says nothing about when a model shipped; the free tier does
      // not carry a release date, so this one is honestly unknown.
      releasedAt: "",
      likes: 0,
      downloads: 0,
      pipeline: "arena",
      source: "aa",
      foundAt: new Date(now).toISOString(),
    });
  }
  return out;
}

/** An arena board's entries in the shape discoveriesFrom wants. */
export function fromAaEntries(entries: AaEntry[]): { name: string; maker: string; slug?: string }[] {
  return entries
    .map((e) => ({ name: (e.name ?? e.slug ?? "").trim(), maker: (e.model_creator?.name ?? "").trim(), slug: e.slug }))
    .filter((e) => e.name);
}

/** The LLM data endpoint's entries in the same shape. */
export function fromAaLlmEntries(entries: AaLlmEntry[]): { name: string; maker: string; slug?: string }[] {
  return entries
    .map((e) => ({ name: (e.name ?? e.slug ?? "").trim(), maker: (e.model_creator?.name ?? "").trim(), slug: e.slug }))
    .filter((e) => e.name);
}

/** How many of a category's top entries are worth suggesting. */
export const ARENA_DISCOVER_TOP = 25;
