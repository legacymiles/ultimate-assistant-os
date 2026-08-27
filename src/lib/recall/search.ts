// ---------------------------------------------------------------------------
// Recall — hybrid retrieval (local mode).
// Ranks items by keyword/tag relevance and also surfaces matching folders and
// tags, so typing "game" returns the Game Dev folder, the `unity` tag AND the
// most relevant entries. When a Supabase + pgvector backend is added, semantic
// scores merge in here behind the same SearchResult shape.
// ---------------------------------------------------------------------------

import type { Folder, Item, ScoredItem, SearchResult } from "./types";

const FIELD_WEIGHTS = { title: 6, tag: 5, summary: 2, body: 1 } as const;

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/** Score a single item against the query tokens (and the whole phrase). */
function scoreItem(item: Item, tokens: string[], phrase: string): number {
  const title = item.title.toLowerCase();
  const summary = item.summary.toLowerCase();
  const body = item.body.toLowerCase();
  const tags = item.tags.map((t) => t.toLowerCase());
  let score = 0;

  for (const tok of tokens) {
    if (title.includes(tok)) score += FIELD_WEIGHTS.title;
    if (tags.some((t) => t.includes(tok))) score += FIELD_WEIGHTS.tag;
    if (summary.includes(tok)) score += FIELD_WEIGHTS.summary;
    if (body.includes(tok)) score += FIELD_WEIGHTS.body;
  }
  // Whole-phrase bonus for a tighter match.
  if (phrase.length > 2) {
    if (title.includes(phrase)) score += 5;
    if (body.includes(phrase)) score += 2;
  }
  return score;
}

export function search(query: string, data: { items: Item[]; folders: Folder[] }): SearchResult {
  const phrase = query.trim().toLowerCase();
  const tokens = tokenize(query);

  if (tokens.length === 0) {
    // No query — return everything, newest first (folder-browsing view).
    const items: ScoredItem[] = [...data.items]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((item) => ({ item, score: 0 }));
    return { items, folders: [], tags: [] };
  }

  const scored: ScoredItem[] = data.items
    .map((item) => ({ item, score: scoreItem(item, tokens, phrase) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.item.createdAt.localeCompare(a.item.createdAt));

  const folders = data.folders.filter((f) =>
    tokens.some((tok) => f.name.toLowerCase().includes(tok)),
  );

  const tagSet = new Set<string>();
  for (const item of data.items)
    for (const t of item.tags)
      if (tokens.some((tok) => t.toLowerCase().includes(tok))) tagSet.add(t);

  return { items: scored, folders, tags: [...tagSet] };
}

/** Items sharing the most tags with the given one (for "related" and RAG). */
export function relatedItems(item: Item, items: Item[], limit = 5): Item[] {
  const tags = new Set(item.tags.map((t) => t.toLowerCase()));
  if (tags.size === 0) return [];
  return items
    .filter((o) => o.id !== item.id)
    .map((o) => ({
      o,
      shared: o.tags.filter((t) => tags.has(t.toLowerCase())).length,
    }))
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, limit)
    .map((x) => x.o);
}

/** Top candidate items for a question — feeds the agent's retrieval step. */
export function retrieveForQuestion(query: string, data: { items: Item[]; folders: Folder[] }, limit = 6): Item[] {
  const result = search(query, data);
  const hits = result.items.slice(0, limit).map((s) => s.item);
  if (hits.length > 0) return hits;
  // Fall back to most-recent so the agent always has something to reason over.
  return [...data.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
