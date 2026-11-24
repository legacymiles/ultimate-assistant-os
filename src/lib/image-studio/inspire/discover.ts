// ---------------------------------------------------------------------------
// Finding things: gallery search and filters, Style Discovery (images that
// share visual DNA), Prompt Recommendations (what is missing from a set of
// chips), and the offline Prompt Translator (an idea in plain words → chips).
// All pure, all instant, no key needed.
// ---------------------------------------------------------------------------

import { CHIP_LIBRARY, searchLibrary } from "./chipLibrary";
import { extractChips } from "./extract";
import { DNA_GROUPS, groupOf, type ChipCategoryId, type DnaGroupId } from "./taxonomy";
import type { Chip, InspireImage } from "./types";
import { deliverableById } from "./deliverables";

// ----- gallery search ------------------------------------------------------

export interface GalleryQuery {
  q?: string;
  category?: string;
  style?: string;
  subject?: string;
  sort?: "newest" | "oldest";
}

function haystack(img: InspireImage): string {
  return [img.title, img.description, img.creator, img.prompt, img.style, img.subject, img.category, ...img.chips.map((c) => c.text)]
    .join(" \u0001 ")
    .toLowerCase();
}

/** Every word must appear somewhere: title, creator, prompt, chips, style. */
export function searchGallery(images: InspireImage[], query: GalleryQuery): InspireImage[] {
  const words = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const out = images.filter((img) => {
    if (query.category && query.category !== "all" && img.category !== query.category) return false;
    if (query.style && query.style !== "all" && img.style !== query.style) return false;
    if (query.subject && query.subject !== "all" && img.subject !== query.subject) return false;
    if (!words.length) return true;
    const h = haystack(img);
    return words.every((w) => h.includes(w.replace(/^@/, "")));
  });
  const dir = query.sort === "oldest" ? 1 : -1;
  return out.sort((a, b) => dir * a.createdAt.localeCompare(b.createdAt));
}

// ----- style discovery -----------------------------------------------------

export type Facet = "all" | "style" | "lighting" | "composition" | "texture" | "color" | "mood";

const FACET_GROUPS: Record<Exclude<Facet, "all">, DnaGroupId[]> = {
  style: ["style"],
  lighting: ["lighting"],
  composition: ["composition", "camera"],
  texture: ["texture", "effects"],
  color: ["color"],
  mood: ["mood", "environment"],
};

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
}

/** Overlap between two chip sets, word-level so "rim light" ~ "soft rim lighting". */
function chipScore(a: Chip[], b: Chip[]): number {
  let score = 0;
  for (const x of a) {
    const wx = words(x.text);
    for (const y of b) {
      if (x.text.toLowerCase() === y.text.toLowerCase()) {
        score += 3;
        continue;
      }
      if (groupOf(x.category).id !== groupOf(y.category).id) continue;
      const wy = words(y.text);
      let shared = 0;
      for (const w of wx) if (wy.has(w)) shared++;
      if (shared) score += shared / Math.max(wx.size, wy.size);
    }
  }
  return score;
}

