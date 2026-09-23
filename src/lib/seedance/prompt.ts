// ---------------------------------------------------------------------------
// One block → one Seedance prompt.
//
// A video model reads description, not settings, so nothing here ships a label:
// every rail contributes the sentence a cinematographer would have written. The
// order below is the order cinema.ts asks for — style first, because the style
// decides what the world is made of, then the shot, then the camera, then the
// glass, then the light, then the grade.
// ---------------------------------------------------------------------------

import {
  CINEMA_GROUPS,
  MOVE_PATTERN,
  movesIn,
  optionById,
  type CinemaSelection,
} from "@/lib/studio/cinema";
import type { Reel, VideoPrompt } from "./types";

/** A block's own rails win; the reel's deck fills in everything it left alone. */
export function mergedCinema(reel: Reel, block: VideoPrompt): CinemaSelection {
  return { ...reel.cinema, ...block.cinema };
}

/** Which rails this block is overriding — the badge on the block. */
export function overrideCount(block: VideoPrompt): number {
  return Object.values(block.cinema).filter((id) => Boolean(optionById(id)?.prompt)).length;
}

/** The image a block wears until it has a rendered clip of its own. */
export function posterOf(block: VideoPrompt): string | null {
  return block.refs.find((r) => r.kind === "image" && r.url)?.url ?? null;
}

const railPrompt = (sel: CinemaSelection, railId: string): string =>
  optionById(sel[railId] ?? "")?.prompt?.trim() ?? "";

/** The 10-swatch strip a block paints along its bottom edge. */
export function paletteOf(sel: CinemaSelection): string[] | null {
  return optionById(sel.grade ?? "")?.colors ?? null;
}

/** Strip the #move tokens — they are rendered as prose, never pasted. */
export function proseOf(text: string): string {
  return text.replace(MOVE_PATTERN, "$1").replace(/\s{2,}/g, " ").trim();
}

export interface ComposeOpts {
  reel: Reel;
  block: VideoPrompt;
  /** True when a lip-sync range lands on this block. */
  lipSynced?: boolean;
}

export function composePrompt({ reel, block, lipSynced }: ComposeOpts): string {
  const sel = mergedCinema(reel, block);
  const parts: string[] = [];

  const style = railPrompt(sel, "style");
  if (style) parts.push(style);

  // The lip-sync lane carries no words of its own, so this is the one sentence
  // it contributes — added to whichever blocks it happens to be sitting on.
  if (lipSynced) {
    parts.push(
      "The performer sings this passage straight to camera, their mouth shaped to the words and " +
        "their phrasing landing on the beat, framed close enough that the sync reads",
    );
  } else {
    parts.push("Nobody speaks or sings in this shot: it cuts under the music");
  }

  const direction = proseOf(reel.direction);
  if (direction) parts.push(direction);
  const own = proseOf(block.prompt);
  if (own) parts.push(own);

  const moves = movesIn(block.prompt);
  if (moves.length) parts.push(moves.map((m) => m.prompt).join(", then "));

  for (const rail of ["genre", "era", "body", "lens", "aperture", "light", "grade"]) {
    const p = railPrompt(sel, rail);
    if (p) parts.push(p);
  }

  return parts
    .map((p) => p.replace(/\.$/, ""))
    .filter(Boolean)
    .join(". ") + ".";
}

/** The reel's deck, read back as a line of names — shown in the header. */
export function deckSummary(sel: CinemaSelection): string {
  const names = CINEMA_GROUPS.flatMap((g) => g.rails)
    .map((r) => optionById(sel[r.id] ?? ""))
    .filter((o) => o?.prompt)
    .map((o) => o!.name);
  return names.join(" · ");
}
