// Two guards, both pure functions of time: do not answer the same question
// twice, and do not speak more than a set number of times a minute.

/** Five minutes: long enough that chat has moved on. */
export const DEDUPE_WINDOW_MS = 5 * 60_000;
/** Default cap. Above roughly this the character sounds frantic. */
export const MAX_PER_MINUTE = 8;

/**
 * "Near-identical" means: same words in the same order, ignoring case,
 * punctuation and runs of whitespace. Deliberately strict — a looser rule
 * silently swallows genuinely different questions.
 */
export function questionKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export class Dedupe {
  private seen = new Map<string, number>();

  isRepeat(text: string, now: number): boolean {
    const key = questionKey(text);
    if (!key) return false;
    const at = this.seen.get(key);
    return at !== undefined && now - at < DEDUPE_WINDOW_MS;
  }

  remember(text: string, now: number): void {
    const key = questionKey(text);
    if (!key) return;
    this.seen.set(key, now);
    for (const [k, at] of this.seen) {
      if (now - at >= DEDUPE_WINDOW_MS) this.seen.delete(k);
    }
  }
}

export class RateLimit {
  private spoke: number[] = [];

  constructor(public maxPerMinute: number = MAX_PER_MINUTE) {}

  allowed(now: number): boolean {
    this.trim(now);
    return this.spoke.length < this.maxPerMinute;
  }

  record(now: number): void {
    this.trim(now);
    this.spoke.push(now);
  }

  private trim(now: number): void {
    this.spoke = this.spoke.filter((t) => now - t < 60_000);
  }
}
