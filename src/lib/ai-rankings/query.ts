// ---------------------------------------------------------------------------
// The Board — pure filtering, sorting and counting.
//
// No persistence here on purpose: everything is a plain function of the tools
// array, so the table can be reasoned about (and tested) without a browser.
//
// Note there is no wall of filter chips. The facts live in table columns you
// sort by, and the narrowing people actually repeat — "what's open source",
// "what needs a key I don't have" — is a named view in the sidebar instead.
// ---------------------------------------------------------------------------

import { CONTENT_LABEL, isAdult, ratingOf } from "./types";
import type { Tool } from "./types";

export type SortBy = "rank" | "name" | "newest" | "oldest" | "category" | "access";
export type SortDir = "asc" | "desc";

/**
 * The NSFW filter.
 *
 * Deliberately NOT one of the `Filters` below, for two reasons. It is applied
 * before everything else — to the pool the sections, the counts, the feature
 * index and the search all run against — so that with it on, an adult record
 * cannot surface through a sidebar count or a stray search word. And "reset
 * filters" must not silently switch it off: a filter you turned on for privacy
 * should only ever come off deliberately.
 *
 *   all    every record
 *   safe   hide anything rated suggestive or uncensored (unrated stays)
 *   nsfw   only those, for when the adult board IS the thing you're working on
 */
export type ContentFilter = "all" | "safe" | "nsfw";

export const CONTENT_FILTERS: { id: ContentFilter; label: string; title: string }[] = [
  { id: "all", label: "All", title: "Every record" },
  { id: "safe", label: "Safe", title: "Hide anything rated suggestive or uncensored" },
  { id: "nsfw", label: "18+", title: "Only records rated suggestive or uncensored" },
];

/** Narrow the pool before any other filtering, sorting or counting happens. */
export function applyContentFilter(tools: Tool[], mode: ContentFilter): Tool[] {
  if (mode === "all") return tools;
  const wantAdult = mode === "nsfw";
  return tools.filter((t) => isAdult(t) === wantAdult);
}

export const VIEWS = [
  { id: "all", label: "All records" },
  { id: "ranked", label: "Ranked" },
  { id: "unranked", label: "Unranked" },
  { id: "open", label: "Open source" },
  { id: "free", label: "Free" },
  { id: "selfhost", label: "Self-hostable" },
  { id: "needskey", label: "Needs a key" },
  { id: "havekey", label: "Key in hand" },
  { id: "loved", label: "Has a love note" },
] as const;

export type ViewId = (typeof VIEWS)[number]["id"];

/**
 * When a record was added to the board.
 *
 * A range rather than a view, because it has to hold at the same time as
 * everything else: "the video models I added this month", "what came in this
 * week that I rated 18+". A single-select view could never answer those.
 */
export type AddedPreset = "any" | "7d" | "30d" | "90d" | "365d" | "custom";

export const ADDED_PRESETS: { id: AddedPreset; label: string; title: string }[] = [
  { id: "any", label: "Any time", title: "No date filter" },
  { id: "7d", label: "7 days", title: "Added in the last 7 days" },
  { id: "30d", label: "30 days", title: "Added in the last 30 days" },
  { id: "90d", label: "3 months", title: "Added in the last 3 months" },
  { id: "365d", label: "1 year", title: "Added in the last year" },
  { id: "custom", label: "Between…", title: "Added between two dates you pick" },
];

export interface AddedRange {
  preset: AddedPreset;
  /** yyyy-mm-dd, inclusive. Only read when the preset is "custom". */
  from: string;
  to: string;
}

export const ANY_TIME: AddedRange = { preset: "any", from: "", to: "" };

const PRESET_DAYS: Record<Exclude<AddedPreset, "any" | "custom">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

/** How the header strip says which window is in force. */
export function addedLabel(range: AddedRange): string | null {
  if (range.preset === "any") return null;
  if (range.preset !== "custom") {
    return `added in the last ${ADDED_PRESETS.find((p) => p.id === range.preset)?.label}`;
  }
  if (range.from && range.to) return `added ${range.from} → ${range.to}`;
  if (range.from) return `added since ${range.from}`;
  if (range.to) return `added up to ${range.to}`;
  // "Between…" with neither end filled in is not yet a filter.
  return null;
}

export interface Filters {
  query: string;
  view: ViewId;
  /** null = every group. */
  group: string | null;
  /** Only meaningful with a group set. */
  category: string | null;
  /** AND across tags — every selected tag must be present. */
  tags: string[];
  /**
   * One feature, matched case-insensitively against feature text.
   *
   * This is the axis the board is really organised by: "first-last frame",
   * "extend", "cinematic" are not categories a tool belongs to, they are things
   * a tool does — and the question is always "which of these do it".
   */
  feature: string | null;
  /** When it was added. `ANY_TIME` is off. */
  added: AddedRange;
}

export const EMPTY_FILTERS: Filters = {
  query: "",
  view: "all",
  group: null,
  category: null,
  tags: [],
  feature: null,
  added: ANY_TIME,
};

/** Features are compared loosely so "First-Last Frame" and "first last frame" meet. */
export function featureKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchesView(tool: Tool, view: ViewId): boolean {
  switch (view) {
    case "all":
      return true;
    case "ranked":
      return tool.rank !== undefined;
    case "unranked":
      return tool.rank === undefined;
    case "open":
      return tool.openSource;
    case "free":
      return tool.access !== "paid";
    case "selfhost":
      return tool.hosting !== "hosted";
    case "needskey":
      return tool.apiKey === "required" && !tool.haveKey;
    case "havekey":
      return tool.haveKey;
    case "loved":
      return tool.features.some((f) => f.verdict === "love");
  }
}

