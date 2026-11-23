// ---------------------------------------------------------------------------
// The built-in designer: a deterministic planner that answers when no AI
// provider is configured, the provider fails, or its answer is unreadable.
//
// It understands the requests customers actually type in an editor — nudge,
// centre, bigger/smaller (for the text OR the artwork, not both), rotate,
// font and colour changes, "make it work on a black shirt", style presets
// (premium, vintage, streetwear, minimal), "three versions", background
// removal, adding quoted text and palette advice — and turns them into the
// same DesignOps a live model would. Its output goes through the same gate
// (schema.ts sanitizeReply) so it is clamped and checked exactly the same way.
// ---------------------------------------------------------------------------

import { getColor, getGarment, isDarkFabric, ZONES, zonesFor, type Garment } from "../garments";
import { LANCELOT_M1630_PRO } from "../printers";
import type { AiProposal, AiReply, DesignOp, DesignProject, FontId, Layer, RectCm, SideId, TextLayer, ZoneId } from "../types";
import { activeZone } from "./context";
import { INK_COLORS, normalizeAngle, sanitizeReply } from "./schema";

export interface OfflineOptions {
  /** The layer selected in the editor — what "this" / "it" means. */
  selectedLayerId?: string;
}

// ----- colour maths -----------------------------------------------------------------

function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const LIGHT_INK = "#FFFFFF";
const DARK_INK = "#111111";

/** The plain ink that reads on this fabric. */
function inkFor(fabricHex: string): string {
  return isDarkFabric(fabricHex) ? LIGHT_INK : DARK_INK;
}

/** `wanted` if it reads on the fabric, else the plain ink. */
function readable(wanted: string, fabricHex: string): string {
  return contrastRatio(wanted, fabricHex) >= 3 ? wanted : inkFor(fabricHex);
}

const PALETTE_POOL: { hex: string; name: string }[] = [
  { hex: "#F4F1EA", name: "Paper white" },
  { hex: "#F2E8CF", name: "Cream" },
  { hex: "#C9A227", name: "Old gold" },
  { hex: "#F26B21", name: "Safety orange" },
  { hex: "#9EC3DF", name: "Powder blue" },
  { hex: "#E3B5B8", name: "Washed pink" },
  { hex: "#A8E6CF", name: "Mint" },
  { hex: "#111111", name: "Ink black" },
  { hex: "#1C2233", name: "Midnight navy" },
  { hex: "#B3242B", name: "Signal red" },
  { hex: "#24392E", name: "Forest" },
  { hex: "#7A2E1F", name: "Rust" },
  { hex: "#2546A8", name: "Royal" },
  { hex: "#3A3B3F", name: "Charcoal" },
];

/** 5 inks with real contrast on this fabric, best first. */
export function paletteFor(fabricHex: string): { hex: string; name: string }[] {
  return PALETTE_POOL.map((c) => ({ ...c, ratio: contrastRatio(c.hex, fabricHex) }))
    .filter((c) => c.ratio >= 3)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 5)
    .map(({ hex, name }) => ({ hex, name }));
}

// ----- geometry -------------------------------------------------------------------------

const r2 = (v: number) => Math.round(v * 100) / 100;
const area = (l: Layer) => l.w * l.h;

