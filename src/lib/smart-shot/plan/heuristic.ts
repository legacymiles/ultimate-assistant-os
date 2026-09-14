// ---------------------------------------------------------------------------
// The offline planner. With no LLM key the app still has to produce a full
// sheet, so this splits the brief into beats, names the cast and product
// from the uploads and picks a classic progression: establish, detail,
// rack-focus close-up, hero arc. Everything it writes is editable on the sheet.
// ---------------------------------------------------------------------------

import { clampCutCount } from "../constants";
import type { Brief, Upload } from "../types";
import { normalisePlan, type NormaliseInput } from "./schema";

const PROGRESSION: { lens: number; aperture: string; move: string; framing: string; verb: string }[] = [
  { lens: 50, aperture: "f/2", move: "dolly-in", framing: "wide", verb: "establishes" },
  { lens: 100, aperture: "f/2.8", move: "track", framing: "macro", verb: "glides across" },
  { lens: 75, aperture: "f/2", move: "rack-focus", framing: "close-up", verb: "closes on" },
  { lens: 50, aperture: "f/2.4", move: "arc", framing: "medium", verb: "circles" },
  { lens: 40, aperture: "f/2", move: "crane-up", framing: "wide", verb: "rises above" },
  { lens: 35, aperture: "f/2.8", move: "static", framing: "wide", verb: "holds on" },
  { lens: 85, aperture: "f/2", move: "push-in", framing: "close-up", verb: "pushes toward" },
  { lens: 24, aperture: "f/4", move: "pull-out", framing: "extreme wide", verb: "leaves" },
];

