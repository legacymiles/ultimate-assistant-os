// ---------------------------------------------------------------------------
// The offline director.
//
// Every stage the AI Director runs has a version here that needs no model.
// It reads the idea for names, people and places, leans on the template's
// beats and the genre's habits, and produces a plan that is honest about
// being a first draft. The LLM path improves on it; nothing depends on the
// LLM path existing.
//
// Pure functions over plain data, so they are unit-tested directly.
// ---------------------------------------------------------------------------

import {
  COVERAGE_ORDER,
  MAX_SHOT_SEC,
  MIN_SHOT_SEC,
  genreById,
  templateById,
  type Genre,
  type Template,
} from "../constants";
import type {
  Camera,
  CameraAngle,
  CameraMovement,
  Character,
  Concept,
  Development,
  Framing,
  Project,
  Reference,
  Scene,
  Shot,
  Style,
  World,
} from "../types";

let counter = 0;
function id(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ----- reading the idea ----------------------------------------------------

const STOP = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "of", "for", "with", "about",
  "who", "that", "which", "where", "when", "into", "from", "by", "as", "is", "are", "was",
  "create", "make", "cinematic", "film", "video", "short", "movie", "scene", "story", "commercial",
  "romantic", "romance", "horror", "comedy", "drama", "thriller", "action", "trailer", "music",
  "ad", "product", "documentary", "i", "we", "you", "it", "they", "he", "she", "him", "her",
  "his", "their", "our", "my", "new", "old", "one", "two", "three",
]);

const PLACES = [
  "new york", "nyc", "manhattan", "brooklyn", "paris", "london", "tokyo", "los angeles", "la",
  "rome", "berlin", "venice", "lisbon", "seoul", "hong kong", "shanghai", "dubai", "mumbai",
  "sydney", "rio", "mexico city", "chicago", "miami", "san francisco", "iceland", "sahara",
  "amazon", "alps", "himalayas", "scotland", "ireland", "morocco", "kyoto", "lagos", "cairo",
];

const SETTINGS: [RegExp, string, string][] = [
  [/\b(forest|woods)\b/i, "the forest", "dense trees, shafts of light, soft moss underfoot"],
  [/\bbeach\b/i, "the beach", "wide sand, breaking waves, wind in the dune grass"],
  [/\b(apartment|flat)\b/i, "the apartment", "small lived-in rooms, window light, personal clutter"],
  [/\bdiner\b/i, "the diner", "chrome counter, red booths, neon sign, coffee steam"],
  [/\b(subway|metro|train)\b/i, "the subway", "tiled platform, fluorescent light, passing trains"],
  [/\b(rooftop)\b/i, "the rooftop", "gravel roof, skyline behind, string lights"],
  [/\b(office)\b/i, "the office", "glass partitions, monitors, cool overhead light"],
  [/\b(kitchen|restaurant|cafe|café|coffee shop)\b/i, "the café", "warm wood, steam, rain on the window"],
  [/\b(desert)\b/i, "the desert", "endless dunes, heat shimmer, a hard blue sky"],
  [/\b(space|spaceship|station)\b/i, "the station", "corridors of brushed metal, blinking panels, starfield windows"],
  [/\b(castle|kingdom)\b/i, "the castle", "stone halls, torchlight, banners in the draft"],
  [/\b(hospital)\b/i, "the hospital", "long pale corridors, humming lights"],
  [/\b(car|highway|road)\b/i, "the road", "night highway, headlights, passing sodium lamps"],
  [/\b(gym)\b/i, "the gym", "racks of iron, mirrors, harsh spotlights"],
  [/\b(school|campus|college)\b/i, "the campus", "brick and lawns, lockers, late afternoon light"],
  [/\b(club|bar)\b/i, "the club", "strobes, haze, bodies in colour"],
  [/\b(house|home)\b/i, "the house", "a quiet family house, lamps on, floorboards"],
  [/\b(street|city|downtown)\b/i, "the city streets", "crosswalks, taxis, neon and steam"],
  [/\b(studio)\b/i, "the studio", "seamless backdrop, softboxes, clean floor"],
  [/\b(lab|laboratory)\b/i, "the lab", "glass, steel benches, cold blue light"],
];

