// ---------------------------------------------------------------------------
// The one renderer. The editor canvas, the 3D garment's print texture and the
// 300 DPI production file are all this function at different resolutions —
// which is what keeps the mockup, the editor and the transfer identical.
//
// Browser-only (canvas). Pure geometry lives in ./project.ts.
// ---------------------------------------------------------------------------

import { getFont, snapWeight } from "./fonts";
import type { Layer, RectCm, TextLayer } from "./types";

export type Drawable = HTMLImageElement | ImageBitmap | HTMLCanvasElement;

/** Decoded images by src. Shared by every render so nothing decodes twice. */
const cache = new Map<string, Promise<Drawable | null>>();
const ready = new Map<string, Drawable>();

export function loadDrawable(src: string): Promise<Drawable | null> {
  let p = cache.get(src);
  if (!p) {
    p = new Promise<Drawable | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      // A deadline: an off-page <img> can fail to settle in some embedded
      // browsers, and a render must never hang on one picture.
      const timer = setTimeout(() => resolve(null), 20_000);
      img.onload = () => {
        clearTimeout(timer);
        ready.set(src, img);
        resolve(img);
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = src;
    });
    cache.set(src, p);
  }
  return p;
}

/** Synchronous lookup for hot paths (60 fps drags). */
export function drawableNow(src: string): Drawable | undefined {
  return ready.get(src);
}

/** Make sure every image layer is decoded. */
export async function preload(layers: Layer[]): Promise<void> {
  await Promise.all(layers.filter((l) => l.kind === "image").map((l) => loadDrawable((l as { src: string }).src)));
}

/** Swap a cached src (e.g. blob: → served URL) without a flash. */
export function aliasDrawable(from: string, to: string): void {
  const d = ready.get(from);
  if (d) {
    ready.set(to, d);
    cache.set(to, Promise.resolve(d));
  }
}

// ----- text --------------------------------------------------------------------------

let measureCtx: CanvasRenderingContext2D | null = null;
const MEASURE_PX = 200;

function fontString(t: TextLayer, px: number): string {
  const f = getFont(t.font);
  return `${t.italic ? "italic " : ""}${snapWeight(f, t.weight)} ${px}px "${f.family}", system-ui, sans-serif`;
}

function lines(t: TextLayer): string[] {
  return (t.uppercase ? t.text.toUpperCase() : t.text).split("\n");
}

/** Width of one line including tracking, in px at the given font size. */
function lineWidth(ctx: CanvasRenderingContext2D, line: string, px: number, tracking: number): number {
  const base = ctx.measureText(line).width;
  return base + Math.max(0, line.length - 1) * tracking * px;
}

/** Real text box size in cm, measured with the actual font. */
export function measureText(t: TextLayer): { w: number; h: number } {
  if (typeof document === "undefined") {
    return { w: t.w || 1, h: t.h || 1 };
  }
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  const ctx = measureCtx!;
  ctx.font = fontString(t, MEASURE_PX);
  const ls = lines(t);
  const widest = Math.max(...ls.map((l) => lineWidth(ctx, l, MEASURE_PX, t.letterSpacing)), MEASURE_PX * 0.3);
  const k = t.fontSizeCm / MEASURE_PX;
  return { w: Math.round(widest * k * 100) / 100, h: Math.round(ls.length * t.lineHeight * t.fontSizeCm * 100) / 100 };
}

function drawText(ctx: CanvasRenderingContext2D, t: TextLayer, pxPerCm: number) {
  const px = t.fontSizeCm * pxPerCm;
  ctx.font = fontString(t, px);
  ctx.fillStyle = t.color;
  ctx.textBaseline = "middle";
  const ls = lines(t);
  const lh = t.lineHeight * px;
  const boxW = t.w * pxPerCm;
  const top = -(ls.length * lh) / 2 + lh / 2;
  ls.forEach((line, i) => {
    const w = lineWidth(ctx, line, px, t.letterSpacing);
    const startX = t.align === "left" ? -boxW / 2 : t.align === "right" ? boxW / 2 - w : -w / 2;
    const y = top + i * lh;
    if (!t.letterSpacing) {
      ctx.textAlign = "left";
      ctx.fillText(line, startX, y);
      return;
    }
    // Manual tracking: per-glyph advance keeps kerning inside each glyph and
    // renders the same in every browser (ctx.letterSpacing is not universal).
    let x = startX;
    ctx.textAlign = "left";
    for (const ch of line) {
      ctx.fillText(ch, x, y);
      x += ctx.measureText(ch).width + t.letterSpacing * px;
    }
  });
}

// ----- the side renderer ----------------------------------------------------------------

export interface RenderOptions {
  /** The side-space rectangle the canvas covers, cm. */
  extent: RectCm;
  pxPerCm: number;
  /** Fill colour behind the artwork, or null for transparent. */
  background?: string | null;
  /** Skip layers by id (e.g. the one being dragged is drawn by DOM). */
  skip?: Set<string>;
  /** Highest quality resampling (production). */
  hq?: boolean;
}

/**
 * Draw layers (bottom first) onto ctx. Returns the ids of image layers whose
 * pixels were not decoded yet — the caller re-renders once they are.
 */
export function drawLayers(ctx: CanvasRenderingContext2D, layers: Layer[], opts: RenderOptions): string[] {
  const { extent, pxPerCm } = opts;
  const minX = extent.x - extent.w / 2;
  const maxY = extent.y + extent.h / 2;
  const missing: string[] = [];
  ctx.save();
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = opts.hq ? "high" : "medium";
  for (const l of layers) {
    if (l.hidden || opts.skip?.has(l.id) || l.opacity <= 0) continue;
    ctx.save();
    ctx.globalAlpha = l.opacity;
    ctx.translate((l.x - minX) * pxPerCm, (maxY - l.y) * pxPerCm);
    if (l.rotation) ctx.rotate((l.rotation * Math.PI) / 180);
    if (l.kind === "image") {
      const d = drawableNow(l.src);
      if (d) {
        ctx.drawImage(d, (-l.w / 2) * pxPerCm, (-l.h / 2) * pxPerCm, l.w * pxPerCm, l.h * pxPerCm);
      } else {
        missing.push(l.id);
        void loadDrawable(l.src);
      }
    } else {
      drawText(ctx, l, pxPerCm);
    }
    ctx.restore();
  }
  ctx.restore();
  return missing;
}

/** Make a canvas (OffscreenCanvas is avoided: text + images must match DOM fonts exactly). */
export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
