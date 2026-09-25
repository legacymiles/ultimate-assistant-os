// ---------------------------------------------------------------------------
// The Chat tab's agent conversation, minus React.
//
// Two rules live here because both are easy to get wrong in a component and
// cheap to prove in a test:
//
//   1. What travels. Pictures are heavy and the platform caps a request at
//      4.5 MB, so a conversation with a dozen photos in it cannot send them
//      all. The newest go at full size, older ones as thumbnails, and past a
//      point they stay behind — the model is told nothing about what it did
//      not get, because a caption of an unseen photo is a guess.
//   2. What is kept. A turn saved to the store carries thumbnails only; the
//      full-size copies live for the session in a Map the component owns.
// ---------------------------------------------------------------------------

import type { ChatTurn } from "./types";

/** How many turns of history the agent argues from. */
export const HISTORY_TURNS = 24;
/** Full-size pictures per request — what the model reads properly. */
export const FULL_IMAGES = 4;
/** Pictures per request at any size. Above this, older ones stay behind. */
export const TOTAL_IMAGES = 8;

export interface WireTurn {
  role: "user" | "assistant";
  content: string;
  images: string[];
}

/**
 * The conversation as the agent route receives it.
 *
 * `full` maps a turn id to the full-size copies of its pictures, which only
 * exist in the session that attached them. A reloaded conversation has none, so
 * its turns travel as thumbnails — smaller, still honest.
 */
export function withImageBudget(turns: ChatTurn[], full: Map<string, string[]>): WireTurn[] {
  let fullLeft = FULL_IMAGES;
  let totalLeft = TOTAL_IMAGES;
  const out = [...turns].reverse().map((t): WireTurn => {
    if (t.role !== "you") return { role: "assistant", content: t.text, images: [] };
    const big = full.get(t.id) ?? [];
    const small = t.images ?? [];
    const images: string[] = [];
    for (let i = 0; i < Math.max(big.length, small.length) && totalLeft > 0; i += 1) {
      const pick = fullLeft > 0 && big[i] ? big[i] : small[i];
      if (!pick) continue;
      if (pick === big[i]) fullLeft -= 1;
      totalLeft -= 1;
      images.push(pick);
    }
    return { role: "user", content: t.text, images };
  });
  return out.reverse().slice(-HISTORY_TURNS);
}

/**
 * The agent's own account of a turn, as lines.
 *
 * The loop reports what it ran as sentences ("searched memory for …"); the tab
 * draws them as a list, so a turn that took four steps reads as four steps
 * rather than as one sentence with dots in it.
 */
export function traceLines(did: string[] | undefined): string[] {
  return (did ?? [])
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => d.charAt(0).toUpperCase() + d.slice(1));
}
