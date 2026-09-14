// ---------------------------------------------------------------------------
// Plan → the MiniMax H3 brief.
//
// Two shapes come out of here:
//   composeFullH3Prompt — the whole film as ONE generation (the Smart Shot
//     way): every cut is a "[Shot N]" block inside one detailed_description,
//     and the references are the character/product sheets, the set plate and
//     the composed shot-plan sheet itself.
//   composeH3Prompt — one cut on its own, for retakes of a single beat.
//
// H3 reads a production brief, not a caption. In reference mode it wants six
// sections — subject_definitions, summary, retention_analysis,
// detailed_description, overall_soundscape, non_diegetic_music — with every
// attached file named <Subject N> in attach order and told how faithfully it
// is kept. Camera moves are prose with an amplitude and a speed (never the old
// "[Push in]" brackets), dialogue is <d>[English] …</d> with (S1) speaker ids,
// and because H3 always generates sound the brief says what that sound is.
//
// Deterministic and model-free, so the user never has to learn H3 prompting.
// ---------------------------------------------------------------------------

import { lookById } from "./constants";
import type { Brief, CameraMove, Framing, Plan, PlanCut } from "./types";

/** One file attached to the render, in send order. */
export interface H3Reference {
  label: string;
  /** Which plan entity supplied the image. */
  source: { kind: "character" | "product" | "environment" | "cut" | "sheet" | "style"; id: string; name: string };
  dataUrl: string;
}

export interface H3Brief {
  text: string;
  cameraLine: string;
  references: H3Reference[];
  notes: string;
}

/** Images offered to the composer; it labels and orders them. */
export interface H3Media {
  characterSheets: { characterId: string; dataUrl: string }[];
  productSheets: { productId: string; dataUrl: string }[];
  environmentPlates: { environmentId: string; dataUrl: string }[];
  /** The storyboard frame of the one cut being rendered on its own. */
  cutFrame?: string;
  /** The composed shot-plan sheet, attached when the whole film renders. */
  sheet?: string;
  styles: { name: string; dataUrl: string }[];
}

export const EMPTY_MEDIA: H3Media = { characterSheets: [], productSheets: [], environmentPlates: [], styles: [] };

const MOVE_PROSE: Record<CameraMove, string> = {
  static: "is locked off, perfectly still",
  handheld: "is handheld, drifting gently with the operator's breath",
  "dolly-in": "dollies in on a smooth slider",
  "push-in": "pushes in",
  "pull-out": "pulls out",
  track: "tracks alongside the subject",
  pan: "pans across the scene",
  tilt: "tilts",
  "crane-up": "rises on a crane",
  "crane-down": "descends on a crane",
  arc: "arcs around the subject in a clean, polished curve",
  orbit: "orbits slowly around the subject",
  "rack-focus": "holds still while focus racks from the foreground to the subject",
  "dolly-zoom": "dollies in while zooming out, holding the subject's size as the background stretches",
};

function amplitude(move: CameraMove, framing: Framing): "small" | "medium" | "large" {
  if (move === "static" || move === "rack-focus") return "small";
  if (move === "crane-up" || move === "crane-down" || move === "orbit" || move === "arc") return "large";
  if (framing === "close-up" || framing === "extreme close-up" || framing === "macro" || framing === "insert") return "small";
  if (framing === "wide" || framing === "extreme wide") return "large";
  return "medium";
}

function speed(move: CameraMove, durationSec: number): "slow" | "medium" | "fast" {
  if (move === "static" || move === "handheld" || move === "rack-focus") return "slow";
  if (durationSec <= 3) return "medium";
  return "slow";
}

function framingProse(f: Framing, lensMm: number, aperture: string): string {
  const name = f === "insert" ? "An insert" : f === "two-shot" ? "A two-shot" : f === "macro" ? "A macro shot" : `A ${f} shot`;
  return `${name} on a ${lensMm}mm lens at ${aperture}`;
}