function beats(prompt: string, n: number): string[] {
  const sentences = prompt
    .split(/(?<=[.!?,;])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  if (sentences.length >= n) {
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(sentences[Math.floor((i * sentences.length) / n)]);
    return out;
  }
  const out = [...sentences];
  while (out.length < n) out.push(sentences[out.length % Math.max(1, sentences.length)] ?? prompt);
  return out;
}

const PALETTES: Record<string, { note: string; hex: string[]; light: string }> = {
  coast: { note: "warm amber sunlight + cobalt blue sky + deep ocean blue + soft cloud white + cool shadow charcoal", hex: ["#c89a5a", "#3b7dd8", "#12345a", "#f2f0ea", "#2b2f36"], light: "LOW GOLDEN SUN" },
  city: { note: "sodium amber + wet asphalt black + neon cyan + concrete grey + brake-light red", hex: ["#d9962e", "#141416", "#2fd3d9", "#7c7f85", "#d63a2f"], light: "NEON AND SODIUM" },
  forest: { note: "moss green + bark brown + dappled gold + fog white + deep shade", hex: ["#4a6b3a", "#5b4632", "#d9b35c", "#e8e9e4", "#1f2a1c"], light: "DAPPLED CANOPY" },
  interior: { note: "warm tungsten + cream walls + walnut brown + soft shadow + a single cool accent", hex: ["#e0a95a", "#efe6d2", "#6b4a2f", "#2c2620", "#5d8fc9"], light: "WARM TUNGSTEN" },
  product: { note: "rich cocoa brown + warm amber key + gold accent + deep negative black + cream highlight", hex: ["#3b2416", "#d9963a", "#c9a24a", "#0d0b0a", "#f1e6cf"], light: "WARM AMBER SPOTLIGHT" },
  default: { note: "warm key + cool fill + neutral mid-tones + one saturated accent + deep shadow", hex: ["#d4a15f", "#5b8fd6", "#8a8a86", "#d6413a", "#1e1f24"], light: "WARM KEY, COOL FILL" },
};

function paletteFor(text: string, hasProduct: boolean) {
  const t = text.toLowerCase();
  if (hasProduct || /commercial|ad\b|product|bottle|can\b|bar\b|packshot/.test(t)) return PALETTES.product;
  if (/coast|beach|sea|ocean|road|highway/.test(t)) return PALETTES.coast;
  if (/city|street|night|neon|downtown/.test(t)) return PALETTES.city;
  if (/forest|wood|tree|hill|mountain/.test(t)) return PALETTES.forest;
  if (/room|kitchen|apartment|office|studio|home|cafe|café|table/.test(t)) return PALETTES.interior;
  return PALETTES.default;
}

export function heuristicPlan(brief: Brief, uploads: Upload[], id: NormaliseInput["id"]) {
  const n = clampCutCount(brief.cutCount);
  const chars = uploads.filter((u) => u.role === "character");
  const objs = uploads.filter((u) => u.role === "object");
  const locs = uploads.filter((u) => u.role === "location");
  const isCommercial = objs.length > 0 || (!chars.length && /commercial|ad\b|product|bottle|can\b|bar\b|packshot/i.test(brief.prompt));
  const pal = paletteFor(`${brief.prompt} ${locs.map((l) => l.description).join(" ")}`, isCommercial);

  const characters = (chars.length ? chars : isCommercial ? [] : [null]).map((u, i) => ({
    name: u?.name || (i === 0 ? "LEAD" : `CHARACTER ${i + 1}`),
    uploadId: u?.id ?? null,
    look: u?.description || "the lead as described in the brief",
    wardrobe: "as seen in the reference photo, unchanged across every cut",
    palette: pal.hex.slice(0, 4),
  }));
  const products = (objs.length ? objs : isCommercial ? [null] : []).map((u, i) => ({
    name: u?.name || (i === 0 ? "THE PRODUCT" : `PRODUCT ${i + 1}`),
    uploadId: u?.id ?? null,
    description: u?.description || "the hero product as described in the brief, identical in every cut",
    notes: [
      { label: "TEXTURE", text: "true surface texture, sharp in macro" },
      { label: "FINISH", text: "controlled specular highlights, no blown-out hot spots" },
      { label: "STYLING", text: "packaging and props arranged as a premium ad" },
    ],
    palette: pal.hex.slice(0, 4),
  }));
  const environments = (locs.length ? locs : [null]).map((u, i) => ({
    name: `${u?.name || (i === 0 ? (isCommercial ? "TABLETOP SET" : "MAIN LOCATION") : `LOCATION ${i + 1}`)}${i === 0 ? " — MAIN LOCATION" : ""}`,
    uploadId: u?.id ?? null,
    description: u?.description || brief.prompt,
    timeOfDay: /night|dusk|evening/i.test(brief.prompt) ? "night" : /morning|dawn|sunrise/i.test(brief.prompt) ? "early morning" : "late afternoon",
  }));

  const lead = characters[0]?.name;
  const hero = products[0]?.name;
  const cuts = beats(brief.prompt, n).map((beat, i) => {
    const p = PROGRESSION[i] ?? PROGRESSION[PROGRESSION.length - 1];
    const env = environments[i % environments.length];
    const who = lead && characters.length > 1 && p.framing === "two-shot" ? characters.slice(0, 2).map((c) => c.name) : lead ? [lead] : [];
    const subject = who.length ? who.join(" and ") : hero ?? "the subject";
    return {
      title: `Cut ${i + 1}`,
      lensMm: p.lens,
      aperture: p.aperture,
      move: p.move,
      framing: p.framing,
      description: `${p.framing} shot ${p.verb} ${subject} — ${beat.replace(/[.,;]$/, "")}.`,
      action: beat,
      dialogue: "",
      characterNames: who,
      productNames: hero ? [hero] : [],
      environmentName: env.name,
      position: i === 0 ? "camera at the front edge of the set, facing the hero" : i === n - 1 ? "camera arcing around the far side of the set" : `camera close on the ${i % 2 ? "left" : "right"} side, beat ${i + 1}`,
    };
  });

  const raw = {
    paletteNote: pal.note,
    palette: pal.hex,
    lightingNote: pal.light,
    lensNote: "ANAMORPHIC PRIME",
    environmentFingerprint: environments.map((e) => e.description).join("; ").slice(0, 240),
    characters,
    products,
    environments,
    setNotes: `${environments[0].description.slice(0, 160)}. Key light pooled on the subject, soft falloff into the background.`,
    props: isCommercial ? "packaging, a folded wrapper, scattered ingredient details, one surface texture" : "only what the brief names; nothing that pulls focus",
    cuts,
    lighting: [
      "key light and its shadow on the subject",
      "edge light rimming the outline against the background",
      "environment texture under the ambient light",
      "reflective surfaces catching the key",
    ],
    moods: isCommercial ? ["premium", "tactile", "slow-burn reveal", "indulgent"] : ["a single encounter", "quiet momentum", "realism"],
    styleEssence: isCommercial ? "A controlled, premium world where every surface is felt before it is seen." : "A grounded, observed world lit by what is already there.",
    cinematography: [
      "Anamorphic language for cinematic texture, subtle oval flare",
      "Shallow depth of field to isolate the subject",
      "Restrained, motivated camera movement — no whip pans, no speed ramps",
      "Controlled contrast with a warm key and cool fill",
    ].join("\n"),
    soundscape: "natural ambience of the location, cloth movement and small material sounds, no dialogue unless written",
    music: "sparse piano over a soft sustained pad, slow tempo, dynamics that swell only on the final cut",
  };
  return normalisePlan(raw as Record<string, unknown>, { brief, uploads, id });
}
