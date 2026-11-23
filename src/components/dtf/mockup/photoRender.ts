"use client";

// ---------------------------------------------------------------------------
// Photo mockups: a real photograph of a blank WHITE garment, recoloured to the
// chosen fabric and printed on, the way a mockup house does it in Photoshop.
//
//   shading  s = photo luminance / the lit-cloth luminance (1 = lit cloth)
//   fabric   = colour · s^γ (+ a little sheen on dark cloth), γ grows as the
//              colour darkens so folds stay visible on black
//   print    = artwork × (s / s̄)^1.3 × (1 + knit detail), clipped to the cloth
//
// Everything is computed once per photo (and once per colour) in the browser
// from the photo itself, so a new garment is one photo and one calibration.
// The production file never goes near any of this: it is preview-only.
// ---------------------------------------------------------------------------

import { drawLayers, makeCanvas } from "@/lib/dtf/render";
import type { Layer, RectCm } from "@/lib/dtf/types";
import { photoExtent, type GarmentPhoto, type Scene } from "@/lib/dtf/mockups";

const WORK_MAX = 1400; // working resolution of the maps (px, long edge)

export interface PhotoMaps {
  w: number;
  h: number;
  /** Shading, 0..~1.15, per pixel. */
  s: Float32Array;
  /** Cloth coverage, 0..1, per pixel. */
  a: Float32Array;
  /** Grey multiply map for the print (opaque). */
  shade: HTMLCanvasElement;
  /** Cloth alpha (white, alpha = coverage) for clipping. */
  mask: HTMLCanvasElement;
  /** For scenes: the untouched photo, drawn under the recoloured cloth. */
  photo: HTMLCanvasElement;
  /** Displacement field for scenes: smoothed shading gradient. */
  gx?: Float32Array;
  gy?: Float32Array;
  tints: Map<string, HTMLCanvasElement>;
}

const cache = new Map<string, Promise<PhotoMaps | null>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => ok(im);
    im.onerror = () => fail(new Error(`Could not load ${src}`));
    im.src = src;
  });
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function percentile(values: Float32Array, weights: Float32Array, p: number): number {
  const hist = new Float64Array(512);
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    if (weights[i] < 0.5) continue;
    hist[Math.min(511, Math.max(0, Math.round(values[i] * 340)))]++;
    total++;
  }
  if (!total) return 1;
  let acc = 0;
  for (let i = 0; i < 512; i++) {
    acc += hist[i];
    if (acc >= total * p) return i / 340;
  }
  return 1;
}

/**
 * Build the maps for one photo. `maskSrc` is a separate grey PNG for scene
 * photos (which are opaque); product photos carry their own alpha.
 */
export function photoMaps(src: string, opts: { maskSrc?: string; flip?: boolean; displacement?: boolean; detail?: number } = {}): Promise<PhotoMaps | null> {
  const key = `${src}|${opts.maskSrc ?? ""}|${opts.flip ? 1 : 0}|${opts.detail ?? 6}`;
  let p = cache.get(key);
  if (!p) {
    p = build(src, opts).catch((e) => {
      console.warn("[dtf] mockup photo failed", e);
      cache.delete(key);
      return null;
    });
    cache.set(key, p);
  }
  return p;
}