export function cameraSentence(cut: PlanCut, focus: string): string {
  if (cut.move === "static") return `The camera ${MOVE_PROSE.static}, holding on ${focus}.`;
  if (cut.move === "rack-focus") return `The camera ${MOVE_PROSE["rack-focus"].replace("the subject", focus)} with small amplitude at slow speed.`;
  const toward = /push-in|dolly-in|track|orbit|arc|dolly-zoom/.test(cut.move) ? ` toward ${focus}` : "";
  return `The camera ${MOVE_PROSE[cut.move]} with ${amplitude(cut.move, cut.framing)} amplitude at ${speed(cut.move, cut.durationSec)} speed${toward}.`;
}

/** "GIRL: Don't go." → (S1) GIRL says: <d>[English] Don't go.</d> */
export function dialogueLine(dialogue: string, castNames: string[]): string {
  const raw = dialogue.trim();
  if (!raw) return "";
  const m = raw.match(/^([^:]{1,40}):\s*(.+)$/);
  const name = m ? m[1].trim() : castNames[0] ?? "The subject";
  const line = (m ? m[2] : raw).replace(/^["“]|["”]$/g, "").trim();
  const idx = Math.max(0, castNames.findIndex((n) => n.toLowerCase() === name.toLowerCase()));
  return `(S${idx + 1}) ${name} says: <d>[English] ${line}</d>`;
}

/**
 * Attach order: characters and products (identity first, because H3 weighs
 * earlier references more), then the environment(s), then the storyboard
 * frame or the composed sheet, then style images. Nine images at most.
 */
export function orderReferences(plan: Plan, cuts: PlanCut[], media: H3Media): H3Reference[] {
  const refs: H3Reference[] = [];
  const push = (r: Omit<H3Reference, "label">) => {
    if (refs.length >= 9) return;
    refs.push({ label: `Subject ${refs.length + 1}`, ...r });
  };
  const charIds = [...new Set(cuts.flatMap((c) => c.characterIds))];
  const prodIds = [...new Set(cuts.flatMap((c) => c.productIds))];
  const envIds = [...new Set(cuts.map((c) => c.environmentId).filter((v): v is string => Boolean(v)))];
  for (const id of charIds) {
    const c = plan.characters.find((x) => x.id === id);
    const sheet = media.characterSheets.find((s) => s.characterId === id);
    if (c && sheet) push({ source: { kind: "character", id, name: c.name }, dataUrl: sheet.dataUrl });
  }
  for (const id of prodIds) {
    const p = plan.products.find((x) => x.id === id);
    const sheet = media.productSheets.find((s) => s.productId === id);
    if (p && sheet) push({ source: { kind: "product", id, name: p.name }, dataUrl: sheet.dataUrl });
  }
  for (const id of envIds) {
    const env = plan.environments.find((e) => e.id === id);
    const plate = media.environmentPlates.find((p) => p.environmentId === id);
    if (env && plate) push({ source: { kind: "environment", id, name: env.name }, dataUrl: plate.dataUrl });
  }
  if (media.cutFrame && cuts.length === 1) push({ source: { kind: "cut", id: cuts[0].id, name: cuts[0].title }, dataUrl: media.cutFrame });
  if (media.sheet) push({ source: { kind: "sheet", id: "sheet", name: "the shot plan" }, dataUrl: media.sheet });
  for (const s of media.styles) push({ source: { kind: "style", id: s.name, name: s.name }, dataUrl: s.dataUrl });
  return refs;
}

function retention(kind: H3Reference["source"]["kind"]): string {
  switch (kind) {
    case "character":
    case "product":
      return "fully_preserved";
    case "environment":
      return "partially_preserved";
    case "cut":
    case "sheet":
    case "style":
      return "attribute_transfer";
  }
}

