"use client";

// ---------------------------------------------------------------------------
// Photos — building ONE picture out of several uploads.
//
// The job this does: you photograph a truck from six angles, drop all six in at
// once, and say "make these into a collage and put 'FOR SALE — 2019 F-150'
// across the bottom". Six files go in; one picture comes out, and it is that
// picture — not the six — that gets reviewed, filed and backed up.
//
// It runs in the BROWSER, on a canvas, for two reasons. The pixels never leave
// the device to be assembled, and it works with no AI key at all: the model is
// asked only what the user MEANT ("a collage? which words?"), never to draw
// anything. So the picture is always produced, even offline, and only the
// wording degrades.
//
// Everything that decides the shape of the result is pure and exported, so the
// layout maths is testable without a canvas.
// ---------------------------------------------------------------------------

/** The longest edge of the finished picture. Big enough to print, small enough to store. */
const MAX_EDGE = 1800;

export type CollageLayout = "grid" | "row" | "column";
export type CaptionPosition = "top" | "bottom" | "center";
export type CaptionSize = "small" | "medium" | "large";

export interface CollageSpec {
  layout: CollageLayout;
  /** CSS colour behind and between the tiles. */
  background: string;
  /** Pixels between tiles, before the picture is scaled to its final size. */
  gap: number;
}

export interface CaptionSpec {
  text: string;
  position: CaptionPosition;
  size: CaptionSize;
  color: string;
  /** Draw a solid band behind the words, so they read over a busy photo. */
  band: boolean;
}

export const DEFAULT_COLLAGE: CollageSpec = { layout: "grid", background: "#0b0d12", gap: 12 };

export const DEFAULT_CAPTION: Omit<CaptionSpec, "text"> = {
  position: "bottom",
  size: "medium",
  color: "#ffffff",
  band: true,
};

/**
 * Rows and columns for `count` pictures.
 *
 * Six wants 3x2, not 4x2 with two holes in it — so the column count is the
 * square root rounded up, which is the shape that leaves the fewest empty cells.
 */
export function gridShape(count: number, layout: CollageLayout): { cols: number; rows: number } {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (layout === "row") return { cols: count, rows: 1 };
  if (layout === "column") return { cols: 1, rows: count };
  const cols = Math.ceil(Math.sqrt(count));
  return { cols, rows: Math.ceil(count / cols) };
}

/** Height of the caption band, as a share of the picture's short edge. */
export function captionHeight(size: CaptionSize, shortEdge: number): number {
  const share = size === "large" ? 0.18 : size === "small" ? 0.09 : 0.13;
  return Math.round(shortEdge * share);
}

/**
 * Break text into lines that fit `maxWidth`.
 *
 * A single word wider than the line is left to overhang rather than chopped: a
 * broken word reads as a bug, a long one reads as a long word.
 */
export function wrapLines(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n+/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? line + " " + word : word;
      if (line && measure(next) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }
  return lines.slice(0, 6);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Could not read that image."));
    r.onload = () => resolve(String(r.result ?? ""));
    r.readAsDataURL(blob);
  });
}

/** Draw `img` to fill the cell exactly, cropping the overflow rather than squashing it. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

export interface ComposeArgs {
  files: File[];
  /** null means "do not tile" — the caption is burned onto the single file instead. */
  collage: CollageSpec | null;
  caption: CaptionSpec | null;
  /** Name for the result, without an extension. */
  title?: string;
}

/**
 * Turn a batch into one image file.
 *
 * "Add this quote to this image" is the same operation with one tile and no
 * collage, which is why both live here rather than in two near-identical files.
 */
export async function composeBatch(args: ComposeArgs): Promise<File> {
  const files = args.files.filter(Boolean);
  if (!files.length) throw new Error("There are no pictures to work with.");

  const images: HTMLImageElement[] = [];
  for (const f of files) {
    const img = await loadImage(await readAsDataUrl(f));
    if (img) images.push(img);
  }
  if (!images.length) throw new Error("None of those files could be opened as a picture.");

  const tiled = Boolean(args.collage) && images.length > 1;
  const collage = args.collage ?? DEFAULT_COLLAGE;
  const { cols, rows } = tiled ? gridShape(images.length, collage.layout) : { cols: 1, rows: 1 };

  // Cell shape follows the first picture, so a batch of portraits makes a
  // portrait collage instead of cropping every one of them square.
  const aspect = images[0].width / images[0].height || 1;
  const gap = tiled ? collage.gap : 0;

  let cellW = 600;
  let cellH = Math.max(1, Math.round(cellW / aspect));
  let width = cols * cellW + gap * (cols + 1);
  let height = rows * cellH + gap * (rows + 1);

  // Scale the whole thing to the output ceiling in one step, so the gaps and the
  // caption stay in proportion instead of being sized against dimensions the
  // finished picture never has.
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  cellW = Math.max(1, Math.round(cellW * scale));
  cellH = Math.max(1, Math.round(cellH * scale));
  const g = Math.round(gap * scale);
  width = cols * cellW + g * (cols + 1);
  height = rows * cellH + g * (rows + 1);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser would not give us a canvas to draw on.");

  ctx.fillStyle = collage.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const drawn = tiled ? images : images.slice(0, 1);
  drawn.forEach((img, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    drawCover(ctx, img, g + c * (cellW + g), g + r * (cellH + g), cellW, cellH);
  });

  if (args.caption && args.caption.text.trim()) drawCaption(ctx, canvas, args.caption);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9),
  );
  if (!blob) throw new Error("The finished picture could not be saved.");

  const stem = (args.title ?? "").trim().replace(/[\\/:*?"<>|]+/g, "").slice(0, 60);
  const name = (stem || (tiled ? "Collage" : "Edited photo")) + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}

/** Burn the words into the picture, over a band when one is asked for. */
function drawCaption(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  caption: CaptionSpec,
): void {
  const shortEdge = Math.min(canvas.width, canvas.height);
  const bandH = captionHeight(caption.size, shortEdge);
  const fontSize = Math.max(12, Math.round(bandH * 0.42));
  const pad = Math.round(shortEdge * 0.04);

  ctx.font = "700 " + fontSize + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = wrapLines(caption.text.trim(), canvas.width - pad * 2, (t) => ctx.measureText(t).width);
  if (!lines.length) return;
  const lineH = Math.round(fontSize * 1.25);
  const blockH = lines.length * lineH + pad;

  const top =
    caption.position === "top"
      ? 0
      : caption.position === "center"
        ? Math.round((canvas.height - blockH) / 2)
        : canvas.height - blockH;

  if (caption.band) {
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(0, top, canvas.width, blockH);
  } else {
    // Words with no band still have to be readable over a bright photo, so they
    // get a shadow rather than being left to vanish into a white sky.
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = Math.round(fontSize * 0.35);
  }

  ctx.fillStyle = caption.color;
  lines.forEach((line, i) => {
    ctx.fillText(line, canvas.width / 2, top + pad / 2 + lineH / 2 + i * lineH);
  });
  ctx.shadowBlur = 0;
}
