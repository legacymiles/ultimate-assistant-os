// ---------------------------------------------------------------------------
// The AI Director's model-backed stages.
//
// Each function here mirrors one heuristic in heuristic.ts / retake.ts and
// returns the SAME shape, so the route can swap freely between them. Every
// function throws on a bad response and the route falls back; the model is a
// better first draft, never a dependency.
//
// Server-only: it needs the gateway key. Imported by /api/auteur/director.
// ---------------------------------------------------------------------------

import "server-only";
import { DEFAULT_MODEL, aiKey as providerKey, aiUrl } from "@/lib/ai/provider";

import { uid } from "@/lib/utils";
import { GENRES, TEMPLATES, genreById, templateById } from "../constants";
import type {
  Camera,
  CameraAngle,
  CameraMovement,
  Character,
  Development,
  Framing,
  H3Prompt,
  Project,
  Scene,
  Shot,
  ShotPatch,
  World,
} from "../types";
import { heuristicBreakdown } from "./heuristic";

const GATEWAY = aiUrl();

/** Re-exported so existing callers keep their import. */
export function aiKey(): string {
  return providerKey();
}

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

async function chat(system: string, user: string | Part[], json = true, timeoutMs = 60_000): Promise<string> {
  const model = process.env.AUTEUR_MODEL || process.env.AI_MODEL || DEFAULT_MODEL;
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiKey()}` },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return String(data?.choices?.[0]?.message?.content ?? "");
}

function readJson(content: string): Record<string, unknown> {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : content).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in response");
  return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v.trim() : fallback);
const strs = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, max) : [];

// ----- shared context ------------------------------------------------------

function projectContext(p: Project): string {
  const t = templateById(p.templateId);
  const genres = p.genreIds.map(genreById).filter(Boolean);
  const lines = [
    `Idea: ${p.idea}`,
    `Template: ${t.name} — ${t.blurb}. Production: ${t.production}. Target length ~${p.targetDurationSec}s, clips of ~${t.shotSec}s, pacing ${t.pacing}. Beats: ${t.beats.join(" → ")}.`,
    genres.length
      ? `Genre: ${genres.map((g) => `${g!.name} (tone: ${g!.tone}; light: ${g!.lighting}; palette: ${g!.palette}; camera: ${g!.camera})`).join(" + ")}`
      : "Genre: none chosen",
    `Aspect: ${p.aspectRatio}`,
    p.notes ? `Creative direction from the user: ${p.notes}` : "",
  ];
  const refs = p.references.filter((r) => r.description.trim());
  if (refs.length) {
    lines.push("References the user supplied (use them; they are real assets):");
    for (const r of refs) lines.push(`- [${r.kind}] ${r.name} (id ${r.id}, scope ${r.scope.level}): ${r.description}`);
  }
  return lines.filter(Boolean).join("\n");
}

function planContext(p: Project): string {
  const c = p.concept;
  return [
    c ? `Logline: ${c.logline}\nSynopsis: ${c.synopsis}\nTheme: ${c.theme}. Tone: ${c.tone}.\nStructure: ${c.structure.join(" → ")}` : "",
    p.characters.length
      ? "Characters:\n" + p.characters.map((ch) => `- ${ch.name} (id ${ch.id}, ${ch.role}): ${ch.description}${ch.manner ? ` Manner: ${ch.manner}` : ""}`).join("\n")
      : "Characters: none",
    p.worlds.length
      ? "Worlds:\n" + p.worlds.map((w) => `- ${w.name} (id ${w.id}): ${w.description}; ${w.timeOfDay}`).join("\n")
      : "Worlds: none",
    p.style
      ? `Style: ${p.style.lookName}; palette ${p.style.palette}; lighting ${p.style.lighting}; camera language ${p.style.cameraLanguage}; grade ${p.style.grade}; pacing ${p.style.pacing}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const DIRECTOR_VOICE =
  "You are an experienced film director, cinematographer and screenwriter working inside an AI " +
  "filmmaking studio that renders each shot with the MiniMax H3 video model (4–15 second clips " +
  "with native audio and lip-synced dialogue). You think in concrete, filmable, visible detail: " +
  "wardrobe with colours, ages, props, light sources, lens choices, camera moves with amplitude and " +
  "speed, blocking, expressions. Never write intentions, backstory or symbolism that cannot be seen. " +
  "Keep every character's look identical from shot to shot. ";

