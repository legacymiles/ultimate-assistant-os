// ---------------------------------------------------------------------------
// "What to change" for a recreation — characters, outfits, locations, style.
//
// The owner types it in plain words ("Person A -> a grey-haired fisherman",
// "outfit: red dress -> black tuxedo", "style: 16 mm film, warm grade"); this
// file reads that into a typed `H3Changes`, then applies it to a Blueprint the
// way the H3 Lab's recreate() expects: new Character / Environment bible
// entries plus the label → id maps (castMap / envMap). Pure, no Node APIs —
// the H3 Lab panel uses parseChangeText() to preview what it understood.
//
// A recreation never face-swaps the reference: a replaced person is written
// from the owner's words, never from the reference's look.
// ---------------------------------------------------------------------------

import type { Blueprint, Character, Environment } from "@/lib/h3-lab/model";

export interface Swap {
  from: string;
  to: string;
}

export interface H3Changes {
  characters: Swap[];
  outfits: Swap[];
  locations: Swap[];
  /** Replaces the reference's style line when set. */
  style: string;
  /** Anything else, appended to every prompt's closing block. */
  extra: string;
}

export const NO_CHANGES: H3Changes = { characters: [], outfits: [], locations: [], style: "", extra: "" };

const clip = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function cleanSwaps(v: unknown): Swap[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s) => ({ from: clip((s as Swap)?.from, 200), to: clip((s as Swap)?.to, 600) }))
    .filter((s) => s.from && s.to)
    .slice(0, 20);
}

/** Whatever arrived (config JSON, a planner's guess) → a safe H3Changes. A string is parsed as text. */
export function cleanChanges(v: unknown): H3Changes {
  if (typeof v === "string") return parseChangeText(v);
  const r = (v ?? {}) as Record<string, unknown>;
  return {
    characters: cleanSwaps(r.characters),
    outfits: cleanSwaps(r.outfits),
    locations: cleanSwaps(r.locations),
    style: clip(r.style, 600),
    extra: clip(r.extra, 1500),
  };
}

export function hasChanges(c: H3Changes): boolean {
  return Boolean(c.characters.length || c.outfits.length || c.locations.length || c.style || c.extra);
}

const ARROW = /\s*(?:->|=>|→|⇒)\s*/;
const VERB_SWAP = /^(?:replace|swap|change|turn|make)\s+(.+?)\s+(?:with|for|to|into)\s+(.+)$/i;
const BECOMES = /^(.+?)\s+(?:becomes|is now|should be)\s+(.+)$/i;
const OUTFIT_WORDS = /\b(outfit|outfits|wear|wears|wearing|dress|suit|jacket|shirt|clothes|clothing|costume|uniform|hoodie|coat|jeans|skirt)\b/i;
const PLACE_WORDS = /\b(location|place|set|setting|room|kitchen|street|beach|city|forest|office|bar|park|house|studio|desert|rooftop|stage|garden|alley|cafe|café|restaurant|warehouse|bedroom|living room|car park|parking lot)\b/i;

function splitSwap(text: string): Swap | null {
  const t = text.trim();
  const arrow = t.split(ARROW);
  if (arrow.length === 2 && arrow[0] && arrow[1]) return { from: arrow[0].trim(), to: arrow[1].trim() };
  const verb = VERB_SWAP.exec(t);
  if (verb) return { from: verb[1].trim(), to: verb[2].trim() };
  const becomes = BECOMES.exec(t);
  if (becomes) return { from: becomes[1].trim(), to: becomes[2].trim() };
  return null;
}

/**
 * Plain words → H3Changes. One instruction per line (or per ";"). Prefixes
 * `character:`, `outfit:`, `location:`, `style:` say what a line is; without
 * one, a swap is read as an outfit or a location when its words say so, and
 * as a character otherwise. Anything that is not a swap goes to `extra`.
 */
