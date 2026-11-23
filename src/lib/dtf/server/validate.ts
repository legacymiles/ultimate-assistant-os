// ---------------------------------------------------------------------------
// Never trust a project from a browser. This normalises one into a shape the
// server is willing to store, price and print: known garment, colour, size and
// zones; bounded strings and counts; image layers pointing only at this app's
// own asset URLs (no hot-linked images, no blob: leftovers at checkout).
// ---------------------------------------------------------------------------

import { DESIGN_FONTS } from "../fonts";
import { GARMENTS, getGarment, zonesFor } from "../garments";
import type { DesignProject, ImageLayer, Layer, SideId, TextLayer, ZoneId } from "../types";

const SIDES: SideId[] = ["front", "back", "sleeve-left", "sleeve-right"];
const ID = /^[A-Za-z0-9_-]{4,80}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
export const ASSET_URL = /^\/api\/dtf\/assets\/([A-Za-z0-9_-]{4,80})$/;

export class InvalidProject extends Error {}

const num = (v: unknown, lo: number, hi: number, d = 0): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : d;
  return Math.max(lo, Math.min(hi, n));
};
const str = (v: unknown, max: number, d = ""): string => (typeof v === "string" ? v.slice(0, max) : d);

/**
 * @param strict at checkout: every image must already be a stored asset.
 *               While saving a draft, local (not yet uploaded) images are dropped
 *               from the server copy rather than rejected.
 */
export function cleanProject(raw: unknown, strict: boolean): DesignProject {
  if (!raw || typeof raw !== "object") throw new InvalidProject("No design was sent.");
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 80);
  if (!ID.test(id)) throw new InvalidProject("The design has no valid id.");
  const g = GARMENTS.find((x) => x.id === r.garmentId);
  if (!g) throw new InvalidProject("Unknown garment.");
  const colorId = g.colors.some((c) => c.id === r.colorId) ? String(r.colorId) : g.colors[0].id;
  const size = g.sizes.includes(String(r.size)) ? String(r.size) : g.sizes[0];

  const placements: DesignProject["placements"] = {};
  const rp = (r.placements ?? {}) as Record<string, unknown>;
  for (const side of SIDES) {
    const z = rp[side];
    if (typeof z === "string" && zonesFor(g, side).some((x) => x.id === z)) placements[side] = z as ZoneId;
    else if (g.defaultZones[side]) placements[side] = g.defaultZones[side];
  }

  const layersIn = Array.isArray(r.layers) ? r.layers.slice(0, 60) : [];
  const layers: Layer[] = [];
  for (const l of layersIn) {
    const c = cleanLayer(l, strict);
    if (c) layers.push(c);
  }

  const refsIn = Array.isArray(r.references) ? r.references.slice(0, 8) : [];
  const references = refsIn
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .filter((x) => typeof x.id === "string" && ID.test(x.id) && typeof x.url === "string" && ASSET_URL.test(x.url))
    .map((x) => ({
      id: String(x.id),
      kind: "reference" as const,
      mime: str(x.mime, 40, "image/png"),
      bytes: num(x.bytes, 0, 1e9),
      width: num(x.width, 0, 1e5),
      height: num(x.height, 0, 1e5),
      url: String(x.url),
      name: str(x.name, 120),
    }));

  const now = new Date().toISOString();
  return {
    id,
    name: str(r.name, 120, "Untitled design").trim() || "Untitled design",
    garmentId: g.id,
    colorId,
    size,
    placements,
    layers,
    references,
    createdAt: typeof r.createdAt === "string" && !Number.isNaN(Date.parse(r.createdAt)) ? r.createdAt : now,
    updatedAt: now,
  };
}

function cleanLayer(raw: unknown, strict: boolean): Layer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 80);
  if (!ID.test(id)) return null;
  const side = SIDES.includes(r.side as SideId) ? (r.side as SideId) : null;
  if (!side) return null;
  const base = {
    id,
    name: str(r.name, 80, "Layer"),
    side,
    x: num(r.x, -80, 80),
    y: num(r.y, -120, 40),
    w: num(r.w, 0.1, 120, 1),
    h: num(r.h, 0.1, 120, 1),
    rotation: num(r.rotation, -360, 360),
    opacity: num(r.opacity, 0, 1, 1),
    locked: Boolean(r.locked),
    hidden: Boolean(r.hidden),
  };
  if (r.kind === "text") {
    const font = DESIGN_FONTS.some((f) => f.id === r.font) ? (r.font as TextLayer["font"]) : "geist";
    return {
      ...base,
      kind: "text",
      text: str(r.text, 400, "Text"),
      font,
      weight: num(r.weight, 100, 900, 400),
      color: typeof r.color === "string" && HEX.test(r.color) ? r.color : "#FFFFFF",
      fontSizeCm: num(r.fontSizeCm, 0.2, 30, 2),
      letterSpacing: num(r.letterSpacing, -0.1, 1),
      lineHeight: num(r.lineHeight, 0.7, 2.5, 1.1),
      align: r.align === "left" || r.align === "right" ? r.align : "center",
      uppercase: Boolean(r.uppercase),
      italic: Boolean(r.italic),
    };
  }
  if (r.kind === "image") {
    const src = str(r.src, 200_000);
    const assetId = str(r.assetId, 80);
    const served = ASSET_URL.exec(src);
    if (!served || served[1] !== assetId) {
      if (strict) throw new InvalidProject(`“${base.name}” hasn't finished uploading yet. Wait a moment and try again.`);
      return null;
    }
    const origin: ImageLayer["origin"] = r.origin === "ai" || r.origin === "processed" ? r.origin : "upload";
    return {
      ...base,
      kind: "image",
      assetId,
      src,
      mime: str(r.mime, 40, "image/png"),
      naturalW: num(r.naturalW, 1, 100_000, 1),
      naturalH: num(r.naturalH, 1, 100_000, 1),
      origin,
      sourceAssetId: typeof r.sourceAssetId === "string" && ID.test(r.sourceAssetId) ? r.sourceAssetId : undefined,
    };
  }
  return null;
}

/** Asset ids a project depends on (artwork + references + originals). */
export function assetIdsOf(p: DesignProject): string[] {
  const ids = new Set<string>();
  for (const l of p.layers) {
    if (l.kind === "image") {
      ids.add(l.assetId);
      if (l.sourceAssetId) ids.add(l.sourceAssetId);
    }
  }
  for (const r of p.references) ids.add(r.id);
  return [...ids];
}

export function garmentName(p: DesignProject): string {
  return getGarment(p.garmentId).name;
}
