// ---------------------------------------------------------------------------
// The DTF artwork validation engine.
//
// Two halves, both pure so they are tested without a browser:
//   analyzePixels — reads one image's RGBA once and keeps the facts a DTF
//                   print depends on (alpha, border, soft edges, thin strokes)
//   checkProject  — combines those facts with WHERE and HOW BIG each layer
//                   prints, against a printer profile, into plain-English issues
//
// Nothing here changes artwork. It reports; the customer or the operator acts.
// ---------------------------------------------------------------------------

import { getGarment } from "./garments";
import { effectiveDpi } from "./printers";
import { activeZone, layerBounds, rectBounds, sideLayers, unionBounds } from "./project";
import type { CheckId, DesignProject, ImageLayer, PrinterProfile, ReadinessIssue, ReadinessReport, Severity, SideId } from "./types";

export interface PixelStats {
  width: number;
  height: number;
  /** Scale of the analysed bitmap relative to the source (≤ 1). */
  scale: number;
  /** Any pixel with alpha < 250. */
  hasAlpha: boolean;
  /** Fraction of pixels that are fully transparent. */
  transparentRatio: number;
  /** Fraction of the outer 1px border that is opaque. */
  borderOpaqueRatio: number;
  /** The border's average colour when it is mostly opaque. */
  borderColor: string | null;
  /** How uniform the opaque border is: 0 = noisy photo edge, 1 = flat colour. */
  borderUniformity: number;
  /** Of visible pixels, the fraction that are semi-transparent (8 < a < 240). */
  semiRatio: number;
  /**
   * Stroke-width histogram: for ridge pixels of the alpha mask (the centre
   * lines of shapes), count by half-width in analysed pixels, index 1..32
   * (index 32 = "32 or more"). A thin line has a ridge with a small half-width.
   */
  ridge: number[];
  /** Visible (alpha ≥ 128) pixel count in the analysed bitmap. */
  visible: number;
  /** Tight bounds of visible pixels, as fractions of the image (0..1). */
  content: { x0: number; y0: number; x1: number; y1: number } | null;
}

const RIDGE_MAX = 32;

