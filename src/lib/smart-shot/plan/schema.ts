// ---------------------------------------------------------------------------
// The plan as JSON: what the planner is asked to return, and how a messy
// answer is turned into a valid Plan. Pure, shared by the route and the tests.
//
// The normaliser is forgiving on purpose: a model answer with a missing
// palette, a cut with no character, a lens written as "40mm" — all of it is
// coerced rather than rejected, because a slightly wrong sheet the user can
// edit beats a failed request.
// ---------------------------------------------------------------------------

import { APERTURES, FRAMINGS, MOVES, clampCutCount, clampTotal, perCutSeconds } from "../constants";
import type { Brief, CameraMove, Framing, Plan, PlanCharacter, PlanCut, PlanEnvironment, PlanProduct, Upload } from "../types";

export const PLAN_JSON_SHAPE = `{
  "title": "short film or brand title",
  "paletteNote": "warm amber sunlight + cobalt blue sky + deep ocean blue + soft cloud white + cool shadow charcoal",
  "palette": ["#c89a5a", "#3b7dd8", "#12345a", "#f2f0ea", "#2b2f36", "#4a5d3a"],
  "lightingNote": "WARM AMBER SPOTLIGHT",
  "lensNote": "ANAMORPHIC PRIME",
  "environmentFingerprint": "one sentence that fingerprints the whole physical world of the film",
  "characters": [
    {
      "name": "GIRL",
      "uploadId": "id of the character upload this is built from, or null",
      "look": "age, build, face, hair, skin — everything every frame must keep",
      "wardrobe": "exact clothing, colours, accessories",
      "palette": ["#hex", "#hex", "#hex", "#hex"]
    }
  ],
  "products": [
    {
      "name": "NOIRÉ DARK CHOCOLATE BAR",
      "uploadId": "id of the product upload this is built from, or null",
      "description": "shape, size, materials, wrapper, markings — everything every frame must keep",
      "notes": [{ "label": "TEXTURE", "text": "…" }, { "label": "FINISH", "text": "…" }, { "label": "WRAPPED ELEMENT", "text": "…" }],
      "palette": ["#hex", "#hex", "#hex", "#hex"]
    }
  ],
  "environments": [
    {
      "name": "COASTAL ROAD — MAIN LOCATION",
      "uploadId": "id of the location upload, or null",
      "description": "architecture, ground, vegetation, weather, key props, scale",
      "timeOfDay": "late afternoon"
    }
  ],
  "setNotes": "set-design notes: surfaces, background, light pools, dressing",
  "props": "the props on set, comma separated",
  "cuts": [
    {
      "title": "Cut 1",
      "lensMm": 50,
      "aperture": "f/2",
      "durationSec": 4,
      "move": "dolly-in",
      "framing": "wide",
      "description": "what the audience sees, as a storyboard caption: framing, who/what, where, what happens, light",
      "action": "what the subject physically does across the cut, in order",
      "dialogue": "",
      "characterNames": ["GIRL"],
      "productNames": [],
      "environmentName": "COASTAL ROAD — MAIN LOCATION",
      "position": "camera on the inland shoulder at the first bend, subject moving left to right"
    }
  ],
  "lighting": [{ "caption": "warm amber key with deep negative fill" }],
  "moods": ["indulgent", "premium", "tactile"],
  "styleEssence": "one sentence: the essence of the look",
  "cinematography": "3–5 short notes on format, lenses, movement, depth of field, contrast — one per line",
  "soundscape": "the ambient sound world in one or two sentences, no music",
  "music": "instrumentation, tempo, dynamics of the score, or 'none'"
}`;

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v.trim() : fallback);
const strs = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, max) : [];
const num = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
};

const HEX = /^#?([0-9a-f]{6})$/i;
function hexes(v: unknown, fallback: string[]): string[] {
  const out = strs(v, 8)
    .map((s) => s.match(HEX)?.[1])
    .filter((s): s is string => Boolean(s))
    .map((s) => `#${s.toLowerCase()}`);
  return out.length >= 3 ? out : fallback;
}

