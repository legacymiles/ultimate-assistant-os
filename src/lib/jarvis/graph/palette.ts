// ---------------------------------------------------------------------------
// The graph's colours, in one place.
//
// `SOURCE_COLOR` used to live in MemoryCore.tsx, which meant the two chat tabs
// imported a react-three-fiber component purely to get eight hex values — and
// it meant the new knowledge graph could not use the same palette without
// dragging `three` with it. It lives here now; MemoryCore re-exports it so its
// existing callers are untouched.
//
// Every value is chosen to stay distinguishable at 2px on black, which rules
// out putting two sources on neighbouring hues. The hues currently in use are
// cyan 190, green 140, violet 240, amber 42, lilac 260, coral 15, mint 165 and
// pink 335 — a ninth source needs a genuinely unused one, not a shade.
// ---------------------------------------------------------------------------

import type { MemorySource } from "@/lib/jarvis/types";

export const SOURCE_COLOR: Record<MemorySource, string> = {
  // The authored brain gets the one strong green, because it is the source the
  // owner wrote on purpose and it should read as the spine of the graph.
  vault: "#5ef08a",
  note: "#6ee7ff", // cyan
  chat: "#8b8cff", // violet
  "master-folder": "#ffd479", // amber
  skill: "#c4b5fd", // lilac
  file: "#ff9f7f", // coral
  email: "#5ee0c0", // mint
  event: "#ff5fa2", // pink
  profile: "#e9ecf3", // near-white
};

/**
 * A note that is linked to but has never been written.
 *
 * Deliberately the dimmest thing on the canvas: a ghost is an absence, and it
 * should look like one next to the notes that actually exist. It still has to
 * be visible, because "I keep referring to something I never wrote" is the
 * most useful thing a second brain can tell you.
 */
export const GHOST_COLOR = "#6b7390";

/** A `#tag` drawn as a node of its own. */
export const TAG_COLOR = "#b8c75e";

/** The selected node, and the ring around it. */
export const SELECTED_COLOR = "#ffffff";

/** A node matching the current search. */
export const MATCH_COLOR = "#ffe27a";

/** Edges at rest. Kept cool and low so a few thousand of them do not become a fog. */
export const EDGE_COLOR = "#5b7cff";

/** Edges touching the selected node. */
export const EDGE_ACTIVE_COLOR = "#cfe0ff";

/** How much a node that is filtered out keeps of its colour, rather than vanishing. */
export const DIM_FACTOR = 0.18;

/** `#rrggbb` → `[r, g, b]` in 0..1. Throws on nothing — a bad value reads as black rather than crashing a frame. */
export function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
