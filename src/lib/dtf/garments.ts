// ---------------------------------------------------------------------------
// The garment line: what can be bought, in which colours and sizes, and where
// on each one a transfer can go.
//
// ADD A GARMENT = one object in GARMENTS plus a white blank photo per side in
// public/dtf/garments, calibrated in src/lib/dtf/mockups.ts. Zones are physical (cm) and
// sized to what a 300 mm DTF transfer and a standard heat-press platen can
// actually do, not to what looks nice in a picture.
// ---------------------------------------------------------------------------

import type { FabricColor, GarmentId, PlacementZone, RectCm, SideId, ZoneId } from "./types";

export interface Garment {
  id: GarmentId;
  name: string;
  /** Short fashion line under the name. */
  line: string;
  description: string;
  fabric: string;
  weightGsm: number;
  fit: string;
  /** Base price before print locations, cents. */
  baseCents: number;
  sizes: string[];
  colors: FabricColor[];
  sides: SideId[];
  zones: ZoneId[];
  /** The zone each side starts on. */
  defaultZones: Partial<Record<SideId, ZoneId>>;
  /**
   * The flat area of each side the editor shows and the 3D texture covers, cm.
   * Bigger than any zone so artwork dragged past a boundary is still visible
   * (and flagged) rather than clipped out of existence.
   */
  extents: Partial<Record<SideId, RectCm>>;
}

// ----- Colours. Real dyed-cotton values, not screen primaries. -----------------

const CORE: FabricColor[] = [
  { id: "black", name: "Jet Black", hex: "#141416" },
  { id: "white", name: "Optic White", hex: "#F3F2EE" },
  { id: "heather-grey", name: "Heather Grey", hex: "#A7A8AA", heather: true },
  { id: "charcoal", name: "Charcoal", hex: "#3A3B3F", heather: true },
  { id: "navy", name: "Midnight Navy", hex: "#1C2233" },
  { id: "bone", name: "Bone", hex: "#E4DCCB" },
  { id: "sand", name: "Desert Sand", hex: "#C8B08E" },
  { id: "olive", name: "Military Olive", hex: "#575A3F" },
  { id: "forest", name: "Forest", hex: "#24392E" },
  { id: "burgundy", name: "Oxblood", hex: "#5A1E25" },
  { id: "red", name: "Signal Red", hex: "#B3242B" },
  { id: "royal", name: "Royal", hex: "#2546A8" },
  { id: "sky", name: "Sky", hex: "#9EC3DF" },
  { id: "lilac", name: "Lilac", hex: "#B9A7CF" },
  { id: "pink", name: "Washed Pink", hex: "#E3B5B8" },
  { id: "mustard", name: "Mustard", hex: "#C99A2E" },
];

function pick(...ids: string[]): FabricColor[] {
  return ids.map((id) => {
    const c = CORE.find((x) => x.id === id);
    if (!c) throw new Error(`Unknown colour ${id}`);
    return c;
  });
}

const ADULT = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];

// ----- Zones. (x, y) is the centre; y is measured UP from the collar line. ------

/** Centre-y for a zone whose top edge sits `top` cm below the collar. */
const below = (top: number, h: number) => -(top + h / 2);

export const ZONES: Record<ZoneId, PlacementZone> = {
  "full-front": {
    id: "full-front",
    label: "Full front",
    side: "front",
    rect: { x: 0, y: below(8, 36), w: 28, h: 36 },
    hint: "Centred, 8 cm below the collar — the classic big graphic",
  },
  "front-chest": {
    id: "front-chest",
    label: "Front chest",
    side: "front",
    rect: { x: 0, y: below(8, 16), w: 25, h: 16 },
    hint: "Across the chest, ends above the stomach",
  },
  "left-chest": {
    id: "left-chest",
    label: "Left chest",
    side: "front",
    rect: { x: 9.5, y: below(10, 10), w: 10, h: 10 },
    hint: "Over the heart — logos and small marks",
  },
  "right-chest": {
    id: "right-chest",
    label: "Right chest",
    side: "front",
    rect: { x: -9.5, y: below(10, 10), w: 10, h: 10 },
    hint: "Opposite the heart",
  },
  back: {
    id: "back",
    label: "Full back",
    side: "back",
    rect: { x: 0, y: below(9, 40), w: 29, h: 40 },
    hint: "Centred, 9 cm below the back collar",
  },
  "upper-back": {
    id: "upper-back",
    label: "Upper back",
    side: "back",
    rect: { x: 0, y: below(5, 9), w: 28, h: 9 },
    hint: "Under the collar — names, wordmarks",
  },
  sleeve: {
    id: "sleeve",
    label: "Sleeve",
    side: "sleeve-left",
    rect: { x: 0, y: below(4.5, 10), w: 10, h: 10 },
    hint: "Centred on the outer sleeve",
  },
  "sleeve-long": {
    id: "sleeve-long",
    label: "Long sleeve",
    side: "sleeve-left",
    rect: { x: 0, y: below(6, 40), w: 8, h: 40 },
    hint: "Runs down the arm — vertical type",
  },
  "tote-front": {
    id: "tote-front",
    label: "Bag front",
    side: "front",
    rect: { x: 0, y: below(9, 28), w: 28, h: 28 },
    hint: "Centred on the bag face",
  },
  "tote-back": {
    id: "tote-back",
    label: "Bag back",
    side: "back",
    rect: { x: 0, y: below(9, 28), w: 28, h: 28 },
    hint: "Centred on the reverse",
  },
};

