// ---------------------------------------------------------------------------
// The H3 prompt composer.
//
// A shot is a structured thing: who is in it, where, doing what, how the
// camera sees it, how it is lit, what must match the previous shot. This
// module turns that structure into the brief MiniMax H3 actually receives.
//
// H3 does not read captions or the old Director-model "[Push in]" brackets.
// It reads a production brief: "[Shot 1]" tags, style and composition first,
// then subject appearance, environment, a camera SENTENCE with amplitude and
// speed, the action along the timeline, dialogue as <d>[English] …</d>, and —
// because H3 always generates sound — an overall soundscape and a music line.
// References are named <Subject N> / <Video N> / <Audio N> in the order they
// are attached to the request, which is why this composer also returns that
// order.
//
// Deterministic and model-free. The LLM path may polish the wording; this is
// what makes "the user never has to learn H3 prompting" true with no key.
// ---------------------------------------------------------------------------

import { genreById, templateById, type Genre } from "../constants";
import type {
  Camera,
  CameraMovement,
  Character,
  H3Prompt,
  Project,
  PromptReference,
  Reference,
  Scene,
  Shot,
  World,
} from "../types";

// ----- camera as prose -----------------------------------------------------

const MOVEMENT_PROSE: Record<CameraMovement, string> = {
  static: "is locked off, perfectly still",
  "push in": "pushes in",
  "pull out": "pulls out",
  "pan left": "pans left",
  "pan right": "pans right",
  "tilt up": "tilts up",
  "tilt down": "tilts down",
  tracking: "tracks alongside the subject",
  handheld: "is handheld, drifting slightly with the operator's breath",
  "crane up": "rises on a crane",
  "crane down": "descends on a crane",
  orbit: "orbits slowly around the subject",
  "zoom in": "zooms in",
  "zoom out": "zooms out",
  shake: "shakes with the impact",
};

function amplitudeFor(camera: Camera): "small" | "medium" | "large" {
  if (camera.movement === "static") return "small";
  if (camera.framing === "close-up" || camera.framing === "extreme close-up" || camera.framing === "insert") return "small";
  if (camera.framing === "wide" || camera.framing === "extreme wide") return "large";
  return "medium";
}

function speedFor(pacing: string, movement: CameraMovement): "slow" | "medium" | "fast" {
  if (movement === "shake") return "fast";
  if (pacing === "rapid") return "fast";
  if (pacing === "brisk") return "medium";
  return "slow";
}

function angleProse(angle: Camera["angle"]): string {
  switch (angle) {
    case "eye level":
      return "";
    case "low angle":
      return " from a low angle";
    case "high angle":
      return " from a high angle";
    case "overhead":
      return " from directly overhead";
    case "dutch angle":
      return " on a canted dutch angle";
    case "over the shoulder":
      return " over the shoulder";
    case "POV":
      return " from the subject's point of view";
  }
}

/** "The camera pushes in with small amplitude at slow speed toward Nora's face." */
export function cameraSentence(camera: Camera, pacing: string, focus: string): string {
  const move = MOVEMENT_PROSE[camera.movement];
  if (camera.movement === "static") {
    return `The camera ${move}${focus ? `, holding on ${focus}` : ""}.`;
  }
  const amp = amplitudeFor(camera);
  const speed = speedFor(pacing, camera.movement);
  const toward = focus && /push in|zoom in|tracking|orbit/.test(camera.movement) ? ` toward ${focus}` : "";
  return `The camera ${move} with ${amp} amplitude at ${speed} speed${toward}.`;
}

function framingProse(camera: Camera): string {
  const f = camera.framing === "insert" ? "an insert" : `a ${camera.framing}`;
  return `${f} shot${angleProse(camera.angle)}${camera.lens ? ` on a ${camera.lens} lens` : ""}`;
}

// ----- sound ---------------------------------------------------------------

const MUSIC: Record<string, string> = {
  comedy: "light pizzicato strings and a playful ukulele, upbeat tempo, bright dynamics",
  drama: "sparse solo piano with a low cello drone, slow tempo, soft dynamics that swell gently",
  romance: "warm solo piano over soft sustained strings, slow tempo, a gentle rising swell",
  horror: "a low sub-bass drone with sparse dissonant string scrapes, very slow, dynamics that creep up",
  action: "driving percussion and low brass hits, fast tempo, hard accents on the beat",
  thriller: "a ticking pulse over a cold synth pad, steady medium tempo, tension that never resolves",
  "sci-fi": "wide analog synth pads with a slow arpeggio, medium-slow tempo, vast dynamics",
  fantasy: "soft harp and woodwinds over a distant choir, slow tempo, dynamics that bloom",
  crime: "muted trumpet over an upright bass walk, slow swing, smoky low dynamics",
  mystery: "a solitary clarinet over a soft vibraphone, slow tempo, hushed dynamics",
  emotional: "a single felt piano with room tone, very slow, fragile dynamics",
  musical: "a full orchestral pit with brass and strings, medium tempo, big theatrical dynamics",
  adventure: "soaring strings and horns, medium-fast tempo, wide heroic dynamics",
  noir: "a lone saxophone over brushed drums, slow tempo, low and smoky",
  "coming-of-age": "warm acoustic guitar with a soft indie beat, medium tempo, sunlit dynamics",
};

