// ---------------------------------------------------------------------------
// Projects and layers: creation, geometry, and the ONE reducer every edit goes
// through — a drag in the editor, a slider, and an approved AI proposal all
// become DesignOps applied here, so undo, sync and the 3D mockup see one kind
// of change.
// ---------------------------------------------------------------------------

import { getColor, getGarment, zoneOn, zonesFor } from "./garments";
import type {
  DesignOp,
  DesignProject,
  GarmentId,
  ImageLayer,
  Layer,
  RectCm,
  SideId,
  TextLayer,
  ZoneId,
} from "./types";

export function uid(prefix = "l"): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${r.slice(0, 16)}`;
}

export function newProject(garmentId: GarmentId = "tee", colorId = "black"): DesignProject {
  const g = getGarment(garmentId);
  const now = new Date().toISOString();
  return {
    id: uid("p"),
    name: "Untitled design",
    garmentId: g.id,
    colorId: getColor(g, colorId).id,
    size: g.sizes.includes("L") ? "L" : g.sizes[0],
    placements: { ...g.defaultZones },
    layers: [],
    references: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** The zone currently in force on a side. */
export function activeZone(project: DesignProject, side: SideId) {
  const g = getGarment(project.garmentId);
  const id = project.placements[side] ?? g.defaultZones[side];
  if (!id) return null;
  const allowed = zonesFor(g, side).find((z) => z.id === id);
  return allowed ?? zonesFor(g, side)[0] ?? null;
}

// ----- geometry -------------------------------------------------------------------

/** Axis-aligned bounds of a (possibly rotated) layer, side space cm. */
export function layerBounds(l: Pick<Layer, "x" | "y" | "w" | "h" | "rotation">): { minX: number; maxX: number; minY: number; maxY: number } {
  const t = (l.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  const hw = (l.w * c + l.h * s) / 2;
  const hh = (l.w * s + l.h * c) / 2;
  return { minX: l.x - hw, maxX: l.x + hw, minY: l.y - hh, maxY: l.y + hh };
}

export function unionBounds(layers: Layer[]): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let b: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
  for (const l of layers) {
    const lb = layerBounds(l);
    b = b
      ? { minX: Math.min(b.minX, lb.minX), maxX: Math.max(b.maxX, lb.maxX), minY: Math.min(b.minY, lb.minY), maxY: Math.max(b.maxY, lb.maxY) }
      : lb;
  }
  return b;
}

export function rectBounds(r: RectCm) {
  return { minX: r.x - r.w / 2, maxX: r.x + r.w / 2, minY: r.y - r.h / 2, maxY: r.y + r.h / 2 };
}

/** Fit a w×h box inside a zone, keeping aspect, at most `fill` of the zone. */
export function fitInZone(zone: RectCm, aspect: number, fill = 0.82): { w: number; h: number } {
  let w = zone.w * fill;
  let h = w / aspect;
  if (h > zone.h * fill) {
    h = zone.h * fill;
    w = h * aspect;
  }
  return { w: round(w), h: round(h) };
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// ----- layer factories ---------------------------------------------------------------

export interface ImageSource {
  assetId: string;
  src: string;
  mime: string;
  naturalW: number;
  naturalH: number;
  origin: ImageLayer["origin"];
  name: string;
  sourceAssetId?: string;
}

export function newImageLayer(project: DesignProject, side: SideId, img: ImageSource): ImageLayer {
  const zone = activeZone(project, side)?.rect ?? { x: 0, y: -25, w: 25, h: 30 };
  const { w, h } = fitInZone(zone, img.naturalW / Math.max(1, img.naturalH));
  return {
    id: uid("img"),
    kind: "image",
    name: img.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "Artwork",
    side,
    x: zone.x,
    y: round(zone.y + zone.h / 2 - h / 2 - zone.h * 0.04),
    w,
    h,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    assetId: img.assetId,
    src: img.src,
    mime: img.mime,
    naturalW: img.naturalW,
    naturalH: img.naturalH,
    origin: img.origin,
    sourceAssetId: img.sourceAssetId,
  };
}

export function newTextLayer(project: DesignProject, side: SideId, text = "YOUR TEXT", at?: { x: number; y: number }): TextLayer {
  const zone = activeZone(project, side)?.rect ?? { x: 0, y: -25, w: 25, h: 30 };
  const dark = isDarkHex(getColor(getGarment(project.garmentId), project.colorId).hex);
  const fontSizeCm = Math.max(1, Math.min(4, zone.w / 8));
  const layer: TextLayer = {
    id: uid("txt"),
    kind: "text",
    name: text.slice(0, 40),
    side,
    x: at?.x ?? zone.x,
    y: at?.y ?? zone.y,
    w: 0,
    h: 0,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text,
    font: "archivo-black",
    weight: 400,
    color: dark ? AUTO_INK_DARK : AUTO_INK_LIGHT,
    fontSizeCm,
    letterSpacing: 0.02,
    lineHeight: 1.05,
    align: "center",
    uppercase: false,
    italic: false,
  };
  return { ...layer, ...approxTextSize(layer) };
}

/** The ink the studio picks by itself for text on dark and on light fabric. */
export const AUTO_INK_DARK = "#F4F1EA";
export const AUTO_INK_LIGHT = "#141416";

function isDarkHex(hex: string): boolean {
  const n = parseInt(hex.replace("#", ""), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 < 0.42;
}

/** Text size without a canvas — the browser replaces it with a real measurement. */
export function approxTextSize(t: Pick<TextLayer, "text" | "fontSizeCm" | "letterSpacing" | "lineHeight" | "uppercase">): { w: number; h: number } {
  const lines = (t.uppercase ? t.text.toUpperCase() : t.text).split("\n");
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const w = longest * t.fontSizeCm * (0.62 + t.letterSpacing);
  const h = lines.length * t.fontSizeCm * t.lineHeight;
  return { w: round(Math.max(0.5, w)), h: round(Math.max(0.5, h)) };
}

// ----- the reducer ---------------------------------------------------------------------

export interface OpContext {
  /** Real text measurement from the browser; falls back to an estimate. */
  measure?: (t: TextLayer) => { w: number; h: number };
  /** Turn an SVG string into a drawable source (the editor uploads it afterwards). */
  svgSource?: (svg: string, name: string) => ImageSource | null;
}

export interface OpResult {
  project: DesignProject;
  applied: number;
  skipped: string[];
  /** Pixel work the reducer cannot do synchronously (background removal). */
  pending: { op: "remove-background"; layerId: string; tolerance: number }[];
  /** Ids of layers this batch created. */
  created: string[];
}

function remeasure(t: TextLayer, ctx: OpContext): TextLayer {
  const m = ctx.measure ? ctx.measure(t) : approxTextSize(t);
  return { ...t, w: round(m.w), h: round(m.h) };
}

export function applyOps(project: DesignProject, ops: DesignOp[], ctx: OpContext = {}): OpResult {
  let p: DesignProject = { ...project, layers: [...project.layers], placements: { ...project.placements } };
  const skipped: string[] = [];
  const pending: OpResult["pending"] = [];
  const created: string[] = [];
  let applied = 0;

  const find = (id: string) => p.layers.findIndex((l) => l.id === id);
  const replace = (i: number, l: Layer) => {
    p.layers[i] = l;
  };

  for (const op of ops) {
    try {
      switch (op.op) {
        case "move": {
          const i = find(op.layerId);
          if (i < 0 || p.layers[i].locked) throw new Error("layer");
          const l = p.layers[i];
          replace(i, {
            ...l,
            x: round(op.x ?? l.x + (op.dx ?? 0)),
            y: round(op.y ?? l.y + (op.dy ?? 0)),
          });
          break;
        }
        case "resize": {
          const i = find(op.layerId);
          if (i < 0 || p.layers[i].locked) throw new Error("layer");
          const l = p.layers[i];
          let scale = op.scale ?? 1;
          if (!op.scale) {
            if (op.w && op.h && l.kind === "image") {
              replace(i, { ...l, w: round(clamp(op.w, 0.3, 80)), h: round(clamp(op.h, 0.3, 80)) });
              break;
            }
            if (op.w) scale = op.w / l.w;
            else if (op.h) scale = op.h / l.h;
          }
          scale = clamp(scale, 0.05, 20);
          if (l.kind === "text") {
            replace(i, remeasure({ ...l, fontSizeCm: round(clamp(l.fontSizeCm * scale, 0.2, 30), 3) }, ctx));
          } else {
            replace(i, { ...l, w: round(clamp(l.w * scale, 0.3, 80)), h: round(clamp(l.h * scale, 0.3, 80)) });
          }
          break;
        }
        case "rotate": {
          const i = find(op.layerId);
          if (i < 0 || p.layers[i].locked) throw new Error("layer");
          replace(i, { ...p.layers[i], rotation: round(((op.rotation % 360) + 540) % 360 - 180, 1) });
          break;
        }
        case "set-text": {
          const i = find(op.layerId);
          const l = p.layers[i];
          if (i < 0 || l.locked || l.kind !== "text") throw new Error("layer");
          const next: TextLayer = {
            ...l,
            text: op.text ?? l.text,
            font: op.font ?? l.font,
            weight: op.weight ?? l.weight,
            color: op.color ?? l.color,
            fontSizeCm: op.fontSizeCm !== undefined ? clamp(op.fontSizeCm, 0.2, 30) : l.fontSizeCm,
            letterSpacing: op.letterSpacing !== undefined ? clamp(op.letterSpacing, -0.1, 1) : l.letterSpacing,
            lineHeight: op.lineHeight !== undefined ? clamp(op.lineHeight, 0.7, 2.5) : l.lineHeight,
            uppercase: op.uppercase ?? l.uppercase,
            italic: op.italic ?? l.italic,
            align: op.align ?? l.align,
          };
          if (op.text !== undefined) next.name = op.text.split("\n")[0].slice(0, 40) || "Text";
          replace(i, remeasure(next, ctx));
          break;
        }
        case "add-text": {
          const base = newTextLayer(p, op.side, op.text, { x: op.x, y: op.y });
          const l = remeasure(
            {
              ...base,
              font: op.font ?? base.font,
              weight: op.weight ?? base.weight,
              color: op.color ?? base.color,
              fontSizeCm: op.fontSizeCm ? clamp(op.fontSizeCm, 0.2, 30) : base.fontSizeCm,
              letterSpacing: op.letterSpacing ?? base.letterSpacing,
              uppercase: op.uppercase ?? base.uppercase,
              italic: op.italic ?? base.italic,
            },
            ctx,
          );
          p.layers.push(l);
          created.push(l.id);
          break;
        }
        case "add-svg": {
          const src = ctx.svgSource?.(op.svg, op.name);
          if (!src) throw new Error("svg");
          const aspect = src.naturalW / Math.max(1, src.naturalH);
          const w = clamp(op.w, 1, 60);
          const l: ImageLayer = {
            ...newImageLayer(p, op.side, src),
            x: round(op.x),
            y: round(op.y),
            w: round(w),
            h: round(w / aspect),
          };
          p.layers.push(l);
          created.push(l.id);
          break;
        }
        case "set-opacity": {
          const i = find(op.layerId);
          if (i < 0 || p.layers[i].locked) throw new Error("layer");
          replace(i, { ...p.layers[i], opacity: clamp(op.opacity, 0, 1) });
          break;
        }
        case "delete": {
          const i = find(op.layerId);
          if (i < 0 || p.layers[i].locked) throw new Error("layer");
          p.layers.splice(i, 1);
          break;
        }
        case "duplicate": {
          const i = find(op.layerId);
          if (i < 0) throw new Error("layer");
          const src = p.layers[i];
          const copy: Layer = {
            ...src,
            id: uid(src.kind === "text" ? "txt" : "img"),
            name: `${src.name} copy`,
            locked: false,
            x: round(src.x + (op.dx ?? 1.5)),
            y: round(src.y + (op.dy ?? -1.5)),
          };
          p.layers.splice(i + 1, 0, copy);
          created.push(copy.id);
          break;
        }
        case "reorder": {
          const i = find(op.layerId);
          if (i < 0) throw new Error("layer");
          const [l] = p.layers.splice(i, 1);
          const to =
            op.to === "front" ? p.layers.length : op.to === "back" ? 0 : op.to === "forward" ? Math.min(p.layers.length, i + 1) : Math.max(0, i - 1);
          p.layers.splice(to, 0, l);
          break;
        }
        case "set-color": {
          const g = getGarment(p.garmentId);
          if (!g.colors.some((c) => c.id === op.colorId)) throw new Error("color");
          // Text still in the studio's automatic ink follows the fabric: cream
          // on dark cloth, near-black on light. A colour the customer chose is
          // left alone.
          const wasDark = isDarkHex(getColor(g, p.colorId).hex);
          const nowDark = isDarkHex(getColor(g, op.colorId).hex);
          if (wasDark !== nowDark) {
            const from = wasDark ? AUTO_INK_DARK : AUTO_INK_LIGHT;
            const to = nowDark ? AUTO_INK_DARK : AUTO_INK_LIGHT;
            p.layers = p.layers.map((l) => (l.kind === "text" && !l.locked && l.color.toUpperCase() === from ? { ...l, color: to } : l));
          }
          p.colorId = op.colorId;
          break;
        }
        case "set-garment": {
          p = switchGarment(p, op.garmentId);
          break;
        }
        case "set-placement": {
          const g = getGarment(p.garmentId);
          const zone = zonesFor(g, op.side).find((z) => z.id === op.zoneId);
          if (!zone) throw new Error("zone");
          const old = activeZone(p, op.side);
          p.placements[op.side] = op.zoneId;
          if (old && old.id !== zone.id) p.layers = p.layers.map((l) => (l.side === op.side && !l.locked ? refit(l, old.rect, zone.rect, ctx) : l));
          break;
        }
        case "remove-background": {
          const i = find(op.layerId);
          if (i < 0 || p.layers[i].kind !== "image" || p.layers[i].locked) throw new Error("layer");
          pending.push({ op: "remove-background", layerId: op.layerId, tolerance: clamp(op.tolerance ?? 18, 0, 100) });
          break;
        }
        case "center": {
          const i = find(op.layerId);
          if (i < 0 || p.layers[i].locked) throw new Error("layer");
          const l = p.layers[i];
          const z = activeZone(p, l.side)?.rect;
          if (!z) throw new Error("zone");
          const axis = op.axis ?? "both";
          replace(i, { ...l, x: axis === "y" ? l.x : z.x, y: axis === "x" ? l.y : z.y });
          break;
        }
      }
      applied++;
    } catch {
      skipped.push(op.op + ("layerId" in op ? `:${op.layerId}` : ""));
    }
  }
  p.updatedAt = new Date().toISOString();
  return { project: p, applied, skipped, pending, created };
}

/** Scale and move a layer from one zone into another, keeping its relative spot. */
function refit(l: Layer, from: RectCm, to: RectCm, ctx: OpContext): Layer {
  const s = Math.min(to.w / from.w, to.h / from.h);
  const x = round(to.x + (l.x - from.x) * (to.w / from.w));
  const y = round(to.y + (l.y - from.y) * (to.h / from.h));
  if (l.kind === "text") return remeasure({ ...l, x, y, fontSizeCm: round(l.fontSizeCm * s, 3) }, ctx);
  return { ...l, x, y, w: round(l.w * s), h: round(l.h * s) };
}

/**
 * Change garment, keeping the design. Layers on sides the new garment does not
 * have are kept (hidden from print) rather than lost, so switching back restores
 * them. Zones the new garment lacks are swapped for its default on that side.
 */
export function switchGarment(project: DesignProject, garmentId: GarmentId): DesignProject {
  const g = getGarment(garmentId);
  const colorId = g.colors.some((c) => c.id === project.colorId) ? project.colorId : nearestColor(project, g.colors).id;
  const placements: DesignProject["placements"] = {};
  for (const side of g.sides) {
    const wanted = project.placements[side];
    const ok = wanted && zonesFor(g, side).some((z) => z.id === wanted);
    placements[side] = (ok ? wanted : g.defaultZones[side]) as ZoneId | undefined;
  }
  return {
    ...project,
    garmentId: g.id,
    colorId,
    size: g.sizes.includes(project.size) ? project.size : g.sizes.includes("L") ? "L" : g.sizes[0],
    placements: { ...project.placements, ...placements },
    updatedAt: new Date().toISOString(),
  };
}

function nearestColor(project: DesignProject, colors: { id: string; hex: string }[]) {
  const from = getColor(getGarment(project.garmentId), project.colorId).hex;
  const rgb = (h: string) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const a = rgb(from);
  let best = colors[0];
  let bestD = Infinity;
  for (const c of colors) {
    const b = rgb(c.hex);
    const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Layers that print on a side of the CURRENT garment. */
export function sideLayers(project: DesignProject, side: SideId): Layer[] {
  return project.layers.filter((l) => l.side === side && !l.hidden);
}

export function onGarment(project: DesignProject, side: SideId): boolean {
  return getGarment(project.garmentId).sides.includes(side);
}

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

export { zoneOn };
