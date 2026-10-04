// ---------------------------------------------------------------------------
// The games on offer, as data.
//
// A game in this app has to pass one test: a baby who cannot aim, cannot wait
// and cannot read must be able to cause something to happen. So there is no
// scoring, no failure, no timer and no instruction anywhere in any of them.
// Touching the screen is the whole interface, and every touch is correct.
//
// Adding a game is an entry here plus a component in
// src/components/baby-no-scroll/games/ wired into GameStage.
// ---------------------------------------------------------------------------

import type { GameId } from "./types";

export interface GameInfo {
  id: GameId;
  name: string;
  /** What a parent reads when choosing. */
  line: string;
  /** Youngest age this actually works at, which is not a marketing number. */
  from: string;
  /** Base hue for the game's own colour world. */
  hue: number;
}

export const GAMES: GameInfo[] = [
  {
    id: "balloons",
    name: "Balloon pop",
    line:
      "Balloons drift up and burst wherever a finger lands. The one game that works with a palm, "
      + "a knuckle or a whole hand, so it is the one to start with.",
    from: "6 months",
    hue: 330,
  },
  {
    id: "piano",
    name: "Baby piano",
    line:
      "Eight fat bars, each a note of a pentatonic scale — so there is no combination of keys that "
      + "can sound like a wrong note. Holds a note while a finger stays down.",
    from: "9 months",
    hue: 265,
  },
  {
    id: "sparkle",
    name: "Finger paint",
    line:
      "Light follows the finger and slowly fades. Nothing to hit, so it rewards the one thing "
      + "babies do most: dragging a hand across a screen.",
    from: "6 months",
    hue: 190,
  },
  {
    id: "eggs",
    name: "Hide and seek",
    line:
      "Six eggs, a shape hiding under one. Tap to crack them open. The first game here that needs "
      + "aiming, and the first with a payoff worth waiting for.",
    from: "14 months",
    hue: 35,
  },
];

export function gameInfo(id: GameId): GameInfo {
  return GAMES.find((g) => g.id === id) ?? GAMES[0];
}
