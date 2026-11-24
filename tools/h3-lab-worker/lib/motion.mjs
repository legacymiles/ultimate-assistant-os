// ---------------------------------------------------------------------------
// Global camera motion from a handful of small grayscale frames. Pure maths,
// no ffmpeg, no I/O, so it is unit-tested with synthetic images.
//
// Frames are Uint8Array luma planes, row-major, `w` x `h` (the worker uses
// ~96 px wide). For each consecutive pair it finds:
//
//   1. the translation (integer search over ±radius, then a parabola through
//      the cost around the best integer for a sub-pixel answer), and
//   2. the zoom (scales 0.92..1.08 about the centre, with that translation
//      applied, again refined with a parabola).
//
// SIGN CONVENTION — reported numbers describe the CAMERA, not the content:
//
//   content shift  = how far the picture moved from frame A to frame B
//                    (+x right, +y down), i.e. B(x, y) ≈ A(x - sx, y - sy).
//   camera dx      = -content sx.  dx > 0: the camera panned/tracked RIGHT
//                    (the picture slid left).
//   camera dy      = -content sy.  dy > 0: the camera tilted/moved DOWN
//                    (the picture slid up). dy < 0 is a tilt up.
//   zoom           = percent the picture was magnified, compounded over the
//                    clip. zoom > 0: push-in / zoom-in. zoom < 0: pull-out.
//   energy         = mean absolute luma difference (0..255) left over after
//                    the best alignment, averaged over pairs — what the
//                    subject did that the camera did not explain.
//
// It cannot tell a dolly from an optical zoom (no parallax model), a pan from
// a truck, or see rotation (rot is always 0). It is a pointer, not a verdict.
// ---------------------------------------------------------------------------

/** Mean |B(x,y) - A(x - sx, y - sy)| over B's inner region (fixed margin, so every candidate is scored on the same pixels). */
export function shiftCost(a, b, w, h, sx, sy, margin) {
  let sum = 0;
  let n = 0;
  for (let y = margin; y < h - margin; y += 1) {
    const ay = y - sy;
    if (ay < 0 || ay >= h) continue;
    const rowB = y * w;
    const rowA = ay * w;
    for (let x = margin; x < w - margin; x += 1) {
      const ax = x - sx;
      if (ax < 0 || ax >= w) continue;
      sum += Math.abs(b[rowB + x] - a[rowA + ax]);
      n += 1;
    }
  }
  return n ? sum / n : Infinity;
}

/** Vertex offset of a parabola through (-1, c0), (0, c1), (+1, c2); clamped to ±0.5. */
export function parabolaOffset(c0, c1, c2) {
  const denom = c0 - 2 * c1 + c2;
  if (!Number.isFinite(denom) || denom <= 1e-9) return 0;
  const off = (0.5 * (c0 - c2)) / denom;
  return Math.max(-0.5, Math.min(0.5, off));
}

/**
 * Content translation from A to B: { sx, sy, cost } with sub-pixel sx/sy.
 * A coarse-to-fine search would be faster; at 96 px the brute force is ~1 ms a pair.
 */
export function estimateShift(a, b, w, h, radius = 8) {
  const margin = radius;
  let best = { sx: 0, sy: 0, cost: Infinity };
  const costs = new Map();
  for (let sy = -radius; sy <= radius; sy += 1) {
    for (let sx = -radius; sx <= radius; sx += 1) {
      const c = shiftCost(a, b, w, h, sx, sy, margin);
      costs.set(`${sx},${sy}`, c);
      // Prefer the smaller shift on ties so a flat picture reads as static.
      if (c < best.cost - 1e-9 || (Math.abs(c - best.cost) <= 1e-9 && Math.abs(sx) + Math.abs(sy) < Math.abs(best.sx) + Math.abs(best.sy))) {
        best = { sx, sy, cost: c };
      }
    }
  }
  const at = (sx, sy) => costs.get(`${sx},${sy}`);
  let fx = 0;
  let fy = 0;
  if (Math.abs(best.sx) < radius) fx = parabolaOffset(at(best.sx - 1, best.sy), best.cost, at(best.sx + 1, best.sy));
  if (Math.abs(best.sy) < radius) fy = parabolaOffset(at(best.sx, best.sy - 1), best.cost, at(best.sx, best.sy + 1));
  return { sx: best.sx + fx, sy: best.sy + fy, cost: best.cost, atEdge: Math.abs(best.sx) >= radius || Math.abs(best.sy) >= radius };
}