/** A zone resolved for a given side (sleeve zones serve both sleeves). */
export function zoneOn(zoneId: ZoneId, side: SideId): PlacementZone {
  const z = ZONES[zoneId];
  return z.side === side ? z : { ...z, side };
}

/** Zones a garment offers on one side. */
export function zonesFor(garment: Garment, side: SideId): PlacementZone[] {
  return garment.zones
    .map((id) => ZONES[id])
    .filter((z) => z.side === side || (z.side === "sleeve-left" && side === "sleeve-right"))
    .map((z) => zoneOn(z.id, side));
}

const BODY_FRONT: RectCm = { x: 0, y: -40, w: 64, h: 88 };
const BODY_BACK: RectCm = { x: 0, y: -40, w: 64, h: 88 };
const SHORT_SLEEVE: RectCm = { x: 0, y: -11, w: 24, h: 26 };
const LONG_SLEEVE: RectCm = { x: 0, y: -30, w: 24, h: 64 };

export const GARMENTS: Garment[] = [
  {
    id: "tee",
    name: "Studio Tee",
    line: "Heavyweight classic fit",
    description: "The everyday canvas: dense ring-spun cotton that holds a transfer flat and crisp.",
    fabric: "100% combed ring-spun cotton",
    weightGsm: 220,
    fit: "Classic, true to size",
    baseCents: 1800,
    sizes: ADULT,
    colors: CORE,
    sides: ["front", "back", "sleeve-left", "sleeve-right"],
    zones: ["full-front", "front-chest", "left-chest", "right-chest", "back", "upper-back", "sleeve"],
    defaultZones: { front: "full-front", back: "back", "sleeve-left": "sleeve", "sleeve-right": "sleeve" },
    extents: { front: BODY_FRONT, back: BODY_BACK, "sleeve-left": SHORT_SLEEVE, "sleeve-right": SHORT_SLEEVE },
  },
  {
    id: "oversized-tee",
    name: "Oversized Tee",
    line: "Boxy streetwear cut",
    description: "Dropped shoulders, wide body, a longer sleeve. Built for big back prints.",
    fabric: "100% cotton, garment-dyed",
    weightGsm: 260,
    fit: "Oversized — size down for a regular fit",
    baseCents: 2600,
    sizes: ["XS", "S", "M", "L", "XL", "2XL"],
    colors: pick("black", "white", "bone", "sand", "charcoal", "olive", "forest", "burgundy", "sky", "lilac", "pink", "heather-grey"),
    sides: ["front", "back", "sleeve-left", "sleeve-right"],
    zones: ["full-front", "front-chest", "left-chest", "right-chest", "back", "upper-back", "sleeve"],
    defaultZones: { front: "full-front", back: "back", "sleeve-left": "sleeve", "sleeve-right": "sleeve" },
    extents: { front: { x: 0, y: -40, w: 72, h: 90 }, back: { x: 0, y: -40, w: 72, h: 90 }, "sleeve-left": SHORT_SLEEVE, "sleeve-right": SHORT_SLEEVE },
  },
  {
    id: "hoodie",
    name: "Pullover Hoodie",
    line: "Brushed fleece, lined hood",
    description: "Soft brushed-back fleece with a kangaroo pocket. Front graphics sit above the pocket line.",
    fabric: "80% cotton / 20% polyester fleece",
    weightGsm: 350,
    fit: "Relaxed",
    baseCents: 4200,
    sizes: ADULT,
    colors: pick("black", "heather-grey", "charcoal", "navy", "bone", "sand", "olive", "forest", "burgundy", "royal", "pink", "white"),
    sides: ["front", "back", "sleeve-left", "sleeve-right"],
    zones: ["front-chest", "left-chest", "right-chest", "back", "upper-back", "sleeve-long"],
    defaultZones: { front: "front-chest", back: "back", "sleeve-left": "sleeve-long", "sleeve-right": "sleeve-long" },
    extents: { front: { x: 0, y: -38, w: 68, h: 84 }, back: { x: 0, y: -38, w: 68, h: 84 }, "sleeve-left": LONG_SLEEVE, "sleeve-right": LONG_SLEEVE },
  },
  {
    id: "sweatshirt",
    name: "Crewneck Sweatshirt",
    line: "Ribbed collar, cuffs and waistband",
    description: "A clean crew with ribbed trims — the cleanest canvas for a centred chest graphic.",
    fabric: "80% cotton / 20% polyester fleece",
    weightGsm: 320,
    fit: "Classic",
    baseCents: 3600,
    sizes: ADULT,
    colors: pick("black", "heather-grey", "charcoal", "navy", "bone", "sand", "forest", "burgundy", "sky", "white"),
    sides: ["front", "back", "sleeve-left", "sleeve-right"],
    zones: ["full-front", "front-chest", "left-chest", "right-chest", "back", "upper-back", "sleeve-long"],
    defaultZones: { front: "front-chest", back: "back", "sleeve-left": "sleeve-long", "sleeve-right": "sleeve-long" },
    extents: { front: { x: 0, y: -38, w: 68, h: 80 }, back: { x: 0, y: -38, w: 68, h: 80 }, "sleeve-left": LONG_SLEEVE, "sleeve-right": LONG_SLEEVE },
  },
  {
    id: "long-sleeve",
    name: "Long Sleeve Tee",
    line: "Fitted jersey, rib cuffs",
    description: "Midweight jersey with rib cuffs. The arm is a canvas too — run type down the sleeve.",
    fabric: "100% combed cotton",
    weightGsm: 200,
    fit: "Fitted",
    baseCents: 2400,
    sizes: ADULT,
    colors: pick("black", "white", "heather-grey", "charcoal", "navy", "bone", "olive", "burgundy", "royal"),
    sides: ["front", "back", "sleeve-left", "sleeve-right"],
    zones: ["full-front", "front-chest", "left-chest", "right-chest", "back", "upper-back", "sleeve-long"],
    defaultZones: { front: "full-front", back: "back", "sleeve-left": "sleeve-long", "sleeve-right": "sleeve-long" },
    extents: { front: BODY_FRONT, back: BODY_BACK, "sleeve-left": LONG_SLEEVE, "sleeve-right": LONG_SLEEVE },
  },
  {
    id: "tank",
    name: "Muscle Tank",
    line: "Deep armhole, raw energy",
    description: "Lightweight jersey with deep armholes — gym, summer, festival.",
    fabric: "100% cotton jersey",
    weightGsm: 180,
    fit: "Relaxed",
    baseCents: 1600,
    sizes: ["S", "M", "L", "XL", "2XL"],
    colors: pick("black", "white", "heather-grey", "charcoal", "navy", "sand", "olive", "red"),
    sides: ["front", "back"],
    zones: ["full-front", "front-chest", "left-chest", "back", "upper-back"],
    defaultZones: { front: "full-front", back: "back" },
    extents: { front: { x: 0, y: -40, w: 56, h: 88 }, back: { x: 0, y: -40, w: 56, h: 88 } },
  },
  {
    id: "tote",
    name: "Canvas Tote",
    line: "12 oz natural canvas",
    description: "A heavy canvas carry-all with long handles. Flat faces take a transfer edge to edge.",
    fabric: "100% cotton canvas, 12 oz",
    weightGsm: 400,
    fit: "38 × 42 cm, 70 cm handles",
    baseCents: 1400,
    sizes: ["One size"],
    colors: pick("bone", "black", "sand", "olive", "navy", "burgundy"),
    sides: ["front", "back"],
    zones: ["tote-front", "tote-back"],
    defaultZones: { front: "tote-front", back: "tote-back" },
    extents: { front: { x: 0, y: -21, w: 44, h: 50 }, back: { x: 0, y: -21, w: 44, h: 50 } },
  },
];

export function getGarment(id: GarmentId | string): Garment {
  return GARMENTS.find((g) => g.id === id) ?? GARMENTS[0];
}

export function getColor(garment: Garment, colorId: string): FabricColor {
  return garment.colors.find((c) => c.id === colorId) ?? garment.colors[0];
}

/** Is this fabric dark enough that light ink is what reads on it? */
export function isDarkFabric(hex: string): boolean {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // Relative luminance, sRGB-ish. Below ~0.35 reads as a dark garment.
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum < 0.42;
}

export const SIDE_LABEL: Record<SideId, string> = {
  front: "Front",
  back: "Back",
  "sleeve-left": "Left sleeve",
  "sleeve-right": "Right sleeve",
};
