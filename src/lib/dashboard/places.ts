// ---------------------------------------------------------------------------
// "Put it in my desert cookbook" → the existing "Desserts", not a new one.
//
// When a user names a place — a cookbook, a board section, a photo album — the
// place they mean usually already exists under a slightly different spelling.
// Creating their exact wording would scatter records across near-duplicates
// ("Desserts", "Deserts", "desserts") that each look correct on their own. So a
// named place resolves to an existing one when it is the same place, and only
// becomes a new place when nothing is close.
//
// "Close" is deliberately strict. A false match files something into the WRONG
// existing place, which is worse than a new one: "Brunch" is one letter from
// "Lunch" and is not the same place. So beyond case, punctuation and a plural
// "s", a match must also start with the same letter and differ by very little.
//
// Pure, so the rule that decides where things are stored is tested directly.
// ---------------------------------------------------------------------------

/** Lowercase letters and digits only, with a trailing plural "s" removed. */
export function normalizePlace(name: string): string {
  const t = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t;
}

/** Levenshtein distance: the single-character edits that turn a into b. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The existing place the user means, or null when they mean a new one.
 * Returns the existing name exactly as stored, so records land in it.
 */
export function closestPlace(
  wanted: string | null | undefined,
  known: readonly string[],
): string | null {
  const w = (wanted ?? "").trim();
  if (!w) return null;

  const exact = known.find((k) => k.trim().toLowerCase() === w.toLowerCase());
  if (exact) return exact;

  const nw = normalizePlace(w);
  if (!nw) return null;

  let best: string | null = null;
  let bestDistance = Infinity;
  for (const k of known) {
    const nk = normalizePlace(k);
    if (!nk || nk[0] !== nw[0]) continue;
    const distance = editDistance(nw, nk);
    const limit = Math.min(2, Math.floor(Math.max(nw.length, nk.length) * 0.3));
    if (distance <= limit && distance < bestDistance) {
      best = k;
      bestDistance = distance;
    }
  }
  return best;
}