export function parseChangeText(text: string): H3Changes {
  const out: H3Changes = { characters: [], outfits: [], locations: [], style: "", extra: "" };
  const extra: string[] = [];
  const lines = String(text ?? "")
    .split(/\r?\n|;/)
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 40);
  for (const line of lines) {
    const pre = /^(characters?|people|person|cast|outfits?|wardrobe|clothes|locations?|places?|sets?|settings?|style|look|grade|extra|notes?)\s*:\s*(.+)$/i.exec(line);
    const kind = pre?.[1].toLowerCase() ?? "";
    const body = pre ? pre[2] : line;
    if (/^(style|look|grade)$/.test(kind)) {
      out.style = clip([out.style, body].filter(Boolean).join(", "), 600);
      continue;
    }
    if (/^(extra|notes?)$/.test(kind)) {
      extra.push(body);
      continue;
    }
    const styleOf = /^(?:in the style of|make it (?:look )?like|style it as)\s+(.+)$/i.exec(body);
    if (!pre && styleOf) {
      out.style = clip([out.style, styleOf[1]].filter(Boolean).join(", "), 600);
      continue;
    }
    const swap = splitSwap(body);
    if (!swap) {
      extra.push(body);
      continue;
    }
    const s = { from: clip(swap.from, 200), to: clip(swap.to, 600) };
    const ownerOf = /^(.+?)['’]s\s+(?:outfit|clothes|clothing|wardrobe|costume)$/i.exec(s.from) ?? /^(?:the\s+)?(?:outfit|clothes|wardrobe|costume)\s+of\s+(.+)$/i.exec(s.from);
    if (ownerOf) {
      out.outfits.push({ from: ownerOf[1].trim(), to: s.to });
      continue;
    }
    if (/^(outfits?|wardrobe|clothes)$/.test(kind)) out.outfits.push(s);
    else if (/^(locations?|places?|sets?|settings?)$/.test(kind)) out.locations.push(s);
    else if (/^(characters?|people|person|cast)$/.test(kind)) out.characters.push(s);
    else if (OUTFIT_WORDS.test(s.from) || (OUTFIT_WORDS.test(s.to) && !/\b(person|man|woman|boy|girl|guy|lady)\b/i.test(s.from))) out.outfits.push(s);
    else if (PLACE_WORDS.test(s.from)) out.locations.push(s);
    else out.characters.push(s);
  }
  out.extra = clip(extra.join(". "), 1500);
  return out;
}

// ----- matching ---------------------------------------------------------------------

const STOP = new Set(["the", "a", "an", "in", "on", "with", "and", "of", "to", "at", "his", "her", "their", "who", "is", "person", "character", "subject"]);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Does `from` name this labelled thing? Label first, then its description. */
export function matches(from: string, label: string, description: string): boolean {
  const f = from.trim().toLowerCase();
  if (!f) return false;
  if (/^(everyone|everybody|all|all people|\*)$/.test(f)) return true;
  const l = label.trim().toLowerCase();
  if (f === l || f === l.replace(/^person\s+/, "") || f.replace(/^the\s+/, "") === l) return true;
  const d = description.toLowerCase();
  if (d && d.includes(f)) return true;
  const fw = words(from);
  if (!fw.length) return false;
  const hay = new Set(words(`${label} ${description}`));
  const hit = fw.filter((w) => hay.has(w)).length;
  return hit / fw.length >= 0.6;
}

function replaceAll(text: string, from: string, to: string): string {
  if (!text || !from) return text;
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(esc, "gi"), to);
}

/**
 * A short display name for a new person or place, from the owner's words:
 * "Maya, a fisherwoman" → "Maya"; "a lighthouse kitchen at night" →
 * "lighthouse kitchen"; else the reference label.
 */