/**
 * Custom ends are parsed as local midnight and local end-of-day, not UTC.
 * A date you typed means that date where you are — parsing "2026-09-06" as UTC
 * drops everything you added that evening out of a range that names the day.
 */
function dayStart(date: string): number {
  return new Date(`${date}T00:00:00`).getTime();
}

function dayEnd(date: string): number {
  return new Date(`${date}T23:59:59.999`).getTime();
}

function matchesAdded(tool: Tool, range: AddedRange, now: number): boolean {
  if (range.preset === "any") return true;

  const added = new Date(tool.addedAt).getTime();
  if (Number.isNaN(added)) return false;

  if (range.preset === "custom") {
    // Either end may be blank, so one field answers "everything since March"
    // without making the user invent a closing date.
    const from = range.from ? dayStart(range.from) : NaN;
    const to = range.to ? dayEnd(range.to) : NaN;
    if (!Number.isNaN(from) && added < from) return false;
    if (!Number.isNaN(to) && added > to) return false;
    return true;
  }

  return now - added < PRESET_DAYS[range.preset] * 24 * 60 * 60 * 1000;
}

function matchesQuery(tool: Tool, q: string): boolean {
  if (!q) return true;
  const haystack = [
    tool.name,
    tool.summary,
    tool.notes ?? "",
    tool.pricingNote ?? "",
    tool.group,
    tool.category,
    tool.url,
    // Rated records answer to their label, so "uncensored" narrows by typing
    // as well as by clicking. Unrated ones contribute nothing.
    ratingOf(tool) === "unknown" ? "" : CONTENT_LABEL[ratingOf(tool)],
    ...tool.tags,
    ...tool.features.map((f) => f.text),
  ]
    .join(" ")
    .toLowerCase();
  // Every word must appear somewhere, so "open video" narrows rather than widens.
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function filterTools(tools: Tool[], f: Filters, now = Date.now()): Tool[] {
  const q = f.query.trim();
  return tools.filter((t) => {
    if (f.group && t.group !== f.group) return false;
    if (f.category && t.category !== f.category) return false;
    if (!matchesView(t, f.view)) return false;
    if (!matchesAdded(t, f.added, now)) return false;
    if (f.tags.length > 0 && !f.tags.every((tag) => t.tags.includes(tag))) return false;
    if (f.feature) {
      const want = featureKey(f.feature);
      if (!t.features.some((x) => featureKey(x.text) === want)) return false;
    }
    return matchesQuery(t, q);
  });
}

const ACCESS_ORDER = { free: 0, freemium: 1, paid: 2 } as const;

export function sortTools(tools: Tool[], by: SortBy, dir: SortDir): Tool[] {
  const sign = dir === "asc" ? 1 : -1;
  return tools.slice().sort((a, b) => {
    let d = 0;
    switch (by) {
      case "rank": {
        // Unranked sinks below every ranked one in BOTH directions — flipping
        // the sort should reorder the leaderboard, not float the unranked pool
        // to the top.
        const ar = a.rank ?? Number.POSITIVE_INFINITY;
        const br = b.rank ?? Number.POSITIVE_INFINITY;
        if (ar === br) break;
        if (!Number.isFinite(ar) || !Number.isFinite(br)) return ar - br;
        d = ar - br;
        break;
      }
      case "name":
        d = a.name.localeCompare(b.name);
        break;
      case "newest":
        d = b.addedAt.localeCompare(a.addedAt);
        break;
      case "oldest":
        d = a.addedAt.localeCompare(b.addedAt);
        break;
      case "category":
        d = `${a.group} ${a.category}`.localeCompare(`${b.group} ${b.category}`);
        break;
      case "access":
        d = ACCESS_ORDER[a.access] - ACCESS_ORDER[b.access];
        break;
    }
    return (d || a.name.localeCompare(b.name)) * sign;
  });
}

/** Every tag in use, most-used first, then A–Z. */
export function allTags(tools: Tool[]): string[] {
  const counts = new Map<string, number>();
  for (const t of tools) for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.keys()].sort((a, b) => {
    const d = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
    return d !== 0 ? d : a.localeCompare(b);
  });
}

/**
 * Every feature written anywhere on the board, most-used first.
 *
 * Keyed loosely but labelled with the first spelling seen, so the index stays
 * one row per idea instead of splitting on capitalisation — and so the record
 * panel can offer the existing wording before a fifth variant gets typed.
 */
export function featureIndex(tools: Tool[]): { label: string; count: number }[] {
  const seen = new Map<string, { label: string; count: number }>();
  for (const t of tools) {
    // A tool listing the same feature twice must not count twice.
    const once = new Set<string>();
    for (const f of t.features) {
      const key = featureKey(f.text);
      if (!key || once.has(key)) continue;
      once.add(key);
      const hit = seen.get(key);
      if (hit) hit.count += 1;
      else seen.set(key, { label: f.text, count: 1 });
    }
  }
  return [...seen.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
}

export function countsByGroup(tools: Tool[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of tools) counts[t.group] = (counts[t.group] ?? 0) + 1;
  return counts;
}

export function countsByCategory(tools: Tool[], group: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of tools) if (t.group === group) counts[t.category] = (counts[t.category] ?? 0) + 1;
  return counts;
}