/** Bilinear sample of A at a real coordinate; NaN outside. */
function sample(a, w, h, x, y) {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = a[y0 * w + x0] * (1 - fx) + a[y0 * w + x1] * fx;
  const bot = a[y1 * w + x0] * (1 - fx) + a[y1 * w + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

/**
 * Cost of B against A magnified by `s` about the centre and shifted by (sx, sy):
 * B(p) ≈ A(c + (p - c - shift) / s).
 */
export function zoomCost(a, b, w, h, s, sx = 0, sy = 0, margin = 8) {
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  let sum = 0;
  let n = 0;
  for (let y = margin; y < h - margin; y += 1) {
    for (let x = margin; x < w - margin; x += 1) {
      const v = sample(a, w, h, cx + (x - cx - sx) / s, cy + (y - cy - sy) / s);
      if (Number.isNaN(v)) continue;
      sum += Math.abs(b[y * w + x] - v);
      n += 1;
    }
  }
  return n ? sum / n : Infinity;
}

/** Best magnification A→B in [lo, hi] (1 = none), with the pair's translation applied. */
export function estimateZoom(a, b, w, h, shift = { sx: 0, sy: 0 }, lo = 0.92, hi = 1.08, step = 0.01) {
  const scales = [];
  for (let s = lo; s <= hi + 1e-9; s += step) scales.push(Math.round(s * 1e4) / 1e4);
  const costs = scales.map((s) => zoomCost(a, b, w, h, s, shift.sx, shift.sy));
  let i = 0;
  for (let k = 1; k < costs.length; k += 1) {
    if (costs[k] < costs[i] - 1e-9 || (Math.abs(costs[k] - costs[i]) <= 1e-9 && Math.abs(scales[k] - 1) < Math.abs(scales[i] - 1))) i = k;
  }
  let s = scales[i];
  if (i > 0 && i < costs.length - 1) s += parabolaOffset(costs[i - 1], costs[i], costs[i + 1]) * step;
  return { scale: s, cost: costs[i] };
}

/** A magnified by `s` about the centre, resampled onto the same grid (edges clamped). */
export function magnify(a, w, h, s) {
  if (s === 1) return a;
  const out = new Float32Array(w * h);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  for (let y = 0; y < h; y += 1) {
    const sy = Math.max(0, Math.min(h - 1, cy + (y - cy) / s));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.max(0, Math.min(w - 1, cx + (x - cx) / s));
      out[y * w + x] = sample(a, w, h, sx, sy);
    }
  }
  return out;
}

/**
 * Joint zoom + translation for one pair. Zoom and translation are not
 * independent — a push-in toward an off-centre subject IS a zoom plus a
 * shift — so estimating one and then the other biases both. Here every scale
 * gets its own full shift search on a pre-magnified copy of A, and the best
 * (scale, shift) is refined with parabolas on each axis.
 */
export function estimatePair(a, b, w, h, { radius = 8, lo = 0.92, hi = 1.08, step = 0.01 } = {}) {
  const scales = [];
  for (let s = lo; s <= hi + 1e-9; s += step) scales.push(Math.round(s * 1e4) / 1e4);
  const results = scales.map((s) => estimateShift(magnify(a, w, h, s), b, w, h, radius));
  let i = 0;
  for (let k = 1; k < results.length; k += 1) {
    const c = results[k].cost;
    const best = results[i].cost;
    if (c < best - 1e-9 || (Math.abs(c - best) <= 1e-9 && Math.abs(scales[k] - 1) < Math.abs(scales[i] - 1))) i = k;
  }
  let scale = scales[i];
  if (i > 0 && i < results.length - 1) scale += parabolaOffset(results[i - 1].cost, results[i].cost, results[i + 1].cost) * step;
  // The plain-translation cost too: when zoom buys nothing, prefer no zoom.
  const plain = results[scales.indexOf(1)] ?? estimateShift(a, b, w, h, radius);
  if (plain.cost <= results[i].cost * 1.005) return { sx: plain.sx, sy: plain.sy, scale: 1, cost: plain.cost, atEdge: plain.atEdge };
  return { sx: results[i].sx, sy: results[i].sy, scale, cost: results[i].cost, atEdge: results[i].atEdge };
}

/**
 * Per-pair and summed camera motion over a sequence of frames.
 * `srcWidth` rescales dx/dy into source-video pixels (defaults to analysis pixels).
 */
export function estimateMotion(frames, w, h, { radius = 8, srcWidth = w } = {}) {
  const pairs = [];
  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1];
    const b = frames[i];
    const p = estimatePair(a, b, w, h, { radius });
    pairs.push({ dx: -p.sx, dy: -p.sy, scale: p.scale, energy: p.cost, atEdge: p.atEdge });
  }
  return summarizeMotion(pairs, w, h, srcWidth);
}

