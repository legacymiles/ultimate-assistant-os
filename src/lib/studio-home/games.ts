// ---------------------------------------------------------------------------
// Game Studio — make a game, and the games that aren't finished yet.
//
// Pure and server-safe. Create mounts Game Creator; Unfinished is the dense
// list of playable games that still need work, each with a "Finish it" button
// that files the request in the owner's In Queue for Claude Code.
// ---------------------------------------------------------------------------

import { getProject } from "@/lib/catalog";
import type { HomeSection } from "./sections";

export type GameSection = "create" | "unfinished";

export const GAME_FOLDER = "app:game-studio";

export const GAME_SECTIONS: readonly HomeSection<GameSection>[] = [
  { id: "create", label: "Create", hint: "describe it, your PC builds it", icon: "Sparkles", hue: 285 },
  { id: "unfinished", label: "Unfinished games", hint: "play them, finish them", icon: "Flag", hue: 32 },
];

export const GAME_DEFAULT: GameSection = "create";
export const GAME_REMEMBER = "game-studio:section";

export interface UnfinishedGame {
  slug: string;
  title: string;
  tag: string;
  overview: string;
  route: string;
  /** Plain-English list of what is still missing — goes into the request. */
  missing: string[];
  /** How you play it, in a few words. */
  controls: string;
  /** 3D game that wants a real GPU. */
  webgl: boolean;
  hue: number;
}

function fromCatalog(slug: string, fallback: Omit<UnfinishedGame, "slug" | "missing" | "controls" | "webgl" | "hue">) {
  const p = getProject(slug);
  return {
    slug,
    title: p?.title ?? fallback.title,
    tag: p?.tag ?? fallback.tag,
    overview: p?.overview ?? fallback.overview,
    route: p?.appUrl ?? fallback.route,
  };
}

export const UNFINISHED_GAMES: UnfinishedGame[] = [
  {
    ...fromCatalog("slippery-escape", {
      title: "Slippery Escape",
      tag: "First-person physics escape",
      overview: "Trapped in a giant oiled-up bathroom with a bruiser blocking the only door. Build momentum, juke him out and slide to the exit.",
      route: "/apps/slippery-escape",
    }),
    missing: ["touch controls for a phone", "more than one room", "sound", "a proper win screen and best-time board"],
    controls: "WASD + mouse · click to lock the mouse",
    webgl: true,
    hue: 196,
  },
  {
    ...fromCatalog("item-storm-arena", {
      title: "Item Storm Arena",
      tag: "An interactive gravity playground",
      overview: "A storm of living objects circles a floating arena. Your cursor is a gravity well: collect the storm, launch it at the kart.",
      route: "/apps/item-storm-arena",
    }),
    missing: ["a goal and an end — it is a toy, not yet a game", "touch play on a phone", "sound", "a saved best score"],
    controls: "Move near the storm to collect · click to launch",
    webgl: true,
    hue: 168,
  },
];

/** The In Queue request a "Finish it" press files. */
export function finishRequest(g: UnfinishedGame): { folder: string; text: string } {
  const text =
    `Finish ${g.title}: it plays at ${g.route} (and in Game Studio › Unfinished games) but isn't finished. ` +
    `Still missing: ${g.missing.join("; ")}. Keep what already works, make it work on a phone and with reduced motion, ` +
    `and when it's done move it off the Unfinished list in src/lib/studio-home/games.ts.`;
  return { folder: GAME_FOLDER, text: text.slice(0, 3_900) };
}
