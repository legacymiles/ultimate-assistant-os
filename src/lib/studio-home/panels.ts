// ---------------------------------------------------------------------------
// Which studios get a panel on the Studio tab, and what is inside each one.
//
// This is a file of its own for one reason: two places need to agree about it.
// The wall (./wall.ts) draws these panels, and the App plugins page
// (@/lib/studio/plugins) has to NOT draw a card for the same studio, because
// the wall is already the door to it. Keeping the list here means neither of
// them owns it and neither can drift from the other — a studio is added to the
// wall and leaves the plugins page in the same edit, which is the only version
// of this that stays true.
//
// It deliberately imports nothing from `@/lib/studio/plugins`: plugins imports
// this, so a reference back would be a cycle. Anything that needs to resolve a
// slug against the catalog or against MERGED_INTO does it in ./wall.ts.
// ---------------------------------------------------------------------------

import { GAME_SECTIONS } from "./games";
import type { HomeIcon, HomeSection } from "./sections";
import { TRADING_SECTIONS } from "./trading";

/** One thing inside a studio, as a spine along the panel's bottom edge. */
export interface Inside {
  label: string;
  icon: HomeIcon;
}

export interface Panel {
  slug: string;
  /** A studio with its own sections list hands it over directly. */
  sections?: readonly HomeSection[];
  /** Otherwise: spines written here, for a studio whose parts are not modelled. */
  inside?: Inside[];
}

/**
 * The studios that get a panel, in the order they are drawn, and where each
 * one's contents come from.
 *
 * A hand-written order rather than every plugin slug: the App plugins page
 * lists the apps that did NOT become studios, and a wall of twenty tall panels
 * is a list with pictures. These are the ones that MAKE something, which is
 * what the Studio tab is for.
 */
export const PANELS: readonly Panel[] = [
  { slug: "image-studio", inside: [{ label: "Agents", icon: "Sparkles" }, { label: "Gallery", icon: "Grid" }] },
  {
    slug: "jarvis-audio-studio",
    inside: [
      { label: "Find", icon: "Search" },
      { label: "Classify", icon: "Waveform" },
      { label: "Create", icon: "Mic" },
    ],
  },
  { slug: "seedance-studio", inside: [{ label: "Engine", icon: "Waveform" }] },
  { slug: "personas-studio", inside: [{ label: "Personas", icon: "Users" }, { label: "Calendar", icon: "Calendar" }, { label: "Analytics", icon: "Target" }] },
  { slug: "money-agent-studio", inside: [{ label: "Clip", icon: "Scissors" }, { label: "Channels", icon: "Film" }, { label: "Campaigns", icon: "Cash" }] },
  { slug: "game-studio", sections: GAME_SECTIONS },
  { slug: "trading-studio", sections: TRADING_SECTIONS },
];

/**
 * Just the slugs, for the one question the plugins page asks: is this studio
 * already reachable from the Studio tab?
 */
export const PANEL_SLUGS: readonly string[] = PANELS.map((p) => p.slug);

/** Whether this app has a panel on the Studio tab's wall. */
export function onTheWall(slug: string): boolean {
  return PANEL_SLUGS.includes(slug);
}
