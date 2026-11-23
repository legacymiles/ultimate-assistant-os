// ---------------------------------------------------------------------------
// Production export + pixel tools (browser).
//
//   renderPrintFile — one print side → artwork-only PNG at the profile's DPI,
//                     exact physical size, trimmed to the visible artwork,
//                     pHYs written so ColorboxRIP opens it at true size.
//   analyzeLayer    — PixelStats for the readiness engine.
//   removeBackground — a NEW processed image; the original is never touched.
//
// Colour: pixels go out exactly as the browser decoded them (sRGB). There is
// no CMYK conversion, white generation, choke, ink limit, mirror or
// underbase here — the RIP and its installed profile own every one of those.
// ---------------------------------------------------------------------------

import { analyzePixels, type PixelStats } from "./readiness";
import { drawLayers, loadDrawable, makeCanvas, preload, type Drawable } from "./render";
import { effectiveDpi } from "./printers";
import { activeZone, sideLayers, unionBounds } from "./project";
import { withPhys } from "./png";
import type { DesignProject, ImageLayer, SideId } from "./types";

export interface PrintRender {
  blob: Blob;
  widthPx: number;
  heightPx: number;
  dpi: number;
  widthCm: number;
  heightCm: number;
  /** Trimmed artwork bounds in side space, cm. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Press position: top edge below the collar, horizontal offset of the centre. */
  pressTopCm: number;
  pressCenterOffsetCm: number;
  upsampled: boolean;
  minSourceDpi: number | null;
}

/** Largest canvas edge we will allocate (Chrome's hard limit is 32767). */
const MAX_EDGE = 16000;

