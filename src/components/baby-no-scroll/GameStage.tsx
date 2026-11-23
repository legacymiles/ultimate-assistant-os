"use client";

// ---------------------------------------------------------------------------
// Whichever game the parent picked, mounted alone.
//
// One game, not a menu. "It just locks it on that screen" is the whole product:
// a switcher on a locked screen is a second thing a baby can press, and the
// moment there are two there is a way to get lost. (The Musical Playroom's
// toy shelf is the one exception, and it only swaps instruments inside the
// room — it never leads anywhere else.)
//
// Each game is its own chunk, loaded only when it is the one on. Ten canvas
// worlds in the console's first download would be ten worlds a parent waits
// for to pick one.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import { gameInfo } from "@/lib/baby-no-scroll/games";
import type { GameId } from "@/lib/baby-no-scroll/types";

const Balloons = dynamic(() => import("./games/Balloons").then((m) => m.Balloons), { ssr: false });
const Playroom = dynamic(() => import("./games/Playroom").then((m) => m.Playroom), { ssr: false });
const Bubbles = dynamic(() => import("./games/Bubbles").then((m) => m.Bubbles), { ssr: false });
const Fireworks = dynamic(() => import("./games/Fireworks").then((m) => m.Fireworks), { ssr: false });
const Jelly = dynamic(() => import("./games/Jelly").then((m) => m.Jelly), { ssr: false });
const Aquarium = dynamic(() => import("./games/Aquarium").then((m) => m.Aquarium), { ssr: false });
const Zoom = dynamic(() => import("./games/Zoom").then((m) => m.Zoom), { ssr: false });
const Peekaboo = dynamic(() => import("./games/Peekaboo").then((m) => m.Peekaboo), { ssr: false });
const Sparkle = dynamic(() => import("./games/Sparkle").then((m) => m.Sparkle), { ssr: false });
const Eggs = dynamic(() => import("./games/Eggs").then((m) => m.Eggs), { ssr: false });

export function GameStage({ game }: { game: GameId }) {
  switch (game) {
    case "music":
      return <Playroom />;
    case "bubbles":
      return <Bubbles />;
    case "fireworks":
      return <Fireworks />;
    case "jelly":
      return <Jelly />;
    case "aquarium":
      return <Aquarium />;
    case "zoom":
      return <Zoom />;
    case "peekaboo":
      return <Peekaboo />;
    case "eggs":
      return <Eggs />;
    case "sparkle":
      return <Sparkle />;
    case "balloons":
    default:
      return <Balloons />;
  }
}

/** The background hue the nursery takes from the game that is on. */
export function gameHue(game: GameId): number {
  return gameInfo(game).hue;
}