const PEOPLE: [RegExp, { name: string; role: string; description: string }[]][] = [
  [
    /\bcouple\b|\btwo lovers\b|\blovers\b/i,
    [
      { name: "Nora", role: "Lead", description: "late 20s, dark curls, red wool coat over a cream sweater, gold hoop earrings" },
      { name: "Eli", role: "Lead", description: "early 30s, close-cropped hair, navy peacoat, grey scarf, a worn leather satchel" },
    ],
  ],
  [/\bdetective\b/i, [{ name: "Detective Hale", role: "Lead", description: "40s, weathered face, rumpled trench coat, loosened tie" }]],
  [/\bchef\b/i, [{ name: "Chef Marisol", role: "Lead", description: "30s, sleeves rolled, white chef's jacket, a burn scar on one wrist" }]],
  [/\bastronaut\b/i, [{ name: "Commander Ruiz", role: "Lead", description: "40s, cropped grey hair, white EVA suit with orange trim" }]],
  [/\bathlete\b|\brunner\b|\bboxer\b/i, [{ name: "Jules", role: "Lead", description: "20s, athletic build, black training kit, taped wrists" }]],
  [/\bchild\b|\bkid\b|\bboy\b|\bgirl\b/i, [{ name: "Milo", role: "Lead", description: "9 years old, oversized yellow raincoat, scuffed sneakers" }]],
  [/\b(woman|she|her|girl|mother|wife|bride)\b/i, [{ name: "Nora", role: "Lead", description: "late 20s, dark curls, red wool coat, gold hoop earrings" }]],
  [/\b(man|he|him|guy|father|husband|groom)\b/i, [{ name: "Eli", role: "Lead", description: "early 30s, close-cropped hair, navy peacoat, grey scarf" }]],
  [/\b(dog|puppy)\b/i, [{ name: "Biscuit", role: "Companion", description: "a scruffy golden terrier with one floppy ear" }]],
  [/\b(robot|android)\b/i, [{ name: "Unit 7", role: "Lead", description: "a slender white android with a single amber eye-light" }]],
];

function properNouns(idea: string): string[] {
  const words = idea.replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w || i === 0) continue;
    if (/^[A-Z][a-z]+$/.test(w) && !STOP.has(w.toLowerCase())) out.push(w);
  }
  return Array.from(new Set(out));
}

function findPlaces(idea: string): string[] {
  const lower = idea.toLowerCase();
  return PLACES.filter((p) => new RegExp(`\\b${p.replace(/ /g, "\\s+")}\\b`).test(lower)).map(titleCase);
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\bNyc\b/, "New York").replace(/\bLa\b/, "Los Angeles");
}