// ----- develop -------------------------------------------------------------

export async function developWithLLM(p: Project): Promise<Development> {
  const system =
    DIRECTOR_VOICE +
    "Develop the user's idea into a production plan. Respond ONLY with minified JSON:\n" +
    `{"title":string,"concept":{"logline":string,"synopsis":string,"theme":string,"tone":string,"structure":string[]},` +
    `"characters":[{"name":string,"role":string,"description":string,"manner":string,"referenceIds":string[]}],` +
    `"worlds":[{"name":string,"description":string,"timeOfDay":string,"referenceIds":string[]}],` +
    `"style":{"lookName":string,"palette":string,"lighting":string,"cameraLanguage":string,"grade":string,"pacing":string,"referenceIds":string[]}}\n` +
    "Rules: 1–4 characters, 1–3 worlds. structure = 4–7 short beat titles that follow the template's beats but are specific to THIS story. " +
    "Each character description must be a continuity sheet: age, build, hair, skin, exact wardrobe with colours, one distinctive prop or detail. " +
    "Each world description must name the environment, architecture or set, weather, and 2–3 key props. " +
    "If a supplied reference is a character/location/style, attach its id in referenceIds and base the description on it. " +
    "A product ad may have zero characters. The title is short and evocative (2–4 words).";
  const parsed = readJson(await chat(system, projectContext(p)));
  const concept = parsed.concept as Record<string, unknown> | undefined;
  const style = parsed.style as Record<string, unknown> | undefined;
  const validRef = new Set(p.references.map((r) => r.id));
  const refIds = (v: unknown) => strs(v).filter((id) => validRef.has(id));

  const characters: Character[] = (Array.isArray(parsed.characters) ? parsed.characters : [])
    .slice(0, 4)
    .map((c: Record<string, unknown>) => ({
      id: uid("chr"),
      name: str(c.name, "Lead"),
      role: str(c.role, "Lead"),
      description: str(c.description),
      manner: str(c.manner),
      referenceIds: refIds(c.referenceIds),
    }))
    .filter((c: Character) => c.name);
  const worlds: World[] = (Array.isArray(parsed.worlds) ? parsed.worlds : [])
    .slice(0, 3)
    .map((w: Record<string, unknown>) => ({
      id: uid("wld"),
      name: str(w.name, "Location"),
      description: str(w.description),
      timeOfDay: str(w.timeOfDay),
      referenceIds: refIds(w.referenceIds),
    }))
    .filter((w: World) => w.name);
  if (!worlds.length) throw new Error("no worlds");

  const template = templateById(p.templateId);
  return {
    title: str(parsed.title, "Untitled"),
    concept: {
      logline: str(concept?.logline, p.idea),
      synopsis: str(concept?.synopsis),
      theme: str(concept?.theme),
      tone: str(concept?.tone),
      structure: strs(concept?.structure, 7).length >= 3 ? strs(concept?.structure, 7) : [...template.beats],
    },
    characters,
    worlds,
    style: {
      lookName: str(style?.lookName, template.name),
      palette: str(style?.palette),
      lighting: str(style?.lighting),
      cameraLanguage: str(style?.cameraLanguage),
      grade: str(style?.grade),
      pacing: str(style?.pacing, template.pacing),
      referenceIds: refIds(style?.referenceIds),
    },
  };
}

// ----- breakdown -----------------------------------------------------------

