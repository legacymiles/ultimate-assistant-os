// ---------------------------------------------------------------------------
// Prompt DNA without a model: split a prompt into the visual ingredients that
// actually change the picture, and say what kind each one is.
//
// The AI route (server/ai.ts) does this better when a key is set; this is what
// runs without one, what fills in the starter set, and what the AI answer is
// checked against. It is deliberately conservative: a fragment it cannot
// place is kept as a Subject (the thing the picture is about) rather than
// dropped, and lone filler words ("a", "very", "beautiful") never become chips.
// ---------------------------------------------------------------------------

import { CHIP_LIBRARY, libraryChip } from "./chipLibrary";
import { groupOf, type ChipCategoryId } from "./taxonomy";
import type { Chip } from "./types";

/** Words that, alone, are not an ingredient. */
const FILLER = new Set([
  "a", "an", "the", "of", "and", "with", "in", "on", "at", "by", "for", "to", "very", "highly", "extremely",
  "beautiful", "amazing", "stunning", "masterpiece", "best quality", "high quality", "trending", "award winning",
  "artstation", "4k", "8k", "hd", "hdr", "detailed", "image", "picture", "photo", "palette", "colors", "colours",
  "style", "aesthetic", "its", "her", "his", "their",
]);

/** Leading adjectives that are an ingredient of their own (FUTURISTIC + CYBERPUNK WARRIOR). */
const LEAD_ADJECTIVES: Record<string, ChipCategoryId> = {
  futuristic: "style",
  vintage: "style",
  retro: "style",
  ancient: "mood",
  minimalist: "style",
  whimsical: "mood",
  expressive: "style",
  classical: "style",
  luxury: "mood",
  lonely: "mood",
  candid: "camera",
  surreal: "style",
  cozy: "mood",
  epic: "mood",
  gothic: "style",
  steampunk: "style",
  anime: "style",
  translucent: "texture",
  "moss-covered": "texture",
  sleek: "style",
  geometric: "style",
};

const DECADE = /^(19|20)\d0s$/i;

/** Places where a clause turns from subject to setting. */
const SPLITTERS = [
  " standing in ", " standing on ", " sitting in ", " sitting at ", " walking through ", " walking in ",
  " floating in ", " floating among ", " leaping over ", " driving through ", " kneeling in ", " hanging on ",
  " surrounded by ", " covered in ", " made of ", " wearing ", " holding ", " seen through ",
  " in a ", " in an ", " in the ", " on a ", " on an ", " on the ", " under a ", " under the ",
  " through ", " among ", " against a ", " against the ", " with ", " of a ", " of an ", " speeding between ",
  " drifting through ", " lighting a ", " inside a ", " carved into ", " floating above ", " in ",
];

