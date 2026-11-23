// ---------------------------------------------------------------------------
// What the AI designer is allowed to hand the browser.
//
// A model's reply is untrusted text. It goes: extractJson (find the object) →
// zod (right shapes, numbers that are numbers, known enums) → sanitiseReply
// (ops checked against THIS project: real, unlocked layer ids; colours and
// zones the garment actually offers; numbers clamped to what a garment and the
// printer can take; SVG rebuilt by svg.ts). Whatever fails is dropped, never
// thrown — the customer always gets a reply, with a note saying what was
// skipped. The browser then applies the surviving ops with the editor's own
// reducer, so nothing here edits anything.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { getGarment, zonesFor, type Garment } from "../garments";
import type {
  AiProposal,
  AiReply,
  DesignOp,
  DesignProject,
  FontId,
  GarmentId,
  Layer,
  ReadinessReport,
  RectCm,
  SideId,
  ZoneId,
} from "../types";
import { sanitizeSvg } from "./svg";

export const MAX_PROPOSALS = 4;
export const MAX_OPS = 24;

// ----- enums --------------------------------------------------------------------

export const FONT_IDS = [
  "geist",
  "inter",
  "space-grotesk",
  "syne",
  "oxanium",
  "chakra-petch",
  "archivo-black",
  "instrument-serif",
  "jetbrains-mono",
] as const satisfies readonly FontId[];

export const SIDE_IDS = ["front", "back", "sleeve-left", "sleeve-right"] as const satisfies readonly SideId[];

export const ZONE_IDS = [
  "full-front",
  "front-chest",
  "left-chest",
  "right-chest",
  "back",
  "upper-back",
  "sleeve",
  "sleeve-long",
  "tote-front",
  "tote-back",
] as const satisfies readonly ZoneId[];

export const GARMENT_IDS = ["tee", "oversized-tee", "hoodie", "sweatshirt", "long-sleeve", "tank", "tote"] as const satisfies readonly GarmentId[];

// ----- normalisers (shared with the offline planner) --------------------------------

/** Ink colour words a customer or a model might use instead of hex. */
export const INK_COLORS: Record<string, string> = {
  white: "#FFFFFF",
  "off-white": "#F4F1EA",
  offwhite: "#F4F1EA",
  cream: "#F2E8CF",
  ivory: "#F6F0DC",
  bone: "#E4DCCB",
  beige: "#D9C7A7",
  sand: "#C8B08E",
  tan: "#B89A6E",
  black: "#111111",
  charcoal: "#3A3B3F",
  grey: "#8E9094",
  gray: "#8E9094",
  silver: "#C0C2C6",
  red: "#C8102E",
  crimson: "#B0182A",
  burgundy: "#6E1F2A",
  maroon: "#6E1F2A",
  orange: "#F26B21",
  rust: "#A4462A",
  yellow: "#F5C518",
  mustard: "#C99A2E",
  gold: "#C9A227",
  green: "#2E8B57",
  olive: "#6B6E3F",
  forest: "#24392E",
  mint: "#A8E6CF",
  teal: "#138A8A",
  blue: "#2F5BD3",
  royal: "#2546A8",
  navy: "#1C2233",
  sky: "#9EC3DF",
  purple: "#6C3FB5",
  lilac: "#B9A7CF",
  lavender: "#C8B8E6",
  pink: "#F2A7B8",
  magenta: "#C2187A",
  brown: "#6B4A2F",
};

/** "#abc" / "abc" / "#AABBCC" / a colour word → "#AABBCC"; anything else → undefined. */
export function normalizeHex(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (INK_COLORS[s]) return INK_COLORS[s];
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (!m) return undefined;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return `#${hex.toUpperCase()}`;
}