async function build(src: string, opts: { maskSrc?: string; flip?: boolean; displacement?: boolean; detail?: number }): Promise<PhotoMaps> {
  const [im, mk] = await Promise.all([loadImage(src), opts.maskSrc ? loadImage(opts.maskSrc) : Promise.resolve(null)]);
  const sc = Math.min(1, WORK_MAX / Math.max(im.naturalWidth, im.naturalHeight));
  const w = Math.round(im.naturalWidth * sc);
  const h = Math.round(im.naturalHeight * sc);
  const draw = (img: HTMLImageElement) => {
    const c = makeCanvas(w, h);
    const x = c.getContext("2d", { willReadFrequently: true })!;
    if (opts.flip) {
      x.translate(w, 0);
      x.scale(-1, 1);
    }
    x.drawImage(img, 0, 0, w, h);
    return c;
  };
  const photo = draw(im);
  const px = photo.getContext("2d")!.getImageData(0, 0, w, h).data;
  const mpx = mk ? draw(mk).getContext("2d")!.getImageData(0, 0, w, h).data : null;

  const n = w * h;
  const L = new Float32Array(n);
  const a = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    L[i] = (px[j] * 0.299 + px[j + 1] * 0.587 + px[j + 2] * 0.114) / 255;
    a[i] = mpx ? mpx[j] / 255 : px[j + 3] / 255;
  }
  const ref = Math.max(0.2, percentile(L, a, 0.9));
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.min(1.15, L[i] / ref);
  const mid = Math.max(0.3, percentile(s, a, 0.6));

  // Knit detail = luminance minus a small blur of it. Scenes are softer photos
  // whose "detail" is mostly noise, so they take less of it.
  const detail = opts.detail ?? 6;
  const blur = boxBlur(L, w, h, Math.max(1, Math.round(3 * (w / 800))));
  const shade = makeCanvas(w, h);
  const mask = makeCanvas(w, h);
  {
    const sd = shade.getContext("2d")!.createImageData(w, h);
    const md = mask.getContext("2d")!.createImageData(w, h);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const det = (L[i] - blur[i]) / ref;
      const v = Math.max(0, Math.min(1, Math.pow(Math.min(1, s[i] / mid), 1.3) * (1 + det * detail)));
      const g = Math.round(v * 255);
      sd.data[j] = sd.data[j + 1] = sd.data[j + 2] = g;
      sd.data[j + 3] = 255;
      md.data[j] = md.data[j + 1] = md.data[j + 2] = 255;
      md.data[j + 3] = Math.round(a[i] * 255);
    }
    shade.getContext("2d")!.putImageData(sd, 0, 0);
    mask.getContext("2d")!.putImageData(md, 0, 0);
  }

  let gx: Float32Array | undefined;
  let gy: Float32Array | undefined;
  if (opts.displacement) {
    // Folds push the print sideways along the shading slope: a wide blur so the
    // print bends with the fold rather than every thread.
    const wide = boxBlur(s, w, h, Math.max(2, Math.round(w / 90)));
    gx = new Float32Array(n);
    gy = new Float32Array(n);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        gx[i] = (wide[i + 1] - wide[i - 1]) * 0.5;
        gy[i] = (wide[i + w] - wide[i - w]) * 0.5;
      }
  }

  return { w, h, s, a, shade, mask, photo, gx, gy, tints: new Map() };
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

/** The cloth recoloured to `hex`, alpha = cloth coverage. Cached per colour. */
export function tinted(m: PhotoMaps, hex: string, heather = false): HTMLCanvasElement {
  const key = `${hex}${heather ? "h" : ""}`;
  const hit = m.tints.get(key);
  if (hit) return hit;
  const [r, g, b] = hexRgb(hex);
  const lum = r * 0.299 + g * 0.587 + b * 0.114;
  const dark = 1 - lum;
  const gamma = 1 + 1.8 * dark;
  const c = makeCanvas(m.w, m.h);
  const ctx = c.getContext("2d")!;
  const d = ctx.createImageData(m.w, m.h);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0, j = 0; i < m.s.length; i++, j += 4) {
    const al = m.a[i];
    if (al <= 0.004) continue;
    const s = m.s[i];
    const sc = Math.min(1, s);
    const k = Math.pow(sc, gamma);
    const sheen = 0.07 * dark * sc * sc * sc * sc;
    const hi = Math.max(0, Math.min(1, (s - 0.92) / 0.23)) * 0.06;
    // Heather: a fine salt-and-pepper of lighter and darker fibres.
    const fib = heather ? (rnd() - 0.5) * 0.16 : 0;
    const ch = (v: number) => {
      const base = v * k * (1 + fib);
      return Math.round(Math.max(0, Math.min(1, base + (1 - base) * sheen + hi)) * 255);
    };
    d.data[j] = ch(r);
    d.data[j + 1] = ch(g);
    d.data[j + 2] = ch(b);
    d.data[j + 3] = Math.round(al * 255);
  }
  ctx.putImageData(d, 0, 0);
  m.tints.set(key, c);
  return c;
}

const scratch: { t?: HTMLCanvasElement } = {};
function scratchCanvas(w: number, h: number): HTMLCanvasElement {
  const t = (scratch.t ??= makeCanvas(w, h));
  if (t.width !== w || t.height !== h) {
    t.width = w;
    t.height = h;
  }
  return t;
}