/** Images that share visual DNA with `img`, optionally on one facet only. */
export function relatedImages(img: InspireImage, pool: InspireImage[], facet: Facet = "all", limit = 8): InspireImage[] {
  const pick = (chips: Chip[]) =>
    facet === "all" ? chips : chips.filter((c) => FACET_GROUPS[facet].includes(groupOf(c.category).id));
  const mine = pick(img.chips);
  return pool
    .filter((o) => o.id !== img.id)
    .map((o) => {
      let s = chipScore(mine, pick(o.chips));
      if (facet === "all" || facet === "style") s += o.style === img.style ? 2 : 0;
      if (facet === "all") s += o.category === img.category ? 1 : 0;
      return { o, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.o);
}

// ----- recommendations -----------------------------------------------------

export interface Recommendation extends Chip {
  reason: string;
}

/** Groups a strong image prompt almost always covers, in the order they matter. */
const CORE: DnaGroupId[] = ["subject", "style", "lighting", "composition", "camera", "color", "mood", "texture", "environment", "effects"];

/**
 * What to add next. Two signals: groups the chips do not cover yet (a prompt
 * with no lighting nearly always benefits from some), and what tends to sit
 * next to these chips in images people shared (co-occurrence in the gallery).
 */
export function recommend(chips: Chip[], gallery: InspireImage[], deliverable?: string, limit = 8): Recommendation[] {
  const have = new Set(chips.map((c) => c.text.toLowerCase()));
  const covered = new Set(chips.map((c) => groupOf(c.category).id));
  const out: Recommendation[] = [];
  const add = (c: Chip, reason: string) => {
    const k = c.text.toLowerCase();
    if (have.has(k) || out.some((o) => o.text.toLowerCase() === k)) return;
    out.push({ ...c, reason });
  };

  // 1) Starters for the deliverable.
  if (deliverable) {
    for (const s of deliverableById(deliverable).starters) {
      const lib = CHIP_LIBRARY.find((c) => c.text === s);
      if (lib) add(lib, `Works well for ${deliverableById(deliverable).label.toLowerCase()}s.`);
    }
  }

  // 2) Co-occurrence in shared images.
  const counts = new Map<string, { chip: Chip; n: number }>();
  const mineWords = chips.map((c) => words(c.text));
  for (const img of gallery) {
    const hit = img.chips.some((c) => {
      const w = words(c.text);
      return mineWords.some((m) => [...m].some((x) => w.has(x)));
    });
    if (!hit) continue;
    for (const c of img.chips) {
      const k = c.text.toLowerCase();
      const cur = counts.get(k) ?? { chip: c, n: 0 };
      cur.n++;
      counts.set(k, cur);
    }
  }
  [...counts.values()]
    .filter((x) => !covered.has(groupOf(x.chip.category).id) || x.n > 1)
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .forEach((x) => add(x.chip, "Shows up alongside your ingredients in shared images."));

  // 3) Fill the biggest missing groups from the library.
  for (const g of CORE) {
    if (covered.has(g) || g === "subject") continue;
    const seedText = chips.map((c) => c.text).join(" ");
    const pool = CHIP_LIBRARY.filter((c) => groupOf(c.category).id === g);
    const ranked = seedText ? searchLibrary(seedText).filter((c) => groupOf(c.category).id === g) : [];
    const pickOne = ranked[0] ?? pool[0];
    if (pickOne) add(pickOne, `Your prompt has no ${DNA_GROUPS.find((d) => d.id === g)!.label.toLowerCase()} yet.`);
  }
  return out.slice(0, limit);
}

// ----- translator ----------------------------------------------------------

const IDEA_HINTS: [RegExp, string[]][] = [
  [/\bscary|horror|creepy|spooky\b/i, ["ominous", "dramatic shadows", "volumetric fog"]],
  [/\bcute|kawaii|adorable\b/i, ["whimsical", "pastel colors", "claymorphism 3D render"]],
  [/\bfuture|futuristic|sci-?fi|space\b/i, ["cinematic lighting", "octane render", "atmospheric haze"]],
  [/\bvintage|retro|old school|80s|70s|90s\b/i, ["halftone texture", "burnt orange and teal", "film grain"]],
  [/\bluxury|premium|elegant|expensive\b/i, ["luxurious", "deep emerald and gold", "soft studio lighting"]],
  [/\bstreet|urban|hip.?hop|skate\b/i, ["energetic", "graffiti wildstyle", "high contrast"]],
  [/\bcalm|peaceful|relax|zen\b/i, ["serene", "negative space", "cool blue palette"]],
  [/\bshirt|tee|merch|apparel\b/i, ["centered composition", "isolated subject", "screen print style"]],
  [/\blogo|brand|mark|icon\b/i, ["flat vector", "centered composition", "negative space"]],
  [/\bphoto|realistic|real\b/i, ["50mm lens", "shallow depth of field", "soft window light"]],
  [/\bnight|neon|city\b/i, ["neon glow", "rainy city night", "bokeh"]],
  [/\bfantasy|magic|dragon|wizard\b/i, ["concept art", "god rays", "epic"]],
];

/** An idea in plain words → categorised building blocks. */
export function translateIdea(idea: string): Chip[] {
  const base = extractChips(idea, 10);
  const out: Chip[] = [...base];
  const seen = new Set(out.map((c) => c.text.toLowerCase()));
  for (const [re, hints] of IDEA_HINTS) {
    if (!re.test(idea)) continue;
    for (const h of hints) {
      const lib = CHIP_LIBRARY.find((c) => c.text === h);
      if (lib && !seen.has(h)) {
        seen.add(h);
        out.push({ text: lib.text, category: lib.category, why: lib.why });
      }
    }
  }
  return out.slice(0, 14);
}

/** Chips grouped by DNA group, in display order, skipping empty groups. */
export function groupChips(chips: Chip[]): { group: (typeof DNA_GROUPS)[number]; chips: Chip[] }[] {
  return DNA_GROUPS.map((group) => ({ group, chips: chips.filter((c) => groupOf(c.category).id === group.id) })).filter(
    (g) => g.chips.length,
  );
}

/** Proportions for the DNA ribbon: share of chips per group, in group order. */
export function dnaRibbon(chips: Chip[]): { hue: number; share: number; id: DnaGroupId }[] {
  if (!chips.length) return [];
  const n = chips.length;
  return DNA_GROUPS.map((g) => ({ id: g.id, hue: g.hue, share: chips.filter((c) => groupOf(c.category).id === g.id).length / n })).filter(
    (s) => s.share > 0,
  );
}

export type { ChipCategoryId };