/** Keyword → category, tried in order; first hit wins. */
const RULES: [RegExp, ChipCategoryId][] = [
  [/\bbackground\b|\bbackdrop\b/i, "environment"],
  [/\b\d{2,3}\s?mm\b|\blens\b|\bangle\b|\bshot\b|\bview\b|\bdepth of field\b|\bmacro\b|\bclose-?up\b|\bf\/\d|\bfisheye\b|\bdrone\b|\bpov\b|\bperspective\b|\bflat lay\b|\btilt-?shift\b|\bkodak\b|\bportra\b|\bfujifilm\b|\bpolaroid\b|\bfilm stock\b|\bcandid\b/i, "camera"],
  [/\bfog\b|\bmist\b|\bsmoke\b|\bhaze\b|\bparticles?\b|\bsparks?\b|\bembers?\b|\bsplash|\bsteam\b|\bglitch\b|\blens flare\b|\blightning\b|\bsplatter\b|\bdrips?\b|\bdripping\b|\bmotion blur\b|\breflections?\b|\bbokeh\b(?!.*light)|\brain\b|\bstorm\b|\bdust\b|\bsnow(fall|ing)\b|\bholographic\b/i, "effects"],
  [/\blight(ing|s)?\b|\bshadows?\b|\bglow(ing|s)?\b|\bsunlight\b|\bdaylight\b|\bsunset\b|\bsunrise\b|\bgolden hour\b|\billuminat|\brays?\b|\brim\b|\bbacklit\b|\bspotlight\b|\bchiaroscuro\b|\bluminescen|\bneon\b(?=.*\b(light|glow|sign)\b)/i, "lighting"],
  [/\bpalette\b|\bcolou?rs?\b|\btones?\b|\bmonochrome\b|\bpastel\b|\bblack and white\b|\bgradient\b|\b(two|three|single)-?colou?r\b|\b(red|blue|green|greens|pink|cyan|teal|orange|purple|magenta|amber|gold|golden|navy|cream|ochre|indigo|emerald|vermilion|lime|crimson|beige|silver|black|white|violet|sage) (and|to|on) (red|blue|green|pink|cyan|teal|orange|purple|magenta|amber|gold|navy|cream|ochre|indigo|emerald|white|black|lime|silver|violet|rose)\b|\bink only\b|\bgrad(ed|ing)\b/i, "color"],
  [/\btypograph|\blettering\b|\bletters\b|\bfont\b|\bserif\b|\bsans\b|\bscript\b|\bheadline\b|\bwordmark\b|\bspelling\b|\breading\b|\bthe word\b/i, "typography"],
  [/\bmars\b|\bstreet\b|\bcity\b|\bforest\b|\bdesert\b|\bdunes?\b|\bocean\b|\btrench\b|\bsea\b|\blake\b|\bmountains?\b|\bpeaks?\b|\bridges\b|\broom\b|\bbedroom\b|\bhangar\b|\bdiner\b|\bcafe\b|\btemple\b|\bruins\b|\bjungle\b|\bplanets?\b|\bgarden\b|\bbeach\b|\balley\b|\btokyo\b|\bnew york\b|\bwaterfalls?\b|\bcanopy\b|\bgrass\b|\bskyscrapers?\b|\bstump\b/i, "scene"],
  [/\brender(ing|ed)?\b|\bstyle\b|\bpainting\b|\billustration\b|\bvector\b|\bconcept art\b|\banime\b|\bcel\b|\bwatercolou?r\b|\bgouache\b|\boil\b|\bsketch\b|\bline ?art\b|\blinework\b|\boutlines\b|\bbrush ?strokes\b|\bwash\b|\bpixel art\b|\bphotography\b|\bphotograph\b|\bphotorealistic\b|\bportrait\b|\baesthetic\b|\bprint\b|\b3d\b|\bclaymation\b|\bclaymorphism\b|\bunreal engine\b|\boctane\b|\bcinema ?4d\b|\bmatte painting\b|\bart nouveau\b|\bart deco\b|\bukiyo-?e\b|\bgraphic\b|\blogo\b|\bemblem\b|\bbadge\b|\bmockup\b|\bposter\b|\bcinematic\b|\bfantasy\b|\bminimalism\b|\bnoir\b|\bgeometric\b|\b(19|20)\d0s\b|\b[5-9]0s\b/i, "style"],
  [/\btexture\b|\bgrain\b|\bdetail(s|ed)?\b|\bsharp\b|\bscattering\b|\bsurface\b|\bpaper\b|\bfabric\b|\bmatte\b|\bglossy\b|\bmetallic\b|\bintricate\b|\bhalftone\b|\bdistressed\b|\btranslucent\b|\biridescent\b|\bcovered\b|\bedges\b|\bshading\b/i, "texture"],
  [/\bcompos(ition|ed)\b|\bcentered\b|\bcentred\b|\bsymmetr|\bnegative space\b|\brule of thirds\b|\bisolated\b|\bfull body\b|\bframing\b|\blayout\b|\bcutaway\b|\bleading lines\b|\bminimal\b|\bfor scale\b|\barranged\b/i, "composition"],
  [/\bstudio\b|\bfloor\b|\bwall\b|\bcounter\b|\bsky\b|\bhorizon\b|\bspace\b|\bstars?\b|\bconcrete\b|\bpedestal\b/i, "environment"],
  [/\bjacket\b|\bhoodie\b|\bcoat\b|\bdress\b|\bgown\b|\bsuit\b|\barmou?r\b|\bkimono\b|\bpants\b|\bshirt\b|\boutfit\b|\buniform\b|\bcape\b|\brobes?\b|\bvest\b/i, "wardrobe"],
  [/\bsunglasses\b|\bumbrella\b|\bhelmet\b|\bkatana\b|\bsword\b|\bheadphones\b(?=.*wear)|\bchain\b|\bnecklace\b|\bvisor\b|\bbackpack\b|\bhat\b|\bcap\b|\bgloves?\b|\btattoos?\b|\bpatches\b|\bcigarette\b/i, "accessories"],
  [/\bstanding\b|\bsitting\b|\bkneeling\b|\bleaping\b|\bjumping\b|\bwalking\b|\brunning\b|\bfloating\b|\blooking\b|\bpose\b|\bposing\b|\bholding\b|\bcrossed\b|\bdancing\b|\bflying\b|\bdrifting\b|\bspeeding\b/i, "pose"],
  [/\bmood(y)?\b|\batmospher(e|ic)\b|\bdreamy\b|\bcozy\b|\bserene\b|\bmelanchol|\bominous\b|\bmysterious\b|\bepic\b|\bwhimsical\b|\bnostalgic\b|\bpeaceful\b|\beerie\b|\bdramatic\b|\bcalm\b|\bjoyful\b|\bgloomy\b|\blonely\b|\bcrisp\b.*\bair\b|\belegant\b|\bluxur/i, "mood"],
];

