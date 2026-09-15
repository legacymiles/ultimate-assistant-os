// ---------------------------------------------------------------------------
// Motion routing: which tool animates a given action.
//
// The rule of thumb the director follows, in order:
//   1. Objects, vehicles, cameras and effects are not characters: Blender
//      keyframes, constraints, physics or geometry nodes.
//   2. Creatures and quadrupeds: Cascadeur. Mixamo only rigs bipeds.
//   3. Stunts, falls, fights, acrobatics, contact with props: Cascadeur,
//      because those need physically plausible custom motion.
//   4. Everyday humanoid motion a mocap library already has: Mixamo.
//   5. A specific humanoid motion no clip covers: Cascadeur.
//
// Pure functions, shared by the heuristic director, the AI director's
// validator, and the tests.
// ---------------------------------------------------------------------------

import type { MotionTool, SubjectKind } from "../types";

export interface MixamoClip {
  clip: string;
  motion: string;
  keywords: string[];
}

/** Mixamo clips the studio knows by name. The builder looks for `<clip>.fbx` in the local library. */
export const MIXAMO_CLIPS: MixamoClip[] = [
  { clip: "Idle", motion: "idle", keywords: ["idle", "stand", "standing", "wait", "waiting", "breathe", "pose"] },
  { clip: "Walking", motion: "walk", keywords: ["walk", "walks", "walking", "stroll", "strolls", "wander", "wanders", "enter", "enters", "arrive", "arrives", "approach", "approaches"] },
  { clip: "Running", motion: "run", keywords: ["run", "runs", "running", "sprint", "sprints", "jog", "jogs", "chase", "chases", "rush", "rushes", "race", "races", "flee", "flees"] },
  { clip: "Jumping", motion: "jump", keywords: ["jump", "jumps", "jumping", "hop", "hops", "leap", "leaps"] },
  { clip: "Talking", motion: "talk", keywords: ["talk", "talks", "talking", "speak", "speaks", "explain", "explains", "say", "says", "tell", "tells", "chat", "present", "presents", "narrate", "narrates", "teach", "teaches", "argue", "argues", "ask", "asks"] },
  { clip: "Waving", motion: "wave", keywords: ["wave", "waves", "waving", "greet", "greets", "hello", "goodbye", "bye"] },
  { clip: "Hip Hop Dancing", motion: "dance", keywords: ["dance", "dances", "dancing", "groove", "grooves", "boogie", "party", "parties"] },
  { clip: "Clapping", motion: "cheer", keywords: ["clap", "claps", "cheer", "cheers", "celebrate", "celebrates", "applaud", "applauds"] },
  { clip: "Victory", motion: "cheer", keywords: ["win", "wins", "victory", "triumph", "triumphs", "succeed", "succeeds"] },
  { clip: "Pointing", motion: "point", keywords: ["point", "points", "pointing", "show", "shows", "indicate", "indicates"] },
  { clip: "Thinking", motion: "think", keywords: ["think", "thinks", "ponder", "ponders", "wonder", "wonders", "consider", "considers", "puzzled", "curious"] },
  { clip: "Looking Around", motion: "look", keywords: ["look", "looks", "search", "searches", "explore", "explores", "discover", "discovers", "notice", "notices", "watch", "watches"] },
  { clip: "Sitting", motion: "sit", keywords: ["sit", "sits", "sitting", "seated", "rest", "rests", "relax", "relaxes"] },
  { clip: "Typing", motion: "type", keywords: ["type", "types", "typing", "code", "codes", "coding", "computer", "laptop", "keyboard"] },
  { clip: "Picking Up", motion: "pickup", keywords: ["pick", "picks", "grab", "grabs", "collect", "collects", "take", "takes"] },
  { clip: "Sad Idle", motion: "sad", keywords: ["sad", "cry", "cries", "crying", "sigh", "sighs", "lonely", "disappointed"] },
  { clip: "Laughing", motion: "laugh", keywords: ["laugh", "laughs", "laughing", "giggle", "giggles", "smile", "smiles"] },
  { clip: "Salute", motion: "salute", keywords: ["salute", "salutes", "bow", "bows"] },
];

