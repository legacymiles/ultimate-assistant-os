// ---------------------------------------------------------------------------
// Name normalisation, shared by the server picker and the client merge.
//
// Dance names arrive from three places that disagree about punctuation and
// case: the editorial seed ("APT."), a model ("apt"), and a video title
// ("APT Dance"). Comparing them raw lets the same dance in twice.
// ---------------------------------------------------------------------------

/** Lowercase, unaccented, punctuation-free, single-spaced. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Is this dance already in the vault?
 *
 * Substring containment either way, not equality: "APT" vs "APT Dance" and
 * "Espresso" vs "Espresso Challenge" are the same dance, and a picker that
 * only rejects exact matches will happily add both.
 */
export function isKnownName(candidate: string, known: Iterable<string>): boolean {
  const c = normalizeName(candidate);
  if (!c) return true; // An empty name is never a usable pick.
  for (const k of known) {
    const n = normalizeName(k);
    if (!n) continue;
    if (n === c || n.includes(c) || c.includes(n)) return true;
  }
  return false;
}
