// ---------------------------------------------------------------------------
// The offline director.
//
// Turns a prompt into a full plan without any AI key: finds the characters and
// settings the prompt mentions, breaks the story into beats sized to the
// requested length, gives every scene a camera, lighting and actions, and
// routes each action to Mixamo, Cascadeur or Blender with motion.ts. The AI
// director does the same job with more imagination; this one is predictable,
// instant, and always available.
// ---------------------------------------------------------------------------

import { styleById, type Brief, type CameraMove, type DirectorPlan, type SubjectKind } from "../types";
import { BLENDER_TRIGGERS, CREATURE_WORDS, OBJECT_WORDS, routeMotion, subjectKind } from "./motion";
import { normalizePlan } from "./normalize";

const HUMAN_WORDS = [
  "robot", "girl", "boy", "kid", "child", "man", "woman", "astronaut", "chef", "knight", "wizard", "witch", "scientist",
  "teacher", "student", "alien", "monster", "dancer", "ninja", "pirate", "princess", "prince", "king", "queen", "farmer",
  "detective", "doctor", "superhero", "hero", "villain", "explorer", "athlete", "soldier", "zombie", "ghost", "elf",
  "grandma", "grandpa", "baby", "cowboy", "musician", "singer", "gamer", "presenter", "host", "penguin", "bear", "panda",
  "character", "mascot", "person", "friend", "friends", "family", "couple", "team",
];

const MOVING_OBJECTS = OBJECT_WORDS.filter((w) =>
  ["car", "truck", "bus", "train", "plane", "airplane", "jet", "rocket", "spaceship", "ship", "boat", "submarine", "bike", "bicycle", "motorcycle", "drone", "balloon", "ball", "meteor", "asteroid", "satellite"].includes(w),
);

interface Setting {
  keys: string[];
  name: string;
  description: string;
  props: string[];
  sky: string;
  ground: string;
  fog: string;
  timeOfDay: "day" | "golden" | "night";
}

