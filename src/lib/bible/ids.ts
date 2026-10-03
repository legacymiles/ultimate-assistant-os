// ---------------------------------------------------------------------------
// Ids, in one place.
//
// A counter rides along with the clock because a single generation mints dozens
// of ids inside one millisecond, and two steps sharing an id is a bug whose
// symptom is an edit landing on the wrong step — the hardest kind to see.
// ---------------------------------------------------------------------------

let counter = 0;

export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