/** Default hover line for a chip the library does not know, by category. */
const WHY: Record<ChipCategoryId, (t: string) => string> = {
  character: (t) => `Defines who the picture is about: ${t}.`,
  subject: (t) => `The main subject — everything else in the prompt dresses "${t}".`,
  wardrobe: (t) => `Dresses the subject; shapes silhouette, fabric and era.`,
  accessories: (t) => `A prop or accessory that adds story and a focal detail.`,
  pose: (t) => `Sets the body language and action of the subject.`,
  scene: (t) => `Places the subject somewhere specific, which drives light and colour.`,
  environment: (t) => `Sets the background the subject sits against.`,
  camera: (t) => `Controls how the shot is framed and how much falls in focus.`,
  lighting: (t) => `Shapes where light falls and how hard the shadows are.`,
  style: (t) => `Sets the rendering technique and overall look.`,
  composition: (t) => `Arranges elements inside the frame.`,
  color: (t) => `Steers the dominant colours of the image.`,
  texture: (t) => `Adds surface quality and finish to what is rendered.`,
  effects: (t) => `Adds an atmospheric or optical effect on top of the scene.`,
  typography: (t) => `Sets how any lettering in the image is drawn.`,
  mood: (t) => `Sets the emotional tone of the picture.`,
};

const TEXTURE_NOUN = /\b(texture|textures|grain|details?|scattering|surface|paper|fabric|shading|edges|focus|finish)\b/i;

export function classify(fragment: string): ChipCategoryId | null {
  for (const [re, cat] of RULES) {
    if (!re.test(fragment)) continue;
    // "matte white wireless headphones" is a subject described by its
    // material, not a texture ingredient.
    if (cat === "texture" && fragment.split(" ").length >= 3 && !TEXTURE_NOUN.test(fragment)) return "subject";
    return cat;
  }
  return null;
}