interface Trigger {
  motion: string;
  keywords: string[];
  why: string;
}

/** Motion that needs Cascadeur's physics-aware custom animation. */
export const CASCADEUR_TRIGGERS: Trigger[] = [
  { motion: "flip", keywords: ["flip", "flips", "backflip", "backflips", "somersault", "somersaults", "cartwheel", "cartwheels", "acrobatic", "acrobatics", "spin kick", "twirl", "twirls"], why: "acrobatics need a physically correct arc and landing" },
  { motion: "fall", keywords: ["fall", "falls", "falling", "trip", "trips", "stumble", "stumbles", "slip", "slips", "tumble", "tumbles", "crash", "crashes", "collapse", "collapses", "knocked"], why: "falls need believable weight and balance loss" },
  { motion: "fight", keywords: ["fight", "fights", "fighting", "punch", "punches", "kick", "kicks", "sword", "duel", "duels", "battle", "battles", "wrestle", "wrestles", "tackle", "tackles", "block", "blocks", "strike", "strikes", "karate", "kung fu"], why: "fight choreography needs custom timing and contact" },
  { motion: "climb", keywords: ["climb", "climbs", "climbing", "vault", "vaults", "parkour", "swing", "swings", "hang", "hangs", "scale", "scales"], why: "hand and foot contacts must lock to the set" },
  { motion: "throw", keywords: ["throw", "throws", "catch", "catches", "toss", "tosses", "juggle", "juggles", "push", "pushes", "pull", "pulls", "lift", "lifts", "carry", "carries", "drag", "drags"], why: "interacting with an object needs matching weight and contact" },
  { motion: "land", keywords: ["land", "lands", "landing", "dive", "dives", "skate", "skates", "surf", "surfs", "ski", "skis", "balance", "balances"], why: "momentum and balance need physics-based motion" },
  { motion: "stretch", keywords: ["squash", "stretch", "cartoony", "exaggerated", "wobble", "wobbles"], why: "stylised squash-and-stretch goes beyond mocap" },
];

/** Non-character motion Blender animates directly. */
export const BLENDER_TRIGGERS: Trigger[] = [
  { motion: "fly", keywords: ["fly", "flies", "flying", "soar", "soars", "hover", "hovers", "float", "floats", "orbit", "orbits", "launch", "launches", "blast off", "take off", "takes off"], why: "a flight path is a keyframed curve in Blender" },
  { motion: "drive", keywords: ["drive", "drives", "driving", "roll", "rolls", "speed", "speeds", "zoom", "zooms", "sail", "sails", "ride", "rides"], why: "vehicles follow a path with wheel/prop rigs in Blender" },
  { motion: "grow", keywords: ["grow", "grows", "bloom", "blooms", "sprout", "sprouts", "appear", "appears", "morph", "morphs", "transform", "transforms", "shrink", "shrinks", "build", "builds", "assemble", "assembles"], why: "shape and scale changes are shape keys / geometry nodes" },
  { motion: "explode", keywords: ["explode", "explodes", "explosion", "shatter", "shatters", "burst", "bursts", "sparkle", "sparkles", "glow", "glows", "rain", "snow", "smoke", "fire", "splash", "splashes"], why: "effects are Blender particles, simulation and emission" },
  { motion: "spin", keywords: ["spin", "spins", "rotate", "rotates", "turn", "turns", "bounce", "bounces", "shake", "shakes", "open", "opens", "close", "closes"], why: "simple object motion is keyframed in Blender" },
];

export const CREATURE_WORDS = [
  "dog", "puppy", "cat", "kitten", "horse", "pony", "dragon", "bird", "eagle", "owl", "fish", "shark", "whale", "dolphin",
  "snake", "spider", "dinosaur", "t-rex", "lion", "tiger", "wolf", "fox", "deer", "elephant", "giraffe", "cow", "pig",
  "sheep", "chicken", "duck", "butterfly", "bee", "octopus", "crab", "turtle", "frog", "mouse", "rabbit", "bunny", "squirrel",
];