function musicFor(genres: Genre[], templateId: string, hasAudioRef: boolean): string {
  if (hasAudioRef) return "Use the referenced audio as the music, unchanged.";
  if (templateId === "ugc-ad" || templateId === "documentary") return "No music; natural sound only.";
  const g = genres[0];
  return g && MUSIC[g.id] ? MUSIC[g.id] + "." : "Sparse solo piano, slow tempo, soft dynamics.";
}

const AMBIENCE: [RegExp, string][] = [
  [/street|city|crosswalk|taxi|traffic|new york|manhattan|brooklyn|london|paris|tokyo/i, "distant traffic and horns, footsteps on wet pavement, a passing conversation"],
  [/beach|sea|ocean|wave/i, "waves breaking and pulling back, gulls, wind across sand"],
  [/forest|wood|tree/i, "wind through leaves, birdsong, twigs underfoot"],
  [/rain|storm/i, "steady rain on hard surfaces, water running in gutters"],
  [/café|cafe|coffee|kitchen|restaurant|diner/i, "cups on saucers, an espresso machine, low chatter"],
  [/subway|train|station|platform/i, "a train arriving with brakes squealing, an announcement echo"],
  [/apartment|room|house|home|office/i, "quiet room tone, a clock, cloth movement"],
  [/desert|dune/i, "dry wind, sand hissing across rock"],
  [/space|ship|corridor|metal/i, "a low ship hum, ventilation, a distant metallic knock"],
  [/club|bar|party/i, "a muffled bass thump, glasses clinking, crowd noise"],
  [/studio|backdrop/i, "near-silent studio room tone, a soft cloth rustle"],
  [/rooftop|skyline/i, "wind at height, the city far below, a flag snapping"],
  [/road|highway|car/i, "tyres on asphalt, passing engines, wind buffeting"],
];

function soundscapeFor(world: World | undefined, scene: Scene, shot: Shot): string {
  const corpus = `${world?.name ?? ""} ${world?.description ?? ""} ${scene.summary}`;
  const hit = AMBIENCE.find(([re]) => re.test(corpus));
  const base = hit ? hit[1] : "natural ambience that matches the setting, subtle cloth movement";
  const actionSound = /run|sprint|walk|step/i.test(shot.action) ? ", the subject's footsteps" : "";
  return `${base}${actionSound}. No dialogue except what is written, no music in the ambience.`;
}

// ----- dialogue ------------------------------------------------------------

/** "Nora: Don't go." → (S1) Nora says: <d>[English] Don't go.</d> */
function dialogueLine(dialogue: string, cast: Character[]): string {
  const raw = dialogue.trim();
  if (!raw) return "";
  const m = raw.match(/^([^:]{1,40}):\s*(.+)$/);
  const name = m ? m[1].trim() : cast[0]?.name ?? "The subject";
  const line = (m ? m[2] : raw).replace(/^["“]|["”]$/g, "").trim();
  const idx = Math.max(0, cast.findIndex((c) => c.name.toLowerCase() === name.toLowerCase()));
  return `(S${idx + 1}) ${name} says: <d>[English] ${line}</d>`;
}

// ----- references ----------------------------------------------------------

/**
 * Every reference that applies to this shot: project-level, its scene's, its
 * own, and anything attached to its characters or world. Shot-level entries
 * come last so they win any tie downstream.
 */
export function effectiveReferences(project: Project, scene: Scene, shot: Shot): Reference[] {
  const byId = new Map(project.references.map((r) => [r.id, r]));
  const out: Reference[] = [];
  const seen = new Set<string>();
  const push = (r: Reference | undefined) => {
    if (r && !seen.has(r.id)) {
      seen.add(r.id);
      out.push(r);
    }
  };
  for (const r of project.references) if (r.scope.level === "project") push(r);
  for (const r of project.references)
    if (r.scope.level === "scene" && r.scope.sceneId === scene.id) push(r);
  for (const cid of shot.characterIds) {
    const c = project.characters.find((x) => x.id === cid);
    for (const id of c?.referenceIds ?? []) push(byId.get(id));
  }
  const world = project.worlds.find((w) => w.id === (shot.worldId ?? scene.worldId));
  for (const id of world?.referenceIds ?? []) push(byId.get(id));
  for (const r of project.references)
    if (r.scope.level === "shot" && r.scope.shotId === shot.id) push(r);
  for (const id of shot.referenceIds) push(byId.get(id));
  return out;
}