export async function renderPrintFile(project: DesignProject, side: SideId, dpi = 300): Promise<PrintRender> {
  const layers = sideLayers(project, side);
  if (!layers.length) throw new Error("This side has no artwork.");
  await preload(layers);
  const loose = unionBounds(layers)!;
  const pad = 0.2; // cm, so antialiased edges are never clipped before trimming
  const extent = {
    x: (loose.minX + loose.maxX) / 2,
    y: (loose.minY + loose.maxY) / 2,
    w: loose.maxX - loose.minX + pad * 2,
    h: loose.maxY - loose.minY + pad * 2,
  };
  const pxPerCm = dpi / 2.54;
  const W = Math.round(extent.w * pxPerCm);
  const H = Math.round(extent.h * pxPerCm);
  if (W > MAX_EDGE || H > MAX_EDGE) throw new Error(`At ${dpi} DPI this side would be ${W}×${H} px — larger than a browser can render. Scale it down.`);
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const missing = drawLayers(ctx, layers, { extent, pxPerCm, background: null, hq: true });
  if (missing.length) throw new Error("Some artwork could not be loaded, so no print file was made.");

  // Trim fully transparent padding — the RIP should receive the artwork only.
  const img = ctx.getImageData(0, 0, W, H).data;
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    for (let x = 0; x < W; x++) {
      if (img[row + x * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error("This side renders as fully transparent — nothing would print.");
  const tw = x1 - x0 + 1;
  const th = y1 - y0 + 1;
  const out = makeCanvas(tw, th);
  out.getContext("2d")!.drawImage(canvas, x0, y0, tw, th, 0, 0, tw, th);

  const raw = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
  if (!raw) throw new Error("The browser could not encode the PNG.");
  const bytes = withPhys(new Uint8Array(await raw.arrayBuffer()), dpi);
  const blob = new Blob([bytes as BlobPart], { type: "image/png" });

  const minX = extent.x - extent.w / 2 + x0 / pxPerCm;
  const maxY = extent.y + extent.h / 2 - y0 / pxPerCm;
  const bounds = { minX, maxX: minX + tw / pxPerCm, maxY, minY: maxY - th / pxPerCm };

  let minSourceDpi: number | null = null;
  for (const l of layers) {
    if (l.kind !== "image" || l.mime === "image/svg+xml") continue;
    const d = Math.min(effectiveDpi(l.naturalW, l.w), effectiveDpi(l.naturalH, l.h));
    minSourceDpi = minSourceDpi === null ? d : Math.min(minSourceDpi, d);
  }

  return {
    blob,
    widthPx: tw,
    heightPx: th,
    dpi,
    widthCm: round(tw / pxPerCm),
    heightCm: round(th / pxPerCm),
    bounds,
    pressTopCm: round(-bounds.maxY),
    pressCenterOffsetCm: round((bounds.minX + bounds.maxX) / 2),
    upsampled: minSourceDpi !== null && minSourceDpi < dpi - 0.5,
    minSourceDpi: minSourceDpi === null ? null : Math.round(minSourceDpi),
  };
}

/** Where the active zone is, for labelling a print file. */
export function zoneLabel(project: DesignProject, side: SideId): string {
  return activeZone(project, side)?.label ?? side;
}

// ----- pixel analysis --------------------------------------------------------------

const ANALYSIS_EDGE = 768;
const statsCache = new Map<string, Promise<PixelStats | null>>();

function rasterFor(d: Drawable, maxEdge: number): { ctx: CanvasRenderingContext2D; w: number; h: number; scale: number } {
  const nw = "naturalWidth" in d ? d.naturalWidth : d.width;
  const nh = "naturalHeight" in d ? d.naturalHeight : d.height;
  const scale = Math.min(1, maxEdge / Math.max(nw || 1, nh || 1));
  const w = Math.max(1, Math.round((nw || maxEdge) * scale));
  const h = Math.max(1, Math.round((nh || maxEdge) * scale));
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(d, 0, 0, w, h);
  return { ctx, w, h, scale };
}

/** Pixel facts for one image layer (cached by src). */
export function analyzeLayer(layer: ImageLayer): Promise<PixelStats | null> {
  let p = statsCache.get(layer.src);
  if (!p) {
    p = (async () => {
      const d = await loadDrawable(layer.src);
      if (!d) return null;
      const { ctx, w, h, scale } = rasterFor(d, ANALYSIS_EDGE);
      return analyzePixels(ctx.getImageData(0, 0, w, h).data, w, h, scale);
    })();
    statsCache.set(layer.src, p);
  }
  return p;
}

// ----- background removal ---------------------------------------------------------

/**
 * Remove a flat background by flood-filling from the image border with a
 * colour tolerance (0–100), then softening only the 1-px boundary so the cut
 * is clean but not jagged. Works on logos, scans, screenshots and product
 * shots on a plain backdrop; it does not guess at a busy photo background
 * and says so (the caller shows the result for approval before it lands).
 *
 * Returns a PNG blob at the SOURCE resolution.
 */
export async function removeBackground(src: string, tolerance = 18): Promise<{ blob: Blob; width: number; height: number; removedRatio: number }> {
  const d = await loadDrawable(src);
  if (!d) throw new Error("Could not read that image.");
  const { ctx, w, h } = rasterFor(d, 6000);
  const im = ctx.getImageData(0, 0, w, h);
  const px = im.data;
  const n = w * h;
  const tol = (tolerance / 100) * 441; // max RGB distance √(3·255²)

  // Seed colour = the median of the border, robust to a logo touching an edge.
  const border: number[] = [];
  for (let x = 0; x < w; x += Math.max(1, (w / 200) | 0)) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y += Math.max(1, (h / 200) | 0)) border.push(y * w, y * w + w - 1);
  const ch = (k: number) => border.map((i) => px[i * 4 + k]).sort((a, b) => a - b)[border.length >> 1];
  const seed = [ch(0), ch(1), ch(2)];

  const near = (i: number) => {
    const o = i * 4;
    if (px[o + 3] < 8) return true;
    const dr = px[o] - seed[0];
    const dg = px[o + 1] - seed[1];
    const db = px[o + 2] - seed[2];
    return Math.sqrt(dr * dr + dg * dg + db * db) <= tol;
  };

  const bg = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const push = (i: number) => {
    if (!bg[i] && near(i)) {
      bg[i] = 1;
      stack[sp++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (sp) {
    const i = stack[--sp];
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < n - w) push(i + w);
  }

  let removed = 0;
  for (let i = 0; i < n; i++) {
    if (bg[i]) {
      px[i * 4 + 3] = 0;
      removed++;
    }
  }
  // One-pixel edge: pixels touching the removed area become partly
  // transparent in proportion to how close they are to the background colour.
  // That kills the coloured fringe without leaving a soft halo for DTF.
  for (let i = 0; i < n; i++) {
    if (bg[i]) continue;
    const x = i % w;
    const touching = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (i >= w && bg[i - w]) || (i < n - w && bg[i + w]);
    if (!touching) continue;
    const o = i * 4;
    const dr = px[o] - seed[0];
    const dg = px[o + 1] - seed[1];
    const db = px[o + 2] - seed[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    const k = Math.min(1, dist / Math.max(1, tol * 2.2));
    px[o + 3] = Math.round(px[o + 3] * (k < 0.5 ? 0 : 1));
  }
  ctx.putImageData(im, 0, 0);
  const blob = await new Promise<Blob | null>((r) => ctx.canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("Could not encode the result.");
  return { blob, width: w, height: h, removedRatio: removed / n };
}

const round = (n: number) => Math.round(n * 100) / 100;