function cleanIdea(idea: string): string {
  return idea
    .replace(/^\s*(please\s+)?(create|make|generate|produce|write|shoot|film)\s+(me\s+)?(a|an|the)?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ----- develop -------------------------------------------------------------

export function heuristicDevelop(project: Project): Development {
  const template = templateById(project.templateId);
  const genres = project.genreIds.map(genreById).filter((g): g is Genre => Boolean(g));
  const idea = cleanIdea(project.idea) || `an untitled ${template.name.toLowerCase()}`;

  const characters = deriveCharacters(project.idea, project.references, template);
  const worlds = deriveWorlds(project.idea, project.references, genres, template);
  const style = deriveStyle(genres, template, project.references);
  const concept = deriveConcept(idea, characters, worlds, genres, template);
  const title = deriveTitle(idea, characters, worlds, genres);

  return { title, concept, characters, worlds, style };
}

function deriveCharacters(idea: string, refs: Reference[], template: Template): Character[] {
  const out: Character[] = [];
  // Words that belong to a place name ("New York") are not people.
  const placeWords = new Set(findPlaces(idea).flatMap((p) => p.split(" ")));
  const names = properNouns(idea).filter((n) => !placeWords.has(n));

  // Named people in the idea come first, with a plain description to fill in.
  for (const n of names.slice(0, 3)) {
    out.push({
      id: id("chr"),
      name: n,
      role: out.length === 0 ? "Lead" : "Supporting",
      description: "distinctive, consistent wardrobe across every shot",
      manner: "",
      referenceIds: [],
    });
  }

  // Then the archetypes the idea implies.
  for (const [re, people] of PEOPLE) {
    if (out.length >= 3) break;
    if (!re.test(idea)) continue;
    for (const p of people) {
      if (out.some((c) => c.name === p.name)) continue;
      out.push({ id: id("chr"), name: p.name, role: p.role, description: p.description, manner: "", referenceIds: [] });
    }
    // A couple settles the cast; a lone pronoun does not add a second lead.
    if (people.length === 2) break;
  }

  // Character references become characters if none were found.
  const charRefs = refs.filter((r) => r.kind === "character");
  for (const r of charRefs) {
    if (out.some((c) => c.referenceIds.includes(r.id))) continue;
    const existing = out.find((c) => !c.referenceIds.length);
    if (existing) {
      existing.referenceIds.push(r.id);
      if (r.description) existing.description = r.description;
    } else {
      out.push({
        id: id("chr"),
        name: r.name.replace(/\.[a-z0-9]+$/i, "") || "Lead",
        role: out.length === 0 ? "Lead" : "Supporting",
        description: r.description || "as shown in the reference image",
        manner: "",
        referenceIds: [r.id],
      });
    }
  }

  if (!out.length && template.id !== "product-ad") {
    out.push({
      id: id("chr"),
      name: "Lead",
      role: "Lead",
      description: "30s, striking features, simple dark wardrobe that reads clearly on camera",
      manner: "",
      referenceIds: [],
    });
  }
  return out;
}

function deriveWorlds(idea: string, refs: Reference[], genres: Genre[], template: Template): World[] {
  const out: World[] = [];
  const timeOfDay = defaultTimeOfDay(genres, template);

  for (const place of findPlaces(idea).slice(0, 2)) {
    out.push({
      id: id("wld"),
      name: place,
      description: `${place} at street level, its real architecture, traffic and weather`,
      timeOfDay,
      referenceIds: [],
    });
  }
  for (const [re, name, description] of SETTINGS) {
    if (out.length >= 3) break;
    if (re.test(idea) && !out.some((w) => w.name === name)) {
      out.push({ id: id("wld"), name, description, timeOfDay, referenceIds: [] });
    }
  }
  for (const r of refs.filter((x) => x.kind === "location")) {
    const bare = out.find((w) => !w.referenceIds.length);
    if (bare) {
      bare.referenceIds.push(r.id);
      if (r.description) bare.description = r.description;
    } else {
      out.push({
        id: id("wld"),
        name: r.name.replace(/\.[a-z0-9]+$/i, "") || "Location",
        description: r.description || "as shown in the reference image",
        timeOfDay,
        referenceIds: [r.id],
      });
    }
  }
  if (!out.length) {
    out.push({
      id: id("wld"),
      name: template.id === "product-ad" ? "The studio" : "The city",
      description:
        template.id === "product-ad"
          ? "seamless dark backdrop, a single polished surface, controlled studio light"
          : "a real city at human scale, wet streets, storefront light, passing figures",
      timeOfDay,
      referenceIds: [],
    });
  }
  return out;
}

function defaultTimeOfDay(genres: Genre[], template: Template): string {
  const g = genres[0]?.id;
  if (g === "horror" || g === "noir" || g === "crime" || g === "thriller") return "night";
  if (g === "romance" || g === "emotional" || g === "coming-of-age") return "golden hour into dusk";
  if (template.id === "travel" || g === "adventure") return "golden hour";
  if (template.id === "product-ad" || template.id === "explainer") return "timeless studio light";
  return "late afternoon";
}

function deriveStyle(genres: Genre[], template: Template, refs: Reference[]): Style {
  const g = genres[0];
  const styleRefs = refs.filter((r) => r.kind === "style");
  const lookName = g ? `${g.name} ${template.name.toLowerCase()}` : template.name;
  return {
    lookName,
    palette: g?.palette ?? "restrained, filmic colour",
    lighting: g?.lighting ?? "motivated natural light",
    cameraLanguage: g?.camera ?? "classic coverage, shallow focus",
    grade: styleRefs[0]?.description ? `graded to match: ${styleRefs[0].description}` : "subtle film grain, soft highlight roll-off",
    pacing: template.pacing,
    referenceIds: styleRefs.map((r) => r.id),
  };
}

function deriveConcept(idea: string, cast: Character[], worlds: World[], genres: Genre[], template: Template): Concept {
  const lead = cast[0]?.name ?? "someone";
  const second = cast[1]?.name;
  const where = worlds[0]?.name ?? "a city";
  const g = genres[0];
  const logline = idea.charAt(0).toUpperCase() + idea.slice(1);
  const synopsis =
    `${lead}${second ? ` and ${second}` : ""} in ${where}. ` +
    `A ${template.name.toLowerCase()}${g ? ` with a ${g.name.toLowerCase()} feel` : ""}, ` +
    `told in ${template.beats.length} beats: ${template.beats.join(", ").toLowerCase()}.`;
  return {
    logline,
    synopsis,
    theme: g ? g.tone : "connection",
    tone: g ? g.tone : template.production,
    structure: [...template.beats],
  };
}

function deriveTitle(idea: string, cast: Character[], worlds: World[], genres: Genre[]): string {
  const place = worlds[0]?.name;
  const lead = cast[0]?.name;
  if (place && !/^the /i.test(place)) return `${place} ${genres[0]?.id === "romance" ? "Nights" : "Story"}`;
  if (lead && lead !== "Lead") return `${lead}`;
  const words = cleanIdea(idea).split(" ").filter((w) => !STOP.has(w.toLowerCase())).slice(0, 3);
  return words.length ? titleCase(words.join(" ")) : "Untitled";
}

// ----- breakdown -----------------------------------------------------------

const ANGLES: CameraAngle[] = ["eye level", "low angle", "eye level", "over the shoulder", "high angle", "eye level", "POV"];

function pickMovement(genres: Genre[], i: number, framing: Framing): CameraMovement {
  const pool = genres[0]?.movements ?? ["push in", "static", "tracking"];
  const m = pool[i % pool.length];
  // A crane rise on a close-up is a mistake a director would not make.
  if ((m === "crane up" || m === "crane down" || m === "orbit") && (framing === "close-up" || framing === "extreme close-up")) {
    return "push in";
  }
  return m;
}

function lensFor(framing: Framing, style: Style | null): string {
  const ana = /anamorphic/i.test(style?.cameraLanguage ?? "");
  switch (framing) {
    case "extreme wide":
    case "wide":
      return ana ? "anamorphic 24mm, deep focus" : "24mm, deep focus";
    case "medium wide":
    case "medium":
      return ana ? "anamorphic 40mm" : "35mm, natural perspective";
    case "medium close-up":
    case "close-up":
      return "85mm, shallow focus";
    case "extreme close-up":
    case "insert":
      return "100mm macro, razor-thin focus";
  }
}

/** Shot count the template's running time implies, clamped to a real board. */
export function shotCountFor(project: Project): number {
  const template = templateById(project.templateId);
  const target = project.targetDurationSec || template.targetSec;
  return Math.max(4, Math.min(14, Math.round(target / template.shotSec)));
}

export function heuristicBreakdown(project: Project): Scene[] {
  const template = templateById(project.templateId);
  const genres = project.genreIds.map(genreById).filter((g): g is Genre => Boolean(g));
  const beats = project.concept?.structure?.length ? project.concept.structure : template.beats;
  const total = shotCountFor(project);
  const shotSec = Math.max(MIN_SHOT_SEC, Math.min(MAX_SHOT_SEC, template.shotSec));

  // Spread shots across beats: every beat gets at least one, the climax gets more.
  const perBeat = beats.map(() => 1);
  let remaining = total - beats.length;
  let k = 0;
  while (remaining > 0) {
    // Favour the later, bigger beats.
    const idx = (beats.length - 1 - (k % beats.length) + beats.length) % beats.length;
    perBeat[idx] += 1;
    remaining -= 1;
    k += 1;
  }

  const cast = project.characters;
  const worlds = project.worlds;
  const scenes: Scene[] = [];
  let shotNo = 0;
  let prev: Shot | null = null;

  beats.forEach((beat, bi) => {
    const world = worlds[bi % Math.max(1, worlds.length)] ?? null;
    const sceneCast = cast.slice(0, bi === 0 && cast.length > 1 && template.id === "short-film" ? 1 : cast.length);
    const mood = moodFor(beat, genres, bi, beats.length);
    const timeOfDay = world?.timeOfDay ?? "";
    const scene: Scene = {
      id: id("scn"),
      title: beat,
      summary: sceneSummary(beat, sceneCast, world, template),
      worldId: world?.id ?? null,
      characterIds: sceneCast.map((c) => c.id),
      timeOfDay,
      mood,
      shots: [],
    };

    for (let s = 0; s < perBeat[bi]; s++) {
      const framing = s === 0 && bi === 0 ? "wide" : COVERAGE_ORDER[(shotNo + 1) % COVERAGE_ORDER.length];
      const movement = pickMovement(genres, shotNo, framing);
      const camera: Camera = {
        angle: ANGLES[shotNo % ANGLES.length],
        movement,
        framing,
        lens: lensFor(framing, project.style),
      };
      const shotCast = framing === "insert" ? [] : sceneCast.slice(0, framing.includes("close") ? 1 : sceneCast.length);
      const shot: Shot = {
        id: id("sht"),
        title: `${beat} — ${framing}`,
        description: shotDescription(beat, s, perBeat[bi], shotCast, world, framing, genres),
        action: shotAction(beat, s, shotCast, framing, genres),
        camera,
        lighting: lightingFor(genres, timeOfDay, framing),
        expression: expressionFor(beat, genres),
        dialogue: "",
        characterIds: shotCast.map((c) => c.id),
        worldId: world?.id ?? null,
        durationSec: shotSec,
        referenceIds: [],
        continuity: prev ? continuityLine(prev, shotCast, world, project) : "",
        prompt: { text: "", cameraLine: "", soundscape: "", music: "", references: [], notes: "" },
        promptEdited: false,
        takes: [],
        activeTakeId: null,
      };
      scene.shots.push(shot);
      prev = shot;
      shotNo += 1;
    }
    scenes.push(scene);
  });

  return scenes;
}

function moodFor(beat: string, genres: Genre[], i: number, n: number): string {
  const base = genres[0]?.tone ?? "quiet, cinematic";
  const pos = i / Math.max(1, n - 1);
  if (pos < 0.2) return `calm, ${base}`;
  if (pos < 0.7) return `building, ${base}`;
  if (pos < 0.9) return `peak intensity, ${base}`;
  return `settled, ${base}`;
}

function sceneSummary(beat: string, cast: Character[], world: World | null, template: Template): string {
  const who = cast.length ? cast.map((c) => c.name).join(" and ") : template.id === "product-ad" ? "the product" : "the subject";
  const where = world ? ` in ${world.name}` : "";
  return `${beat}: ${who}${where}.`;
}

const BEAT_ACTIONS: Record<string, string[]> = {
  establish: ["stands still, taking in the place", "walks into frame, unhurried"],
  meet: ["looks up and notices someone across the space", "nearly collides, then both stop"],
  spark: ["laughs, guard dropping", "leans in to hear better"],
  complication: ["turns away, jaw tight", "checks a phone, face falling"],
  turn: ["stops mid-step, decides", "sets something down and looks up"],
  climax: ["runs, breath visible", "reaches out"],
  resolution: ["exhales, shoulders easing", "walks away slower than before"],
  hook: ["looks straight down the lens", "does the one thing you did not expect"],
  problem: ["struggles with it, frustrated", "sighs at the mess"],
  reveal: ["holds it up to the light", "unboxes it slowly"],
  payoff: ["smiles, finally", "nods once, satisfied"],
  brand: ["steps back to admire it", "sets it on the table, centred"],
  tease: ["a hand reaches into frame", "light catches an edge"],
  detail: ["fingers trace the surface", "rotates it slowly"],
  "in use": ["uses it with practiced ease", "hands it to someone"],
  hero: ["it sits alone, perfectly lit", "rotates a quarter turn and stops"],
  normal: ["goes about an ordinary evening", "sets a kettle on"],
  wrong: ["stops, hearing something", "turns toward the dark hallway"],
  search: ["moves slowly through the dark, one hand on the wall", "opens a door a crack"],
  scare: ["recoils, mouth open", "the lights cut out"],
  aftermath: ["sits on the floor, shaking", "stares at nothing"],
  calm: ["goes about a normal morning", "waves to a neighbour"],
  disruption: ["the sky changes", "the phone rings and everyone freezes"],
  escalation: ["sprints across the frame", "braces against the shockwave"],
  montage: ["a rush of moments", "a hand grabs another"],
  title: ["a title card over black", "the name in steel letters"],
  button: ["a last look, a half-smile", "one final beat of silence"],
  intro: ["stands in the light, waiting for the beat", "walks toward the camera"],
  verse: ["sings to the camera, restrained", "moves through the space singing"],
  build: ["dances, building energy", "the crowd starts to move"],
  chorus: ["full performance, arms wide", "the whole room in motion"],
  bridge: ["alone, quiet, singing softly", "looks out a window"],
  "final chorus": ["everything at once, confetti, light", "the last note held"],
  place: ["the landscape breathes", "a street wakes up"],
  person: ["works with their hands", "speaks to someone off-camera"],
  process: ["repeats a practiced motion", "checks their work"],
  moment: ["pauses, caught off guard", "laughs unexpectedly"],
  reflection: ["looks into the distance", "closes a door gently"],
  arrival: ["steps out into the light", "sets down a bag and looks around"],
  pose: ["holds a pose, fabric settling", "turns, coat swinging"],
  motion: ["walks with attitude", "spins, fabric flaring"],
  exit: ["walks away without looking back", "steps out of frame"],
  streets: ["moves through a crowd", "crosses at the lights"],
  people: ["shares food with strangers", "an old man laughs"],
  "golden hour": ["stands on a ridge as the sun drops", "the whole town turns gold"],
  night: ["neon flickers on", "walks a lit street alone"],
  coverage: ["speaks, measured", "listens, unmoving"],
  reaction: ["their face changes", "a breath catches"],
  beat: ["a long pause", "something small and true happens"],
  out: ["turns and leaves", "the door closes"],
  question: ["holds up the thing in question", "gestures at the problem"],
  step: ["demonstrates the next step clearly", "points to the key part"],
  result: ["shows the finished result", "steps back, done"],
  show: ["holds it up to the camera", "uses it right there"],
  proof: ["shows the before and after", "reads the result out loud"],
  "call to action": ["points at the camera", "grins and nods"],
};

function shotAction(beat: string, s: number, cast: Character[], framing: Framing, genres: Genre[]): string {
  const key = beat.toLowerCase();
  const pool = BEAT_ACTIONS[key] ?? ["holds still, thinking", "moves through the space"];
  const base = pool[s % pool.length];
  if (framing === "insert" || framing === "extreme close-up") {
    return cast.length ? `${base}; the frame holds on a single telling detail` : "a single telling detail fills the frame";
  }
  if (!cast.length) return base;
  const g = genres[0]?.id;
  const flavour = g === "action" ? ", fast" : g === "horror" ? ", too slowly" : g === "comedy" ? ", with comic timing" : "";
  return `${base}${flavour}`;
}

function shotDescription(
  beat: string,
  s: number,
  n: number,
  cast: Character[],
  world: World | null,
  framing: Framing,
  genres: Genre[],
): string {
  const who = cast.length ? cast.map((c) => c.name).join(" and ") : "the subject";
  const where = world ? ` in ${world.name}` : "";
  const part = n > 1 ? ` (${s + 1} of ${n})` : "";
  const feel = genres[0] ? `, ${genres[0].tone.split(",")[0]}` : "";
  return `${beat}${part}: ${framing} on ${who}${where}${feel}.`;
}

function lightingFor(genres: Genre[], timeOfDay: string, framing: Framing): string {
  const base = genres[0]?.lighting ?? "soft motivated light";
  const close = framing.includes("close") ? ", gentle key on the face, catchlights in the eyes" : "";
  return `${base}${timeOfDay ? `, ${timeOfDay}` : ""}${close}`;
}

function expressionFor(beat: string, genres: Genre[]): string {
  const key = beat.toLowerCase();
  if (/meet|spark|payoff|final|chorus|result/.test(key)) return "open, a smile starting";
  if (/complication|problem|wrong|search|disruption/.test(key)) return "worried, watchful";
  if (/climax|scare|escalation/.test(key)) return "wide-eyed, breath held";
  if (/resolution|reflection|aftermath|bridge/.test(key)) return "quiet, unguarded";
  if (genres[0]?.id === "comedy") return "deadpan";
  return "";
}

function continuityLine(prev: Shot, cast: Character[], world: World | null, project: Project): string {
  const bits: string[] = [];
  for (const c of cast) {
    if (prev.characterIds.includes(c.id)) bits.push(`${c.name} wears exactly the same outfit as the previous shot`);
  }
  if (world && prev.worldId === world.id) bits.push(`same location and lighting as the previous shot`);
  else if (world) bits.push(`we have moved to ${world.name}`);
  if (project.style?.grade) bits.push("same colour grade throughout");
  return bits.join("; ") + (bits.length ? "." : "");
}
