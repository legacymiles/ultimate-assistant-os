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
      "A sky full of glossy balloons racing up past the clouds. Any touch pops one in a burst of "
      + "confetti; tap the empty sky and a new one floats up from the finger. Gold star balloons "
      + "set off fireworks, rainbow ones split into a flock of little ones.",
    from: "6 months",
    hue: 330,
  },
  {
    id: "music",
    name: "Musical playroom",
    line:
      "Six instruments on a toy shelf — piano, xylophone, drums, harp, bells, bongos. One fills the "
      + "screen at a time; tap the shelf to swap. Every note is tuned so that no mashing can sound "
      + "wrong, and a dragged hand plays every key it crosses.",
    from: "9 months",
    hue: 265,
  },
  {
    id: "bubbles",
    name: "Bubbles",
    line:
      "Rainbow soap bubbles wobble up the screen and pop with a bloop. Touch empty space or drag "
      + "and the finger blows new ones; the giant ones burst into a family of small ones.",
    from: "6 months",
    hue: 195,
  },
  {
    id: "fireworks",
    name: "Fireworks",
    line:
      "A night sky over a sleeping town. Every tap sends a rocket up to that exact spot and bursts "
      + "it into a ring, a heart, a star or a willow. Cause and effect at its most spectacular.",
    from: "9 months",
    hue: 250,
  },
  {
    id: "jelly",
    name: "Jelly friends",
    line:
      "Squishy jelly blobs with faces that watch the finger. Poke one and it squashes and boings "
      + "back; drag it and fling it and it bounces round the screen, wobbling.",
    from: "9 months",
    hue: 310,
  },
  {
    id: "aquarium",
    name: "Aquarium",
    line:
      "A sunlit fish tank. Tap the water to sprinkle food and the fish race over to eat it; touch "
      + "a fish and it darts off in a puff of bubbles. The puffer puffs.",
    from: "9 months",
    hue: 185,
  },
  {
    id: "zoom",
    name: "Zoom zoom",
    line:
      "A toy town road. Every tap sends a car, a bus, a train or a fire engine racing through, "
      + "beeping. Touch one as it passes and it hops; drag along a lane and it follows the finger.",
    from: "12 months",
    hue: 42,
  },
  {
    id: "peekaboo",
    name: "Peekaboo",
    line:
      "Bushes, a tree, a pond and flower pots, each hiding an animal. Tap one and a bunny, chick, "
      + "frog or kitten pops out with its own little voice — and it is a different one next time.",
    from: "12 months",
    hue: 135,
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
      "Six eggs, a shape hiding under one. Tap to crack them open. The game here that needs the "
      + "most aiming, and the one with a payoff worth waiting for.",
    from: "14 months",
    hue: 35,
  },
];

export function gameInfo(id: GameId): GameInfo {
  return GAMES.find((g) => g.id === id) ?? GAMES[0];
}