function definition(r: H3Reference, plan: Plan): string {
  const { kind, id, name } = r.source;
  switch (kind) {
    case "character": {
      const c = plan.characters.find((x) => x.id === id);
      return `<${r.label}> is ${name}: ${clean(c?.look || "the character as shown")}${c?.wardrobe ? `, wearing ${clean(c.wardrobe)}` : ""}. Retention: fully_preserved.`;
    }
    case "product": {
      const p = plan.products.find((x) => x.id === id);
      return `<${r.label}> is the hero product ${name}: ${clean(p?.description || "as shown")}. Retention: fully_preserved.`;
    }
    case "environment": {
      const e = plan.environments.find((x) => x.id === id);
      return `<${r.label}> is the set ${name}: ${clean(e?.description || "as shown")}. Retention: partially_preserved.`;
    }
    case "cut":
      return `<${r.label}> is the storyboard frame for this shot: its composition, framing, blocking and light are the target look. Retention: attribute_transfer.`;
    case "sheet":
      return `<${r.label}> is the shot plan sheet: the storyboard frames (Section 3) are the target look of each shot in order, and the palette and lighting references set the grade. Retention: attribute_transfer.`;
    case "style":
      return `<${r.label}> is a style reference: its palette, grade and lighting transfer to the new footage. Retention: attribute_transfer.`;
  }
}

function retained(r: H3Reference, shots: string): string {
  const { kind, name } = r.source;
  const where = `(appears in ${shots})`;
  switch (kind) {
    case "character":
      return `<${r.label}> ${where}: ${retention(kind)} - the identity, face, hair, skin and wardrobe of ${name} are retained exactly.`;
    case "product":
      return `<${r.label}> ${where}: ${retention(kind)} - the shape, proportions, materials, colours, wrapper and markings of ${name} are retained exactly.`;
    case "environment":
      return `<${r.label}> ${where}: ${retention(kind)} - the layout, materials, dressing and light of ${name} are retained; the camera may see new angles of it.`;
    case "cut":
      return `<${r.label}> ${where}: ${retention(kind)} - the composition, framing and lighting of the frame are matched; it is a still, so motion comes from the description.`;
    case "sheet":
      return `<${r.label}> ${where}: ${retention(kind)} - composition, framing and lighting of each storyboard frame are matched shot by shot; the sheet's text and layout are never shown.`;
    case "style":
      return `<${r.label}> ${where}: ${retention(kind)} - only palette, grade and lighting are transferred; none of its content.`;
  }
}

/** Which shots a reference appears in, e.g. "[Shot 1], [Shot 3]". */
function shotsFor(r: H3Reference, cuts: PlanCut[]): string {
  const idx = cuts
    .map((c, i) => {
      const { kind, id } = r.source;
      if (kind === "character") return c.characterIds.includes(id) ? i + 1 : 0;
      if (kind === "product") return c.productIds.includes(id) ? i + 1 : 0;
      if (kind === "environment") return c.environmentId === id ? i + 1 : 0;
      return i + 1;
    })
    .filter(Boolean);
  const list = idx.length ? idx : cuts.map((_, i) => i + 1);
  return list.map((n) => `[Shot ${n}]`).join(", ");
}

