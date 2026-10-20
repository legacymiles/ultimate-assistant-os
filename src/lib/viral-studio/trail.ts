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

/** The part of a still that is picture, as fractions of its width and height (0..1). */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL: Region = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Find letterbox and pillarbox bars: whole rows or columns at an edge that are
 * near-black and flat. Shorts cut from TV footage often carry thick black
 * bands; trimming them lets every poster fill its tile edge to edge.
 * `rgba` is a small downsampled copy of the image (e.g. 48×64).
 */
export function contentRegion(rgba: Uint8ClampedArray | number[], w: number, h: number, threshold = 30): Region {
  const lum = (i: number) => 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  // A band is "bar" when it is dark on average and almost nothing in it is
  // bright. Judging by the brightest pixel instead fails on every real bar:
  // compression noise, a watermark or a credit line sits in most of them.
  const dark = (samples: number[]) => {
    let sum = 0;
    let bright = 0;
    for (const v of samples) {
      sum += v;
      if (v > 70) bright++;
    }
    return sum / samples.length < threshold && bright / samples.length < 0.08;
  };
  const rowDark = (y: number) => {
    const s: number[] = [];
    for (let x = 0; x < w; x++) s.push(lum((y * w + x) * 4));
    return dark(s);
  };
  const colDark = (x: number, y0: number, y1: number) => {
    const s: number[] = [];
    for (let y = y0; y < y1; y++) s.push(lum((y * w + x) * 4));
    return dark(s);
  };
  let top = 0;
  while (top < h - 1 && rowDark(top)) top++;
  let bottom = h;
  while (bottom > top + 1 && rowDark(bottom - 1)) bottom--;
  let left = 0;
  while (left < w - 1 && colDark(left, top, bottom)) left++;
  let right = w;
  while (right > left + 1 && colDark(right - 1, top, bottom)) right--;
  const region = { x: left / w, y: top / h, w: (right - left) / w, h: (bottom - top) / h };
  // Mostly-dark frames (a night shot) are content, not bars; and a trim of a
  // pixel or two isn't worth the zoom.
  if (region.w < 0.35 || region.h < 0.35) return FULL;
  if (region.w > 0.96 && region.h > 0.96) return FULL;
  return region;
}

/**
 * object-fit: cover over a sub-region of the image. Returns the uv scale and
 * offset for the shader (texture flipped, so y counts from the bottom) and the
 * same framing as a CSS box in % of the tile.
 */
export function regionCover(
  natW: number,
  natH: number,
  region: Region,
  planeW: number,
  planeH: number,
): { scale: [number, number]; offset: [number, number]; css: { left: number; top: number; width: number; height: number } } {
  const cw = region.w * natW;
  const ch = region.h * natH;
  const s = Math.max(planeW / cw, planeH / ch);
  const vw = planeW / s;
  const vh = planeH / s;
  const sx = region.x * natW + (cw - vw) / 2;
  const sy = region.y * natH + (ch - vh) / 2;
  return {
    scale: [vw / natW, vh / natH],
    offset: [sx / natW, 1 - (sy + vh) / natH],
    css: {
      left: (-sx * s * 100) / planeW,
      top: (-sy * s * 100) / planeH,
      width: (natW * s * 100) / planeW,
      height: (natH * s * 100) / planeH,
    },
  };
}
