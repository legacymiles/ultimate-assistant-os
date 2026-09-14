// ---------------------------------------------------------------------------
// What each drawn panel asks the image model for.
//
// A panel is one image: a character turnaround sheet, a product/hero-object
// sheet, an environment plate, the top-down floor plan, a side elevation, one
// storyboard frame per cut, or a lighting reference strip. The prompt for
// each is built here from the plan so the sheet, the H3 briefs and the
// drawings all describe the same film.
//
// Pure. The client attaches the images the spec names, in the order given.
// ---------------------------------------------------------------------------

import { lookById } from "./constants";
import type { AspectRatio, Brief, Panel, PanelKind, Plan, PlanCut } from "./types";

export interface PanelRef {
  /** What the image is, so the model knows how to use it. */
  role: "photo" | "character-sheet" | "product-photo" | "product-sheet" | "location-photo" | "environment-plate" | "style";
  label: string;
  dataUrl: string;
}

export interface PanelSpec {
  kind: PanelKind;
  prompt: string;
  aspect: string;
  refs: PanelRef[];
}

function refGuide(refs: PanelRef[]): string {
  if (!refs.length) return "";
  const lines = refs.map((r, i) => {
    switch (r.role) {
      case "photo":
        return `Image ${i + 1} is a PHOTO of ${r.label}: keep this exact person — face, age, skin tone, hair, build — recognisable in every view.`;
      case "character-sheet":
        return `Image ${i + 1} is the CHARACTER SHEET for ${r.label}: this is the same person; keep face, hair and wardrobe identical.`;
      case "product-photo":
        return `Image ${i + 1} is a PHOTO of the product ${r.label}: keep its exact shape, proportions, materials, colours, wrapper and markings.`;
      case "product-sheet":
        return `Image ${i + 1} is the PRODUCT SHEET for ${r.label}: this is the same object; keep it identical in every detail.`;
      case "location-photo":
        return `Image ${i + 1} is a PHOTO of the location ${r.label}: keep its layout, materials, vegetation and light.`;
      case "environment-plate":
        return `Image ${i + 1} is the ENVIRONMENT PLATE for ${r.label}: set the shot in exactly this place.`;
      case "style":
        return `Image ${i + 1} is a STYLE reference: borrow its colours, lighting and mood only — do not copy its people.`;
    }
  });
  return `Reference images:\n${lines.join("\n")}`;
}

const NO_TEXT = "No captions, watermarks, borders or extra text.";

