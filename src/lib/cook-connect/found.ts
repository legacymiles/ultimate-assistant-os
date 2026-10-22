// ---------------------------------------------------------------------------
// One video, several recipes — and the tray where the cook keeps or skips them.
//
// "3 dinners under $10", "a whole Sunday spread", a cookbook page with two
// recipes on it: one source, several dishes. The reader used to squeeze those
// into a single recipe, which made all of them wrong. Now it hands back one
// recipe per dish, and nothing is saved until the cook says so — each one is
// accepted, rejected or opened and edited on its own.
//
// Pure — no fetch, no DOM — so the route, the view and the tests share it.
// ---------------------------------------------------------------------------

/** Most recipes one source can turn into. Past this it is a cookbook, not a post. */
export const MAX_RECIPES_PER_SOURCE = 8;

/**
 * The raw recipe objects in a model's answer, however it chose to shape it.
 *
 * Asked for `{ recipes: [...] }`, a model still sometimes answers with one bare
 * recipe (the shape it has seen most), or wraps a single one in the list. All
 * three mean the same thing, so all three are accepted.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function recipeEntries(data: any): any[] {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.recipes)) {
    return data.recipes.filter((r: unknown) => r && typeof r === "object").slice(0, MAX_RECIPES_PER_SOURCE);
  }
  if (data.title || Array.isArray(data.ingredients)) return [data];
  return [];
}

/** Lowercased, punctuation-free title — "Garlic Butter Steak!" and "garlic butter steak" are one dish. */
export function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The same dish named twice is one recipe; the first (fuller) reading wins. */
export function dedupeByTitle<T>(list: T[], titleOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  return list.filter((r) => {
    const k = titleKey(titleOf(r));
    if (!k || seen.has(k)) return !k; // keep untitled ones; the cook can still reject them
    seen.add(k);
    return true;
  });
}

/* ── The review tray ───────────────────────────────────────────── */

export type FoundStatus = "pending" | "accepted" | "rejected";

export interface FoundItem {
  id: string;
  /** Which read produced it, so the row can say "from that TikTok link". */
  jobId: string;
  status: FoundStatus;
  /** Set once it is in the cookbook, so "Undo" can take it back out. */
  savedId?: string;
}

export interface TrayCounts {
  pending: number;
  accepted: number;
  rejected: number;
  total: number;
}

export function trayCounts(items: { status: FoundStatus }[]): TrayCounts {
  const c = { pending: 0, accepted: 0, rejected: 0, total: items.length };
  for (const i of items) c[i.status]++;
  return c;
}

/**
 * The order rows are shown in: what still needs a decision first, then what
 * was kept, then what was skipped — so the next decision is always at the top.
 * Stable within each group, so rows don't jump while the cook is deciding.
 */
export function trayOrder<T extends { status: FoundStatus }>(items: T[]): T[] {
  const rank: Record<FoundStatus, number> = { pending: 0, accepted: 1, rejected: 2 };
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank[a.item.status] - rank[b.item.status] || a.i - b.i)
    .map((x) => x.item);
}

/** The line over the tray. Plain words, and it says what is left to do. */
export function traySummary(c: TrayCounts, reading: number): string {
  if (!c.total) return reading ? "Reading…" : "";
  const found = `${c.total} recipe${c.total === 1 ? "" : "s"} found`;
  const still = reading ? ` so far — still reading ${reading}` : "";
  const parts: string[] = [];
  if (c.accepted) parts.push(`${c.accepted} in the book`);
  if (c.rejected) parts.push(`${c.rejected} skipped`);
  if (c.pending) parts.push(`${c.pending} to decide`);
  return `${found}${still}. ${parts.join(", ")}.`;
}

/** Status of one read in a bulk run. */
export type JobStatus = "queued" | "reading" | "done" | "failed";

/** Reads run two at a time: faster than one, gentler on the provider than all at once. */
export const READ_CONCURRENCY = 2;

/** The line on a read's row: what happened, in a few words. */
export function jobLine(status: JobStatus, found: number, error?: string): string {
  if (status === "queued") return "Waiting its turn";
  if (status === "reading") return "Reading…";
  if (status === "failed") return error || "Couldn't read this one.";
  return found === 0 ? "No recipe in it" : found === 1 ? "1 recipe" : `${found} recipes`;
}