/**
 * Lay an artwork canvas (already in the photo's frame, same size as dw×dh)
 * onto the cloth: shaded by the folds, textured by the knit, clipped to cloth.
 */
export function pressPrint(ctx: CanvasRenderingContext2D, m: PhotoMaps, print: HTMLCanvasElement, dx: number, dy: number, dw: number, dh: number): void {
  const W = Math.max(1, Math.round(dw));
  const H = Math.max(1, Math.round(dh));
  const t = scratchCanvas(W, H);
  const x = t.getContext("2d")!;
  x.save();
  x.globalCompositeOperation = "source-over";
  x.clearRect(0, 0, W, H);
  x.drawImage(m.shade, 0, 0, W, H);
  x.globalCompositeOperation = "destination-in";
  x.drawImage(print, 0, 0, W, H);
  x.globalCompositeOperation = "multiply";
  x.drawImage(print, 0, 0, W, H);
  x.globalCompositeOperation = "destination-in";
  x.drawImage(m.mask, 0, 0, W, H);
  x.restore();
  ctx.drawImage(t, dx, dy, dw, dh);
}

/** The artwork for one side drawn in the photo's own frame. */
export function printInPhotoFrame(photo: GarmentPhoto, layers: Layer[], w: number, h: number, into?: HTMLCanvasElement): { canvas: HTMLCanvasElement; missing: string[] } {
  const ext = photoExtent(photo);
  const c = into ?? makeCanvas(w, h);
  if (c.width !== Math.round(w) || c.height !== Math.round(h)) {
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
  }
  const missing = drawLayers(c.getContext("2d")!, layers, { extent: ext, pxPerCm: c.width / ext.w, background: null, hq: true });
  return { canvas: c, missing };
}

/** A finished product-photo mockup as a canvas (bag thumbnails, order mockups). */
export async function renderProductMockup(photo: GarmentPhoto, hex: string, heather: boolean, layers: Layer[], size: number, background: string | null = "#F4F4F2"): Promise<HTMLCanvasElement | null> {
  const m = await photoMaps(photo.src, { flip: photo.flip });
  if (!m) return null;
  const sc = size / Math.max(m.w, m.h);
  const w = Math.round(m.w * sc);
  const h = Math.round(m.h * sc);
  const out = makeCanvas(w, h);
  const ctx = out.getContext("2d")!;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(tinted(m, hex, heather), 0, 0, w, h);
  const { canvas } = printInPhotoFrame(photo, layers, w, h);
  pressPrint(ctx, m, canvas, 0, 0, w, h);
  return out;
}

// ----- scenes ---------------------------------------------------------------

/** Solve the homography that maps the unit square onto quad (tl, tr, br, bl). */
function squareToQuad(q: [number, number][]): (u: number, v: number) => [number, number] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = den ? (sx * dy2 - dx2 * sy) / den : 0;
  const h = den ? (dx1 * sy - sx * dy1) / den : 0;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  return (u, v) => {
    const z = g * u + h * v + 1;
    return [(a * u + b * v + c) / z, (d * u + e * v + f) / z];
  };
}