const SETTINGS: Setting[] = [
  { keys: ["space", "galaxy", "stars", "orbit", "cosmos"], name: "Deep space", description: "A star field with a glowing planet on the horizon.", props: ["stars", "planet"], sky: "#0b1026", ground: "#1f2547", fog: "#141a3a", timeOfDay: "night" },
  { keys: ["moon", "lunar", "mars", "planet"], name: "Alien surface", description: "Cratered dusty ground under a black sky.", props: ["rocks", "stars", "planet"], sky: "#10142b", ground: "#8d8a86", fog: "#232849", timeOfDay: "night" },
  { keys: ["city", "street", "downtown", "town", "rooftop", "neon"], name: "City street", description: "A lively street lined with stylised buildings.", props: ["buildings", "lamps"], sky: "#9cc9ff", ground: "#6b7280", fog: "#c7ddf5", timeOfDay: "day" },
  { keys: ["forest", "woods", "jungle", "trees"], name: "Forest glade", description: "Tall trees around a sunlit clearing.", props: ["trees", "rocks"], sky: "#a8e6cf", ground: "#5c8d4a", fog: "#cfe8d5", timeOfDay: "day" },
  { keys: ["beach", "ocean", "sea", "island", "shore"], name: "Beach", description: "Sand, gentle waves and a wide horizon.", props: ["palms", "water"], sky: "#8fd3fe", ground: "#f1d9a7", fog: "#d4efff", timeOfDay: "day" },
  { keys: ["underwater", "reef", "deep sea"], name: "Coral reef", description: "Blue water, coral and drifting light rays.", props: ["coral", "bubbles"], sky: "#0e5a8a", ground: "#e0c68f", fog: "#1478a8", timeOfDay: "day" },
  { keys: ["desert", "dunes", "canyon"], name: "Desert", description: "Rolling dunes and red rock under a hot sky.", props: ["rocks", "cactus"], sky: "#ffd29d", ground: "#e2a76f", fog: "#ffe3bf", timeOfDay: "golden" },
  { keys: ["snow", "winter", "arctic", "mountain", "mountains", "ice"], name: "Snowy peaks", description: "Snow fields and mountains in crisp air.", props: ["mountains", "pines"], sky: "#cfe6ff", ground: "#f4f8fb", fog: "#e6f0fa", timeOfDay: "day" },
  { keys: ["kitchen", "restaurant", "bakery", "cafe"], name: "Kitchen", description: "A warm kitchen with counters and hanging pans.", props: ["counter", "shelves"], sky: "#f5e6d3", ground: "#b7825a", fog: "#f5e6d3", timeOfDay: "day" },
  { keys: ["classroom", "school", "library"], name: "Classroom", description: "Desks, a board and big windows.", props: ["desks", "board"], sky: "#e8eefc", ground: "#c49a6c", fog: "#e8eefc", timeOfDay: "day" },
  { keys: ["lab", "laboratory", "factory", "workshop", "garage"], name: "Workshop lab", description: "Workbenches, screens and tools.", props: ["benches", "screens"], sky: "#d6e4f0", ground: "#8795a1", fog: "#d6e4f0", timeOfDay: "day" },
  { keys: ["castle", "kingdom", "medieval", "village"], name: "Castle grounds", description: "Stone walls and banners on a green hill.", props: ["towers", "trees"], sky: "#b5d8ff", ground: "#7fb069", fog: "#dcecff", timeOfDay: "golden" },
  { keys: ["stage", "concert", "club", "party", "studio"], name: "Stage", description: "A performance stage with coloured spotlights.", props: ["spotlights", "platform"], sky: "#1b1030", ground: "#2c2440", fog: "#3a2a5a", timeOfDay: "night" },
  { keys: ["office", "meeting", "startup"], name: "Office", description: "Open-plan desks and a glass meeting room.", props: ["desks", "screens"], sky: "#e5ecf4", ground: "#9aa5b1", fog: "#e5ecf4", timeOfDay: "day" },
  { keys: ["park", "garden", "meadow", "field", "farm"], name: "Park meadow", description: "Grass, flowers and a winding path.", props: ["trees", "flowers"], sky: "#9fd8ff", ground: "#7cc26b", fog: "#d7f0ff", timeOfDay: "day" },
  { keys: ["bedroom", "house", "home", "living room"], name: "Cosy room", description: "A cosy room with a bed, lamp and window.", props: ["furniture", "lamps"], sky: "#fbe8d3", ground: "#a47551", fog: "#fbe8d3", timeOfDay: "golden" },
  { keys: ["night", "midnight", "dark"], name: "Night scene", description: "A moonlit setting with long shadows.", props: ["stars", "lamps"], sky: "#141b3d", ground: "#2e3a59", fog: "#1d2750", timeOfDay: "night" },
];

const GENRES: { genre: string; keys: string[]; pacing: string }[] = [
  { genre: "Explainer", keys: ["how", "why", "explain", "learn", "lesson", "tutorial", "facts", "science", "history", "works", "guide", "teach"], pacing: "Clear beats, one idea per scene" },
  { genre: "Comedy", keys: ["funny", "silly", "prank", "joke", "comedy", "hilarious", "clumsy"], pacing: "Quick set-ups, pauses before punchlines" },
  { genre: "Action", keys: ["fight", "battle", "chase", "race", "escape", "heist", "ninja", "superhero"], pacing: "Fast cuts building to a peak" },
  { genre: "Music video", keys: ["dance", "song", "music", "beat", "concert", "sing"], pacing: "Cut on the beat" },
  { genre: "Adventure", keys: ["journey", "quest", "explore", "adventure", "discover", "space", "treasure", "travel"], pacing: "Wide reveals, rising momentum" },
  { genre: "Ad / promo", keys: ["product", "brand", "launch", "promo", "ad", "commercial", "app", "sale"], pacing: "Hook in 2 seconds, end on the call to action" },
];

const BEATS = ["Opening", "Setup", "Discovery", "Rising action", "Turning point", "Climax", "Resolution", "Closing"];

function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return t;
  return t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".");
}

