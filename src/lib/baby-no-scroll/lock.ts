// ---------------------------------------------------------------------------
// The lock's geometry and its rules — every part of it that is arithmetic.
//
// The padlock is the only thing on a locked screen that reacts, so the whole
// safety of the app comes down to "could a baby do this by accident?". That
// question is answered by numbers, which is why they live here and are tested
// rather than being scattered through an event handler.
//
// Two decisions are worth the words:
//
//   The rail runs along the LONGEST axis of the screen, never diagonally. On a
//   portrait phone that is top-to-bottom; on a tablet in landscape it is
//   side-to-side. Always the longest traverse the device can offer, so the
//   gesture is as hard as it can be — and always hugging an edge, so the line
//   is never drawn across the thing the baby is watching.
//
//   Reaching the end is not the same as finishing. A thumb can cross a phone by
//   luck; it will not then sit still. So the far end is a hold, not a line.
// ---------------------------------------------------------------------------

import type { Corner } from "./types";

export interface Vec {
  x: number;
  y: number;
}

/** From the lock's resting place to the latch, in screen pixels. */
export interface Rail {
  from: Vec;
  to: Vec;
  /** Which axis the drag travels along. */
  axis: "x" | "y";
  length: number;
  /** The corner the latch sits in — the lock's new home if it unlocks there. */
  end: Corner;
}

/** Clockwise from the top left: where a triple-tap sends the lock next. */
export const CORNERS: readonly Corner[] = ["tl", "tr", "br", "bl"] as const;

/** How far along the rail counts as across. Not 1: a pointer never lands exact. */
export const UNLOCK_AT = 0.94;

/** Movement past this many px is a drag rather than a tap. */
export const DRAG_SLOP_PX = 10;

/** Taps inside this window belong to the same gesture. */
export const TRIPLE_WINDOW_MS = 450;

/** The rail puts itself away again after this long untouched. */
export const RAIL_IDLE_MS = 4000;

/** How long the puck must be held at the latch, when holding is asked for. */
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

/** The centre of the puck when it is at rest in a corner. */
export function lockAnchor(corner: Corner, w: number, h: number, inset: number): Vec {
  return {
    x: isRight(corner) ? w - inset : inset,
    y: isBottom(corner) ? h - inset : inset,
  };
}

/**
 * The track the puck travels. The axis is whichever side of the screen is
 * longer, and the latch is the corner at the other end of that side.
 */
export function railFor(corner: Corner, w: number, h: number, inset: number): Rail {
  const axis: "x" | "y" = w >= h ? "x" : "y";
  const end =
    axis === "x"
      ? cornerOf(!isRight(corner), isBottom(corner))
      : cornerOf(isRight(corner), !isBottom(corner));
  const from = lockAnchor(corner, w, h, inset);
  const to = lockAnchor(end, w, h, inset);
  return {
    from,
    to,
    axis,
    end,
    length: Math.abs(axis === "x" ? to.x - from.x : to.y - from.y),
  };
}

/** How far along the rail a pointer is, 0 at the lock and 1 at the latch. */
export function railProgress(rail: Rail, p: Vec): number {
  if (rail.length === 0) return 0;
  const travelled = rail.axis === "x" ? p.x - rail.from.x : p.y - rail.from.y;
  const direction = Math.sign(
    rail.axis === "x" ? rail.to.x - rail.from.x : rail.to.y - rail.from.y,
  );
  return Math.min(1, Math.max(0, (travelled * direction) / rail.length));
}

/** Where the puck should be drawn at a given progress. */
export function pointOnRail(rail: Rail, t: number): Vec {
  const k = Math.min(1, Math.max(0, t));
  return {
    x: rail.from.x + (rail.to.x - rail.from.x) * k,
    y: rail.from.y + (rail.to.y - rail.from.y) * k,
  };
}

export type TapAction = "show-rail" | "move-corner" | "none";

/**
 * What a run of taps means. One tap shows the rail immediately — waiting to see
 * whether a second is coming would make the only control on the screen feel
 * broken. Three moves the lock, and the rail the first tap opened is put away
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