const FONT_ALIASES: Record<string, FontId> = {
  geist: "geist",
  inter: "inter",
  "space-grotesk": "space-grotesk",
  grotesk: "space-grotesk",
  syne: "syne",
  oxanium: "oxanium",
  "chakra-petch": "chakra-petch",
  chakra: "chakra-petch",
  "archivo-black": "archivo-black",
  archivo: "archivo-black",
  "instrument-serif": "instrument-serif",
  instrument: "instrument-serif",
  serif: "instrument-serif",
  "jetbrains-mono": "jetbrains-mono",
  jetbrains: "jetbrains-mono",
  mono: "jetbrains-mono",
  monospace: "jetbrains-mono",
};

/** "Instrument Serif" / "instrument_serif" / "serif" → a FontId; unknown → undefined. */
export function normalizeFont(v: unknown): FontId | undefined {
  if (typeof v !== "string") return undefined;
  const k = v
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return FONT_ALIASES[k];
}

const toNumber = (v: unknown) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v);
const toBool = (v: unknown) => (v === "true" ? true : v === "false" ? false : v);

/** A finite number; numeric strings are accepted (models quote numbers). */
const num = z.preprocess(toNumber, z.number().finite());
/** Optional number; a present-but-garbage value becomes undefined instead of failing the op. */
const optNum = z.preprocess(toNumber, z.number().finite().optional()).catch(undefined);
const optBool = z.preprocess(toBool, z.boolean().optional()).catch(undefined);
const optHex = z.preprocess(normalizeHex, z.string().optional()).catch(undefined);
const optFont = z.preprocess(normalizeFont, z.enum(FONT_IDS).optional()).catch(undefined);
const optAlign = z.enum(["left", "center", "right"]).optional().catch(undefined);
const layerId = z.string().min(1).max(120);
const side = z.enum(SIDE_IDS);

// ----- DesignOp ----------------------------------------------------------------------

export const DesignOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("move"), layerId, dx: optNum, dy: optNum, x: optNum, y: optNum }),
  z.object({ op: z.literal("resize"), layerId, scale: optNum, w: optNum, h: optNum }),
  z.object({ op: z.literal("rotate"), layerId, rotation: num }),
  z.object({
    op: z.literal("set-text"),
    layerId,
    text: z.string().max(400).optional().catch(undefined),
    font: optFont,
    weight: optNum,
    color: optHex,
    fontSizeCm: optNum,
    letterSpacing: optNum,
    lineHeight: optNum,
    uppercase: optBool,
    italic: optBool,
    align: optAlign,
  }),
  z.object({
    op: z.literal("add-text"),
    side,
    text: z.string().min(1).max(400),
    x: num,
    y: num,
    font: optFont,
    weight: optNum,
    color: optHex,
    fontSizeCm: optNum,
    letterSpacing: optNum,
    uppercase: optBool,
    italic: optBool,
  }),
  z.object({ op: z.literal("add-svg"), side, name: z.string().max(120).catch("AI graphic"), svg: z.string().min(1), x: num, y: num, w: num }),
  z.object({ op: z.literal("set-opacity"), layerId, opacity: num }),
  z.object({ op: z.literal("delete"), layerId }),
  z.object({ op: z.literal("duplicate"), layerId, dx: optNum, dy: optNum }),
  z.object({ op: z.literal("reorder"), layerId, to: z.enum(["front", "back", "forward", "backward"]) }),
  z.object({ op: z.literal("set-color"), colorId: z.string().min(1).max(60) }),
  z.object({ op: z.literal("set-garment"), garmentId: z.enum(GARMENT_IDS) }),
  z.object({ op: z.literal("set-placement"), side, zoneId: z.enum(ZONE_IDS) }),
  z.object({ op: z.literal("remove-background"), layerId, tolerance: optNum }),
  z.object({ op: z.literal("center"), layerId, axis: z.enum(["x", "y", "both"]).optional().catch(undefined) }),
]);

export const AiProposalSchema = z.object({
  id: z.string().min(1).max(60),
  title: z.string().max(120),
  rationale: z.string().max(600),
  ops: z.array(DesignOpSchema).max(MAX_OPS),
});