const DEFAULT_PALETTE = ["#c89a5a", "#3b7dd8", "#12345a", "#f2f0ea", "#2b2f36", "#4a5d3a"];

function move(v: unknown): CameraMove {
  const s = str(v).toLowerCase().replace(/\s+/g, "-").replace(/_/g, "-");
  const hit = MOVES.find((m) => m === s);
  if (hit) return hit;
  if (/rack/.test(s)) return "rack-focus";
  if (/dolly-in/.test(s)) return "dolly-in";
  if (/push|zoom-in/.test(s)) return "push-in";
  if (/pull|zoom-out/.test(s)) return "pull-out";
  if (/track|follow|dolly/.test(s)) return "track";
  if (/pan/.test(s)) return "pan";
  if (/tilt/.test(s)) return "tilt";
  if (/crane|rise|boom/.test(s)) return "crane-up";
  if (/arc/.test(s)) return "arc";
  if (/orbit/.test(s)) return "orbit";
  if (/hand/.test(s)) return "handheld";
  return "static";
}

function framing(v: unknown): Framing {
  const s = str(v).toLowerCase().replace(/[-_]/g, " ");
  const hit = FRAMINGS.find((f) => f === s);
  if (hit) return hit;
  if (/extreme wide|establishing/.test(s)) return "extreme wide";
  if (/two/.test(s)) return "two-shot";
  if (/macro/.test(s)) return "macro";
  if (/extreme close|ecu/.test(s)) return "extreme close-up";
  if (/close|cu\b|portrait/.test(s)) return "close-up";
  if (/insert|detail/.test(s)) return "insert";
  if (/wide|full/.test(s)) return "wide";
  return "medium";
}

function aperture(v: unknown): string {
  const s = str(v).replace(/^t/i, "f/").replace(/^f(?!\/)/i, "f/").replace(/\s+/g, "");
  if (/^f\/\d+(\.\d+)?$/i.test(s)) return s.toLowerCase();
  return APERTURES[1];
}

export interface NormaliseInput {
  brief: Brief;
  uploads: Upload[];
  /** A stable id generator so tests can be deterministic. */
  id: (prefix: string) => string;
}

/**
 * Turn whatever the planner answered into a Plan the sheet can draw.
 *
 * Character, product and environment names are the join keys the model was
 * asked to use on cuts, matched case-insensitively. A cut that names nobody
 * falls back to the first character (or product); one that names no
 * environment to the first.
 */