const ANGLES: CameraAngle[] = ["eye level", "low angle", "high angle", "overhead", "dutch angle", "over the shoulder", "POV"];
const MOVEMENTS: CameraMovement[] = [
  "static", "push in", "pull out", "pan left", "pan right", "tilt up", "tilt down", "tracking",
  "handheld", "crane up", "crane down", "orbit", "zoom in", "zoom out", "shake",
];
const FRAMINGS: Framing[] = ["extreme wide", "wide", "medium wide", "medium", "medium close-up", "close-up", "extreme close-up", "insert"];

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const s = str(v).toLowerCase();
  return (allowed.find((a) => a === s) ?? allowed.find((a) => s.includes(a)) ?? fallback) as T;
}

export async function breakdownWithLLM(p: Project): Promise<Scene[]> {
  const template = templateById(p.templateId);
  // The heuristic board gives the model a target count and a skeleton to beat.
  const skeleton = heuristicBreakdown(p);
  const targetShots = skeleton.reduce((n, s) => n + s.shots.length, 0);
  const system =
    DIRECTOR_VOICE +
    "Break the developed plan into scenes and a shot list. Respond ONLY with minified JSON:\n" +
    `{"scenes":[{"title":string,"summary":string,"worldId":string,"characterIds":string[],"timeOfDay":string,"mood":string,` +
    `"shots":[{"title":string,"description":string,"action":string,"camera":{"angle":string,"movement":string,"framing":string,"lens":string},` +
    `"lighting":string,"expression":string,"dialogue":string,"characterIds":string[],"durationSec":number,"continuity":string}]}]}\n` +
    `Rules: one scene per story beat, ${targetShots} shots in total (±2), each ${template.shotSec}s (4–15 allowed). ` +
    `angle ∈ ${JSON.stringify(ANGLES)}; movement ∈ ${JSON.stringify(MOVEMENTS)}; framing ∈ ${JSON.stringify(FRAMINGS)}. ` +
    "Use real coverage: open on a wide, vary framing, motivate every camera move, favour medium and close shots when a face must be recognisable. " +
    "action = what happens during the clip, physically, in one or two sentences. description = what the audience sees. " +
    "expression = the subject's face, or empty. dialogue = at most one short spoken line as \"Name: words\", or empty; most shots have none. " +
    "continuity = what must match the previous shot (wardrobe, props, light, position). Use the given character and world ids exactly.";
  const parsed = readJson(await chat(system, `${projectContext(p)}\n\n${planContext(p)}`, true, 90_000));
  const rawScenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  if (!rawScenes.length) throw new Error("no scenes");
  const charIds = new Set(p.characters.map((c) => c.id));
  const worldIds = new Set(p.worlds.map((w) => w.id));

  const scenes: Scene[] = rawScenes.slice(0, 10).map((s: Record<string, unknown>, si: number) => {
    const worldId = worldIds.has(str(s.worldId)) ? str(s.worldId) : p.worlds[si % Math.max(1, p.worlds.length)]?.id ?? null;
    const shots: Shot[] = (Array.isArray(s.shots) ? s.shots : []).slice(0, 8).map((sh: Record<string, unknown>) => {
      const cam = (sh.camera ?? {}) as Record<string, unknown>;
      const camera: Camera = {
        angle: pick(cam.angle, ANGLES, "eye level"),
        movement: pick(cam.movement, MOVEMENTS, "push in"),
        framing: pick(cam.framing, FRAMINGS, "medium"),
        lens: str(cam.lens, "35mm"),
      };
      const dur = Number(sh.durationSec);
      return {
        id: uid("sht"),
        title: str(sh.title, "Shot"),
        description: str(sh.description),
        action: str(sh.action),
        camera,
        lighting: str(sh.lighting),
        expression: str(sh.expression),
        dialogue: str(sh.dialogue),
        characterIds: strs(sh.characterIds).filter((id) => charIds.has(id)),
        worldId,
        durationSec: Number.isFinite(dur) ? Math.max(4, Math.min(15, Math.round(dur))) : template.shotSec,
        referenceIds: [],
        continuity: str(sh.continuity),
        prompt: { text: "", cameraLine: "", soundscape: "", music: "", references: [], notes: "" },
        promptEdited: false,
        takes: [],
        activeTakeId: null,
      };
    });
    return {
      id: uid("scn"),
      title: str(s.title, `Scene ${si + 1}`),
      summary: str(s.summary),
      worldId,
      characterIds: strs(s.characterIds).filter((id) => charIds.has(id)),
      timeOfDay: str(s.timeOfDay),
      mood: str(s.mood),
      shots,
    };
  });
  const total = scenes.reduce((n, s) => n + s.shots.length, 0);
  if (total < 3) throw new Error("too few shots");
  return scenes;
}

