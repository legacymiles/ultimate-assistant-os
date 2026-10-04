"use client";

// ---------------------------------------------------------------------------
// Whichever game the parent picked, mounted alone.
//
// One game, not a menu. "It just locks it on that screen" is the whole product:
// a switcher on a locked screen is a second thing a baby can press, and the
// moment there are two there is a way to get lost.
// ---------------------------------------------------------------------------

import { gameInfo } from "@/lib/baby-no-scroll/games";
import type { GameId } from "@/lib/baby-no-scroll/types";
import { Balloons } from "./games/Balloons";
import { Eggs } from "./games/Eggs";
import { Piano } from "./games/Piano";
import { Sparkle } from "./games/Sparkle";

export function GameStage({ game }: { game: GameId }) {
  switch (game) {
    case "piano":
      return <Piano />;
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
