// ---------------------------------------------------------------------------
// Real-photo mockups: which photograph shows each garment side, and where the
// design's centimetres land on it.
//
// Every photo is a blank WHITE garment, 1400 px square, transparent around the
// cloth (scenes are opaque and carry a separate cloth mask). The fabric colour
// is applied in the browser from the photo's own shading
// (src/components/dtf/mockup/photoRender.ts).
//
// Calibration: `collar` is the collar-line centre in photo pixels (the origin
// of side space: +x to the viewer's right, +y up) and `ppc` is pixels per cm,
// taken from the garment's real length (high point of shoulder to hem), which a
// ghost-mannequin photo shows without foreshortening.
//
// Sources: tee, oversized-tee front and hoodie photos are from openmerch-engine
// (MIT, github.com/osmaar/openmerch-engine). Everything else was rendered for
// this shop with Flux 2 Klein on the owner's own GPU. See
// public/dtf/garments/CREDITS.md.
// ---------------------------------------------------------------------------

import type { GarmentId, RectCm, SideId } from "./types";

export interface GarmentPhoto {
  src: string;
  /** Native size of the photo in px. */
  w: number;
  h: number;
  collar: [number, number];
  ppc: number;
  /** Draw mirrored (right sleeve from the left-sleeve photo). */
  flip?: boolean;
}

export interface Scene {
  id: string;
  label: string;
  /** Short line under the tile. */
  note: string;
  garments: GarmentId[];
  side: SideId;
  src: string;
  mask: string;
  /** The side-space rectangle (cm) the quad shows. */
  rect: RectCm;
  /** Corners of `rect` in the photo, as fractions: tl, tr, br, bl. */
  quad: [number, number][];
  /** How strongly the print follows the folds (1 = default). */
  displace?: number;
}

const G = "/dtf/garments";
const S = "/dtf/scenes";

const photo = (file: string, cx: number, cy: number, ppc: number, flip = false): GarmentPhoto => ({
  src: `${G}/${file}.webp`,
  w: 1400,
  h: 1400,
  collar: [cx, cy],
  ppc,
  flip,
});

export const PHOTOS: Partial<Record<GarmentId, Partial<Record<SideId, GarmentPhoto>>>> = {
  tee: {
    front: photo("tee-front", 684, 190, 17.2),
    back: photo("tee-back", 684, 92, 17.2),
    "sleeve-left": photo("sleeve-short", 725, 194, 17, true),
    "sleeve-right": photo("sleeve-short", 725, 194, 17),
  },
  "oversized-tee": {
    front: photo("oversized-front", 702, 155, 17.3),
    back: photo("oversized-back", 702, 96, 17.5),
    "sleeve-left": photo("sleeve-short", 725, 194, 17, true),
    "sleeve-right": photo("sleeve-short", 725, 194, 17),
  },
  hoodie: {
    front: photo("hoodie-front", 703, 280, 14.7),
    back: photo("hoodie-back", 700, 300, 15),
    "sleeve-left": photo("sleeve-hoodie", 703, 441, 14, true),
    "sleeve-right": photo("sleeve-hoodie", 703, 441, 14),
  },
  sweatshirt: {
    front: photo("sweatshirt-front", 698, 145, 17.3),
    back: photo("sweatshirt-back", 702, 92, 17.3),
    "sleeve-left": photo("sleeve-long", 720, 230, 17.6, true),
    "sleeve-right": photo("sleeve-long", 720, 230, 17.6),
  },
  "long-sleeve": {
    front: photo("long-sleeve-front", 696, 115, 16.6),
    back: photo("long-sleeve-back", 698, 92, 16.9),
    "sleeve-left": photo("sleeve-long", 720, 230, 17.6, true),
    "sleeve-right": photo("sleeve-long", 720, 230, 17.6),
  },
  tank: {
    front: photo("tank-front", 702, 194, 17.5),
    back: photo("tank-back", 696, 96, 17.4),
  },
  tote: {
    front: photo("tote-front", 698, 303, 25),
    back: photo("tote-front", 702, 303, 25, true),
  },
};