// ----- prompt polish -------------------------------------------------------

/**
 * Improve the composed brief's wording without touching its structure. The
 * section labels and every <Subject N>/<Video N>/<Audio N> label must
 * survive, or the polished text is rejected and the composed one is used.
 */
export async function polishPromptWithLLM(composed: H3Prompt, p: Project, shot: Shot): Promise<string> {
  const system =
    "You are the prompt-rewriting stage of the MiniMax H3 video pipeline. You receive a structured " +
    "H3 brief and return the same brief with better, more vivid, more filmable prose. Output only the " +
    "finished brief, never commentary or markdown. Hard rules: keep every section label exactly " +
    "(subject_definitions:, summary:, retention_analysis:, detailed_description:, " +
    "integrated_multimodal_description:, overall_soundscape:, non_diegetic_music:), keep every " +
    "<Subject N>/<Video N>/<Audio N> label and its meaning, keep [Shot 1], keep dialogue tags " +
    "<d>[English] …</d> verbatim, keep the camera as a prose sentence with amplitude and speed, " +
    "keep the closing negative line. Describe only what is visible or audible. 120–260 words for the " +
    "description. Do not add characters, cuts, text or logos.";
  const user =
    `Shot duration: ${shot.durationSec}s. Aspect: ${p.aspectRatio}.\n\n${composed.text}`;
  const text = (await chat(system, user, false, 45_000)).trim();
  const required = [
    ...composed.references.map((r) => `<${r.label}>`),
    "overall_soundscape:",
    "non_diegetic_music:",
    "[Shot 1]",
    composed.references.length ? "detailed_description:" : "integrated_multimodal_description:",
  ];
  for (const r of required) if (!text.includes(r)) throw new Error(`polished prompt lost ${r}`);
  if (text.length > 6500 || text.length < 200) throw new Error("polished prompt out of range");
  return text;
}

// ----- retake --------------------------------------------------------------