export function characterSheetPrompt(plan: Plan, characterId: string, brief: Brief, refs: PanelRef[]): PanelSpec {
  const c = plan.characters.find((x) => x.id === characterId)!;
  const look = lookById(brief.look);
  const prompt = [
    `Character reference sheet for ${c.name}, a six-panel grid on a plain white studio background: top row full-body front view, full-body three-quarter view, full-body back view; bottom row a head-and-shoulders portrait facing camera, a profile portrait, and a detail of the wardrobe. All six show the identical person in the identical outfit.`,
    `Appearance: ${c.look || "as in the photo"}. Wardrobe: ${c.wardrobe || "as in the photo"}.`,
    `Palette of the character: ${c.palette.join(", ")}.`,
    `Style: ${look.style}. Neutral, even studio light, sharp focus, photographic.`,
    refGuide(refs),
    NO_TEXT,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { kind: "character", prompt, aspect: "1:1", refs };
}

export function productSheetPrompt(plan: Plan, productId: string, brief: Brief, refs: PanelRef[]): PanelSpec {
  const p = plan.products.find((x) => x.id === productId)!;
  const look = lookById(brief.look);
  const prompt = [
    `Product / hero object reference sheet for ${p.name}, a five-panel grid on a plain white studio background: 1 front view, 2 three-quarter view, 3 side / edge view, 4 macro detail of the surface and material, 5 in-context lifestyle shot in its set. All five show the identical object.`,
    `The object: ${p.description || "as in the photo"}.`,
    p.notes.length ? p.notes.map((n) => `${n.label}: ${n.text}`).join(". ") + "." : "",
    `Palette: ${p.palette.join(", ")}.`,
    `Style: ${look.style}. Product-grade studio light with controlled specular highlights, sharp focus, photographic.`,
    refGuide(refs),
    NO_TEXT,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { kind: "product", prompt, aspect: "16:9", refs };
}

export function environmentPrompt(plan: Plan, environmentId: string, brief: Brief, refs: PanelRef[]): PanelSpec {
  const e = plan.environments.find((x) => x.id === environmentId)!;
  const look = lookById(brief.look);
  const prompt = [
    `Set design plate of ${e.name}: a wide establishing view of the location with nobody in it.`,
    `${e.description}${e.timeOfDay ? ` Time of day: ${e.timeOfDay}.` : ""}`,
    plan.setNotes ? `Set notes: ${plan.setNotes}` : "",
    plan.props ? `Props on set: ${plan.props}.` : "",
    `World palette: ${plan.paletteNote || plan.palette.join(", ")}. Environment fingerprint: ${plan.environmentFingerprint}`,
    `Style: ${look.style}.`,
    refGuide(refs),
    NO_TEXT,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { kind: "environment", prompt, aspect: brief.aspectRatio === "9:16" ? "3:4" : "16:9", refs };
}

export function floorPlanPrompt(plan: Plan, refs: PanelRef[]): PanelSpec {
  const env = plan.environments[0];
  const cutLines = plan.cuts
    .map((c, i) => `${i + 1}: ${c.title} — ${c.move.toUpperCase()}, ${c.framing}${c.position ? `, ${c.position}` : ""}`)
    .join("; ");
  const prompt = [
    `A top-down floor plan of the set ${env.name}, drawn as a clean production-design schematic seen from directly above: the ground, surfaces, structures, props and light pools drawn in muted flat colour with thin dark outlines; small camera icons with a short arrow for each cut's direction of movement, and a white numbered circle marker 1 to ${plan.cuts.length} beside each camera. A north arrow or scale bar in a corner. Blueprint / technical-illustration style, white margins.`,
    `Layout: ${env.description}`,
    plan.props ? `Props to draw: ${plan.props}.` : "",
    `Cut positions: ${cutLines}.`,
    refGuide(refs),
    `The only text allowed is the cut numbers 1–${plan.cuts.length} inside the markers.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { kind: "floorplan", prompt, aspect: "16:9", refs };
}

export function elevationPrompt(plan: Plan, refs: PanelRef[]): PanelSpec {
  const last = plan.cuts[plan.cuts.length - 1];
  const env = plan.environments.find((e) => e.id === last?.environmentId) ?? plan.environments[0];
  const prompt = [
    `A side-elevation diagram for ${last?.title ?? "the final cut"} (${last?.move ?? "arc"}) on the set ${env.name}: a vertical strip of three small frames stacked from the highest camera position at the top to ground level at the bottom, showing the camera's path with a dotted line and a small silhouette of the subject at each height. Clean technical-illustration style, muted colour, thin lines, white margins.`,
    `Set: ${env.description}`,
    refGuide(refs),
    NO_TEXT,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { kind: "elevation", prompt, aspect: "3:4", refs };
}

export function cutFramePrompt(plan: Plan, cut: PlanCut, brief: Brief, refs: PanelRef[]): PanelSpec {
  const look = lookById(brief.look);
  const cast = cut.characterIds.map((id) => plan.characters.find((c) => c.id === id)).filter(Boolean);
  const products = cut.productIds.map((id) => plan.products.find((p) => p.id === id)).filter(Boolean);
  const env = plan.environments.find((e) => e.id === cut.environmentId) ?? plan.environments[0];
  const prompt = [
    `Storyboard frame for ${cut.title}: a single cinematic still, ${cut.framing} shot on a ${cut.lensMm}mm lens at ${cut.aperture}.`,
    cut.description,
    cast.length ? cast.map((c) => `${c!.name}: ${c!.look}${c!.wardrobe ? `, wearing ${c!.wardrobe}` : ""}.`).join(" ") : "",
    products.length ? products.map((p) => `${p!.name}: ${p!.description}.`).join(" ") : "",
    `Set: ${env.name} — ${env.description}${env.timeOfDay ? `, ${env.timeOfDay}` : ""}.${plan.props ? ` Props: ${plan.props}.` : ""}`,
    `Palette: ${plan.paletteNote || plan.palette.join(", ")}. ${plan.styleEssence} ${plan.cinematography.replace(/\n/g, " ")}`,
    `Style: ${look.style}. Frame it exactly as the camera would at the midpoint of the ${cut.move} move.`,
    refGuide(refs),
    NO_TEXT,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { kind: "cut", prompt, aspect: brief.aspectRatio, refs };
}

export function lightingPrompt(plan: Plan, lightingId: string, brief: Brief, refs: PanelRef[]): PanelSpec {
  const l = plan.lighting.find((x) => x.id === lightingId)!;
  const look = lookById(brief.look);
  const env = plan.environments[0];
  const subject = plan.products[0]?.name ?? plan.characters[0]?.name ?? "the subject";
  const prompt = [
    `Lighting reference still: ${l.caption}.`,
    `On the set of ${env.name} (${env.description}), showing ${subject}. Palette: ${plan.paletteNote || plan.palette.join(", ")}.`,
    `Style: ${look.style}. A tight, textural frame focused on how the light falls, not on story.`,
    refGuide(refs),
    NO_TEXT,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { kind: "lighting", prompt, aspect: "4:3", refs };
}

/** The panels a plan needs, in draw order: characters, products and environments first because cuts reference them. */
export function panelsFor(plan: Plan, existing: Panel[] = []): Panel[] {
  const keep = new Map(existing.map((p) => [`${p.kind}:${p.targetId}`, p]));
  const want: { kind: PanelKind; targetId: string }[] = [
    ...plan.characters.map((c) => ({ kind: "character" as const, targetId: c.id })),
    ...plan.products.map((p) => ({ kind: "product" as const, targetId: p.id })),
    ...plan.environments.map((e) => ({ kind: "environment" as const, targetId: e.id })),
    { kind: "floorplan", targetId: "floorplan" },
    { kind: "elevation", targetId: "elevation" },
    ...plan.cuts.map((c) => ({ kind: "cut" as const, targetId: c.id })),
    ...plan.lighting.map((l) => ({ kind: "lighting" as const, targetId: l.id })),
  ];
  return want.map(
    (w) => keep.get(`${w.kind}:${w.targetId}`) ?? { id: `${w.kind}:${w.targetId}`, kind: w.kind, targetId: w.targetId, status: "idle" },
  );
}

export function panelFor(panels: Panel[], kind: PanelKind, targetId: string): Panel | undefined {
  return panels.find((p) => p.kind === kind && p.targetId === targetId);
}

/** Pixel size for the offline placeholder, from the model aspect string. */
export function aspectSize(aspect: string | AspectRatio): [number, number] {
  switch (aspect) {
    case "9:16":
      return [576, 1024];
    case "3:4":
      return [768, 1024];
    case "4:3":
      return [1024, 768];
    case "1:1":
      return [1024, 1024];
    default:
      return [1024, 576];
  }
}