function bbox(layers: Layer[]): RectCm {
  const x0 = Math.min(...layers.map((l) => l.x - l.w / 2));
  const x1 = Math.max(...layers.map((l) => l.x + l.w / 2));
  const y0 = Math.min(...layers.map((l) => l.y - l.h / 2));
  const y1 = Math.max(...layers.map((l) => l.y + l.h / 2));
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

function zoneRect(project: DesignProject, side: SideId): RectCm | null {
  const id = activeZone(project, side);
  return id ? ZONES[id].rect : null;
}

/** The largest scale that keeps a w×h box inside the zone and the safe print width. */
function maxScaleFor(w: number, h: number, zone: RectCm | null): number {
  const safeW = LANCELOT_M1630_PRO.safeWidthMm / 10;
  const limW = Math.min(zone?.w ?? safeW, safeW);
  const limH = zone?.h ?? 60;
  return Math.min(limW / Math.max(w, 0.01), limH / Math.max(h, 0.01));
}

/**
 * Scale a group of layers about a point (its own centre unless given) and
 * optionally move that centre — so a multi-layer design keeps its layout.
 */
function groupTransform(layers: Layer[], scale: number, to?: { x?: number; y?: number }): DesignOp[] {
  if (!layers.length) return [];
  const box = bbox(layers);
  const cx = to?.x ?? box.x;
  const cy = to?.y ?? box.y;
  const ops: DesignOp[] = [];
  for (const l of layers) {
    if (Math.abs(scale - 1) > 0.001) ops.push({ op: "resize", layerId: l.id, scale: r2(scale) });
    const nx = r2(cx + (l.x - box.x) * scale);
    const ny = r2(cy + (l.y - box.y) * scale);
    if (Math.abs(nx - l.x) > 0.05 || Math.abs(ny - l.y) > 0.05) ops.push({ op: "move", layerId: l.id, x: nx, y: ny });
  }
  return ops;
}

// ----- request reading ---------------------------------------------------------------------

const TEXT_WORDS = /\b(text|type|typography|font|word|words|letters?|lettering|headline|title|name|slogan|caption|quote|wording)\b/;
const IMAGE_WORDS = /\b(graphic|graphics|image|picture|photo|artwork|art|logo|illustration|icon|drawing|pic)\b/;
const ALL_WORDS = /\b(design|everything|whole thing|all of it|all layers|whole design|the lot)\b/;
const THIS_WORDS = /\b(this|it|selected|that one|this one)\b/;
const SLIGHT = /\b(slightly|a bit|a little|a touch|a tad|tad|nudge|little|bit|marginally|subtly)\b/;
const LOTS = /\b(a lot|much|way|lots|significantly|massively|really)\b/;
const GARMENT_NOUN = "(?:shirt|t-shirt|tshirt|tee|hoodie|sweatshirt|sweater|crewneck|tank|tote|bag|garment|fabric)";

type Kind = "text" | "image" | "all" | null;

function kindIn(clause: string): Kind {
  const t = TEXT_WORDS.test(clause);
  const i = IMAGE_WORDS.test(clause);
  if (t && !i) return "text";
  if (i && !t) return "image";
  if (t && i) return "all";
  if (ALL_WORDS.test(clause)) return "all";
  return null;
}

/** Explicit distance in the message, in cm. */
function distanceCm(m: string): number | null {
  const hit = /(\d+(?:\.\d+)?)\s*(cm|centimet(?:er|re)s?|mm|millimet(?:er|re)s?|in|inch|inches)\b/.exec(m);
  if (!hit) return null;
  const n = Number(hit[1]);
  if (hit[2].startsWith("mm") || hit[2].startsWith("milli")) return n / 10;
  if (hit[2].startsWith("in")) return n * 2.54;
  return n;
}

const FONT_PATTERNS: [RegExp, FontId][] = [
  [/\bsans[\s-]?serif\b/, "inter"],
  [/\binstrument(?:\s+serif)?\b/, "instrument-serif"],
  [/\barchivo(?:\s+black)?\b/, "archivo-black"],
  [/\bspace\s+grotesk\b|\bgrotesk\b/, "space-grotesk"],
  [/\bchakra(?:\s+petch)?\b/, "chakra-petch"],
  [/\bjetbrains(?:\s+mono)?\b|\bmonospace\b|\bmono\b|\btypewriter\b/, "jetbrains-mono"],
  [/\bgeist\b/, "geist"],
  [/\binter\b/, "inter"],
  [/\bsyne\b/, "syne"],
  [/\boxanium\b/, "oxanium"],
  [/\bserif\b/, "instrument-serif"],
];

/** Weight a font actually ships with, where it is not variable. */
function weightFor(font: FontId, wanted: number): number {
  if (font === "archivo-black") return 900;
  if (font === "instrument-serif") return 400;
  return wanted;
}

/** Garment colour synonyms → colour ids (used only when that id exists on the garment). */
const FABRIC_SYNONYMS: Record<string, string> = {
  grey: "heather-grey",
  gray: "heather-grey",
  heather: "heather-grey",
  blue: "royal",
  green: "forest",
  maroon: "burgundy",
  oxblood: "burgundy",
  wine: "burgundy",
  cream: "bone",
  ivory: "bone",
  "off white": "bone",
  "off-white": "bone",
  natural: "bone",
  beige: "sand",
  tan: "sand",
  khaki: "sand",
  purple: "lilac",
  lavender: "lilac",
  yellow: "mustard",
  gold: "mustard",
};

/** Find a garment colour named anywhere in a phrase. */
function fabricColorIn(garment: Garment, phrase: string, at: "end" | "start" | "any" = "any"): string | undefined {
  const p = ` ${phrase.replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim()} `;
  // Longest names first so "heather grey" beats "grey".
  const candidates: [string, string][] = [];
  for (const c of garment.colors) {
    candidates.push([c.name.toLowerCase(), c.id], [c.id.replace(/-/g, " "), c.id], [c.id, c.id]);
    const last = c.name.toLowerCase().split(" ").pop();
    if (last) candidates.push([last, c.id]);
  }
  for (const [word, id] of Object.entries(FABRIC_SYNONYMS)) if (garment.colors.some((c) => c.id === id)) candidates.push([word, id]);
  candidates.sort((a, b) => b[0].length - a[0].length);
  for (const [word, id] of candidates) {
    const w = ` ${word} `;
    if (at === "end" ? p.endsWith(w) : at === "start" ? p.startsWith(w) : p.includes(w)) return id;
  }
  return undefined;
}

/**
 * The fabric colour a message names next to a garment word: "works on a black
 * shirt", "heather grey hoodie", "change the shirt to navy". Returns the colour
 * id and the exact words to strike out so they are not read again as an ink.
 */
function fabricRequest(garment: Garment, m: string): { colorId?: string; unknown?: string; words: string } | null {
  // The colour must sit right against the garment word ("a white shirt"), so
  // "make the text white on the shirt" is read as an ink, not a fabric.
  const before = new RegExp(`((?:\\b[a-z-]+\\s+){1,2})${GARMENT_NOUN}s?\\b`, "g");
  let hit: RegExpExecArray | null;
  while ((hit = before.exec(m))) {
    const id = fabricColorIn(garment, hit[1], "end");
    if (id) return { colorId: id, words: hit[0] };
    const last = hit[1].trim().split(/\s+/).pop() ?? "";
    if (INK_COLORS[last]) return { unknown: last, words: hit[0] };
  }
  const after = new RegExp(`\\b${GARMENT_NOUN}s?\\s+(?:colou?r\\s+)?(?:to|in|into)\\s+([a-z-]+(?:\\s+[a-z-]+)?)`).exec(m);
  if (after) {
    const id = fabricColorIn(garment, after[1], "start");
    if (id) return { colorId: id, words: after[0] };
    const first = after[1].split(/\s+/)[0];
    if (INK_COLORS[first]) return { unknown: first, words: after[0] };
  }
  return null;
}

// ----- presets ----------------------------------------------------------------------------------

type PresetId = "premium" | "streetwear" | "vintage" | "minimal";

const PRESET_WORDS: [PresetId, RegExp][] = [
  ["premium", /\b(expensive|premium|luxury|luxurious|high[\s-]?end|elegant|classy|upscale|designer|sophisticated|refined)\b/],
  ["vintage", /\b(vintage|retro|old[\s-]?school|throwback|classic|worn|distressed|70s|80s|90s)\b/],
  ["streetwear", /\b(streetwear|street|urban|hype|skate|bold|edgy|loud)\b/],
  ["minimal", /\b(minimal|minimalist|cleaner|simple|simpler|understated|less busy)\b/],
];

interface Ctx {
  project: DesignProject;
  garment: Garment;
  fabricHex: string;
  dark: boolean;
  editable: Layer[];
  selected?: Layer;
  side: SideId;
}

function textsByProminence(layers: Layer[]): TextLayer[] {
  return layers.filter((l): l is TextLayer => l.kind === "text").sort((a, b) => b.fontSizeCm * b.w - a.fontSizeCm * a.w);
}

/** The side most of the design lives on (the selected layer's side wins). */
function mainSide(ctx: Omit<Ctx, "side">): SideId {
  if (ctx.selected) return ctx.selected.side;
  const counts = new Map<SideId, number>();
  for (const l of ctx.project.layers) counts.set(l.side, (counts.get(l.side) ?? 0) + area(l));
  let best: SideId = "front";
  let bestN = -1;
  for (const [s, n] of counts) if (n > bestN) [best, bestN] = [s, n];
  return best;
}

function presetProposal(ctx: Ctx, id: PresetId): AiProposal {
  const layers = ctx.editable.filter((l) => l.side === ctx.side && !l.hidden);
  const texts = textsByProminence(layers);
  const [primary, ...secondary] = texts;
  const zone = zoneRect(ctx.project, ctx.side);
  const ops: DesignOp[] = [];
  const ink = inkFor(ctx.fabricHex);

  const style = (l: TextLayer, s: Omit<Extract<DesignOp, { op: "set-text" }>, "op" | "layerId">) => ops.push({ op: "set-text", layerId: l.id, ...s });
  /** Scale the group, but never below legible type or beyond the zone. */
  const scaleGroup = (wanted: number, opts: { centreX?: boolean; lift?: number } = {}) => {
    if (!layers.length) return;
    const box = bbox(layers);
    let s = wanted;
    const minFont = texts.length ? Math.min(...texts.map((t) => t.fontSizeCm)) : Infinity;
    if (s < 1 && Number.isFinite(minFont)) s = Math.max(s, Math.min(1, 0.85 / minFont));
    if (s > 1) s = Math.max(1, Math.min(s, maxScaleFor(box.w, box.h, zone)));
    const to: { x?: number; y?: number } = {};
    if (opts.centreX && zone) to.x = zone.x;
    if (opts.lift) {
      // Lift the smaller group towards the top of the zone, never past it.
      const top = zone ? zone.y + zone.h / 2 - (box.h * s) / 2 : Infinity;
      to.y = r2(Math.min(box.y + opts.lift, top));
    }
    ops.push(...groupTransform(layers, s, to));
  };

  let title: string;
  let rationale: string;
  let fallbackText: Extract<DesignOp, { op: "add-text" }> | null = null;
  const at = zone ? { x: zone.x, y: r2(zone.y + zone.h / 4) } : { x: 0, y: -14 };

  switch (id) {
    case "premium": {
      title = "Quiet luxury";
      const tone = readable(ctx.dark ? "#EDE6D6" : "#1C1C1E", ctx.fabricHex);
      // A short word becomes a wide-tracked fashion-house wordmark; a phrase gets a refined serif.
      const wordmark = !!primary && primary.text.trim().length <= 14;
      rationale = wordmark
        ? "A light, wide-tracked uppercase wordmark in one restrained ink, smaller and with more empty fabric around it, reads like a fashion house."
        : "A refined serif with wide-tracked small caps, one restrained ink and more empty fabric around the design reads as expensive.";
      if (primary) {
        if (wordmark) style(primary, { font: "geist", weight: 300, uppercase: true, italic: false, letterSpacing: 0.35, color: tone });
        else style(primary, { font: "instrument-serif", weight: 400, uppercase: false, italic: false, letterSpacing: 0.02, color: tone });
      }
      for (const t of secondary) {
        if (wordmark) style(t, { font: "instrument-serif", weight: 400, uppercase: false, italic: true, letterSpacing: 0.02, color: tone });
        else style(t, { font: "inter", weight: 500, uppercase: true, letterSpacing: 0.32, color: tone });
      }
      scaleGroup(0.78, { lift: 1.5 });
      fallbackText = { op: "add-text", side: ctx.side, text: "Atelier", ...at, font: "instrument-serif", weight: 400, color: tone, fontSizeCm: 3.2, letterSpacing: 0.02 };
      break;
    }
    case "streetwear": {
      title = "Loud streetwear";
      rationale = "Heavy condensed uppercase at full contrast and a bigger footprint gives it the confident, graphic punch of a streetwear drop.";
      const accent = readable("#E4002B", ctx.fabricHex);
      if (primary) style(primary, { font: "archivo-black", weight: 900, uppercase: true, letterSpacing: -0.01, lineHeight: 0.95, color: ink, italic: false });
      for (const t of secondary) style(t, { font: "inter", weight: 800, uppercase: true, letterSpacing: 0.2, color: accent });
      scaleGroup(1.15);
      fallbackText = { op: "add-text", side: ctx.side, text: "NO DAYS OFF", ...at, font: "archivo-black", weight: 900, color: ink, fontSizeCm: 4, letterSpacing: -0.01, uppercase: true };
      break;
    }
    case "vintage": {
      title = "Worn-in vintage";
      rationale = "An italic serif headline in warm, slightly faded ink with typewriter details and a small tilt feels like a thrifted find.";
      const warm = readable(ctx.dark ? "#E9D8A6" : "#7A2E1F", ctx.fabricHex);
      const detail = readable(ctx.dark ? "#C9A227" : "#3A3B3F", ctx.fabricHex);
      if (primary) {
        style(primary, { font: "instrument-serif", weight: 400, italic: true, uppercase: false, letterSpacing: 0, color: warm });
        ops.push({ op: "rotate", layerId: primary.id, rotation: -4 });
      }
      for (const t of secondary) style(t, { font: "jetbrains-mono", weight: 500, uppercase: true, letterSpacing: 0.18, color: detail });
      fallbackText = { op: "add-text", side: ctx.side, text: "Est. 1979", ...at, font: "instrument-serif", weight: 400, color: warm, fontSizeCm: 3.4, italic: true };
      break;
    }
    case "minimal": {
      title = "Clean minimal";
      rationale = "One small, evenly tracked line of type in a single ink, centred, lets the garment do the talking.";
      for (const t of texts) style(t, { font: "inter", weight: 500, uppercase: true, letterSpacing: 0.14, italic: false, color: ink });
      scaleGroup(0.65, { centreX: true });
      fallbackText = { op: "add-text", side: ctx.side, text: "less, but better", ...at, font: "inter", weight: 500, color: ink, fontSizeCm: 1.2, letterSpacing: 0.14, uppercase: true };
      break;
    }
  }
  if (!ctx.project.layers.length && fallbackText) ops.push(fallbackText);
  return { id, title, rationale, ops };
}

// ----- the planner ---------------------------------------------------------------------------------

const ZONE_PHRASES: [RegExp, ZoneId][] = [
  [/\bleft[\s-]chest\b/, "left-chest"],
  [/\bright[\s-]chest\b/, "right-chest"],
  [/\bfront[\s-]chest\b|\bacross the chest\b/, "front-chest"],
  [/\bfull[\s-]front\b|\bbig front\b/, "full-front"],
  [/\bupper[\s-]back\b|\bunder the collar\b/, "upper-back"],
  [/\bfull[\s-]back\b/, "back"],
  [/\blong[\s-]sleeve\b|\bdown the (?:arm|sleeve)\b/, "sleeve-long"],
];

const BUILT_IN_NOTE = "Running on the built-in designer: it handles layout, size, colour, font, style and placement requests; the live AI adds new artwork and reads reference pictures.";

/**
 * Plan a reply without a model. `message` is what the customer typed.
 * Deterministic: the same project and message always give the same reply.
 */
export function offlineReply(project: DesignProject, message: string, opts: OfflineOptions = {}): AiReply {
  const garment = getGarment(project.garmentId);
  const fabric = getColor(garment, project.colorId);
  const editable = project.layers.filter((l) => !l.locked);
  const selected = project.layers.find((l) => l.id === opts.selectedLayerId);
  const base = { project, garment, fabricHex: fabric.hex, dark: isDarkFabric(fabric.hex), editable, selected };
  const ctx: Ctx = { ...base, side: mainSide(base) };

  const raw = String(message ?? "").slice(0, 2000);
  const m = raw.toLowerCase().replace(/[’‘]/g, "'");
  // "make the text larger but keep the artwork the same" — only the part before "keep" picks the target.
  const focus = m.split(/\b(?:but|while|and)?\s*(?:keep|keeping|leave|leaving|without (?:changing|touching))\b/)[0];
  const kind = kindIn(focus);
  const notes: string[] = [BUILT_IN_NOTE];
  let palette: { hex: string; name: string }[] | undefined;
  const done: string[] = [];

  /** Which layers a request is about. */
  const targets = (want: Kind = kind): Layer[] => {
    const usable = (l: Layer | undefined): l is Layer => !!l && !l.locked;
    const pool = editable.filter((l) => !l.hidden);
    if (THIS_WORDS.test(focus) && usable(selected) && (want === null || want === "all" || selected.kind === want)) return [selected];
    if (want === "all") return pool.filter((l) => l.side === ctx.side);
    if (want === "text" || want === "image") {
      if (usable(selected) && selected.kind === want) return [selected];
      const of = pool.filter((l) => l.kind === want).sort((a, b) => area(b) - area(a));
      return of.slice(0, 1);
    }
    if (usable(selected)) return [selected];
    const best = [...pool].sort((a, b) => area(b) - area(a))[0];
    return best ? [best] : [];
  };
  const label = (ls: Layer[]) => (ls.length > 1 ? "the design" : ls[0]?.kind === "text" ? "the text" : "the graphic");

  // --- variations: three presets -------------------------------------------------------------------
  if (/\b(three|3|several|some|a few|couple of)\s+(?:different\s+)?(versions?|variations?|options?|directions?|takes?|ideas?|looks?|styles?)\b|\bvariations?\b|\balternatives?\b/.test(m)) {
    const wanted = PRESET_WORDS.filter(([, re]) => re.test(m)).map(([id]) => id);
    const order: PresetId[] = [...new Set<PresetId>([...wanted, "premium", "streetwear", "vintage", "minimal"])].slice(0, 3);
    const proposals = order.map((p) => presetProposal(ctx, p));
    palette = paletteFor(fabric.hex);
    return finish(project, {
      message: `Three directions for your ${fabric.name.toLowerCase()} ${garment.name.toLowerCase()}: ${proposals.map((p) => p.title.toLowerCase()).join(", ")}. Approve the one you like — each is undoable.`,
      proposals,
      notes,
      palette,
    });
  }

  const ops: DesignOp[] = [];
  let title = "Your edit";

  // --- style presets ---------------------------------------------------------------------------------
  const preset = PRESET_WORDS.find(([, re]) => re.test(m))?.[0];
  if (preset && !/\b(font|typeface)\b/.test(m)) {
    const p = presetProposal(ctx, preset);
    return finish(project, {
      message: `${p.title}: ${p.rationale}`,
      proposals: [p],
      notes,
      palette: paletteFor(fabric.hex),
    });
  }

  // --- background removal -----------------------------------------------------------------------------
  if (/\b(remove|delete|drop|lose|get rid of|cut out|knock out)\b.*\bbackground\b|\bcut ?out\b|\b(transparent|no) background\b|\bbackground remov/.test(m)) {
    const img = targets(kind === "text" ? "image" : kind ?? "image").find((l) => l.kind === "image") ?? targets("image")[0];
    if (img && img.kind === "image") {
      ops.push({ op: "remove-background", layerId: img.id });
      done.push(`removed the background from "${img.name}" (the original is kept)`);
      title = "Remove background";
    } else notes.push("There's no unlocked picture to cut out — upload one first.");
  }

  // --- add quoted text ------------------------------------------------------------------------------------
  const quoted = /["“”'‘’]([^"“”‘’]{1,80})["“”'‘’]/.exec(raw);
  if (quoted && /\b(add|put|write|include|say|says|saying|text)\b/.test(m)) {
    const side: SideId = /\bback\b/.test(m) && garment.sides.includes("back") ? "back" : ctx.side;
    const zone = zoneRect(project, side);
    const onSide = project.layers.filter((l) => l.side === side);
    const size = 2.2;
    let y: number;
    if (onSide.length) {
      const box = bbox(onSide);
      y = box.y - box.h / 2 - 1.2 - size / 2;
      if (zone && y < zone.y - zone.h / 2 + size / 2) y = box.y + box.h / 2 + 1.2 + size / 2; // no room below → above
    } else y = zone ? zone.y + zone.h / 4 : -14;
    ops.push({
      op: "add-text",
      side,
      text: quoted[1].trim(),
      x: zone?.x ?? 0,
      y: r2(y),
      font: "inter",
      weight: 700,
      color: inkFor(fabric.hex),
      fontSizeCm: size,
      letterSpacing: 0.08,
      uppercase: false,
    });
    done.push(`added "${quoted[1].trim()}"`);
    title = "Add text";
  }

  // --- fabric colour / contrast ---------------------------------------------------------------------------
  // Font names are not colours: "Archivo Black" must not paint the text black.
  let rest = FONT_PATTERNS.reduce((acc, [re]) => acc.replace(new RegExp(re.source, "g"), " "), m);
  const fabricAsk = fabricRequest(garment, m);
  const colorId = fabricAsk?.colorId;
  if (fabricAsk && colorId) {
    rest = rest.replace(fabricAsk.words, " ");
    const next = getColor(garment, colorId);
    if (colorId !== project.colorId) {
      ops.push({ op: "set-color", colorId });
      done.push(`switched the ${garment.name.toLowerCase()} to ${next.name}`);
    }
    const flip = textsByProminence(editable).filter((t) => contrastRatio(t.color, next.hex) < 3);
    for (const t of flip) ops.push({ op: "set-text", layerId: t.id, color: inkFor(next.hex) });
    if (flip.length) done.push(`changed ${flip.length === 1 ? "the text" : `${flip.length} text layers`} to ${isDarkFabric(next.hex) ? "white" : "black"} so ${flip.length === 1 ? "it reads" : "they read"} on it`);
    if (editable.some((l) => l.kind === "image") && isDarkFabric(next.hex) !== isDarkFabric(fabric.hex)) {
      notes.push(`Check pictures on ${next.name}: dark outlines or a solid background that looked fine before can disappear or show as a box. Remove the background if it has one.`);
    }
    palette = paletteFor(next.hex);
    title = `Works on ${next.name}`;
  } else if (fabricAsk?.unknown) {
    const names = garment.colors.map((c) => c.name).join(", ");
    notes.push(`The ${garment.name} doesn't come in ${fabricAsk.unknown}. Available colours: ${names}.`);
    rest = rest.replace(fabricAsk.words, " ");
  }

  // --- text ink colour --------------------------------------------------------------------------------------
  const inkWord = Object.keys(INK_COLORS)
    .sort((a, b) => b.length - a.length)
    .find((w) => new RegExp(`\\b${w.replace("-", "[\\s-]?")}\\b`).test(rest));
  if (inkWord && /\b(make|turn|change|colou?r|in|to|set)\b/.test(rest)) {
    const ts = targets(kind === "image" ? "image" : "text");
    const hex = INK_COLORS[inkWord];
    const fabricNow = getColor(garment, colorId ?? project.colorId).hex;
    const texts = ts.filter((l): l is TextLayer => l.kind === "text");
    if (texts.length) {
      for (const t of texts) ops.push({ op: "set-text", layerId: t.id, color: hex });
      done.push(`made the text ${inkWord}`);
      if (contrastRatio(hex, fabricNow) < 3) notes.push(`${inkWord[0].toUpperCase()}${inkWord.slice(1)} is low-contrast on this fabric and may be hard to read from a distance.`);
      title = title === "Your edit" ? "Text colour" : title;
    } else if (ts.some((l) => l.kind === "image")) {
      notes.push("I can't recolour a picture's pixels — I can recolour text, change the fabric, or cut out the picture's background.");
    }
  }

  // --- font --------------------------------------------------------------------------------------------------
  const font = FONT_PATTERNS.find(([re]) => re.test(m))?.[1];
  if (font && (/\b(font|typeface|type|serif|mono|lettering)\b/.test(m) || !IMAGE_WORDS.test(m))) {
    const ts = targets(kind === "image" ? "text" : kind === "all" ? "all" : "text").filter((l): l is TextLayer => l.kind === "text");
    for (const t of ts) {
      const op: DesignOp = { op: "set-text", layerId: t.id, font, weight: weightFor(font, t.weight) };
      if (font === "instrument-serif") op.italic = /\bitalic\b/.test(m);
      ops.push(op);
    }
    if (ts.length) {
      done.push(`set the type in ${font.replace(/-/g, " ")}`);
      if (title === "Your edit") title = "New typeface";
    } else notes.push("There's no unlocked text layer to change the font on.");
  }

  // --- size -------------------------------------------------------------------------------------------------
  const bigger = /\b(bigger|larger|enlarge|increase|grow|scale up|blow up|huge|more prominent|bolder size)\b/.test(focus);
  const smaller = /\b(smaller|shrink|reduce|decrease|scale down|tiny|less prominent|tone down)\b/.test(focus);
  if (bigger !== smaller) {
    const ts = targets();
    if (ts.length) {
      const slight = SLIGHT.test(focus);
      const lots = LOTS.test(focus);
      let s = bigger ? (slight ? 1.08 : lots ? 1.35 : 1.2) : slight ? 0.92 : lots ? 0.7 : 0.83;
      const box = bbox(ts);
      const zone = zoneRect(project, ts[0].side);
      if (bigger) {
        const cap = maxScaleFor(box.w, box.h, zone);
        if (cap < s) {
          s = Math.max(1, cap);
          notes.push("That's as big as it can go and still fit the print area.");
        }
      } else {
        const minFont = Math.min(...ts.filter((l): l is TextLayer => l.kind === "text").map((t) => t.fontSizeCm), Infinity);
        if (Number.isFinite(minFont) && minFont * s < 0.85) {
          s = Math.min(1, 0.85 / minFont);
          notes.push("Text smaller than about 0.6 cm cap height stops being legible on fabric, so I stopped there.");
        }
      }
      if (Math.abs(s - 1) > 0.005) {
        ops.push(...(ts.length > 1 ? groupTransform(ts, s) : [{ op: "resize" as const, layerId: ts[0].id, scale: r2(s) }]));
        done.push(`made ${label(ts)} ${bigger ? "larger" : "smaller"}`);
        if (title === "Your edit") title = bigger ? "Scale up" : "Scale down";
      }
      const img = ts.find((l) => l.kind === "image");
      if (bigger && img && img.kind === "image" && img.naturalW && img.naturalW / ((img.w * s) / 2.54) < LANCELOT_M1630_PRO.minGoodDpi) {
        notes.push(`At this size "${img.name}" drops below ${LANCELOT_M1630_PRO.minGoodDpi} dpi and may print soft — a higher-resolution file would help.`);
      }
    }
  }

  // --- placement zones -----------------------------------------------------------------------------------------
  const zoneHit = ZONE_PHRASES.find(([re]) => re.test(m));
  let moveText = m;
  if (zoneHit) {
    moveText = m.replace(zoneHit[0], " ");
    const zoneId = zoneHit[1];
    const zone = ZONES[zoneId];
    const sides = garment.sides.filter((s) => zonesFor(garment, s).some((z) => z.id === zoneId));
    const side = sides.includes(ctx.side) ? ctx.side : sides[0];
    if (!side) notes.push(`The ${garment.name} doesn't offer a ${zone.label.toLowerCase()} print.`);
    else {
      ops.push({ op: "set-placement", side, zoneId });
      const group = editable.filter((l) => l.side === side && !l.hidden);
      if (group.length) {
        const box = bbox(group);
        const s = Math.min(1, maxScaleFor(box.w, box.h, zone.rect) * 0.92);
        ops.push(...groupTransform(group, s, { x: zone.rect.x, y: zone.rect.y }));
      } else if (side !== ctx.side) notes.push(`Your artwork is on the ${ctx.side}; move it to the ${side} to use that placement.`);
      done.push(`moved the print to the ${zone.label.toLowerCase()}`);
      if (title === "Your edit") title = zone.label;
    }
  }

  // --- move ---------------------------------------------------------------------------------------------------
  const mv = moveText.replace(/\b(scale|blow|tone|turn|size) (up|down)\b/g, " ");
  const verb = /\b(move|moved|shift|nudge|push|bring|slide|put|place|drag|position|sit|sits)\b/.test(mv);
  const dir = {
    up: /\b(higher|raise|raised|upwards?)\b/.test(mv) || (verb && /\bup\b/.test(mv)),
    down: /\b(lower|downwards?|drop it)\b/.test(mv) || (verb && /\bdown\b/.test(mv)),
    left: verb && /\bleft\b/.test(mv),
    right: verb && /\bright\b/.test(mv),
  };
  if (dir.up || dir.down || dir.left || dir.right) {
    const ts = targets();
    if (ts.length) {
      const amount = distanceCm(mv) ?? (SLIGHT.test(mv) ? 1 : LOTS.test(mv) ? 4 : 2);
      const dx = (dir.right ? amount : 0) - (dir.left ? amount : 0);
      const dy = (dir.up ? amount : 0) - (dir.down ? amount : 0);
      for (const l of ts) ops.push({ op: "move", layerId: l.id, ...(dx ? { dx } : {}), ...(dy ? { dy } : {}) });
      const words = [dir.up && !dir.down ? "up" : "", dir.down && !dir.up ? "down" : "", dir.left && !dir.right ? "left" : "", dir.right && !dir.left ? "right" : ""].filter(Boolean);
      done.push(`moved ${label(ts)} ${words.join(" and ")} ${amount} cm`);
      if (title === "Your edit") title = "Nudge";
    }
  }

  // --- centre -------------------------------------------------------------------------------------------------
  if (/\b(cent(?:er|re)d?|middle)\b/.test(m)) {
    const ts = targets();
    const axis: "x" | "y" | "both" = /\bhorizontal(?:ly)?\b|\bleft[\s-]to[\s-]right\b/.test(m) ? "x" : /\bvertical(?:ly)?\b/.test(m) ? "y" : "both";
    if (ts.length > 1) {
      const zone = zoneRect(project, ts[0].side);
      if (zone) ops.push(...groupTransform(ts, 1, { x: axis === "y" ? undefined : zone.x, y: axis === "x" ? undefined : zone.y }));
    } else for (const l of ts) ops.push({ op: "center", layerId: l.id, axis });
    if (ts.length) {
      done.push(`centred ${label(ts)}${axis === "x" ? " horizontally" : axis === "y" ? " vertically" : ""}`);
      if (title === "Your edit") title = "Centre";
    }
  }

  // --- rotate -------------------------------------------------------------------------------------------------
  if (/\b(rotate|rotated|tilt|tilted|angle|angled|turn it|straighten|level|upright|spin)\b/.test(m)) {
    const ts = targets();
    const deg = /(-?\d+(?:\.\d+)?)\s*(?:°|deg|degrees?)/.exec(m);
    const straighten = /\b(straighten|straight|level|upright|no rotation|unrotate)\b/.test(m);
    const ccw = /\b(counter|anti)[\s-]?clockwise\b|\bleft\b/.test(m);
    for (const l of ts) {
      const amount = deg ? Number(deg[1]) : /\btilt|angle/.test(m) ? 6 : 15;
      const rotation = straighten ? 0 : normalizeAngle(l.rotation + (ccw ? -Math.abs(amount) : amount));
      ops.push({ op: "rotate", layerId: l.id, rotation });
    }
    if (ts.length) {
      done.push(straighten ? `straightened ${label(ts)}` : `rotated ${label(ts)}`);
      if (title === "Your edit") title = straighten ? "Straighten" : "Rotate";
    }
  }

  // --- palette ---------------------------------------------------------------------------------------------------
  if (/\b(palette|colou?r scheme|colou?rs? (?:would|work|go|suit)|what colou?rs?|which colou?rs?|suggest (?:a |some )?colou?rs?)\b/.test(m)) {
    palette = palette ?? paletteFor(getColor(garment, colorId ?? project.colorId).hex);
    const f = getColor(garment, colorId ?? project.colorId);
    notes.push(`On ${f.name} (${isDarkFabric(f.hex) ? "a dark" : "a light"} fabric) these inks keep strong contrast. Pick one main colour and one accent at most for a cleaner print.`);
  }

  // --- assemble ---------------------------------------------------------------------------------------------------
  if (ops.length) {
    const summary = done.length ? `${done.join(", ")}.` : "Here's the change.";
    return finish(project, {
      message: `${summary[0].toUpperCase()}${summary.slice(1)} Approve to apply it — it's undoable.`,
      proposals: [{ id: "p1", title, rationale: rationaleFor(title), ops }],
      notes,
      palette,
    });
  }

  if (!project.layers.length) {
    return finish(project, {
      message: `Your design is empty. Upload artwork, or ask me to add text — for example: add "YOUR WORDS". I can also suggest three style directions.`,
      proposals: [],
      notes,
      palette: palette ?? paletteFor(fabric.hex),
    });
  }
  if (project.layers.length && !editable.length) notes.push("Every layer is locked — unlock one to let me change it.");
  return finish(project, {
    message:
      palette !== undefined
        ? "Here are inks that will read well on this fabric."
        : `I didn't catch a change I can make. Try "move the graphic slightly higher", "make the text larger", "make it work on a black shirt", "more premium", or "show me three versions".`,
    proposals: [],
    notes,
    palette,
  });
}

function rationaleFor(title: string): string {
  if (title.startsWith("Works on")) return "Swaps the fabric and flips any ink that would disappear on it, so everything keeps strong contrast.";
  if (title === "Remove background") return "A solid background prints as a visible box on DTF; cutting it out leaves only the artwork.";
  return "Exactly what you asked for, kept inside the print area.";
}

/** Run the planner's output through the same gate as a live model's. */
function finish(project: DesignProject, reply: Omit<AiReply, "engine">): AiReply {
  return sanitizeReply(reply, project, "offline");
}
