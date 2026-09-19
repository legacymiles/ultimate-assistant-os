// ---------------------------------------------------------------------------
// The AI director chat on the storyboard page. The user says what to change
// ("make it night", "add a close-up of the baby laughing", "swap cut 2 and
// 3"); the model returns the whole revised plan in the planner's JSON shape
// with the ids of everything it kept, and the app redraws only what changed.
// Pure; shared by the route, the studio and the tests.
// ---------------------------------------------------------------------------

import { clampTotal } from "../constants";
import type { Brief, PanelKind, Plan, Upload } from "../types";
import { PLAN_JSON_SHAPE, normalisePlan } from "./schema";

export interface ChatTurn {
  role: "user" | "ai";
  text: string;
}

/** The plan as the planner JSON, joined by names, with every entity's id kept. */
export function planToJson(plan: Plan, brief: Brief): Record<string, unknown> {
  const charName = new Map(plan.characters.map((c) => [c.id, c.name]));
  const prodName = new Map(plan.products.map((p) => [p.id, p.name]));
  const envName = new Map(plan.environments.map((e) => [e.id, e.name]));
  return {
    title: plan.title,
    totalSec: brief.totalSec,
    paletteNote: plan.paletteNote,
    palette: plan.palette,
    lightingNote: plan.lightingNote,
    lensNote: plan.lensNote,
    environmentFingerprint: plan.environmentFingerprint,
    characters: plan.characters.map(({ id, name, uploadId, look, wardrobe, palette }) => ({ id, name, uploadId, look, wardrobe, palette })),
    products: plan.products.map(({ id, name, uploadId, description, notes, palette }) => ({ id, name, uploadId, description, notes, palette })),
    environments: plan.environments.map(({ id, name, uploadId, description, timeOfDay }) => ({ id, name, uploadId, description, timeOfDay })),
    setNotes: plan.setNotes,
    props: plan.props,
    cuts: plan.cuts.map((c) => ({
      id: c.id,
      title: c.title,
      lensMm: c.lensMm,
      aperture: c.aperture,
      durationSec: c.durationSec,
      move: c.move,
      framing: c.framing,
      description: c.description,
      action: c.action,
      dialogue: c.dialogue,
      characterNames: c.characterIds.map((id) => charName.get(id)).filter(Boolean),
      productNames: c.productIds.map((id) => prodName.get(id)).filter(Boolean),
      environmentName: c.environmentId ? envName.get(c.environmentId) ?? "" : "",
      position: c.position,
    })),
    lighting: plan.lighting.map(({ id, caption }) => ({ id, caption })),
    moods: plan.moods,
    styleEssence: plan.styleEssence,
    cinematography: plan.cinematography,
    soundscape: plan.soundscape,
    music: plan.music,
  };
}

export function reviseSystem(): string {
  return [
    "You are the director of a short AI-generated film, revising its SHOT PLAN with the user in a chat.",
    "You get the current plan as JSON, the conversation so far and the user's new request. Apply the request like a professional director would: change what they asked for, keep everything else exactly as it is, and make the rest of the plan consistent with the change (a night-time request also changes lighting captions, palette and time of day; a new character appears in the cuts that need them).",
    "Rules:",
    "- Return the WHOLE plan, not a diff. Keep the \"id\" of every character, product, environment, cut and lighting entry you keep; give NEW entries no id. Remove an entry by leaving it out.",
    "- Keep an entry's text byte-for-byte identical unless the request changes it — unchanged text means its picture is not redrawn, which saves the user money.",
    "- 1–8 cuts. Durations add up to totalSec (4–15). Change totalSec only if the user asks for a longer or shorter film.",
    "- Cuts name characters, products and the environment by their exact names. Captions stay 25–45 words; vary lenses, apertures and moves.",
    "- If the request is a question or unclear, answer it in reply and return the plan unchanged.",
    "Answer with ONE JSON object: { \"reply\": \"one or two sentences telling the user what you changed\", \"plan\": <the plan> }. The plan uses this shape, plus the ids and totalSec:",
    PLAN_JSON_SHAPE,
  ].join("\n");
}

export function reviseUser(plan: Plan, brief: Brief, history: ChatTurn[], message: string): string {
  const lines = [`Original brief: ${brief.prompt.trim()}`, `Current plan:\n${JSON.stringify(planToJson(plan, brief))}`];
  if (history.length) {
    lines.push("Conversation so far:");
    for (const t of history.slice(-10)) lines.push(`${t.role === "user" ? "USER" : "YOU"}: ${t.text}`);
  }
  lines.push(`USER'S NEW REQUEST: ${message.trim()}`);
  return lines.join("\n\n");
}