const IMAGE_KINDS = new Set(["image", "character", "location", "object", "style"]);

/**
 * Assign H3 labels to the media references, honouring its limits: up to 9
 * images, 3 videos, 3 audio clips, 12 files in all.
 */
export function labelReferences(refs: Reference[]): { labelled: PromptReference[]; byId: Map<string, string> } {
  const labelled: PromptReference[] = [];
  const byId = new Map<string, string>();
  let img = 0;
  let vid = 0;
  let aud = 0;
  for (const r of refs) {
    if (!r.mediaId) continue;
    if (labelled.length >= 12) break;
    let label = "";
    if (IMAGE_KINDS.has(r.kind) && img < 9) label = `Subject ${++img}`;
    else if (r.kind === "video" && vid < 3) label = `Video ${++vid}`;
    else if (r.kind === "audio" && aud < 3) label = `Audio ${++aud}`;
    if (!label) continue;
    labelled.push({ label, referenceId: r.id });
    byId.set(r.id, label);
  }
  return { labelled, byId };
}

function retention(kind: Reference["kind"]): string {
  switch (kind) {
    case "character":
    case "object":
      return "fully_preserved";
    case "location":
      return "partially_preserved";
    case "style":
      return "attribute_transfer";
    case "video":
      return "reference";
    case "audio":
      return "fully_copy";
    default:
      return "weak_reference";
  }
}

function hasAudioRefIn(labelled: PromptReference[], refs: Reference[]): boolean {
  return labelled.some((l) => refs.find((r) => r.id === l.referenceId)?.kind === "audio");
}

/** What "kept" means for each kind of reference, in H3's own phrasing. */
function retainedDetail(r: Reference): string {
  const who = r.description.trim() ? r.description.trim().split(/[,.]/)[0] : r.name.replace(/\.[a-z0-9]+$/i, "");
  switch (r.kind) {
    case "character":
      return `the identity, face and clothing of ${who} are retained.`;
    case "object":
      return `the shape, colour and markings of ${who} are retained.`;
    case "location":
      return `the layout, furnishing and lighting of ${who} are retained.`;
    case "style":
      return `the palette, grade and lighting of ${who} are transferred to the new subject.`;
    case "video":
      return `the camera work and motion of ${who} guide the target without copying its content.`;
    case "audio":
      return `the audio is used as the music track.`;
    default:
      return `the overall look of ${who} loosely informs the shot.`;
  }
}

function subjectDefinition(r: Reference, label: string, owner?: string): string {
  const what = r.description.trim() || r.name.replace(/\.[a-z0-9]+$/i, "");
  const role =
    r.kind === "character"
      ? `is ${owner ?? "a character"}: ${what}`
      : r.kind === "location"
        ? `is the location: ${what}`
        : r.kind === "object"
          ? `is the featured object: ${what}`
          : r.kind === "style"
            ? `shows the look to match: ${what}`
            : r.kind === "video"
              ? `is a motion and camera reference: ${what}`
              : r.kind === "audio"
                ? `is the music track: ${what}`
                : `is a visual reference: ${what}`;
  return `<${label}> ${role}. Retention: ${retention(r.kind)}.`;
}

// ----- the composer --------------------------------------------------------

export interface ComposeOptions {
  /** Per-character wardrobe/appearance overrides from a retake. */
  characterOverrides?: Record<string, string>;
}

function characterLine(c: Character, label: string | undefined, override?: string): string {
  const desc = (override ?? c.description).trim();
  const anchor = label ? ` (<${label}>)` : "";
  return desc ? `${c.name}${anchor}, ${desc}` : `${c.name}${anchor}`;
}

