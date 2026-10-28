// The geometry of your hand: how big the cards are, how far apart, and how
// much they turn, for the width the hand actually has. Worked out from the
// real width (not a guess in CSS) so no card is ever clipped, from a 360px
// phone to a desktop.
//
// The fan pivots each card around a point below it, so the outermost cards
// lean outward at the top. That lean is measured here and kept inside the box.
//
// Pure: the table measures its width and draws whatever this returns.

export interface HandLayout {
  /** Card width and height, px. */
  cw: number;
  ch: number;
  /** Distance between neighbouring cards' left edges, px. */
  step: number;
  /** Turn per card away from the middle, degrees. */
  rot: number;
  /** Corner index sizes, px — as big as the visible strip of each card allows. */
  rank: number;
  ten: number;
  pip: number;
  /** Space kept free at each side for the outer cards' lean, px. */
  pad: number;
}

/** The pivot sits this many card-heights below a card's top (CSS transform-origin 50% 120%). */
export const PIVOT = 1.2;
/** Cards grow to this on a wide screen, and shrink to no less than this. */
export const MAX_CW = 108;
export const MIN_CW = 58;
/** Height over width of a card. */
export const ASPECT = 1.44;
/** Picked cards scale up a little; leave room for it. */
const POP = 1.06;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Kept free beyond the lean: the hand's gentle sway and a hair of air. */
const MARGIN = 10;

function fit(width: number, n: number, cw: number) {
  const ch = cw * ASPECT;
  const mid = (n - 1) / 2;
  // Up to 1.7° a card, and at most 9° at the ends (4.5° on a phone, where every
  // pixel of width goes to the cards).
  const end = width < 520 ? 4.5 : 9;
  const rot = n > 1 ? Math.min(1.7, end / Math.max(1, mid)) : 0;
  const lean = PIVOT * ch * Math.sin((mid * rot * Math.PI) / 180);
  const pad = lean + (cw * (POP - 1)) / 2 + MARGIN;
  const room = width - cw - 2 * pad;
  const step = n > 1 ? Math.min(cw * 0.6, Math.max(0, room / (n - 1))) : 0;
  return { ch, rot, pad, step, room };
}

export function handLayout(width: number, n: number): HandLayout {
  const w = Math.max(200, width);
  const count = Math.max(1, Math.min(13, n));
  // Start from a card about a fifth of the width, and shrink until each card
  // shows at least 28% of itself (room for its big corner index).
  let cw = clamp(w * 0.2, MIN_CW, MAX_CW);
  let f = fit(w, count, cw);
  while (count > 1 && cw > MIN_CW && (f.step < cw * 0.28 || f.room < 0)) {
    cw -= 2;
    f = fit(w, count, cw);
  }
  // The strip of each card you can see (plus a little from the fan's turn).
  const visible = count > 1 ? f.step + PIVOT * f.ch * Math.sin((f.rot * Math.PI) / 180) : cw;
  const rank = clamp(visible * 1.1, cw * 0.3, cw * 0.4);
  return {
    cw: Math.round(cw),
    ch: Math.round(f.ch),
    step: Math.round(f.step * 10) / 10,
    rot: Math.round(f.rot * 100) / 100,
    rank: Math.round(rank),
    ten: Math.round(rank * 0.8),
    pip: Math.round(rank * 0.8),
    pad: Math.round(f.pad),
  };
}

/**
 * The left and right edges of the whole fan (including the outer cards'
 * lean), measured from the fan box's left edge. For tests and sanity checks.
 */
export function fanExtent(width: number, layout: HandLayout, n: number): { left: number; right: number } {
  const mid = (n - 1) / 2;
  const lean = PIVOT * layout.ch * Math.sin((mid * layout.rot * Math.PI) / 180);
  const grow = (layout.cw * (POP - 1)) / 2;
  const first = width / 2 - layout.cw / 2 - mid * layout.step;
  const last = width / 2 + layout.cw / 2 + mid * layout.step;
  return { left: first - lean - grow, right: last + lean + grow };
}