/** Sum per-pair camera motion (analysis pixels) into the ClipMetrics shape. Also used after dropping pairs that straddle a cut. */
export function summarizeMotion(pairs, w, h, srcWidth = w) {
  const k = srcWidth / w;
  if (!pairs.length) return { motion: { dx: 0, dy: 0, rot: 0, zoom: 0, energy: 0 }, pairs, w, h };
  const dx = pairs.reduce((s, p) => s + p.dx, 0);
  const dy = pairs.reduce((s, p) => s + p.dy, 0);
  const scale = pairs.reduce((s, p) => s * p.scale, 1);
  const energy = pairs.reduce((s, p) => s + p.energy, 0) / pairs.length;
  return {
    motion: {
      dx: round(dx * k, 1),
      dy: round(dy * k, 1),
      rot: 0,
      zoom: round((scale - 1) * 100, 2),
      energy: round(energy, 2),
    },
    pairs,
    w,
    h,
  };
}

/** Thresholds, as fractions of the frame (translation) and percent (zoom). */
export const MOVE_THRESHOLDS = {
  /** Net travel below this share of the frame is no pan / tilt. */
  travel: 0.03,
  /** Net zoom (percent) below this is no push / pull. */
  zoom: 3,
  /** A per-pair shift under this share of the frame is noise when counting reversals. */
  jitter: 0.004,
};

/**
 * Name the move. `pairs` are analysis-pixel camera shifts; w/h the analysis size.
 * Order of evidence: handheld wobble, then whichever of zoom / pan / tilt is
 * largest relative to its threshold; static when nothing clears its bar.
 */
export function classifyMove({ pairs, w, h }, t = MOVE_THRESHOLDS) {
  if (!pairs || !pairs.length) return "unknown";
  const netX = pairs.reduce((s, p) => s + p.dx, 0) / w;
  const netY = pairs.reduce((s, p) => s + p.dy, 0) / h;
  const pathX = pairs.reduce((s, p) => s + Math.abs(p.dx), 0) / w;
  const pathY = pairs.reduce((s, p) => s + Math.abs(p.dy), 0) / h;
  const zoom = (pairs.reduce((s, p) => s * p.scale, 1) - 1) * 100;

  // Handheld: the camera keeps reversing, going nowhere in particular.
  const reversals = (key, dim) => {
    let last = 0;
    let n = 0;
    for (const p of pairs) {
      const v = p[key] / dim;
      if (Math.abs(v) < t.jitter) continue;
      const sign = Math.sign(v);
      if (last && sign !== last) n += 1;
      last = sign;
    }
    return n;
  };
  const revX = reversals("dx", w);
  const revY = reversals("dy", h);
  const wobbleX = revX >= 2 && pathX >= t.travel && Math.abs(netX) < 0.5 * pathX;
  const wobbleY = revY >= 2 && pathY >= t.travel && Math.abs(netY) < 0.5 * pathY;
  if (wobbleX || wobbleY) {
    // A clear zoom still wins over wobble riding on top of it.
    if (Math.abs(zoom) < t.zoom * 1.5) return "handheld";
  }

  // A push toward a subject that is not dead centre also slides the picture:
  // magnifying by z about a point up to half a frame off-centre moves the
  // centre by up to z/2 of the frame. That much travel belongs to the zoom.
  const allowance = 0.5 * Math.abs(zoom) / 100;
  const residX = Math.max(0, Math.abs(netX) - allowance);
  const residY = Math.max(0, Math.abs(netY) - allowance);
  const scores = [
    { move: zoom > 0 ? "push-in" : "pull-out", score: Math.abs(zoom) / t.zoom },
    { move: netX > 0 ? "pan-right" : "pan-left", score: residX / t.travel },
    { move: netY > 0 ? "tilt-down" : "tilt-up", score: residY / t.travel },
  ].sort((x, y) => y.score - x.score);
  if (scores[0].score < 1) return "static";
  return scores[0].move;
}

function round(v, dp) {
  const m = 10 ** dp;
  return Math.round(v * m) / m;
}