function has(text: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}s?\\b`, "i").test(text);
}

export function sceneCountFor(lengthSec: number): number {
  if (lengthSec <= 15) return 3;
  if (lengthSec <= 30) return 4;
  if (lengthSec <= 60) return 6;
  return 8;
}

/** Split a prompt into story clauses. */
export function clauses(prompt: string): string[] {
  return prompt
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;])\s+|\s+(?:and then|then|after that|finally|until|before|when)\s+|,\s+(?:and\s+|but\s+|so\s+)?/i)
    .map((c) =>
      c
        .replace(/^(?:(?:and then|then|after that|finally|and|but|so)\s+)+/i, "")
        .replace(/[.!?;]+$/, "")
        .trim(),
    )
    .filter((c) => c.split(" ").length >= 2);
}

function cleanTopic(prompt: string): string {
  return prompt
    .replace(/^\s*(please\s+)?(make|create|generate|build|render|animate)\s+(me\s+)?/i, "")
    .replace(/^(an?|the)\s+/i, "")
    .replace(/^((short|animated|3d|cartoon|funny|cute|cinematic)\s+)*(video|animation|film|short|movie|clip|story)\s+(about|of|where|showing|in which)\s+/i, "")
    .trim();
}

export function makeTitle(prompt: string): string {
  const first = clauses(cleanTopic(prompt))[0] ?? cleanTopic(prompt);
  const words = first.replace(/^(an?|the)\s+/i, "").split(/\s+/).slice(0, 6).join(" ");
  return titleCase(words.replace(/[^\w\s'-]/g, "")) || "Untitled Video";
}

interface FoundCharacter {
  noun: string;
  name: string;
  kind: SubjectKind;
  description: string;
}

export function findCharacters(prompt: string): FoundCharacter[] {
  const found: FoundCharacter[] = [];
  const nouns = [...HUMAN_WORDS, ...CREATURE_WORDS, ...MOVING_OBJECTS];
  const re = new RegExp(
    `\\b(?:(?:an?|the|one|two|three|some|his|her|their|my|our)\\s+)((?:[a-z-]+\\s+){0,2}?)(${nouns.map((n) => n.replace(/-/g, "\\-")).join("|")})s?\\b`,
    "gi",
  );
  for (const m of prompt.matchAll(re)) {
    const noun = m[2].toLowerCase();
    if (found.some((f) => f.noun === noun)) continue;
    const adjectives = (m[1] ?? "")
      .trim()
      .split(/\s+/)
      .filter((w) => w && !["who", "that", "which", "is", "was", "and", "with"].includes(w.toLowerCase()));
    const name = titleCase([...adjectives, noun].join(" "));
    // Look just past the mention to spot "a fox who talks". Only for animals:
    // running subjectKind over the whole neighbourhood would let a nearby
    // object ("a dog chases a balloon") turn the dog into an object.
    const after = prompt.slice(m.index ?? 0, (m.index ?? 0) + m[0].length + 30);
    const kind: SubjectKind = MOVING_OBJECTS.includes(noun)
      ? "object"
      : HUMAN_WORDS.includes(noun)
        ? "humanoid"
        : subjectKind(after.replace(new RegExp(OBJECT_WORDS.join("|"), "gi"), ""));
    found.push({ noun, name, kind, description: sentence(m[0]) });
    if (found.length >= 4) break;
  }
  return found;
}

export function findSettings(prompt: string): Setting[] {
  const hits = SETTINGS.map((s) => ({ s, at: Math.min(...s.keys.map((k) => { const i = prompt.toLowerCase().search(new RegExp(`\\b${k}`)); return i < 0 ? Infinity : i; })) }))
    .filter((h) => Number.isFinite(h.at))
    .sort((a, b) => a.at - b.at)
    .map((h) => h.s);
  // "space" and "moon" both hit for a moon landing; keep both, they read as two sets.
  return hits.slice(0, 3);
}

function cameraFor(position: "first" | "last" | "middle", motion: string, index: number): { move: CameraMove; lens: number; framing: string } {
  if (position === "first") return { move: "crane-up", lens: 24, framing: "wide establishing shot" };
  if (position === "last") return { move: "dolly-out", lens: 35, framing: "wide closing shot" };
  if (["run", "fight", "flip", "fall", "drive", "fly", "climb", "chase"].includes(motion)) return { move: index % 2 ? "handheld" : "tracking", lens: 28, framing: "full body, following the action" };
  if (["dance", "cheer", "jump", "spin"].includes(motion)) return { move: "orbit", lens: 35, framing: "full body, circling" };
  if (["talk", "think", "sad", "laugh", "look"].includes(motion)) return { move: "dolly-in", lens: 50, framing: "medium close-up" };
  return { move: index % 2 ? "pan" : "static", lens: 35, framing: "medium shot" };
}

export function directHeuristic(prompt: string, brief: Brief): DirectorPlan {
  const style = styleById(brief.style);
  const text = prompt.trim();
  const lower = text.toLowerCase();

  const genre = GENRES.find((g) => g.keys.some((k) => has(lower, k))) ?? { genre: "Animated short", pacing: "Steady, with a clear beginning, middle and end" };

  // ----- cast
  const found = findCharacters(text);
  const characters = found.map((f, i) => ({ id: `c${i + 1}`, name: f.name, kind: f.kind, description: f.description }));
  if (!characters.some((c) => c.kind !== "object")) {
    characters.unshift({
      id: "host",
      name: genre.genre === "Explainer" ? "Guide" : "Hero",
      kind: "humanoid",
      description: genre.genre === "Explainer" ? "A friendly guide who walks the viewer through the topic." : "The story's lead character.",
    });
  }
  const lead = characters.find((c) => c.kind !== "object") ?? characters[0];
  const nounOf = new Map(found.map((f, i) => [`c${i + 1}`, f.noun]));

  // ----- sets
  const settings = findSettings(text);
  const environments = (settings.length ? settings : []).map((s, i) => ({
    id: `e${i + 1}`,
    name: s.name,
    description: s.description,
    props: s.props,
    palette: { sky: s.sky, ground: s.ground, fog: s.fog },
    timeOfDay: s.timeOfDay,
  }));
  if (!environments.length) {
    environments.push({
      id: "e1",
      name: "Stylised stage",
      description: "A clean set in the chosen style, dressed to suit the topic.",
      props: ["platform", "shapes"],
      palette: { sky: style.palette[0], ground: style.palette[1], fog: style.palette[0] },
      timeOfDay: "day",
    });
  }
  const envFor = (clause: string, fallback: string) => {
    const i = settings.findIndex((s) => s.keys.some((k) => has(clause, k)));
    return i >= 0 ? environments[i].id : fallback;
  };

  // ----- beats
  const n = sceneCountFor(brief.lengthSec);
  let story = clauses(cleanTopic(text));
  if (!story.length) story = [cleanTopic(text) || text];

  type Slot = { beat: string; lines: string[]; synthetic?: "opening" | "closing" | "reaction" };
  let slots: Slot[] = story.map((l) => ({ beat: "", lines: [l] }));
  if (slots.length > n) {
    // Merge neighbouring clauses into n scenes.
    const merged: Slot[] = Array.from({ length: n }, () => ({ beat: "", lines: [] }));
    slots.forEach((s, i) => merged[Math.min(n - 1, Math.floor((i * n) / slots.length))].lines.push(...s.lines));
    slots = merged;
  } else {
    if (slots.length < n) slots.unshift({ beat: "", lines: [], synthetic: "opening" });
    if (slots.length < n) slots.push({ beat: "", lines: [], synthetic: "closing" });
    while (slots.length < n) slots.splice(slots.length - 1, 0, { beat: "", lines: [], synthetic: "reaction" });
  }
  const beatNames = n >= BEATS.length ? BEATS : [BEATS[0], ...BEATS.slice(1, -1).filter((_, i, a) => i % Math.ceil(a.length / (n - 2)) === 0).slice(0, n - 2), BEATS[BEATS.length - 1]];

  let currentEnv = environments[0].id;
  const scenes = slots.map((slot, i) => {
    const position = i === 0 ? "first" : i === slots.length - 1 ? "last" : "middle";
    const joined = slot.lines.join(". ");
    currentEnv = joined ? envFor(joined, currentEnv) : currentEnv;
    const env = environments.find((e) => e.id === currentEnv)!;

    const actions = [] as { id: string; characterId: string; description: string; motion: string; tool: "mixamo" | "cascadeur" | "blender"; clip?: string; reason: string }[];
    const addAction = (characterId: string, description: string) => {
      const kind = characters.find((c) => c.id === characterId)?.kind ?? "humanoid";
      const r = routeMotion(description, kind);
      actions.push({ id: `a${actions.length + 1}`, characterId, description, motion: r.motion, tool: r.tool, clip: r.clip, reason: r.reason });
    };

    if (slot.synthetic === "opening") {
      addAction(lead.id, `${lead.name} looks around ${env.name.toLowerCase()}`);
    } else if (slot.synthetic === "closing") {
      addAction(lead.id, `${lead.name} waves goodbye to the camera`);
    } else if (slot.synthetic === "reaction") {
      addAction(lead.id, i % 2 ? `${lead.name} thinks about what just happened` : `${lead.name} laughs and cheers`);
    } else {
      for (const line of slot.lines.slice(0, 3)) {
        const who =
          characters.find((c) => nounOf.has(c.id) && has(line, nounOf.get(c.id)!)) ??
          (MOVING_OBJECTS.some((o) => has(line, o)) ? characters.find((c) => c.kind === "object") : undefined) ??
          lead;
        addAction(who.id, line);
      }
    }

    const mainMotion = actions[0]?.motion ?? "idle";
    const effects = BLENDER_TRIGGERS.filter((t) => t.motion === "explode")
      .flatMap((t) => t.keywords)
      .filter((k) => has(joined, k))
      .slice(0, 3);
    const lighting =
      env.timeOfDay === "night"
        ? "Cool moonlight key, warm practical accents, rim light to separate characters."
        : env.timeOfDay === "golden"
          ? "Low golden-hour sun, long soft shadows, warm bounce."
          : "Soft daylight key, sky fill, gentle rim light.";

    const summary =
      slot.synthetic === "opening"
        ? `We open on ${env.name.toLowerCase()} and meet ${lead.name}.`
        : slot.synthetic === "closing"
          ? `A final wide shot wraps up "${makeTitle(text)}".`
          : slot.synthetic === "reaction"
            ? `A breath between beats: ${lead.name} reacts.`
            : sentence(joined);

    return {
      id: `s${i + 1}`,
      title: slot.synthetic ? { opening: "Opening", closing: "Closing", reaction: "Reaction" }[slot.synthetic] : titleCase(slot.lines[0].split(/\s+/).slice(0, 5).join(" ")),
      beat: beatNames[i] ?? BEATS[Math.min(i, BEATS.length - 1)],
      durationSec: position === "middle" ? 1.2 : 1,
      environmentId: env.id,
      summary,
      narration: slot.synthetic ? undefined : sentence(joined),
      camera: cameraFor(position, mainMotion, i),
      lighting,
      actions,
      effects,
    };
  });

  const usesCascadeur = scenes.some((s) => s.actions.some((a) => a.tool === "cascadeur"));
  const usesMixamo = scenes.some((s) => s.actions.some((a) => a.tool === "mixamo"));
  const notes = [
    "Planned by the offline director (no AI key needed). Add OPENROUTER_API_KEY for richer storytelling.",
    usesMixamo ? "Humanoid everyday motion uses Mixamo clips — keep the clips listed in the tool plan in your Mixamo library." : "",
    usesCascadeur ? "Some motion is custom (stunts, creatures or object contact) and goes to Cascadeur." : "",
  ].filter(Boolean);

  return normalizePlan(
    {
      title: makeTitle(text),
      logline: sentence(cleanTopic(text)).slice(0, 300),
      interpretation: {
        genre: genre.genre,
        tone: brief.mood || (style.id === "cinematic" ? "Dramatic" : "Upbeat and warm"),
        audience: brief.audience || (genre.genre === "Explainer" ? "Curious viewers of all ages" : "General audience"),
        pacing: genre.pacing,
        themes: [],
      },
      style: { look: style.look },
      characters,
      environments,
      scenes,
      music:
        genre.genre === "Music video"
          ? "A driving track with a clear beat; cuts land on the downbeat."
          : genre.genre === "Action"
            ? "Percussive, rising orchestral-electronic score."
            : genre.genre === "Explainer"
              ? "Light, curious underscore that stays under the narration."
              : "Warm melodic score that swells at the climax.",
      soundDesign: "Footsteps and cloth on every character move, ambience for each set, whooshes on camera moves.",
      notes,
    },
    brief,
    text,
    "heuristic",
  );
}