/** Build the H3 brief for one shot from the whole project's context. */
export function composeH3Prompt(
  project: Project,
  scene: Scene,
  shot: Shot,
  opts: ComposeOptions = {},
): H3Prompt {
  const template = templateById(project.templateId);
  const genres = project.genreIds.map(genreById).filter((g): g is Genre => Boolean(g));
  const world = project.worlds.find((w) => w.id === (shot.worldId ?? scene.worldId));
  const cast = shot.characterIds
    .map((id) => project.characters.find((c) => c.id === id))
    .filter((c): c is Character => Boolean(c));
  const refs = effectiveReferences(project, scene, shot);
  const { labelled, byId } = labelReferences(refs);

  // Which label anchors each character: the first labelled reference it owns.
  const labelForCharacter = (c: Character) => c.referenceIds.map((id) => byId.get(id)).find(Boolean);

  const lines: string[] = [];

  // The brief itself, in H3's preferred order.
  const brief: string[] = [];
  const styleBits = [
    "Live-action, cinematic",
    template.production,
    project.style?.lookName,
    project.style?.palette ? `palette of ${project.style.palette}` : undefined,
    project.style?.grade,
  ].filter(Boolean);
  brief.push(`[Shot 1] ${styleBits.join(", ")}. ${capitalize(framingProse(shot.camera))} frames`);

  const subject = cast.length
    ? cast.map((c) => characterLine(c, labelForCharacter(c), opts.characterOverrides?.[c.id])).join(" and ")
    : template.id === "product-ad"
      ? "the product"
      : "the subject";
  const when = scene.timeOfDay || world?.timeOfDay || "";
  const where = world
    ? ` in ${world.name}${byId.size && world.referenceIds.some((id) => byId.has(id)) ? ` (<${world.referenceIds.map((id) => byId.get(id)).find(Boolean)}>)` : ""}, ${world.description}${when ? `, ${when}` : ""}`
    : scene.summary
      ? ` — ${scene.summary.replace(/\.$/, "")}`
      : "";
  brief[brief.length - 1] += ` ${subject}${where}.`;

  const light = shot.lighting.trim() || project.style?.lighting || genres[0]?.lighting || "";
  if (light) brief.push(`Lighting: ${light}.`);

  const focus = cast.length ? (cast.length === 1 ? cast[0].name : "the pair") : shot.camera.framing === "insert" ? "the detail" : "the subject";
  const cameraLine = cameraSentence(shot.camera, project.style?.pacing ?? template.pacing, focus);
  brief.push(cameraLine);

  const action = shot.action.trim() || shot.description.trim();
  if (action) {
    const actor = cast.length ? cast.map((c) => c.name).join(" and ") : capitalize(subject);
    brief.push(`${actor} ${lowerFirst(action)}${end(action)}`);
  }
  if (shot.expression.trim()) brief.push(`${cast[0]?.name ?? "The subject"}'s expression: ${shot.expression.trim()}.`);

  const spoken = dialogueLine(shot.dialogue, cast);
  if (spoken) brief.push(spoken);

  if (scene.mood) brief.push(`Mood: ${scene.mood}.`);
  if (shot.continuity.trim()) brief.push(`Continuity: ${shot.continuity.trim()}`);

  // Video references are for motion; say so explicitly.
  for (const { label, referenceId } of labelled) {
    const r = refs.find((x) => x.id === referenceId);
    if (r?.kind === "video") brief.push(`Match the camera motion and pacing of <${label}>.`);
  }
  brief.push("No subtitles, no on-screen text, no logos, no extra people.");

  if (labelled.length) {
    // Reference mode is a six-section brief: every label is defined, the
    // task is named, and each reference says how faithfully it is kept.
    lines.push("subject_definitions:");
    for (const { label, referenceId } of labelled) {
      const r = refs.find((x) => x.id === referenceId)!;
      const owner = cast.find((c) => c.referenceIds.includes(r.id))?.name;
      lines.push(subjectDefinition(r, label, owner));
    }
    const tasks = ["reference generation"];
    if (hasAudioRefIn(labelled, refs)) tasks.push("audio reuse");
    lines.push(`summary: [${tasks.join(" + ")}] ${shot.description.trim() || shot.title}`);
    lines.push("retention_analysis:");
    for (const { label, referenceId } of labelled) {
      const r = refs.find((x) => x.id === referenceId)!;
      lines.push(`<${label}> (appears in [Shot 1]): ${retention(r.kind)} - ${retainedDetail(r)}`);
    }
    lines.push(`detailed_description: ${brief.join(" ")}`);
  } else {
    lines.push(`integrated_multimodal_description: ${brief.join(" ")}`);
  }

  const hasAudioRef = hasAudioRefIn(labelled, refs);
  const soundscape = soundscapeFor(world, scene, shot);
  const music = musicFor(genres, template.id, hasAudioRef);
  lines.push(`overall_soundscape: ${soundscape}`);
  lines.push(`non_diegetic_music: ${music}`);

  const text = lines.join("\n").replace(/[ \t]+/g, " ").trim();

  const notes = [
    `Template: ${template.name}${genres.length ? ` · Genre: ${genres.map((g) => g.name).join(" + ")}` : ""}`,
    `Mode: ${labelled.length ? `reference-to-video (${labelled.length} file${labelled.length === 1 ? "" : "s"})` : "text-to-video"}`,
    refs.length > labelled.length ? `${refs.length - labelled.length} reference(s) carried as words only (no media or over H3's limits)` : "",
    spoken ? "Dialogue is lip-synced by H3" : "No dialogue",
  ]
    .filter(Boolean)
    .join("\n");

  return { text, cameraLine, soundscape, music, references: labelled, notes };
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function end(s: string): string {
  return /[.!?]$/.test(s.trim()) ? "" : ".";
}