function drawTriangle(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, s: number[], d: number[]): void {
  const [sx0, sy0, sx1, sy1, sx2, sy2] = s;
  let [dx0, dy0, dx1, dy1, dx2, dy2] = d;
  // Grow the destination triangle a hair so neighbours overlap (no seams).
  const cx = (dx0 + dx1 + dx2) / 3, cy = (dy0 + dy1 + dy2) / 3;
  const grow = (x: number, y: number): [number, number] => {
    const vx = x - cx, vy = y - cy, l = Math.hypot(vx, vy) || 1;
    return [x + (vx / l) * 0.6, y + (vy / l) * 0.6];
  };
  [dx0, dy0] = grow(dx0, dy0);
  [dx1, dy1] = grow(dx1, dy1);
  [dx2, dy2] = grow(dx2, dy2);
  const den = sx0 * (sy1 - sy2) - sx1 * (sy0 - sy2) + sx2 * (sy0 - sy1);
  if (!den) return;
  const a = (dx0 * (sy1 - sy2) - dx1 * (sy0 - sy2) + dx2 * (sy0 - sy1)) / den;
  const b = (dy0 * (sy1 - sy2) - dy1 * (sy0 - sy2) + dy2 * (sy0 - sy1)) / den;
  const c = (sx0 * (dx1 - dx2) - sx1 * (dx0 - dx2) + sx2 * (dx0 - dx1)) / den;
  const dd = (sx0 * (dy1 - dy2) - sx1 * (dy0 - dy2) + sx2 * (dy0 - dy1)) / den;
  const e = (sx0 * (sy1 * dx2 - sy2 * dx1) - sx1 * (sy0 * dx2 - sy2 * dx0) + sx2 * (sy0 * dx1 - sy1 * dx0)) / den;
  const f = (sx0 * (sy1 * dy2 - sy2 * dy1) - sx1 * (sy0 * dy2 - sy2 * dy0) + sx2 * (sy0 * dy1 - sy1 * dy0)) / den;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dx0, dy0);
  ctx.lineTo(dx1, dy1);
  ctx.lineTo(dx2, dy2);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(a, b, c, dd, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/**
 * Render one lifestyle scene: the photo with its cloth recoloured, and the
 * side's artwork bent through the scene's print quad, its folds and its light.
 */
export async function renderScene(scene: Scene, hex: string, heather: boolean, layers: Layer[], size: number): Promise<HTMLCanvasElement | null> {
  const m = await photoMaps(scene.src, { maskSrc: scene.mask, displacement: true, detail: 2.5 });
  if (!m) return null;
  const sc = size / Math.max(m.w, m.h);
  const W = Math.round(m.w * sc);
  const H = Math.round(m.h * sc);
  const out = makeCanvas(W, H);
  const ctx = out.getContext("2d")!;
  ctx.drawImage(m.photo, 0, 0, W, H);
  ctx.drawImage(tinted(m, hex, heather), 0, 0, W, H);

  const visible = layers.filter((l) => !l.hidden);
  if (!visible.length) return out;

  // Artwork for the scene's rectangle, at enough resolution for the quad.
  const rect: RectCm = scene.rect;
  const qpx = scene.quad.map(([x, y]) => [x * W, y * H] as [number, number]);
  const span = Math.max(Math.hypot(qpx[1][0] - qpx[0][0], qpx[1][1] - qpx[0][1]), Math.hypot(qpx[3][0] - qpx[0][0], qpx[3][1] - qpx[0][1]));
  const ppc = Math.min(30, Math.max(6, (span * 1.5) / Math.max(rect.w, rect.h)));
  const art = makeCanvas(rect.w * ppc, rect.h * ppc);
  drawLayers(art.getContext("2d")!, visible, { extent: rect, pxPerCm: ppc, background: null, hq: true });

  const map = squareToQuad(qpx);
  const N = 22;
  const strength = (scene.displace ?? 1) * W * 0.9;
  const pts: [number, number][][] = [];
  for (let j = 0; j <= N; j++) {
    const row: [number, number][] = [];
    for (let i = 0; i <= N; i++) {
      let [x, y] = map(i / N, j / N);
      if (m.gx && m.gy) {
        const mx = Math.min(m.w - 1, Math.max(0, Math.round(x / sc)));
        const my = Math.min(m.h - 1, Math.max(0, Math.round(y / sc)));
        const k = my * m.w + mx;
        x += m.gx[k] * strength;
        y += m.gy[k] * strength;
      }
      row.push([x, y]);
    }
    pts.push(row);
  }
  const warped = makeCanvas(W, H);
  const wx = warped.getContext("2d")!;
  wx.imageSmoothingQuality = "high";
  const aw = art.width / N, ah = art.height / N;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const s0 = [i * aw, j * ah], s1 = [(i + 1) * aw, j * ah], s2 = [(i + 1) * aw, (j + 1) * ah], s3 = [i * aw, (j + 1) * ah];
      const d0 = pts[j][i], d1 = pts[j][i + 1], d2 = pts[j + 1][i + 1], d3 = pts[j + 1][i];
      drawTriangle(wx, art, [...s0, ...s1, ...s2], [...d0, ...d1, ...d2]);
      drawTriangle(wx, art, [...s0, ...s2, ...s3], [...d0, ...d2, ...d3]);
    }
  pressPrint(ctx, m, warped, 0, 0, W, H);
  return out;
}