export function shortName(to: string, fallback: string): string {
  const t = to.trim().replace(/[.,;:]+$/, "");
  const first = t.split(/[,(]/)[0].trim();
  if (first && first.split(/\s+/).length <= 3 && /^[A-Z]/.test(first) && !/^(A|An|The)\b/.test(first)) return first;
  const phrase = first
    .replace(/^(a|an|the)\s+/i, "")
    .split(/\s+(?:with|in|at|on|wearing|who|that|from|by|under|near|during)\s+/i)[0]
    .trim();
  const n = phrase.split(/\s+/).filter(Boolean).length;
  return phrase && n <= 4 ? phrase : fallback;
}

// ----- applying -----------------------------------------------------------------------

export interface AppliedChanges {
  blueprint: Blueprint;
  characters: Character[];
  environments: Environment[];
  /** Reference label → new character id (recreate()'s castMap). */
  castMap: Record<string, string>;
  /** Reference place label → new environment id (recreate()'s envMap). */
  envMap: Record<string, string>;
  /** One line per change that landed, for the task log. */
  applied: string[];
  /** Changes that named nothing in the reference — said out loud, never dropped silently. */
  unmatched: string[];
}

/** Replace words everywhere the reference's prose can hold them. */
function swapText(b: Blueprint, s: Swap): Blueprint {
  const sw = (t: string) => replaceAll(t, s.from, s.to);
  return {
    ...b,
    characters: b.characters.map((c) => ({ ...c, description: sw(c.description) })),
    environments: b.environments.map((e) => ({ ...e, description: sw(e.description) })),
    shots: b.shots.map((x) => ({
      ...x,
      positions: sw(x.positions),
      actions: sw(x.actions),
      dialogue: sw(x.dialogue),
      environment: sw(x.environment),
      props: sw(x.props),
      lighting: sw(x.lighting),
    })),
  };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "x";
}

/**
 * Apply the owner's changes to a reference blueprint. Returns a NEW blueprint
 * (text swaps for free-text outfits / places, the new style) and the bible
 * entries + maps the H3 Lab's recreate() needs. Every reference person and
 * place gets an entry, changed or not, so every shot compiles with its cast.
 */
export function applyChanges(bp: Blueprint, changes: H3Changes, now: string): AppliedChanges {
  const applied: string[] = [];
  const unmatched: string[] = [];
  let b: Blueprint = JSON.parse(JSON.stringify(bp)) as Blueprint;

  if (changes.style) {
    b.style = changes.style;
    applied.push(`Style → ${changes.style}`);
  }

  // Outfits / places that name no person / set are plain text swaps in the prose.
  const textSwaps: Swap[] = [];
  for (const o of changes.outfits) {
    if (!b.characters.some((c) => matches(o.from, c.label, c.description)) && !/^(everyone|everybody|all|\*)$/i.test(o.from.trim())) textSwaps.push(o);
  }
  for (const l of changes.locations) {
    if (!b.environments.some((e) => matches(l.from, e.label, e.description))) textSwaps.push(l);
  }
  for (const s of textSwaps) {
    const before = JSON.stringify(b);
    b = swapText(b, s);
    const hit = JSON.stringify(b) !== before;
    if (hit) applied.push(`"${s.from}" → "${s.to}" (in the shot descriptions)`);
    else unmatched.push(`"${s.from}" was not found in the reference — nothing replaced.`);
  }

  // People: one bible entry per reference person.
  const characters: Character[] = [];
  const castMap: Record<string, string> = {};
  const usedChar = new Set<number>();
  b.characters.forEach((c, i) => {
    const swapIdx = changes.characters.findIndex((s) => matches(s.from, c.label, c.description));
    const swap = swapIdx >= 0 ? changes.characters[swapIdx] : null;
    if (swapIdx >= 0) usedChar.add(swapIdx);
    const outfit = changes.outfits.find((o) => matches(o.from, c.label, c.description));
    const id = `q-char-${i + 1}-${slug(c.label)}`;
    const name = swap ? shortName(swap.to, c.label) : c.label;
    characters.push({
      id,
      name,
      identity: swap ? swap.to : "",
      // A replaced person is written from the owner's words only — never the reference's look.
      face: swap ? swap.to : c.description,
      hair: "",
      wardrobe: outfit ? outfit.to : "",
      body: "",
      accessories: "",
      relationships: "",
      referenceImages: [],
      continuityRules: swap ? [`a new person, not the one in the reference`] : [],
      createdAt: now,
      updatedAt: now,
    });
    castMap[c.label] = id;
    if (swap) applied.push(`${c.label} → ${swap.to}`);
    if (outfit) applied.push(`${c.label}'s outfit → ${outfit.to}`);
  });
  // A "character" swap that names nobody is read as a word swap in the prose ("coffee pot -> teapot").
  changes.characters.forEach((s, i) => {
    if (usedChar.has(i)) return;
    const before = JSON.stringify(b.shots);
    b = swapText(b, s);
    if (JSON.stringify(b.shots) !== before) applied.push(`"${s.from}" → "${s.to}" (in the shot descriptions)`);
    else unmatched.push(`Nothing in the reference matches "${s.from}" — ${b.characters.length ? `the people are ${b.characters.map((c) => c.label).join(", ")}` : "no people were described"}.`);
  });

  // Places: one bible entry per reference place.
  const environments: Environment[] = [];
  const envMap: Record<string, string> = {};
  b.environments.forEach((e, i) => {
    const swap = changes.locations.find((s) => matches(s.from, e.label, e.description));
    const id = `q-env-${i + 1}-${slug(e.label)}`;
    environments.push({
      id,
      name: swap ? shortName(swap.to, e.label) : e.label,
      description: swap ? swap.to : e.description,
      architecture: "",
      furniture: "",
      doorsWindows: "",
      lighting: "",
      objects: "",
      cameraPerspectives: "",
      spatial: "",
      referenceImages: [],
      continuityRules: [],
      createdAt: now,
      updatedAt: now,
    });
    envMap[e.label] = id;
    if (swap) applied.push(`${e.label} → ${swap.to}`);
  });

  if (changes.extra) applied.push(`Extra direction: ${changes.extra}`);
  return { blueprint: b, characters, environments, castMap, envMap, applied, unmatched };
}

/** One line for a card: "2 people, 1 outfit, 1 place, new style". */
export function describeChanges(c: H3Changes): string {
  const bits = [
    c.characters.length ? `${c.characters.length} ${c.characters.length === 1 ? "person" : "people"}` : "",
    c.outfits.length ? `${c.outfits.length} outfit${c.outfits.length === 1 ? "" : "s"}` : "",
    c.locations.length ? `${c.locations.length} place${c.locations.length === 1 ? "" : "s"}` : "",
    c.style ? "new style" : "",
    c.extra ? "extra direction" : "",
  ].filter(Boolean);
  return bits.length ? bits.join(", ") : "no changes — a straight recreation";
}