/** Analyse RGBA pixels. `scale` = analysed width / source width. */
export function analyzePixels(data: Uint8ClampedArray | Uint8Array, width: number, height: number, scale = 1): PixelStats {
  const n = width * height;
  let transparent = 0;
  let semi = 0;
  let visible = 0;
  let anyAlpha = false;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    if (a < 250) anyAlpha = true;
    if (a <= 8) transparent++;
    else {
      if (a < 240) semi++;
      if (a >= 128) {
        visible++;
        mask[i] = 1;
        const x = i % width;
        const y = (i / width) | 0;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }

  // Border: is the image framed by a flat, opaque colour (a background)?
  let bCount = 0;
  let bOpaque = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  const border: number[] = [];
  const visit = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    bCount++;
    if (data[i + 3] > 240) {
      bOpaque++;
      sr += data[i];
      sg += data[i + 1];
      sb += data[i + 2];
      border.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    visit(x, 0);
    if (height > 1) visit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    visit(0, y);
    if (width > 1) visit(width - 1, y);
  }
  let borderColor: string | null = null;
  let uniformity = 0;
  if (bOpaque > 0) {
    const r = sr / bOpaque;
    const g = sg / bOpaque;
    const b = sb / bOpaque;
    borderColor = `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
    let dev = 0;
    for (const i of border) dev += Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b);
    const meanDev = dev / bOpaque / 3;
    uniformity = Math.max(0, 1 - meanDev / 40);
  }

  // Chamfer distance transform of the visible mask (distance to the nearest
  // non-visible pixel), then ridge pixels = local maxima. Their distance is
  // the half-width of the stroke they sit in.
  const dist = new Float32Array(n);
  const INF = 1e9;
  for (let i = 0; i < n; i++) dist[i] = mask[i] ? INF : 0;
  const A = 1;
  const B = Math.SQRT2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!dist[i]) continue;
      let d = dist[i];
      // Edges of the image count as background, so artwork touching the edge
      // is measured from the edge rather than infinitely thick.
      if (x === 0 || y === 0) d = Math.min(d, A);
      if (x > 0) d = Math.min(d, dist[i - 1] + A);
      if (y > 0) {
        d = Math.min(d, dist[i - width] + A);
        if (x > 0) d = Math.min(d, dist[i - width - 1] + B);
        if (x < width - 1) d = Math.min(d, dist[i - width + 1] + B);
      }
      dist[i] = d;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!dist[i]) continue;
      let d = dist[i];
      if (x === width - 1 || y === height - 1) d = Math.min(d, A);
      if (x < width - 1) d = Math.min(d, dist[i + 1] + A);
      if (y < height - 1) {
        d = Math.min(d, dist[i + width] + A);
        if (x < width - 1) d = Math.min(d, dist[i + width + 1] + B);
        if (x > 0) d = Math.min(d, dist[i + width - 1] + B);
      }
      dist[i] = d;
    }
  }
  const ridge = new Array<number>(RIDGE_MAX + 1).fill(0);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const d = dist[i];
      if (!d) continue;
      if (
        d >= dist[i - 1] && d >= dist[i + 1] && d >= dist[i - width] && d >= dist[i + width] &&
        d >= dist[i - width - 1] && d >= dist[i - width + 1] && d >= dist[i + width - 1] && d >= dist[i + width + 1]
      ) {
        ridge[Math.min(RIDGE_MAX, Math.max(1, Math.round(d)))]++;
      }
    }
  }

  return {
    width,
    height,
    scale,
    hasAlpha: anyAlpha,
    transparentRatio: n ? transparent / n : 0,
    borderOpaqueRatio: bCount ? bOpaque / bCount : 0,
    borderColor,
    borderUniformity: uniformity,
    semiRatio: visible + semi ? semi / (visible + semi) : 0,
    ridge,
    visible,
    content: x1 >= 0 ? { x0: x0 / width, y0: y0 / height, x1: (x1 + 1) / width, y1: (y1 + 1) / height } : null,
  };
}

/** Fraction of the artwork's stroke centre-lines thinner than `minLineMm` when printed at `printWidthCm`. */
export function fineDetailRatio(stats: PixelStats, printWidthCm: number, minLineMm: number): number {
  const total = stats.ridge.reduce((s, v) => s + v, 0);
  if (!total || !stats.width) return 0;
  const mmPerPx = (printWidthCm * 10) / stats.width;
  // A ridge of half-width d (px) is a stroke ≈ (2d − 1) px wide.
  let thin = 0;
  for (let d = 1; d < stats.ridge.length; d++) {
    if ((2 * d - 1) * mmPerPx < minLineMm) thin += stats.ridge[d];
  }
  return thin / total;
}

const SEVERITY_RANK: Record<Severity, number> = { ok: 0, info: 1, warn: 2, block: 3 };

export const SUPPORTED_MIME = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export interface CheckInput {
  project: DesignProject;
  printer: PrinterProfile;
  safeWidthMm: number;
  /** Pixel facts per image layer id (missing = not analysed yet). */
  stats: Record<string, PixelStats | undefined>;
}

export function checkProject({ project, printer, safeWidthMm, stats }: CheckInput): ReadinessReport {
  const issues: ReadinessIssue[] = [];
  const add = (check: CheckId, severity: Severity, message: string, extra: Partial<ReadinessIssue> = {}) =>
    issues.push({ check, severity, message, ...extra });
  const garment = getGarment(project.garmentId);
  const sides: ReadinessReport["sides"] = {};

  const printedSides = garment.sides.filter((s) => sideLayers(project, s).length > 0);
  if (!printedSides.length) {
    add("empty", "block", "There's nothing on the garment yet.", { fix: "Upload artwork, add text, or ask the AI designer for a concept." });
  }

  for (const side of printedSides) {
    const layers = sideLayers(project, side);
    const zone = activeZone(project, side);
    const bounds = unionBounds(layers)!;
    const widthCm = bounds.maxX - bounds.minX;
    const heightCm = bounds.maxY - bounds.minY;
    let minDpi: number | null = null;

    // Printer width — the one hard physical limit.
    const safeCm = safeWidthMm / 10;
    const maxCm = printer.maxWidthMm / 10;
    if (Math.min(widthCm, heightCm) > maxCm) {
      add("printer-width", "block", `Your ${label(side)} design is ${fmt(widthCm)} × ${fmt(heightCm)} cm — wider than the printer can print (${maxCm} cm) in either direction.`, {
        side,
        fix: `Scale it down to ${fmt(safeCm)} cm or less across its narrow side.`,
        data: { widthCm: round(widthCm), heightCm: round(heightCm), maxCm },
      });
    } else if (Math.min(widthCm, heightCm) > safeCm) {
      add("printer-width", "warn", `Your ${label(side)} design is ${fmt(Math.min(widthCm, heightCm))} cm across — past the ${fmt(safeCm)} cm safe print width.`, {
        side,
        fix: "Scale it down slightly so the printer has margin at the film edge.",
        data: { widthCm: round(widthCm), safeCm },
      });
    }

    // Placement — artwork outside the zone ends up somewhere a press can't
    // reliably place it (seams, collar, armpit).
    if (zone) {
      const zb = rectBounds(zone.rect);
      const tol = 0.3;
      const out = bounds.minX < zb.minX - tol || bounds.maxX > zb.maxX + tol || bounds.minY < zb.minY - tol || bounds.maxY > zb.maxY + tol;
      if (out) {
        add("placement", "warn", `Part of your ${label(side)} artwork sits outside the ${zone.label.toLowerCase()} print area.`, {
          side,
          fix: `Keep it inside the ${fmt(zone.rect.w)} × ${fmt(zone.rect.h)} cm boundary, or pick a larger placement.`,
        });
      }
    }

    for (const l of layers) {
      if (l.kind === "text") {
        // Cap height ≈ 0.7 em. Below ~4 mm, thin type fills in or breaks up.
        const cap = l.fontSizeCm * 0.7;
        if (cap < 0.4 || (cap < 0.6 && l.weight < 400)) {
          add("fine-detail", "warn", `“${short(l.text)}” is very small (${fmt(cap * 10)} mm letters) and may fill in when pressed.`, {
            layerId: l.id,
            side,
            fix: "Make it larger or use a heavier weight.",
          });
        }
        continue;
      }
      const img = l as ImageLayer;
      if (!SUPPORTED_MIME.includes(img.mime)) {
        add("file-type", "block", `${img.name} is a ${img.mime || "unknown"} file, which can't go to print.`, { layerId: l.id, side, fix: "Upload a PNG, JPG, WebP or SVG." });
        continue;
      }
      const vector = img.mime === "image/svg+xml";
      if (!vector) {
        const dpi = Math.min(effectiveDpi(img.naturalW, l.w), effectiveDpi(img.naturalH, l.h));
        minDpi = minDpi === null ? dpi : Math.min(minDpi, dpi);
        const data = { dpi: Math.round(dpi), sourcePx: `${img.naturalW}×${img.naturalH}`, printCm: `${fmt(l.w)}×${fmt(l.h)}` };
        if (dpi < printer.minAcceptableDpi) {
          add("resolution", "warn", `${img.name} may appear blurry at this print size (${Math.round(dpi)} DPI).`, {
            layerId: l.id,
            side,
            fix: `Print it no wider than ${fmt((img.naturalW / printer.minGoodDpi) * 2.54)} cm, or upload a larger file.`,
            data,
          });
        } else if (dpi < printer.minGoodDpi) {
          add("resolution", "info", `${img.name} is ${Math.round(dpi)} DPI at this size — fine from a step away, slightly soft up close.`, { layerId: l.id, side, data });
        }
      }
      const s = stats[l.id];
      if (!s) continue;
      if (!s.hasAlpha && !vector) {
        add("transparency", "warn", `${img.name}'s background is not transparent — it will print as a solid ${s.borderColor ? "colour box" : "rectangle"}.`, {
          layerId: l.id,
          side,
          fix: "Use Remove background, or upload a PNG with a transparent background.",
          data: { borderColor: s.borderColor ?? "" },
        });
      } else if (s.borderOpaqueRatio > 0.85 && s.borderUniformity > 0.75) {
        add("background", "warn", `${img.name} looks like it has a solid ${s.borderColor ?? ""} background around the artwork.`, {
          layerId: l.id,
          side,
          fix: "Remove background, unless the box is part of the design.",
          data: { borderColor: s.borderColor ?? "", uniformity: round(s.borderUniformity) },
        });
      }
      if (s.semiRatio > 0.12 && !vector) {
        add("edges", "warn", `${img.name} has soft, see-through areas (${Math.round(s.semiRatio * 100)}% of it). DTF prints those as speckled or haloed.`, {
          layerId: l.id,
          side,
          fix: "Avoid glows, drop shadows and feathered edges; keep shapes solid.",
          data: { semiPct: Math.round(s.semiRatio * 100) },
        });
      }
      // The layer's width is the whole image as printed (padding included),
      // which is exactly what the analysed bitmap's width maps onto.
      const fine = fineDetailRatio(s, l.w, printer.minLineMm);
      if (fine > 0.2) {
        add("fine-detail", "warn", `${img.name} has fine lines thinner than ${printer.minLineMm} mm at this size — they may not hold.`, {
          layerId: l.id,
          side,
          fix: "Print it larger or thicken the thinnest lines.",
          data: { finePct: Math.round(fine * 100) },
        });
      }
    }

    sides[side] = { widthCm: round(widthCm), heightCm: round(heightCm), minDpi: minDpi === null ? null : Math.round(minDpi), layers: layers.length };
  }

  const verdict = issues.reduce<Severity>((w, i) => (SEVERITY_RANK[i.severity] > SEVERITY_RANK[w] ? i.severity : w), "ok");
  if (verdict === "ok" || verdict === "info") {
    issues.push({ check: "dimensions", severity: "ok", message: "Your artwork is ready for production review." });
  }
  return { checkedAt: new Date().toISOString(), verdict, issues, sides };
}

/** Check a single layer's printed bounds against the side extent (for the overlay). */
export function layerOutsideZone(project: DesignProject, side: SideId, id: string): boolean {
  const l = project.layers.find((x) => x.id === id);
  const z = activeZone(project, side);
  if (!l || !z) return false;
  const b = layerBounds(l);
  const zb = rectBounds(z.rect);
  return b.minX < zb.minX - 0.3 || b.maxX > zb.maxX + 0.3 || b.minY < zb.minY - 0.3 || b.maxY > zb.maxY + 0.3;
}

const round = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const short = (s: string) => (s.length > 24 ? `${s.slice(0, 22)}…` : s).replace(/\n/g, " ");
const label = (s: SideId) => (s === "front" ? "front" : s === "back" ? "back" : s === "sleeve-left" ? "left sleeve" : "right sleeve");
