// ---------------------------------------------------------------------------
// The lock's geometry and its rules — every part of it that is arithmetic.
//
// The padlock is the only thing on a locked screen that reacts, so the whole
// safety of the app comes down to "could a baby do this by accident?". That
// question is answered by numbers, which is why they live here and are tested
// rather than being scattered through an event handler.
//
// Three decisions are worth the words:
//
//   The way out is an ANGLE, not a line (owner, Nov 2026). Two legs: a swipe
//   along the short edge of the screen, a ninety degree turn at the corner,
//   then the long edge to the opposite corner. A baby's thumb travels one way,
//   lands anywhere, and does not turn a corner on purpose; an adult doing it
//   deliberately does it in a second.
//
//   Both legs hug an EDGE, and the two of them sit on opposite sides of the
//   screen — far apart, so nothing is ever drawn across the thing the baby is
//   watching, and there is no single stripe to trace.
//
//   The turn has to be EARNED. Leg two does not start counting until leg one
//   has been travelled, and once the turn is taken the drag cannot go back —
//   letting go anywhere short of the end springs the whole thing home.
// ---------------------------------------------------------------------------

import type { Corner } from "./types";

export interface Vec {
  x: number;
  y: number;
}

/** One straight run of the gesture, along one edge of the screen. */
export interface Leg {
  from: Vec;
  to: Vec;
  /** Which axis this leg travels along. */
  axis: "x" | "y";
  length: number;
}

/** The whole way out: short edge, corner, long edge. */
export interface UnlockPath {
  /** [the short edge, the long edge] — always in that order. */
  legs: readonly [Leg, Leg];
  /** The corner the swipe turns at. */
  elbow: Corner;
  /** The corner it ends in — the lock's new home if it unlocks there. */
  end: Corner;
}

export type LegIndex = 0 | 1;

/** How far the drag has got: which leg it is on, and how far along that leg. */
export interface Step {
  leg: LegIndex;
  t: number;
}

/** The puck at rest, before anything has been dragged. */
export const START: Step = { leg: 0, t: 0 };

/** Clockwise from the top left: where a triple-tap sends the lock next. */
export const CORNERS: readonly Corner[] = ["tl", "tr", "br", "bl"] as const;

/**
 * How far along the last leg counts as finished. The turn is what makes this
 * gesture hard, so the end itself is forgiving — a pointer never lands exact,
 * and an adult doing this one-handed in the dark should not have to.
 */
export const UNLOCK_AT = 0.9;

/** How far along leg one counts as reaching the corner, so the turn opens. */
export const LEG_DONE = 0.86;

/**
 * How far off the edge it is travelling the finger may stray and still count.
 *
 * Generous, because nobody drags a straight line one-handed in the dark — but
 * it has to exist, or the angle is no angle at all: one diagonal swipe from
 * the lock to the opposite corner would cover the whole travel of both legs
 * at once and open the lock without ever turning the corner.
 */
export const ON_PATH_PX = 110;

/** Movement past this many px is a drag rather than a tap. */
export const DRAG_SLOP_PX = 10;

/** Taps inside this window belong to the same gesture. */
export const TRIPLE_WINDOW_MS = 450;

/** The dotted path puts itself away again after this long untouched. */
export const RAIL_IDLE_MS = 4000;

/** How long the puck must be held at the end, when holding is asked for. */
export const HOLD_MS = 900;

export function nextCorner(c: Corner): Corner {
  const i = CORNERS.indexOf(c);
  return CORNERS[(i + 1) % CORNERS.length];
}

function isRight(c: Corner): boolean {
  return c === "tr" || c === "br";
}

function isBottom(c: Corner): boolean {
  return c === "bl" || c === "br";
}

function cornerOf(right: boolean, bottom: boolean): Corner {
  if (bottom) return right ? "br" : "bl";
  return right ? "tr" : "tl";
}

/** The corner across the screen on the given axis. */
function flip(c: Corner, axis: "x" | "y"): Corner {
  return axis === "x"
    ? cornerOf(!isRight(c), isBottom(c))
    : cornerOf(isRight(c), !isBottom(c));
}

/** The centre of the puck when it is at rest in a corner. */
export function lockAnchor(corner: Corner, w: number, h: number, inset: number): Vec {
  return {
    x: isRight(corner) ? w - inset : inset,
    y: isBottom(corner) ? h - inset : inset,
  };
}

