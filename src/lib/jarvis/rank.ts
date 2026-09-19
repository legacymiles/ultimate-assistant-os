// ---------------------------------------------------------------------------
// Ranking for Jarvis's memory.
//
// Two searches run over the same memories — one by meaning (embeddings, Stage
// 2) and one by words — and their orders have to be merged. Scores from the
// two are not comparable (a cosine distance and a ts_rank are different
// animals), so the merge uses ranks only: reciprocal rank fusion.
//
// Everything here is pure so it can be tested without Supabase or a key, and
// so the same fusion runs client-side in local mode and server-side in hybrid
// mode.
// ---------------------------------------------------------------------------

/** How strongly the top of a list dominates. 60 is the value from the RRF paper. */
export const RRF_K = 60;

/**
 * Merge ranked id lists into one. An item near the top of a single list can
 * beat an item that is merely middling in both — which is the point: a memory
 * that is an exact word match but semantically distant still deserves to be
 * seen.
 */
export function rrf(lists: string[][], k = RRF_K): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "is", "it", "for", "on", "my", "me", "i",
  "what", "was", "were", "do", "did", "does", "you", "your", "that", "this", "with", "at", "be",
]);

/** Words worth matching on: lowercased, de-punctuated, stop-words dropped. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/**
 * Word-overlap score for one memory. The title counts double because a memory
 * called "Jack's favourite animal" should win the query "favourite animal"
 * against a long note that merely mentions animals.
 */
export function keywordScore(query: string, m: { title: string; content: string; tags?: string[] }): number {
  const q = tokens(query);
  if (!q.length) return 0;
  const title = new Set(tokens(m.title));
  const body = new Set([...tokens(m.content), ...(m.tags ?? []).flatMap(tokens)]);
  let hits = 0;
  for (const w of q) {
    if (title.has(w)) hits += 2;
    else if (body.has(w)) hits += 1;
  }
  return hits / (q.length * 2);
}

/** Recency as a 0–1 multiplier with a ~90-day half-life. Older still ranks. */
export function recency(capturedAt: string, now = Date.now()): number {
  const t = Date.parse(capturedAt);
  if (!Number.isFinite(t)) return 0.5;
  const days = Math.max(0, (now - t) / 86_400_000);
  return Math.pow(0.5, days / 90);
}