function clean(s: string): string {
  return s
    .replace(/^[\s,.;:"'()\-–—]+|[\s,.;:"'()\-–—]+$/g, "")
    .replace(/^(a|an|the|and|with|of|in|on|from|its|her|his|their)\s+/i, "")
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/(\s+(of|on|a|an|the|for|with|to|in|at|from|and))+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isFiller(s: string): boolean {
  const l = s.toLowerCase();
  if (l.length < 3) return true;
  if (FILLER.has(l)) return true;
  return l.split(" ").every((w) => FILLER.has(w));
}

/** Split one comma-clause wherever it turns from one ingredient to the next. */
function splitClause(clause: string): string[] {
  const lower = ` ${clause.toLowerCase()} `;
  let best: { at: number; sp: string } | null = null;
  for (const sp of SPLITTERS) {
    const i = lower.indexOf(sp);
    if (i > 1 && (!best || i < best.at)) best = { at: i, sp };
  }
  if (!best) return [clause];
  const head = clause.slice(0, best.at - 1);
  const tail = clause.slice(best.at - 1 + best.sp.length);
  if (!clean(head) || !clean(tail)) return [clause];
  const verb = best.sp.trim().split(" ")[0];
  const pose = /^(standing|sitting|walking|floating|leaping|kneeling|driving|hanging)$/.test(verb) ? [verb] : [];
  return [...splitClause(head), ...pose, ...splitClause(tail)];
}

/** Peel library phrases out of a fragment, longest first. */
function peelLibrary(fragment: string): { found: Chip[]; rest: string[] } {
  let rest = [fragment];
  const found: Chip[] = [];
  const lib = [...CHIP_LIBRARY].sort((a, b) => b.text.length - a.text.length);
  for (const c of lib) {
    // Only peel finishing ingredients (light, lens, style …). A subject phrase
    // stays whole so "japanese koi fish" is not cut down to "koi fish".
    if (groupOf(c.category).id === "subject" || c.text.split(" ").length < 2) continue;
    const re = new RegExp(`(^|[^a-z])${c.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
    const next: string[] = [];
    for (const r of rest) {
      const m = re.exec(r);
      if (m && c.text.split(" ").length >= 2) {
        found.push({ text: r.substr(m.index + m[1].length, c.text.length), category: c.category, why: c.why });
        next.push(r.slice(0, m.index + m[1].length), r.slice(m.index + m[1].length + c.text.length));
      } else next.push(r);
    }
    rest = next;
  }
  return { found, rest: rest.map(clean).filter((r) => r && !isFiller(r)) };
}

export function upperChip(text: string): string {
  return text.toUpperCase();
}

/**
 * Pull categorised ingredients from a prompt. Order follows the prompt, so the
 * chips read left-to-right like the sentence they came from.
 */
export function extractChips(prompt: string, max = 16): Chip[] {
  const text = prompt.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const clauses = text.split(/[,;\n]|\.(?=\s|$)|\s\|\s/).map((c) => c.trim()).filter(Boolean);
  const out: { chip: Chip; at: number }[] = [];
  const seen = new Set<string>();
  const lowerPrompt = text.toLowerCase();

  const push = (raw: string, category: ChipCategoryId, why?: string) => {
    const t = clean(raw);
    if (!t || isFiller(t)) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const lib = libraryChip(t);
    out.push({
      chip: { text: t, category: lib?.category ?? category, why: why ?? lib?.why ?? WHY[category](t) },
      at: Math.max(0, lowerPrompt.indexOf(key)),
    });
  };

  clauses.forEach((clause, ci) => {
    splitClause(clause).forEach((piece, pi) => {
      const p = clean(piece);
      if (!p || isFiller(p)) return;
      const { found, rest } = peelLibrary(p);
      for (const f of found) push(f.text, f.category, f.why);
      for (let r of rest) {
        // A leading adjective that is its own ingredient.
        const words = r.split(" ");
        const first = words[0].toLowerCase();
        const lead = LEAD_ADJECTIVES[first] ?? (DECADE.test(first) ? "style" : undefined);
        if (lead && words.length === 1) {
          push(r, lead);
          continue;
        }
        // Split it off only when what is left still names something
        // ("futuristic | cyberpunk warrior", but "retro sunglasses" stays).
        let ws = words;
        while (ws.length > 2) {
          const l = LEAD_ADJECTIVES[ws[0].toLowerCase()] ?? (DECADE.test(ws[0]) ? "style" : undefined);
          if (!l) break;
          push(ws[0], l);
          ws = ws.slice(1);
        }
        r = ws.join(" ");
        if (/^(standing|sitting|walking|floating|leaping|kneeling|driving|hanging)$/i.test(r)) {
          push(r, "pose");
          continue;
        }
        const cat = classify(r);
        // An unplaced lone word ("soft", "clean", "back") is filler — unless it
        // opens the prompt, where it is usually the subject itself ("tiger").
        if (!cat && !r.includes(" ") && ci !== 0) continue;
        push(r, cat ?? "subject");
      }
    });
  });

  return out
    .sort((a, b) => a.at - b.at)
    .map((o) => o.chip)
    .filter((c) => c.text.split(" ").length <= 7)
    .slice(0, max);
}

export interface Span {
  text: string;
  chip?: Chip;
}

/** The original prompt, cut into plain runs and runs that belong to a chip. */
export function highlightSpans(prompt: string, chips: Chip[]): Span[] {
  const lower = prompt.toLowerCase();
  const marks: { start: number; end: number; chip: Chip }[] = [];
  for (const chip of [...chips].sort((a, b) => b.text.length - a.text.length)) {
    const needle = chip.text.toLowerCase();
    let from = 0;
    while (from <= lower.length) {
      const i = lower.indexOf(needle, from);
      if (i < 0) break;
      const end = i + needle.length;
      if (!marks.some((m) => i < m.end && end > m.start)) {
        marks.push({ start: i, end, chip });
        break;
      }
      from = i + 1;
    }
  }
  marks.sort((a, b) => a.start - b.start);
  const spans: Span[] = [];
  let at = 0;
  for (const m of marks) {
    if (m.start > at) spans.push({ text: prompt.slice(at, m.start) });
    spans.push({ text: prompt.slice(m.start, m.end), chip: m.chip });
    at = m.end;
  }
  if (at < prompt.length) spans.push({ text: prompt.slice(at) });
  return spans;
}

/** Validate chips that came from a browser or a model. */
export function sanitizeChips(raw: unknown, max = 24): Chip[] {
  if (!Array.isArray(raw)) return [];
  const out: Chip[] = [];
  const seen = new Set<string>();
  for (const r of raw as Record<string, unknown>[]) {
    const text = typeof r?.text === "string" ? r.text.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    if (!text || seen.has(text.toLowerCase())) continue;
    const category = typeof r.category === "string" && ALL.has(r.category) ? (r.category as ChipCategoryId) : classify(text) ?? "subject";
    const why = typeof r.why === "string" ? r.why.trim().slice(0, 200) : undefined;
    seen.add(text.toLowerCase());
    out.push({ text, category, ...(why ? { why } : {}) });
    if (out.length >= max) break;
  }
  return out;
}

const ALL = new Set<string>([
  "character", "subject", "wardrobe", "accessories", "pose", "scene", "environment", "camera",
  "lighting", "style", "composition", "color", "texture", "effects", "typography", "mood",
]);
