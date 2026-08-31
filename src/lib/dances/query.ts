// ---------------------------------------------------------------------------
// Search, sort and tag helpers for the wall.
//
// Pure functions over a Dance[] — no storage, no React. The wall re-derives
// its rows from these on every filter change, so they must stay cheap.
// ---------------------------------------------------------------------------

import type { Dance } from "./types";

export type SortBy = "score" | "added" | "year" | "unrated" | "name";

export const SORTS: { value: SortBy; label: string }[] = [
  { value: "score", label: "Top rated" },
  { value: "added", label: "Newest added" },
  { value: "year", label: "Newest dance" },
  { value: "unrated", label: "Unrated first" },
  { value: "name", label: "A–Z" },
];

/** Everything a dance can be found by, lowercased once per call. */
function haystack(d: Dance): string {
  return [d.name, ...(d.aka ?? []), d.song, d.artist, d.creator, ...(d.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function searchDances(dances: Dance[], q: string): Dance[] {
  const term = q.trim().toLowerCase();
  if (!term) return dances;
  // Every word must appear somewhere, so "renegade 2019" narrows rather than
  // widening the way an OR match would.
  const words = term.split(/\s+/);
  return dances.filter((d) => {
    const hay = haystack(d);
    return words.every((w) => hay.includes(w));
  });
}

export function filterByTags(dances: Dance[], tags: string[]): Dance[] {
  if (!tags.length) return dances;
  return dances.filter((d) => tags.every((t) => d.tags?.includes(t)));
}

export function sortDances(dances: Dance[], by: SortBy): Dance[] {
  const out = [...dances];
  switch (by) {
    case "score":
      // Unrated sink below every rated dance rather than sorting as zero.
      return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    case "unrated":
      return out.sort((a, b) => (a.score === undefined ? 0 : 1) - (b.score === undefined ? 0 : 1));
    case "year":
      return out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    case "name":
      return out.sort((a, b) => a.name.localeCompare(b.name));
    case "added":
    default:
      return out.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }
}

/** Tags in descending frequency — the useful ones surface first. */
export function allTags(dances: Dance[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const d of dances) for (const t of d.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Deal dances into `rows` tracks, round-robin.
 *
 * Round-robin rather than chunking on purpose: chunking puts the whole top of
 * a sorted list in row 1, so sorting by score would stack every good dance in
 * one band and leave the bottom rows as filler. Dealing spreads the sort order
 * across all rows, and each row stays a mix.
 */
export function dealRows<T>(items: T[], rows: number): T[][] {
  const out: T[][] = Array.from({ length: rows }, () => []);
  items.forEach((item, i) => out[i % rows].push(item));
  return out.filter((r) => r.length > 0);
}