export const OBJECT_WORDS = [
  "car", "truck", "bus", "train", "plane", "airplane", "jet", "rocket", "spaceship", "ship", "boat", "submarine", "bike",
  "bicycle", "motorcycle", "drone", "balloon", "ball", "planet", "sun", "moon", "star", "logo", "text", "title", "box",
  "cube", "sphere", "flower", "tree", "house", "building", "robot arm", "satellite", "meteor", "asteroid", "cloud", "wave",
];

export interface MotionRoute {
  tool: MotionTool;
  motion: string;
  clip?: string;
  reason: string;
}

function words(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ")} `;
}

function hit(text: string, keywords: string[]): string | null {
  const w = words(text);
  for (const k of keywords) if (w.includes(` ${k} `)) return k;
  return null;
}

export function mixamoClip(name: string | undefined): MixamoClip | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  return MIXAMO_CLIPS.find((c) => c.clip.toLowerCase() === n);
}

/** Decide which tool animates `description` performed by a subject of `kind`. */
export function routeMotion(description: string, kind: SubjectKind): MotionRoute {
  if (kind === "object") {
    const b = BLENDER_TRIGGERS.find((t) => hit(description, t.keywords));
    return {
      tool: "blender",
      motion: b?.motion ?? "move",
      reason: b ? `Object motion — ${b.why}.` : "Not a character — keyframed directly in Blender.",
    };
  }

  const stunt = CASCADEUR_TRIGGERS.find((t) => hit(description, t.keywords));

  if (kind === "creature") {
    return {
      tool: "cascadeur",
      motion: stunt?.motion ?? libraryMotion(description) ?? "move",
      reason: "Creature rig — Mixamo only rigs bipeds, so Cascadeur animates it with AutoPosing.",
    };
  }

  if (stunt) {
    return { tool: "cascadeur", motion: stunt.motion, reason: `"${hit(description, stunt.keywords)}" — ${stunt.why}.` };
  }

  const clip = MIXAMO_CLIPS.find((c) => hit(description, c.keywords));
  if (clip) {
    return {
      tool: "mixamo",
      motion: clip.motion,
      clip: clip.clip,
      reason: `Everyday motion — Mixamo's "${clip.clip}" mocap clip fits.`,
    };
  }

  // A character doing something that is neither everyday nor a stunt. If the
  // text is really about an object moving (the rocket launches), Blender;
  // otherwise it is specific enough to deserve custom motion.
  const object = BLENDER_TRIGGERS.find((t) => hit(description, t.keywords));
  if (object) {
    return { tool: "blender", motion: object.motion, reason: `Effect or object motion — ${object.why}.` };
  }
  if (description.trim().split(/\s+/).length <= 2) {
    return { tool: "mixamo", motion: "idle", clip: "Idle", reason: "No specific motion described — a Mixamo idle keeps the character alive." };
  }
  return { tool: "cascadeur", motion: "custom", reason: "No library clip covers this — Cascadeur keys a custom performance." };
}

function libraryMotion(description: string): string | null {
  return MIXAMO_CLIPS.find((c) => hit(description, c.keywords))?.motion ?? null;
}

/** Best guess of what kind of subject a name or description is. */
export function subjectKind(text: string): SubjectKind {
  if (hit(text, OBJECT_WORDS)) {
    // "robot" is a character; "robot arm" is an object. OBJECT_WORDS already
    // lists the compound, so plain "robot" never lands here.
    return "object";
  }
  if (hit(text, CREATURE_WORDS)) {
    // Anthropomorphic animals ("a fox who talks", "bunny chef") still walk on
    // two legs in most animated shorts, which Mixamo handles.
    return /\b(who|chef|detective|knight|wizard|astronaut|teacher|in a (suit|hat|coat)|talking|bipedal)\b/i.test(text) ? "humanoid" : "creature";
  }
  return "humanoid";
}