export const AiReplySchema = z.object({
  message: z.string(),
  proposals: z.array(AiProposalSchema).max(MAX_PROPOSALS),
  notes: z.array(z.string()).optional(),
  palette: z.array(z.object({ hex: z.string().regex(/^#[0-9A-F]{6}$/), name: z.string() })).optional(),
  engine: z.enum(["live", "offline"]),
});

// ----- request input (the browser's copy of the project) ------------------------------

const finite = (fallback: number) => z.preprocess(toNumber, z.number().finite()).catch(fallback);
const layerBase = {
  id: z.string().min(1).max(120),
  name: z.string().max(200).catch("Layer"),
  side: z.enum(SIDE_IDS).catch("front"),
  x: finite(0),
  y: finite(0),
  w: finite(10),
  h: finite(10),
  rotation: finite(0),
  opacity: finite(1),
  locked: z.boolean().catch(false),
  hidden: z.boolean().catch(false),
};

const ImageLayerInput = z.object({
  ...layerBase,
  kind: z.literal("image"),
  assetId: z.string().max(200).catch(""),
  src: z.string().catch(""),
  mime: z.string().max(100).catch("image/png"),
  naturalW: finite(0),
  naturalH: finite(0),
  origin: z.enum(["upload", "ai", "processed"]).catch("upload"),
  sourceAssetId: z.string().max(200).optional().catch(undefined),
});

const TextLayerInput = z.object({
  ...layerBase,
  kind: z.literal("text"),
  text: z.string().max(2000).catch(""),
  font: z.enum(FONT_IDS).catch("inter"),
  weight: finite(400),
  color: z.string().max(40).catch("#111111"),
  fontSizeCm: finite(2),
  letterSpacing: finite(0),
  lineHeight: finite(1.1),
  align: z.enum(["left", "center", "right"]).catch("center"),
  uppercase: z.boolean().catch(false),
  italic: z.boolean().catch(false),
});

const AssetRefInput = z.object({
  id: z.string().max(200),
  kind: z.enum(["original", "ai", "processed", "reference", "mockup", "production"]),
  mime: z.string().max(100),
  bytes: finite(0),
  width: finite(0),
  height: finite(0),
  url: z.string().max(2000).catch(""),
  name: z.string().max(200).optional().catch(undefined),
  sourceAssetId: z.string().max(200).optional().catch(undefined),
});

/**
 * The project as the browser sends it. Lenient where a field is cosmetic,
 * strict where the planner depends on it; output is a real DesignProject.
 */
export const DesignProjectInputSchema = z.object({
  id: z.string().max(200).catch("draft"),
  name: z.string().max(200).catch("Untitled design"),
  garmentId: z.enum(GARMENT_IDS).catch("tee"),
  colorId: z.string().max(60).catch("black"),
  size: z.string().max(20).catch("M"),
  placements: z.partialRecord(z.enum(SIDE_IDS), z.enum(ZONE_IDS)).catch({}),
  layers: z.array(z.discriminatedUnion("kind", [ImageLayerInput, TextLayerInput])).max(200),
  references: z.array(AssetRefInput).max(20).catch([]),
  createdAt: z.string().max(40).catch(""),
  updatedAt: z.string().max(40).catch(""),
});

const IssueInput = z.object({
  check: z.enum(["resolution", "dimensions", "transparency", "edges", "background", "placement", "printer-width", "file-type", "fine-detail", "empty"]),
  severity: z.enum(["ok", "info", "warn", "block"]),
  message: z.string().max(400),
  fix: z.string().max(400).optional().catch(undefined),
  layerId: z.string().max(120).optional().catch(undefined),
  side: z.enum(SIDE_IDS).optional().catch(undefined),
});

export const ReadinessInputSchema = z.object({
  checkedAt: z.string().max(40).catch(""),
  verdict: z.enum(["ok", "info", "warn", "block"]).catch("ok"),
  issues: z.array(IssueInput).max(60).catch([]),
  sides: z.record(z.string(), z.unknown()).catch({}),
});

/** Readiness from the browser; `sides` is not needed by the AI and is dropped. */
export function parseReadiness(raw: unknown): ReadinessReport | undefined {
  const r = ReadinessInputSchema.safeParse(raw);
  if (!r.success) return undefined;
  return { checkedAt: r.data.checkedAt, verdict: r.data.verdict, issues: r.data.issues, sides: {} };
}

// ----- JSON extraction ------------------------------------------------------------------

/** From index `start` (a "{"), the index just past its matching "}", or -1. */
function matchBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    // The slip models make most: a trailing comma before a closing bracket.
    try {
      return JSON.parse(s.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return undefined;
    }
  }
}

/**
 * The first JSON object in a model reply: inside ```json fences or not, with
 * prose before or after. Returns null when there is none.
 */
export function extractJson(text: unknown): unknown {
  if (typeof text !== "string" || !text) return null;
  const candidates: string[] = [];
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) candidates.push(m[1]);
  candidates.push(text);
  for (const c of candidates) {
    let from = c.indexOf("{");
    let guard = 0;
    while (from !== -1 && guard++ < 50) {
      const end = matchBrace(c, from);
      if (end !== -1) {
        const parsed = tryParse(c.slice(from, end));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      }
      from = c.indexOf("{", from + 1);
    }
  }
  return null;
}

// ----- semantic sanitising ------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, places = 2) => Math.round(v * 10 ** places) / 10 ** places;
const MIN_SIZE = 0.5;
const MAX_SIZE = 60;

/** Normalise any angle to (-180, 180]. */
export function normalizeAngle(deg: number): number {
  let r = ((deg % 360) + 360) % 360;
  if (r > 180) r -= 360;
  return round(r, 1);
}

function extentOf(garment: Garment, s: SideId): RectCm {
  return garment.extents[s] ?? { x: 0, y: -40, w: 64, h: 88 };
}

function clampToExtent(ext: RectCm, x: number, y: number): { x: number; y: number } {
  return {
    x: round(clamp(x, ext.x - ext.w / 2, ext.x + ext.w / 2)),
    y: round(clamp(y, ext.y - ext.h / 2, ext.y + ext.h / 2)),
  };
}

/** Find a garment colour by id or by name ("Jet Black", "jet-black", "black"). */
export function findColorId(garment: Garment, v: string): string | undefined {
  const k = v.trim().toLowerCase();
  const slug = k.replace(/\s+/g, "-");
  const hit =
    garment.colors.find((c) => c.id === k || c.id === slug) ??
    garment.colors.find((c) => c.name.toLowerCase() === k) ??
    garment.colors.find((c) => c.name.toLowerCase().split(/\s+/).includes(k));
  return hit?.id;
}

interface Sim {
  kind: Layer["kind"];
  side: SideId;
  x: number;
  y: number;
  w: number;
  h: number;
  locked: boolean;
  deleted: boolean;
}

interface Tally {
  unknown: number;
  locked: number;
  invalid: number;
  svg: number;
  capped: number;
}

/**
 * Check one zod-valid op against the project state as it stands so far in
 * this proposal. Returns the cleaned op, or null (with the reason tallied).
 */
function checkOp(op: z.infer<typeof DesignOpSchema>, garmentRef: { g: Garment }, sims: Map<string, Sim>, tally: Tally): DesignOp | null {
  const garment = garmentRef.g;
  const layerOp = "layerId" in op ? op : null;
  let sim: Sim | undefined;
  if (layerOp) {
    sim = sims.get(layerOp.layerId);
    if (!sim || sim.deleted) {
      tally.unknown++;
      return null;
    }
    if (sim.locked) {
      tally.locked++;
      return null;
    }
  }
  const ext = sim ? extentOf(garment, sim.side) : null;

  switch (op.op) {
    case "move": {
      if (!sim || !ext) return null;
      let nx = sim.x;
      let ny = sim.y;
      if (op.x !== undefined) nx = op.x;
      else if (op.dx !== undefined) nx = sim.x + op.dx;
      if (op.y !== undefined) ny = op.y;
      else if (op.dy !== undefined) ny = sim.y + op.dy;
      if (nx === sim.x && ny === sim.y && op.x === undefined && op.y === undefined) {
        tally.invalid++;
        return null;
      }
      const p = clampToExtent(ext, nx, ny);
      const out: DesignOp = { op: "move", layerId: op.layerId };
      // Keep the op in the form the model chose (relative stays relative), clamped.
      if (op.x !== undefined) out.x = p.x;
      else if (op.dx !== undefined) out.dx = round(p.x - sim.x);
      if (op.y !== undefined) out.y = p.y;
      else if (op.dy !== undefined) out.dy = round(p.y - sim.y);
      sim.x = p.x;
      sim.y = p.y;
      return out;
    }
    case "resize": {
      if (!sim) return null;
      if (op.scale !== undefined) {
        // The scale that keeps both edges inside 0.5–60 cm.
        const lo = Math.max(MIN_SIZE / sim.w, MIN_SIZE / sim.h, 0.05);
        const hi = Math.min(MAX_SIZE / sim.w, MAX_SIZE / sim.h, 10);
        const scale = round(clamp(op.scale, lo, Math.max(lo, hi)), 3);
        if (!(scale > 0) || scale === 1) {
          tally.invalid++;
          return null;
        }
        sim.w *= scale;
        sim.h *= scale;
        return { op: "resize", layerId: op.layerId, scale };
      }
      if (op.w === undefined && op.h === undefined) {
        tally.invalid++;
        return null;
      }
      const out: DesignOp = { op: "resize", layerId: op.layerId };
      const aspect = sim.w / sim.h || 1;
      if (op.w !== undefined) out.w = round(clamp(op.w, MIN_SIZE, MAX_SIZE));
      if (op.h !== undefined) out.h = round(clamp(op.h, MIN_SIZE, MAX_SIZE));
      sim.w = out.w ?? (out.h ?? sim.h) * aspect;
      sim.h = out.h ?? (out.w ?? sim.w) / aspect;
      return out;
    }
    case "rotate":
      return { op: "rotate", layerId: op.layerId, rotation: normalizeAngle(op.rotation) };
    case "set-text": {
      if (!sim || sim.kind !== "text") {
        tally.invalid++;
        return null;
      }
      const out: DesignOp = { op: "set-text", layerId: op.layerId };
      if (op.text !== undefined && op.text.trim()) out.text = op.text.slice(0, 200);
      if (op.font) out.font = op.font;
      if (op.weight !== undefined) out.weight = clamp(Math.round(op.weight / 100) * 100, 100, 900);
      if (op.color) out.color = op.color;
      if (op.fontSizeCm !== undefined) out.fontSizeCm = round(clamp(op.fontSizeCm, 0.3, 20));
      if (op.letterSpacing !== undefined) out.letterSpacing = round(clamp(op.letterSpacing, -0.2, 1), 3);
      if (op.lineHeight !== undefined) out.lineHeight = round(clamp(op.lineHeight, 0.6, 3));
      if (op.uppercase !== undefined) out.uppercase = op.uppercase;
      if (op.italic !== undefined) out.italic = op.italic;
      if (op.align) out.align = op.align;
      if (Object.keys(out).length <= 2) {
        tally.invalid++;
        return null;
      }
      return out;
    }
    case "add-text": {
      if (!garment.sides.includes(op.side)) {
        tally.invalid++;
        return null;
      }
      const text = op.text.trim().slice(0, 200);
      if (!text) {
        tally.invalid++;
        return null;
      }
      const p = clampToExtent(extentOf(garment, op.side), op.x, op.y);
      const out: DesignOp = { op: "add-text", side: op.side, text, x: p.x, y: p.y };
      if (op.font) out.font = op.font;
      if (op.weight !== undefined) out.weight = clamp(Math.round(op.weight / 100) * 100, 100, 900);
      if (op.color) out.color = op.color;
      if (op.fontSizeCm !== undefined) out.fontSizeCm = round(clamp(op.fontSizeCm, 0.3, 20));
      if (op.letterSpacing !== undefined) out.letterSpacing = round(clamp(op.letterSpacing, -0.2, 1), 3);
      if (op.uppercase !== undefined) out.uppercase = op.uppercase;
      if (op.italic !== undefined) out.italic = op.italic;
      return out;
    }
    case "add-svg": {
      if (!garment.sides.includes(op.side)) {
        tally.invalid++;
        return null;
      }
      const clean = sanitizeSvg(op.svg);
      if (!clean) {
        tally.svg++;
        return null;
      }
      const p = clampToExtent(extentOf(garment, op.side), op.x, op.y);
      return { op: "add-svg", side: op.side, name: op.name.trim().slice(0, 60) || "AI graphic", svg: clean.svg, x: p.x, y: p.y, w: round(clamp(op.w, MIN_SIZE, MAX_SIZE)) };
    }
    case "set-opacity":
      return { op: "set-opacity", layerId: op.layerId, opacity: round(clamp(op.opacity, 0, 1)) };
    case "delete":
      if (sim) sim.deleted = true;
      return { op: "delete", layerId: op.layerId };
    case "duplicate":
      return {
        op: "duplicate",
        layerId: op.layerId,
        ...(op.dx !== undefined ? { dx: round(clamp(op.dx, -30, 30)) } : {}),
        ...(op.dy !== undefined ? { dy: round(clamp(op.dy, -30, 30)) } : {}),
      };
    case "reorder":
      return { op: "reorder", layerId: op.layerId, to: op.to };
    case "set-color": {
      const id = findColorId(garment, op.colorId);
      if (!id) {
        tally.invalid++;
        return null;
      }
      return { op: "set-color", colorId: id };
    }
    case "set-garment":
      garmentRef.g = getGarment(op.garmentId);
      return { op: "set-garment", garmentId: op.garmentId };
    case "set-placement": {
      if (!garment.sides.includes(op.side) || !zonesFor(garment, op.side).some((z) => z.id === op.zoneId)) {
        tally.invalid++;
        return null;
      }
      return { op: "set-placement", side: op.side, zoneId: op.zoneId };
    }
    case "remove-background": {
      if (!sim || sim.kind !== "image") {
        tally.invalid++;
        return null;
      }
      return { op: "remove-background", layerId: op.layerId, ...(op.tolerance !== undefined ? { tolerance: Math.round(clamp(op.tolerance, 0, 100)) } : {}) };
    }
    case "center":
      return { op: "center", layerId: op.layerId, axis: op.axis ?? "both" };
  }
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function slugId(v: unknown, fallback: string, used: Set<string>): string {
  let id = str(v, 40).replace(/[^\w-]/g, "") || fallback;
  while (used.has(id)) id = `${id}-x`;
  used.add(id);
  return id;
}

/** The reply to send when nothing usable came back. */
export function safeReply(engine: AiReply["engine"], note: string): AiReply {
  return {
    message: "I couldn't turn that into edits this time — try rephrasing, or pick a layer and say what to change.",
    proposals: [],
    notes: [note],
    engine,
  };
}

/**
 * Check an already-parsed reply object against the project. Never throws.
 * Used for the live model's JSON and for the offline planner's own output, so
 * both reach the browser through the same gate.
 */
export function sanitizeReply(raw: unknown, project: DesignProject, engine: AiReply["engine"]): AiReply {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return safeReply(engine, "The designer's answer was not in the expected format.");
    const obj = raw as Record<string, unknown>;
    const tally: Tally = { unknown: 0, locked: 0, invalid: 0, svg: 0, capped: 0 };
    const proposals: AiProposal[] = [];
    const used = new Set<string>();
    const rawProposals = Array.isArray(obj.proposals) ? obj.proposals : [];
    if (rawProposals.length > MAX_PROPOSALS) tally.capped += rawProposals.length - MAX_PROPOSALS;

    for (const [pi, rp] of rawProposals.slice(0, MAX_PROPOSALS).entries()) {
      if (!rp || typeof rp !== "object") continue;
      const p = rp as Record<string, unknown>;
      // Each proposal is applied to the CURRENT project on its own, so each one
      // starts from a fresh copy of the layer state and garment.
      const sims = new Map<string, Sim>(
        project.layers.map((l) => [l.id, { kind: l.kind, side: l.side, x: l.x, y: l.y, w: Math.max(l.w, 0.01), h: Math.max(l.h, 0.01), locked: l.locked, deleted: false }]),
      );
      const garmentRef = { g: getGarment(project.garmentId) };
      const ops: DesignOp[] = [];
      const rawOps = Array.isArray(p.ops) ? p.ops : [];
      if (rawOps.length > MAX_OPS) tally.capped += rawOps.length - MAX_OPS;
      for (const ro of rawOps.slice(0, MAX_OPS)) {
        const parsed = DesignOpSchema.safeParse(ro);
        if (!parsed.success) {
          tally.invalid++;
          continue;
        }
        const op = checkOp(parsed.data, garmentRef, sims, tally);
        if (op) ops.push(op);
      }
      if (!ops.length) continue;
      proposals.push({
        id: slugId(p.id, `p${pi + 1}`, used),
        title: str(p.title, 80) || `Option ${proposals.length + 1}`,
        rationale: str(p.rationale, 400),
        ops,
      });
    }

    const notes = (Array.isArray(obj.notes) ? obj.notes : [])
      .map((n) => str(n, 300))
      .filter(Boolean)
      .slice(0, 6);
    const skipped: string[] = [];
    if (tally.unknown) skipped.push(`${tally.unknown} referred to layers that don't exist`);
    if (tally.locked) skipped.push(`${tally.locked} would have changed locked layers`);
    if (tally.invalid) skipped.push(`${tally.invalid} weren't valid for this garment`);
    if (tally.svg) skipped.push(`${tally.svg} graphic${tally.svg === 1 ? "" : "s"} couldn't be made print-safe`);
    if (tally.capped) skipped.push(`${tally.capped} went over the limit per reply`);
    if (skipped.length) notes.push(`Skipped some suggested edits: ${skipped.join("; ")}.`);

    const palette = (Array.isArray(obj.palette) ? obj.palette : [])
      .map((c) => {
        if (!c || typeof c !== "object") return null;
        const rec = c as Record<string, unknown>;
        const hex = normalizeHex(rec.hex);
        return hex ? { hex, name: str(rec.name, 40) || hex } : null;
      })
      .filter((c): c is { hex: string; name: string } => c !== null)
      .slice(0, 8);

    const message = str(obj.message, 1500) || (proposals.length ? "Here's what I'd change." : "Here's my take.");
    const reply: AiReply = { message, proposals, engine };
    if (notes.length) reply.notes = notes;
    if (palette.length) reply.palette = palette;
    return reply;
  } catch (err) {
    console.warn("[dtf/ai] sanitizeReply failed", err);
    return safeReply(engine, "Something in the designer's answer couldn't be read, so nothing was changed.");
  }
}

/** A live model's parsed JSON → a safe AiReply for this project. Never throws. */
export function parseAiReply(raw: unknown, project: DesignProject): AiReply {
  return sanitizeReply(raw, project, "live");
}