export function normalisePlan(raw: Record<string, unknown>, input: NormaliseInput): Plan {
  const { brief, uploads, id } = input;
  const uploadIds = new Set(uploads.map((u) => u.id));
  const uploadByName = new Map(uploads.map((u) => [u.name.trim().toLowerCase(), u.id]));
  const validUpload = (v: unknown, name: string, role: Upload["role"]) => {
    let uploadId = str(v) || null;
    if (uploadId && !uploadIds.has(uploadId)) uploadId = null;
    if (!uploadId) {
      const byName = uploadByName.get(name.toLowerCase());
      if (byName && uploads.find((u) => u.id === byName)?.role === role) uploadId = byName;
    }
    return uploadId;
  };

  const characters: PlanCharacter[] = [];
  for (const c of (Array.isArray(raw.characters) ? raw.characters : []) as Record<string, unknown>[]) {
    const name = str(c?.name).toUpperCase().slice(0, 40);
    if (!name) continue;
    characters.push({
      id: id("chr"),
      name,
      look: str(c?.look),
      wardrobe: str(c?.wardrobe),
      palette: hexes(c?.palette, DEFAULT_PALETTE.slice(0, 5)),
      uploadId: validUpload(c?.uploadId, name, "character"),
    });
    if (characters.length === 6) break;
  }
  // Every character upload deserves a sheet, even if the model forgot one.
  for (const u of uploads) {
    if (u.role !== "character" || characters.some((c) => c.uploadId === u.id)) continue;
    characters.push({
      id: id("chr"),
      name: (u.name || `CHARACTER ${characters.length + 1}`).toUpperCase(),
      look: u.description,
      wardrobe: "",
      palette: DEFAULT_PALETTE.slice(0, 5),
      uploadId: u.id,
    });
  }

  const products: PlanProduct[] = [];
  for (const p of (Array.isArray(raw.products) ? raw.products : []) as Record<string, unknown>[]) {
    const name = str(p?.name).toUpperCase().slice(0, 60);
    if (!name) continue;
    const notes = ((Array.isArray(p?.notes) ? p.notes : []) as Record<string, unknown>[])
      .map((n) => ({ label: str(n?.label).toUpperCase().slice(0, 30), text: str(n?.text) }))
      .filter((n) => n.label && n.text)
      .slice(0, 6);
    products.push({
      id: id("prd"),
      name,
      description: str(p?.description),
      notes,
      palette: hexes(p?.palette, DEFAULT_PALETTE.slice(0, 5)),
      uploadId: validUpload(p?.uploadId, name, "object"),
    });
    if (products.length === 4) break;
  }
  for (const u of uploads) {
    if (u.role !== "object" || products.some((p) => p.uploadId === u.id)) continue;
    products.push({
      id: id("prd"),
      name: (u.name || `PRODUCT ${products.length + 1}`).toUpperCase(),
      description: u.description,
      notes: [],
      palette: DEFAULT_PALETTE.slice(0, 5),
      uploadId: u.id,
    });
  }

  const environments: PlanEnvironment[] = [];
  for (const e of (Array.isArray(raw.environments) ? raw.environments : []) as Record<string, unknown>[]) {
    const name = str(e?.name).toUpperCase().slice(0, 60);
    if (!name) continue;
    environments.push({
      id: id("env"),
      name,
      description: str(e?.description),
      timeOfDay: str(e?.timeOfDay),
      uploadId: validUpload(e?.uploadId, name, "location"),
    });
    if (environments.length === 4) break;
  }
  if (!environments.length) {
    const loc = uploads.find((u) => u.role === "location");
    environments.push({
      id: id("env"),
      name: (loc?.name || "MAIN LOCATION").toUpperCase(),
      description: loc?.description || brief.prompt,
      timeOfDay: "",
      uploadId: loc?.id ?? null,
    });
  }

  const charByName = new Map(characters.map((c) => [c.name.toLowerCase(), c.id]));
  const prodByName = new Map(products.map((p) => [p.name.toLowerCase(), p.id]));
  const envByName = new Map(environments.map((e) => [e.name.toLowerCase(), e.id]));
  const findEnv = (name: string) => {
    const key = name.toLowerCase();
    if (envByName.has(key)) return envByName.get(key)!;
    const partial = environments.find((e) => e.name.toLowerCase().includes(key) || key.includes(e.name.toLowerCase()));
    return partial?.id ?? environments[0].id;
  };
  const matchIds = <T extends { id: string; name: string }>(names: string[], list: T[], byName: Map<string, string>) =>
    [
      ...new Set(
        names
          .map((n) => byName.get(n.toLowerCase()) ?? list.find((x) => n.toLowerCase().includes(x.name.toLowerCase()))?.id)
          .filter((v): v is string => Boolean(v)),
      ),
    ];

  const want = clampCutCount(brief.cutCount);
  const total = clampTotal(brief.totalSec);
  const each = perCutSeconds(total, want);

  const cuts: PlanCut[] = [];
  for (const c of (Array.isArray(raw.cuts) ? raw.cuts : []) as Record<string, unknown>[]) {
    const characterIds = matchIds(strs(c?.characterNames ?? c?.characters, 6), characters, charByName);
    const productIds = matchIds(strs(c?.productNames ?? c?.products, 4), products, prodByName);
    const nobody = !characterIds.length && !productIds.length;
    cuts.push({
      id: id("cut"),
      title: `Cut ${cuts.length + 1}`,
      lensMm: Math.min(200, Math.max(14, Math.round(num(c?.lensMm ?? c?.lens, 40)))),
      aperture: aperture(c?.aperture ?? c?.tStop ?? c?.fStop),
      durationSec: Math.max(2, Math.min(15, Math.round(num(c?.durationSec ?? c?.duration, each)))),
      move: move(c?.move ?? c?.camera),
      framing: framing(c?.framing),
      description: str(c?.description),
      action: str(c?.action),
      dialogue: str(c?.dialogue),
      characterIds: nobody && characters[0] && !products.length ? [characters[0].id] : characterIds,
      productIds: nobody && products[0] ? [products[0].id] : productIds,
      environmentId: findEnv(str(c?.environmentName ?? c?.environment)),
      position: str(c?.position),
    });
    if (cuts.length === 8) break;
  }
  // Pad or trim to the requested count so the sheet always matches the brief.
  while (cuts.length < want) {
    const n = cuts.length + 1;
    cuts.push({
      id: id("cut"),
      title: `Cut ${n}`,
      lensMm: [50, 100, 75, 90, 35, 40, 85, 24][n - 1] ?? 50,
      aperture: n % 2 ? "f/2" : "f/2.8",
      durationSec: each,
      move: n === want ? "arc" : n === 1 ? "dolly-in" : n % 2 ? "push-in" : "track",
      framing: n === 1 ? "wide" : n === want ? "medium" : n % 2 ? "close-up" : "macro",
      description: `Beat ${n} of the story.`,
      action: "",
      dialogue: "",
      characterIds: characters[0] && !products.length ? [characters[0].id] : [],
      productIds: products[0] ? [products[0].id] : [],
      environmentId: environments[0].id,
      position: "",
    });
  }
  cuts.length = Math.min(cuts.length, want);
  // The cuts must add up to the film: rescale whatever the model chose.
  const sum = cuts.reduce((a, c) => a + c.durationSec, 0) || 1;
  let acc = 0;
  cuts.forEach((c, i) => {
    c.durationSec = i === cuts.length - 1 ? Math.max(2, total - acc) : Math.max(2, Math.round((c.durationSec / sum) * total));
    acc += c.durationSec;
  });

  const lighting = ((Array.isArray(raw.lighting) ? raw.lighting : []) as unknown[])
    .map((l) => (typeof l === "string" ? l : str((l as Record<string, unknown>)?.caption)))
    .filter(Boolean)
    .slice(0, 4)
    .map((caption) => ({ id: id("lit"), caption }));
  while (lighting.length < 4) {
    const fill = ["key light and shadow on the main subject", "backlight through edges and rims", "environment texture under the ambient light", "reflective surfaces catching the key"];
    lighting.push({ id: id("lit"), caption: fill[lighting.length] });
  }

  const cinematography = Array.isArray(raw.cinematography)
    ? strs(raw.cinematography, 6).join("\n")
    : str(raw.cinematography);

  return {
    title: str(raw.title) || titleFrom(brief.prompt),
    paletteNote: str(raw.paletteNote),
    palette: hexes(raw.palette, DEFAULT_PALETTE),
    lightingNote: str(raw.lightingNote).toUpperCase() || (lighting[0]?.caption ?? "").toUpperCase().slice(0, 40),
    lensNote: str(raw.lensNote).toUpperCase() || "ANAMORPHIC PRIME",
    environmentFingerprint: str(raw.environmentFingerprint),
    characters,
    products,
    environments,
    setNotes: str(raw.setNotes),
    props: str(raw.props),
    cuts,
    lighting,
    moods: strs(raw.moods, 8),
    styleEssence: str(raw.styleEssence),
    cinematography,
    soundscape: str(raw.soundscape),
    music: str(raw.music),
  };
}

export function titleFrom(prompt: string): string {
  const words = prompt
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  const t = words.join(" ");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Untitled";
}

/** Renumber cuts after a reorder, add or delete. */
export function renumber(cuts: PlanCut[]): PlanCut[] {
  return cuts.map((c, i) => ({ ...c, title: `Cut ${i + 1}` }));
}

/** Pull the first JSON object out of a model answer, fenced or not. */
export function readJson(content: string): Record<string, unknown> {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : content).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in response");
  return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
}