export interface Revision {
  plan: Plan;
  totalSec: number;
  cutCount: number;
  reply: string;
}

/** Turn the model's answer into a valid plan that reuses the old ids. */
export function applyRevision(raw: Record<string, unknown>, old: Plan, brief: Brief, uploads: Upload[], id: (prefix: string) => string): Revision {
  const rawPlan = (raw.plan && typeof raw.plan === "object" ? raw.plan : raw) as Record<string, unknown>;
  const rawCuts = Array.isArray(rawPlan.cuts) ? rawPlan.cuts.length : old.cuts.length;
  const cutCount = Math.min(8, Math.max(1, rawCuts || old.cuts.length));
  const totalSec = clampTotal(rawPlan.totalSec ?? brief.totalSec);
  const keepIds = new Set([
    ...old.characters.map((x) => x.id),
    ...old.products.map((x) => x.id),
    ...old.environments.map((x) => x.id),
    ...old.cuts.map((x) => x.id),
    ...old.lighting.map((x) => x.id),
  ]);
  const plan = normalisePlan(rawPlan, { brief: { ...brief, cutCount, totalSec }, uploads, id, keepIds });
  const reply = typeof raw.reply === "string" && raw.reply.trim() ? raw.reply.trim().slice(0, 600) : "Done — the plan is updated.";
  return { plan, totalSec, cutCount, reply };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Which drawn panels no longer match the plan. New entries need no listing —
 * panelsFor gives them an idle panel. A changed character or product also
 * stales the cut frames it appears in; a changed set stales the floor plan,
 * the elevation and every cut shot there.
 */
export function stalePanels(old: Plan, next: Plan): { kind: PanelKind; targetId: string }[] {
  const out = new Map<string, { kind: PanelKind; targetId: string }>();
  const add = (kind: PanelKind, targetId: string) => out.set(`${kind}:${targetId}`, { kind, targetId });

  const changedChars = new Set<string>();
  for (const c of next.characters) {
    const was = old.characters.find((x) => x.id === c.id);
    if (was && !same([was.name, was.look, was.wardrobe, was.palette], [c.name, c.look, c.wardrobe, c.palette])) {
      add("character", c.id);
      changedChars.add(c.id);
    }
  }
  const changedProds = new Set<string>();
  for (const p of next.products) {
    const was = old.products.find((x) => x.id === p.id);
    if (was && !same([was.name, was.description, was.notes, was.palette], [p.name, p.description, p.notes, p.palette])) {
      add("product", p.id);
      changedProds.add(p.id);
    }
  }
  const changedEnvs = new Set<string>();
  for (const e of next.environments) {
    const was = old.environments.find((x) => x.id === e.id);
    if (was && !same([was.name, was.description, was.timeOfDay], [e.name, e.description, e.timeOfDay])) {
      add("environment", e.id);
      changedEnvs.add(e.id);
    }
  }
  const lookChanged = !same([old.palette, old.lightingNote, old.styleEssence], [next.palette, next.lightingNote, next.styleEssence]);
  for (const c of next.cuts) {
    const was = old.cuts.find((x) => x.id === c.id);
    if (!was) continue;
    const own = !same(
      [was.lensMm, was.aperture, was.move, was.framing, was.description, was.action, was.characterIds, was.productIds, was.environmentId],
      [c.lensMm, c.aperture, c.move, c.framing, c.description, c.action, c.characterIds, c.productIds, c.environmentId],
    );
    const via =
      c.characterIds.some((id) => changedChars.has(id)) ||
      c.productIds.some((id) => changedProds.has(id)) ||
      (c.environmentId !== null && changedEnvs.has(c.environmentId));
    if (own || via || lookChanged) add("cut", c.id);
  }
  const blocking = (p: Plan) => p.cuts.map((c) => [c.id, c.position, c.move, c.environmentId]);
  if (changedEnvs.size || !same(blocking(old), blocking(next))) {
    add("floorplan", "floorplan");
    add("elevation", "elevation");
  }
  for (const l of next.lighting) {
    const was = old.lighting.find((x) => x.id === l.id);
    if (was && (was.caption !== l.caption || changedEnvs.size || lookChanged)) add("lighting", l.id);
  }
  return [...out.values()];
}
