// ---------------------------------------------------------------------------
// The memory behind the hover reveal (webgl-trail-reveal skill).
//
// A spotlight follows the cursor; a trail REMEMBERS it. Each point on the
// pointer's recent path ages on its own, so the tail of the scan closes before
// the head — that persistence is the whole effect. Pure functions over a small
// fixed-size buffer, uploaded to the shader as two uniform arrays each frame.
// ---------------------------------------------------------------------------

export const TRAIL_N = 24;

export interface TrailPoint {
  x: number;
  y: number;
  /** 0 = just painted, 1 = fully faded. */
  age: number;
}

/**
 * Add a pointer position (uv space, 0..1) unless it is too close to the last
 * one — an idle pointer must not flood the buffer with identical points and
 * push the visible path out. Oldest points drop first.
 */
export function pushPoint(points: TrailPoint[], x: number, y: number, minDist = 0.006, max = TRAIL_N): TrailPoint[] {
  const last = points[points.length - 1];
  if (last && Math.hypot(last.x - x, last.y - y) < minDist && last.age < 0.2) return points;
  const next = [...points, { x, y, age: 0 }];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Age every point by `dt` seconds over a `hold`-second lifetime; drop the dead ones. */
export function ageTrail(points: TrailPoint[], dt: number, hold = 0.75): TrailPoint[] {
  if (!points.length) return points;
  const step = Math.max(0, dt) / hold;
  const out: TrailPoint[] = [];
  for (const p of points) {
    const age = p.age + step;
    if (age < 1) out.push({ x: p.x, y: p.y, age });
  }
  return out;
}

/** The flat arrays the shader reads. Empty slots sit off-canvas and fully aged. */
export function trailUniforms(points: TrailPoint[], n = TRAIL_N): { pos: Float32Array; age: Float32Array } {
  const pos = new Float32Array(n * 2).fill(-10);
  const age = new Float32Array(n).fill(1);
  const start = Math.max(0, points.length - n);
  for (let i = start; i < points.length; i++) {
    const j = i - start;
    pos[j * 2] = points[i].x;
    pos[j * 2 + 1] = points[i].y;
    age[j] = points[i].age;
  }
  return { pos, age };
}

/**
 * object-fit: cover, as a uv transform. Returns the scale and offset that map
 * the plane's 0..1 uv into the texture so the art fills the tile uncropped on
 * its short side and centred on its long side.
 */
export function coverTransform(texW: number, texH: number, planeW: number, planeH: number): { scale: [number, number]; offset: [number, number] } {
  if (!texW || !texH || !planeW || !planeH) return { scale: [1, 1], offset: [0, 0] };
  const tex = texW / texH;
  const plane = planeW / planeH;
  if (tex > plane) {
    const s = plane / tex;
    return { scale: [s, 1], offset: [(1 - s) / 2, 0] };
  }
  const s = tex / plane;
  return { scale: [1, s], offset: [0, (1 - s) / 2] };
}

/** Ease-out for the flood that follows the scan: fast to start, settling into full colour. */
export function floodEase(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}