export async function retakeWithLLM(instruction: string, shot: Shot, p: Project): Promise<ShotPatch> {
  const cast = shot.characterIds.map((id) => p.characters.find((c) => c.id === id)).filter(Boolean) as Character[];
  const system =
    DIRECTOR_VOICE +
    "The user wants to RETAKE one shot with a plain-language note. Turn the note into the smallest " +
    "structured patch that achieves it and leaves everything else untouched. Respond ONLY with minified JSON:\n" +
    `{"summary":string,"description"?:string,"action"?:string,"camera"?:{"angle"?:string,"movement"?:string,"framing"?:string,"lens"?:string},` +
    `"lighting"?:string,"expression"?:string,"dialogue"?:string,"durationSec"?:number,"characterOverrides"?:{[characterId]:string}}\n` +
    `angle ∈ ${JSON.stringify(ANGLES)}; movement ∈ ${JSON.stringify(MOVEMENTS)}; framing ∈ ${JSON.stringify(FRAMINGS)}. ` +
    "Only include keys that change. characterOverrides replaces a character's full continuity description (age, hair, wardrobe with colours, prop) for THIS shot; " +
    "use it for wardrobe or appearance notes. summary = one short line naming what changed, for a label.";
  const user = [
    `Instruction: ${instruction}`,
    `Shot: ${shot.title}`,
    `description: ${shot.description}`,
    `action: ${shot.action}`,
    `camera: ${JSON.stringify(shot.camera)}`,
    `lighting: ${shot.lighting}`,
    `expression: ${shot.expression}`,
    `dialogue: ${shot.dialogue}`,
    `durationSec: ${shot.durationSec}`,
    cast.length ? "Characters in shot:\n" + cast.map((c) => `- ${c.name} (id ${c.id}): ${c.description}`).join("\n") : "No characters in shot.",
  ].join("\n");
  const parsed = readJson(await chat(system, user));
  const patch: ShotPatch = { summary: str(parsed.summary, instruction) };
  if (typeof parsed.description === "string") patch.description = parsed.description.trim();
  if (typeof parsed.action === "string") patch.action = parsed.action.trim();
  if (typeof parsed.lighting === "string") patch.lighting = parsed.lighting.trim();
  if (typeof parsed.expression === "string") patch.expression = parsed.expression.trim();
  if (typeof parsed.dialogue === "string") patch.dialogue = parsed.dialogue.trim();
  if (parsed.camera && typeof parsed.camera === "object") {
    const cam = parsed.camera as Record<string, unknown>;
    const out: Partial<Camera> = {};
    if (cam.angle) out.angle = pick(cam.angle, ANGLES, shot.camera.angle);
    if (cam.movement) out.movement = pick(cam.movement, MOVEMENTS, shot.camera.movement);
    if (cam.framing) out.framing = pick(cam.framing, FRAMINGS, shot.camera.framing);
    if (typeof cam.lens === "string") out.lens = cam.lens.trim();
    if (Object.keys(out).length) patch.camera = out;
  }
  const dur = Number(parsed.durationSec);
  if (Number.isFinite(dur) && dur > 0) patch.durationSec = Math.max(4, Math.min(15, Math.round(dur)));
  if (parsed.characterOverrides && typeof parsed.characterOverrides === "object") {
    const valid = new Set(cast.map((c) => c.id));
    const overrides: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.characterOverrides as Record<string, unknown>)) {
      if (valid.has(k) && typeof v === "string" && v.trim()) overrides[k] = v.trim();
    }
    if (Object.keys(overrides).length) patch.characterOverrides = overrides;
  }
  const changed = Object.keys(patch).filter((k) => k !== "summary");
  if (!changed.length) throw new Error("empty patch");
  return patch;
}

// ----- describe a reference (vision) --------------------------------------

export interface Described {
  description: string;
  tags: string[];
  suggestedKind: "character" | "location" | "object" | "style" | "image";
}

export async function describeWithLLM(dataUrl: string, hint: string): Promise<Described> {
  const system =
    "You describe a reference image for a film director so the description can stand in for the " +
    "image inside a video-generation prompt. Write only what is visible: for a person — apparent age, " +
    "build, hair, skin tone, exact wardrobe with colours, accessories, expression; for a place — the " +
    "environment, architecture, materials, weather, light, key props; for an object — shape, colour, " +
    "material, markings, scale; for a style reference — palette, grade, lighting, lens feel, film stock. " +
    "40–90 words, one paragraph, no opinions. Respond ONLY with minified JSON: " +
    `{"description":string,"tags":string[],"suggestedKind":"character"|"location"|"object"|"style"|"image"}`;
  const parts: Part[] = [
    { type: "text", text: hint ? `The user labelled this: ${hint}. Describe the image.` : "Describe the image." },
    { type: "image_url", image_url: { url: dataUrl } },
  ];
  const parsed = readJson(await chat(system, parts));
  const description = str(parsed.description);
  if (!description) throw new Error("no description");
  const kind = str(parsed.suggestedKind) as Described["suggestedKind"];
  return {
    description,
    tags: strs(parsed.tags, 8),
    suggestedKind: (["character", "location", "object", "style", "image"] as const).includes(kind) ? kind : "image",
  };
}

/** Exposed so the route can list what the model was allowed to choose from. */
export const VOCAB = { templates: TEMPLATES.map((t) => t.id), genres: GENRES.map((g) => g.id) };