export function photoFor(garment: GarmentId, side: SideId): GarmentPhoto | null {
  return PHOTOS[garment]?.[side] ?? null;
}

/** The side-space rectangle (cm) the whole photo covers. */
export function photoExtent(p: GarmentPhoto): RectCm {
  // A mirrored photo is drawn flipped, so its collar sits mirrored too.
  const cx = p.flip ? p.w - p.collar[0] : p.collar[0];
  return {
    x: (p.w / 2 - cx) / p.ppc,
    y: (p.collar[1] - p.h / 2) / p.ppc,
    w: p.w / p.ppc,
    h: p.h / p.ppc,
  };
}

const FRONT_RECT: RectCm = { x: 0, y: -24, w: 36, h: 44 };
const BACK_RECT: RectCm = { x: 0, y: -25, w: 36, h: 46 };
const TOTE_RECT: RectCm = { x: 0, y: -23, w: 40, h: 44 };
const SIZE = 1400;

/**
 * A scene placed by its collar point (photo px) and scale (px per cm), with an
 * optional keystone: the bottom edge `widen` times the top (perspective).
 */
function scene(
  id: string,
  label: string,
  note: string,
  garments: GarmentId[],
  side: SideId,
  collar: [number, number],
  ppc: number,
  opts: { rect?: RectCm; widen?: number; displace?: number } = {},
): Scene {
  const rect = opts.rect ?? (side === "back" ? BACK_RECT : FRONT_RECT);
  const widen = opts.widen ?? 1;
  const top = rect.y + rect.h / 2;
  const bottom = rect.y - rect.h / 2;
  const at = (x: number, y: number, k: number): [number, number] => [(collar[0] + x * ppc * k) / SIZE, (collar[1] - y * ppc) / SIZE];
  const l = rect.x - rect.w / 2;
  const r = rect.x + rect.w / 2;
  return {
    id,
    label,
    note,
    garments,
    side,
    src: `${S}/${id}.webp`,
    mask: `${S}/${id}-mask.png`,
    rect,
    quad: [at(l, top, 1), at(r, top, 1), at(r, bottom, widen), at(l, bottom, widen)],
    displace: opts.displace,
  };
}

const TEES: GarmentId[] = ["tee", "oversized-tee"];

/** Lifestyle scenes, in the order the Preview shows them. */
export const SCENES: Scene[] = [
  scene("tee-man", "Worn", "Front, on a person", TEES, "front", [714, 210], 13.8),
  scene("tee-back", "Worn · back", "Back, on a person", TEES, "back", [704, 349], 12.2),
  scene("tee-folded", "Folded", "On the shelf", TEES, "front", [706, 487], 22, { displace: 0.5, rect: { x: 0, y: -18, w: 32, h: 32 } }),
  scene("tee-hanging", "Hanging", "On a hanger", TEES, "front", [710, 336], 13.9),
  scene("tee-flatlay", "Flat lay", "Laid out flat", TEES, "front", [703, 250], 15.1, { displace: 0.6 }),
  scene("hoodie-person", "Worn", "Front, on a person", ["hoodie"], "front", [687, 197], 13.3),
  scene("hoodie-hanging", "Hanging", "On the rail", ["hoodie"], "front", [705, 388], 12.7),
  scene("sweatshirt-person", "Worn", "Front, on a person", ["sweatshirt"], "front", [712, 248], 13.7),
  scene("longsleeve-person", "Worn", "Front, on a person", ["long-sleeve"], "front", [687, 193], 13.7),
  scene("tank-person", "Worn", "Front, on a person", ["tank"], "front", [693, 233], 13.2),
  scene("tote-person", "Carried", "On the shoulder", ["tote"], "front", [725, 600], 14.2, { rect: TOTE_RECT, widen: 1.09 }),
];

export function scenesFor(garment: GarmentId): Scene[] {
  return SCENES.filter((s) => s.garments.includes(garment));
}