/** The [Shot N] block for one cut. */
function shotBlock(plan: Plan, cut: PlanCut, n: number, brief: Brief, labelFor: (kind: string, id: string) => string | undefined, opening: boolean): { text: string; cameraLine: string; spoken: string } {
  const look = lookById(brief.look);
  const cast = cut.characterIds.map((id) => plan.characters.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const products = cut.productIds.map((id) => plan.products.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  const env = plan.environments.find((e) => e.id === cut.environmentId) ?? plan.environments[0];
  const b: string[] = [];

  const subjects = [
    ...cast.map((c) => {
      const l = labelFor("character", c.id);
      const look2 = opening ? firstSentences(c.look, 2) : "";
      const wear = opening ? firstSentences(c.wardrobe, 1) : "";
      return `${c.name}${l ? ` (<${l}>)` : ""}${look2 ? `, ${look2}` : ""}${wear ? `, wearing ${wear}` : ""}`;
    }),
    ...products.map((p) => {
      const l = labelFor("product", p.id);
      const desc = opening ? firstSentences(p.description, 1) : "";
      return `${p.name}${l ? ` (<${l}>)` : ""}${desc ? `, ${desc}` : ""}`;
    }),
  ];
  const subject = subjects.length ? subjects.join(" and ") : "the subject";
  const envLabel = env ? labelFor("environment", env.id) : undefined;
  const where = env
    ? ` in ${env.name}${envLabel ? ` (<${envLabel}>)` : ""}${opening ? `, ${firstSentences(env.description, 2)}${env.timeOfDay ? `, ${clean(env.timeOfDay)}` : ""}` : ""}`
    : "";
  const style = opening ? `${look.style}. ` : "";
  b.push(`[Shot ${n}] ${style}${framingProse(cut.framing, cut.lensMm, cut.aperture)} frames ${subject}${where}, ${cut.durationSec} seconds.`);
  if (opening) {
    if (plan.paletteNote) b.push(`Palette: ${clean(plan.paletteNote)}.`);
    const light = plan.lighting[0]?.caption;
    if (light) b.push(`Lighting: ${clean(light)}${plan.lighting[1] ? `; ${clean(plan.lighting[1].caption)}` : ""}.`);
  }
  const focus = cast.length ? (cast.length === 1 ? cast[0].name : "the pair") : products.length ? products[0].name : cut.framing === "insert" ? "the detail" : "the subject";
  const cameraLine = cameraSentence(cut, focus);
  b.push(cameraLine);
  const beat = clean(cut.description);
  if (beat) b.push(beat.replace(/\s+/g, " ") + ".");
  const action = clean(cut.action);
  if (action && action !== beat) {
    const names = [...cast.map((c) => c.name), ...products.map((p) => p.name)];
    const namesFirst = names.some((nm) => action.toUpperCase().startsWith(nm.toUpperCase()));
    const actor = cast.length ? cast.map((c) => c.name).join(" and ") : products.length ? products[0].name : "The subject";
    b.push(`${namesFirst ? action : `${actor} ${lowerFirst(action)}`}.`);
  }
  const spoken = dialogueLine(cut.dialogue, cast.map((c) => c.name));
  if (spoken) b.push(spoken);
  return { text: b.join(" "), cameraLine, spoken };
}

function closing(plan: Plan, refs: H3Reference[], labelFor: (kind: string, id: string) => string | undefined): string[] {
  const out: string[] = [];
  if (plan.moods.length) out.push(`Mood: ${plan.moods.slice(0, 5).join(", ")}.`);
  if (plan.styleEssence) out.push(clean(plan.styleEssence) + ".");
  if (plan.cinematography) out.push(clean(plan.cinematography.replace(/^\s*[•\-*]\s*/gm, "").replace(/\s*\n\s*/g, "; ")) + ".");
  const frame = labelFor("cut", "") ?? refs.find((r) => r.source.kind === "cut")?.label;
  if (frame) out.push(`Match the composition and light of <${frame}> and bring it to life with the motion described.`);
  const sheet = refs.find((r) => r.source.kind === "sheet")?.label;
  if (sheet) out.push(`Match each shot to its storyboard frame in <${sheet}>, in order; never show the sheet, its text or its layout.`);
  out.push("Impeccable subject consistency across every shot. No subtitles, no on-screen text, no logos, no extra people.");
  return out;
}

function sections(plan: Plan, cuts: PlanCut[], refs: H3Reference[], description: string, summary: string): string {
  const lines: string[] = [];
  if (refs.length) {
    lines.push("subject_definitions:");
    for (const r of refs) lines.push(definition(r, plan));
    lines.push(`summary: [reference generation] ${summary}`);
    lines.push("retention_analysis:");
    for (const r of refs) lines.push(retained(r, shotsFor(r, cuts)));
    lines.push(`detailed_description: ${description}`);
  } else {
    lines.push(`integrated_multimodal_description: ${description}`);
  }
  const soundscape = clean(plan.soundscape) || "natural ambience of the location, cloth movement, small material sounds";
  lines.push(`overall_soundscape: ${soundscape}. No dialogue except what is written, no music in the ambience.`);
  const music = clean(plan.music);
  lines.push(`non_diegetic_music: ${!music || /^none$/i.test(music) ? "No music; natural sound only" : music}.`);
  return lines.join("\n").replace(/[ \t]+/g, " ").trim();
}

/** The whole film as one H3 generation: every cut is a [Shot N] block. */
export function composeFullH3Prompt(plan: Plan, brief: Brief, media: H3Media): H3Brief {
  const cuts = plan.cuts;
  const refs = orderReferences(plan, cuts, { ...media, cutFrame: undefined });
  const labelFor = (kind: string, id: string) => refs.find((r) => r.source.kind === kind && r.source.id === id)?.label;
  const total = cuts.reduce((a, c) => a + c.durationSec, 0);
  const blocks = cuts.map((c, i) => shotBlock(plan, c, i + 1, brief, labelFor, i === 0));
  const description = [
    `A ${total}-second ${plan.products.length ? "commercial" : "film"} in ${cuts.length} shots that flow into one another.`,
    ...blocks.map((b) => b.text),
    ...closing(plan, refs, labelFor),
  ].join(" ");
  const summary = `${plan.title} — ${cuts.length} shots, ${total}s: ${cuts.map((c) => `${c.title} ${c.framing} ${c.move}`).join("; ")}`;
  const text = sections(plan, cuts, refs, description, summary);
  const notes = [
    `Mode: ${refs.length ? `reference-to-video (${refs.length} image${refs.length === 1 ? "" : "s"})` : "text-to-video"} · one generation, ${cuts.length} shots, ${total}s`,
    blocks.some((b) => b.spoken) ? "Dialogue is lip-synced by H3" : "No dialogue",
  ].join("\n");
  return { text, cameraLine: blocks[0]?.cameraLine ?? "", references: refs, notes };
}

/** One cut on its own, for a retake of a single beat. */
export function composeH3Prompt(plan: Plan, cut: PlanCut, brief: Brief, media: H3Media): H3Brief {
  const refs = orderReferences(plan, [cut], { ...media, sheet: undefined });
  const labelFor = (kind: string, id: string) => refs.find((r) => r.source.kind === kind && r.source.id === id)?.label;
  const block = shotBlock(plan, { ...cut, durationSec: Math.max(4, cut.durationSec) }, 1, brief, labelFor, true);
  const description = [block.text, ...closing(plan, refs, labelFor)].join(" ");
  const summary = `${cut.title} — ${clean(cut.description) || clean(cut.action) || "the shot"}`;
  const text = sections(plan, [cut], refs, description, summary);
  const notes = [
    `Mode: ${refs.length ? `reference-to-video (${refs.length} image${refs.length === 1 ? "" : "s"})` : "text-to-video"}`,
    `${cut.lensMm}mm · ${cut.aperture} · ${cut.framing} · ${cut.move}`,
    block.spoken ? "Dialogue is lip-synced by H3" : "No dialogue",
  ].join("\n");
  return { text, cameraLine: block.cameraLine, references: refs, notes };
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Trailing full stops and whitespace removed, so joins never produce ".." or ".,". */
function clean(s: string): string {
  return s.trim().replace(/[.\s]+$/, "");
}

/** The first `n` sentences, for the compact restatement inside the description. */
function firstSentences(s: string, n: number): string {
  const parts = clean(s).split(/(?<=[.!?])\s+/).filter(Boolean);
  return clean(parts.slice(0, n).join(" "));
}
