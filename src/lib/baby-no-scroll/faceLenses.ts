// ---------------------------------------------------------------------------
// Silly faces — the maths behind the camera game, kept apart from the camera.
//
// The face tracker (jeeliz FaceFilter) reports a face as a square in its own
// viewport: a centre in -1..1 (y up), a size as a fraction of the width, and
// three head angles. Everything a lens needs — where the ears go, how big the
// nose is, which way the crown tilts — follows from turning that into screen
// pixels once, mirrored, because a front camera that is not mirrored reads as
// "wrong" to everyone, babies included.
//
// Pure and tested: no DOM, no camera, no WebGL.
// ---------------------------------------------------------------------------

export type LensId =
  | "puppy"
  | "bunny"
  | "kitty"
  | "bear"
  | "crown"
  | "hearts"
  | "flowers"
  | "alien"
  | "lion"
  | "rainbow";

export interface Lens {
  id: LensId;
  /** The lens's own colour, for its carousel bubble and its sparkles. */
  hue: number;
}

/** Order matters: the carousel opens on the first, and the cutest goes first. */
export const LENSES: readonly Lens[] = [
  { id: "puppy", hue: 28 },
  { id: "bunny", hue: 330 },
  { id: "crown", hue: 46 },
  { id: "kitty", hue: 300 },
  { id: "hearts", hue: 350 },
  { id: "flowers", hue: 120 },
  { id: "bear", hue: 20 },
  { id: "alien", hue: 140 },
  { id: "lion", hue: 35 },
  { id: "rainbow", hue: 200 },
];

/** What the tracker says about one face, as it says it. */
export interface Detect {
  detected: number;
  x: number;
  y: number;
  s: number;
  rx: number;
  ry: number;
  rz: number;
  /** expressions[0] is mouth opening, 0..1, where the model provides it. */
  mouth?: number;
}

/** A face in screen pixels, ready to hang stickers on. */
export interface FacePose {
  /** Centre of the face square. */
  cx: number;
  cy: number;
  /** Width of the face square in px. */
  size: number;
  /** Head roll in screen radians (clockwise positive, as canvas rotates). */
  roll: number;
  /** Head turn left/right, -1..1-ish, for parallax on the stickers. */
  yaw: number;
  /** 0..1. */
  mouth: number;
  /** 0..1 confidence, smoothed — stickers fade with it. */
  seen: number;
}

/** Below this the tracker is guessing; a lens on a guess jumps around a wall. */
export const SEEN_AT = 0.6;

/**
 * Tracker space → screen space for a mirrored selfie view filling a w × h
 * viewport. The tracker's viewport is the same w × h (its canvas is sized to
 * the screen), so this is a flip and a scale, nothing more.
 */
export function toScreen(d: Detect, w: number, h: number, mirrored = true): Omit<FacePose, "seen"> {
  const px = ((d.x + 1) / 2) * w;
  const py = ((1 - d.y) / 2) * h;
  return {
    cx: mirrored ? w - px : px,
    cy: py,
    size: d.s * w,
    // The tracker's rz is counter-clockwise in a y-up frame. On a y-down
    // canvas that is already clockwise-positive; mirroring flips it back.
    roll: mirrored ? -d.rz : d.rz,
    yaw: mirrored ? -d.ry : d.ry,
    mouth: Math.max(0, Math.min(1, d.mouth ?? 0)),
  };
}

/**
 * Ease a pose toward a fresh reading. The tracker is already stabilised; this
 * takes out the last few pixels of shiver, which on a sticker the size of a
 * face reads as the sticker being loose. Faster for big moves so a turned head
 * is never left behind.
 */
export function smooth(prev: FacePose | null, next: Omit<FacePose, "seen">, seen: boolean, dt: number): FacePose {
  const target = seen ? 1 : 0;
  if (!prev) return { ...next, seen: target * Math.min(1, dt * 6) };
  const jump = Math.hypot(next.cx - prev.cx, next.cy - prev.cy) / Math.max(1, prev.size);
  const k = 1 - Math.pow(jump > 0.25 ? 0.0005 : 0.02, dt);
  const lerp = (a: number, b: number) => a + (b - a) * k;
  const fade = 1 - Math.pow(0.002, dt);
  return {
    cx: seen ? lerp(prev.cx, next.cx) : prev.cx,
    cy: seen ? lerp(prev.cy, next.cy) : prev.cy,
    size: seen ? lerp(prev.size, next.size) : prev.size,
    roll: seen ? lerp(prev.roll, next.roll) : prev.roll,
    yaw: seen ? lerp(prev.yaw, next.yaw) : prev.yaw,
    mouth: seen ? lerp(prev.mouth, next.mouth) : prev.mouth * (1 - fade),
    seen: prev.seen + (target - prev.seen) * fade,
  };
}

export type Gesture = "next" | "prev" | "tap" | "none";

/**
 * What a finger did, from where it went down to where it came up.
 * Swiping LEFT brings the next lens in from the right, like turning a page —
 * the direction every carousel on a phone already taught the parent.
 */
export function gestureOf(dx: number, dy: number, seconds: number, short: number): Gesture {
  const dist = Math.hypot(dx, dy);
  const swipe = Math.max(48, short * 0.08);
  if (Math.abs(dx) > swipe && Math.abs(dx) > Math.abs(dy) * 1.2 && seconds < 2) {
    return dx < 0 ? "next" : "prev";
  }
  if (dist < 24 && seconds < 0.6) return "tap";
  return "none";
}

/** Step through the lenses, wrapping both ways, so there is no end to hit. */
export function stepLens(i: number, by: number, n = LENSES.length): number {
  return (((i + by) % n) + n) % n;
}