function legBetween(from: Vec, to: Vec, axis: "x" | "y"): Leg {
  return {
    from,
    to,
    axis,
    length: Math.abs(axis === "x" ? to.x - from.x : to.y - from.y),
  };
}

/**
 * The two legs the puck travels: the short edge of the screen first, then the
 * long one. Short first on purpose — the gesture starts easily and commits,
 * and the long leg (the one a stray thumb might manage by luck) can only be
 * reached by someone who has already turned a corner.
 */
export function pathFor(corner: Corner, w: number, h: number, inset: number): UnlockPath {
  // On a portrait phone the short edge runs across (x); in landscape, down (y).
  const shortAxis: "x" | "y" = w >= h ? "y" : "x";
  const longAxis: "x" | "y" = shortAxis === "x" ? "y" : "x";
  const elbow = flip(corner, shortAxis);
  const end = flip(elbow, longAxis);
  const a = lockAnchor(corner, w, h, inset);
  const b = lockAnchor(elbow, w, h, inset);
  const c = lockAnchor(end, w, h, inset);
  return {
    legs: [legBetween(a, b, shortAxis), legBetween(b, c, longAxis)] as const,
    elbow,
    end,
  };
}

/** How far along one leg a pointer is, 0 at its start and 1 at its end. */
export function legProgress(leg: Leg, p: Vec): number {
  if (leg.length === 0) return 0;
  const travelled = leg.axis === "x" ? p.x - leg.from.x : p.y - leg.from.y;
  const direction = Math.sign(
    leg.axis === "x" ? leg.to.x - leg.from.x : leg.to.y - leg.from.y,
  );
  return Math.min(1, Math.max(0, (travelled * direction) / leg.length));
}

/** How far the finger is from the edge this leg travels along. */
export function offPath(leg: Leg, p: Vec): number {
  return leg.axis === "x" ? Math.abs(p.y - leg.from.y) : Math.abs(p.x - leg.from.x);
}

/**
 * Where the drag has got to, given where it was and where the finger is now.
 *
 * The turn is one-way: leg two opens only once leg one has been travelled, and
 * from then on the pointer is read against leg two alone. Sliding back round
 * the corner does not undo the turn — it reads as nothing travelled on leg
 * two, which is exactly where the puck then sits.
 *
 * A finger that has left the edge it was travelling stops counting rather than
 * springing back: the drag simply waits where it was until the finger returns.
 */
export function advance(path: UnlockPath, step: Step, p: Vec): Step {
  if (offPath(path.legs[step.leg], p) > ON_PATH_PX) return step;
  if (step.leg === 0) {
    const t = legProgress(path.legs[0], p);
    return t >= LEG_DONE ? { leg: 1, t: 0 } : { leg: 0, t };
  }
  return { leg: 1, t: legProgress(path.legs[1], p) };
}

/** Has the whole angle been travelled? */
export function isDone(step: Step): boolean {
  return step.leg === 1 && step.t >= UNLOCK_AT;
}

/** Where the puck should be drawn for a given step. */
export function pointAt(path: UnlockPath, step: Step): Vec {
  const leg = path.legs[step.leg];
  const k = Math.min(1, Math.max(0, step.t));
  return {
    x: leg.from.x + (leg.to.x - leg.from.x) * k,
    y: leg.from.y + (leg.to.y - leg.from.y) * k,
  };
}

/** How lit a leg should be: full behind the puck, partial under it, dark ahead. */
export function legFill(step: Step, leg: LegIndex): number {
  if (step.leg > leg) return 1;
  if (step.leg < leg) return 0;
  return Math.min(1, Math.max(0, step.t));
}

export type TapAction = "show-rail" | "move-corner" | "none";

/**
 * What a run of taps means. One tap shows the path immediately — waiting to see
 * whether a second is coming would make the only control on the screen feel
 * broken. Three moves the lock, and the path the first tap opened is put away
 * again by the caller, so the two gestures never both land.
 */
export function tapAction(count: number): TapAction {
  if (count >= 3) return "move-corner";
  if (count === 1) return "show-rail";
  return "none";
}

/** Distance between two points, for telling a tap from the start of a drag. */
export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
