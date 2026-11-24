// Phonon returns whole audio files, so a two-sentence reply costs twice the
// latency budget in one call. Split it and speak the first piece while the
// rest is still being synthesized.

/** Pieces shorter than this are not worth their own round-trip. */
export const MIN_PIECE = 12;

export function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Split after . ! ? (and runs like "?!") when followed by whitespace and a
  // non-digit — so "3.50" stays whole.
  const raw = trimmed
    .split(/(?<=[.!?]+)\s+(?=\D)/u)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const piece of raw) {
    if (out.length && piece.length < MIN_PIECE) out[out.length - 1] += ` ${piece}`;
    else out.push(piece);
  }
  return out;
}
