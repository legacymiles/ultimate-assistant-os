// ---------------------------------------------------------------------------
// "Turn yourself into a blue holographic wolf" → structured avatar actions.
//
// Two ways in, one action shape out:
//
//   parseAvatarCommand(text)  the fast path. Runs in the tab with no model, so
//                             a spoken "make yourself smaller" changes it the
//                             instant the sentence ends — and so it works with
//                             the PC and the AI both off.
//   actionsFromToolArgs(args) the agent's `avatar` tool (agentTools.ts), for
//                             anything the fast path does not understand
//                             ("look like a sunset over the sea"): the model
//                             translates, this checks.
//
// Appearance is a preference and is kept; an emotion is a moment and expires.
// Pure, tested in commands.test.ts.
// ---------------------------------------------------------------------------

import {
  EMOTIONS,
  FORMS,
  GESTURES,
  MATERIALS,
  clampLook,
  type AvatarLook,
  type Emotion,
  type FormId,
  type Gesture,
  type MaterialId,
} from "./looks";

export type AvatarAction =
  | { type: "look"; patch: Partial<AvatarLook>; relative?: { scale?: number } }
  | { type: "emotion"; emotion: Emotion; seconds: number }
  | { type: "gesture"; gesture: Gesture }
  | { type: "cycle"; on: boolean }
  /** Which agent shows: the Three.js avatar or the real-looking face. */
  | { type: "face"; face: "3d" | "real" }
  | { type: "reset" };

export interface AvatarCommand {
  actions: AvatarAction[];
  /** What Jarvis says back, in plain words. */
  reply: string;
}

export const COLOURS: Record<string, string> = {
  red: "#ff3b4f",
  crimson: "#dc143c",
  scarlet: "#ff2400",
  orange: "#ff8a2f",
  amber: "#ffb02e",
  gold: "#ffd27a",
  golden: "#ffd27a",
  yellow: "#ffe14d",
  lime: "#b6ff3a",
  green: "#3ddc97",
  emerald: "#2ecc71",
  mint: "#7cff9e",
  teal: "#19c3b3",
  cyan: "#47e8ff",
  aqua: "#47e8ff",
  turquoise: "#40e0d0",
  blue: "#3b82f6",
  azure: "#5ea8ff",
  navy: "#1e3a8a",
  indigo: "#5b5bd6",
  purple: "#9b5cff",
  violet: "#7c5cff",
  lavender: "#b794ff",
  magenta: "#ff3dc8",
  pink: "#ff6fb5",
  rose: "#ff5d73",
  white: "#f4f7ff",
  silver: "#c9d6e8",
  grey: "#8a94a6",
  gray: "#8a94a6",
  black: "#1a1d26",
  brown: "#8a5a3c",
};

const FORM_WORDS: [RegExp, FormId][] = [
  [/\b(robot|android|droid|mech|cyborg|machine|bot)\b/, "robot"],
  [/\b(wolf|wolves|dog|puppy|fox|husky|coyote)\b/, "wolf"],
  [/\b(cat|kitten|kitty|tiger|lion|panther|leopard)\b/, "cat"],
  [/\b(dragon|lizard|dinosaur|dino|wyvern|serpent)\b/, "dragon"],
  [/\b(alien|martian|extraterrestrial|e\.t\.)\b/, "alien"],
  [/\b(orb|sphere|ball|planet|sun|star)\b/, "orb"],
  [/\b(crystal|gem|diamond|prism|jewel)\b/, "crystal"],
  [/\b(blob|slime|jelly|liquid|goo|lava lamp)\b/, "blob"],
  [/\b(human|person|man|woman|guy|girl|face|humanoid)\b/, "humanoid"],
];

const MATERIAL_WORDS: [RegExp, MaterialId][] = [
  [/\b(holographic|hologram|holo)\b/, "holo"],
  [/\b(glass|transparent|see[- ]through|clear)\b/, "glass"],
  [/\b(metal|metallic|chrome|steel|iron|futuristic)\b/, "metal"],
  [/\b(plasma|fire|fiery|flame|flaming|energy|electric|lava)\b/, "plasma"],
  [/\b(matte|solid|clay|stone|plastic)\b/, "matte"],
  [/\b(wireframe|wire|neon lines|grid|tron)\b/, "wire"],
];

const EMOTION_WORDS: [RegExp, Emotion][] = [
  [/\b(happ(y|ier)|smile|smiling|cheer(ful| up)?|joyful|glad)\b/, "happy"],
  [/\b(sad|sadder|unhappy|cry|upset)\b/, "sad"],
  [/\b(angry|angrier|mad|furious|grumpy)\b/, "angry"],
  [/\b(surprised|shocked|amazed|astonished)\b/, "surprised"],
  [/\b(think(ing)?|thoughtful|pondering|curious)\b/, "thinking"],
  [/\b(calm|calmer|relaxed|chill|peaceful|serene)\b/, "calm"],
  [/\b(excited|hyped|energetic|pumped)\b/, "excited"],
];

const GESTURE_WORDS: [RegExp, Gesture][] = [
  [/\b(nod|nods|nodding)\b/, "nod"],
  [/\bshake (your )?head\b|\bshake\b/, "shake"],
  [/\b(tilt|cock) (your )?head\b|\btilt\b/, "tilt"],
  [/\b(spin|twirl|turn around|do a flip|flip)\b/, "spin"],
  [/\b(bounce|jump|hop)\b/, "bounce"],
  [/\b(wave|say hi|say hello)\b/, "wave"],
];

/** Is this sentence about the avatar at all? Guards against "become a better cook". */
const SELF = /\b(yourself|your (eyes?|face|look|colou?rs?|body|head|avatar|appearance|shape|form|skin|mouth|size)|you look|avatar|jarvis'?s? (look|face|avatar))\b/;
const TRANSFORM = /\b(turn|transform|change|morph|shift|switch)( yourself)? into\b|\bbecome\b|\blook like\b|\bbe an?\b|\bshape-?shift\b/;
const CYCLE_ON = /\b(keep|start|resume|go back to|carry on) (transforming|morphing|changing|shape-?shifting|shifting)\b|\bsurprise me\b|\b(transform|morph) (on your own|by yourself|every few seconds)\b/;
const CYCLE_OFF = /\b(stop|quit|pause|no more) (transforming|morphing|changing|shape-?shifting|shifting)\b|\b(stay|keep) (like this|this way|that way|as you are)\b|\bhold (that|this) (look|form|shape)\b/;
/** Words that mean the sentence is a job, not a request about how it looks. */
const TASK = /\b(note|notes|remind(er)?|email|e-mail|message|text|buy|order|book|schedule|calendar|search|google|look up|find|write|send|call|list|file|save|remember|draft|post|cook|dress|shirt|car|paint the|room|wall|website|site|app|button|logo|page)\b/;
const RESET = /\b(go back to|return to|reset( to)?) (normal|default|your (normal|default|usual|original) (look|self|form)|how you were)\b|\breset your (look|appearance|avatar)\b/;

function colourIn(s: string): string | undefined {
  const m = s.match(/#[0-9a-f]{6}\b/i);
  if (m) return m[0].toLowerCase();
  for (const word of s.split(/[^a-z]+/)) if (COLOURS[word]) return COLOURS[word];
  return undefined;
}

function allColours(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/#[0-9a-f]{6}\b/gi)) out.push(m[0].toLowerCase());
  for (const word of s.split(/[^a-z]+/)) if (COLOURS[word] && !out.includes(COLOURS[word])) out.push(COLOURS[word]);
  return out;
}

const FORM_NAME: Record<FormId, string> = {
  humanoid: "a human face",
  robot: "a robot",
  wolf: "a wolf",
  cat: "a cat",
  dragon: "a dragon",
  alien: "an alien",
  orb: "an orb",
  crystal: "a crystal",
  blob: "a liquid blob",
};
const MATERIAL_NAME: Record<MaterialId, string> = {
  holo: "holographic",
  glass: "glass",
  metal: "metallic",
  plasma: "plasma",
  matte: "solid",
  wire: "wireframe",
};
const colourName = (hex: string) => Object.entries(COLOURS).find(([, v]) => v === hex)?.[0] ?? hex;

/**
 * Read a sentence and return what it asks the avatar to do, or null when it is
 * not about the avatar (so it goes to the chat as normal).
 */
export function parseAvatarCommand(raw: string): AvatarCommand | null {
  const s = ` ${String(raw ?? "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim()} `;
  if (s.trim().length < 3 || s.length > 240) return null;

  const self = SELF.test(s);
  const transform = TRANSFORM.test(s);
  const form = FORM_WORDS.find(([re]) => re.test(s))?.[1];
  const cycleOn = CYCLE_ON.test(s);
  const cycleOff = CYCLE_OFF.test(s);
  const reset = RESET.test(s) && (self || /\b(look|avatar|appearance)\b/.test(s) || /^ (go back to|reset)/.test(s));

  // Which agent: "switch to your real face", "go back to 3D". Checked before
  // reset, so "go back to 3D" is a switch and not a reset.
  const switchVerb = /\b(switch|change|go|turn|show|use|be|become|bring|want|put)\b/.test(s);
  const aboutFace = self || /\b(face|look|avatar|agent|version|mode)\b/.test(s);
  // The word has to name the agent ("real face", "real-looking version"), so
  // "switch the lights to real time mode" stays a chat message.
  const AGENT = "(?:face|look|version|person|avatar|agent|mode|self|you|one)";
  const toReal = switchVerb && aboutFace && new RegExp(`\\b(?:real|realistic|human|lifelike|photoreal|real[- ]looking) ${AGENT}\\b`).test(s);
  const to3d = switchVerb && aboutFace && new RegExp(`\\b(?:3d|3-d|three d|three-d|hologram|holographic) ${AGENT}\\b`).test(s) && form === undefined;
  if (toReal && !TASK.test(s)) return { actions: [{ type: "face", face: "real" }], reply: "Switching to my real face." };
  if (to3d && !TASK.test(s)) return { actions: [{ type: "face", face: "3d" }], reply: "Back to my 3D look." };

  // A job that happens to say "yourself" ("make yourself a note to buy a red
  // dress") is the chat's, unless it also clearly asks for a new form.
  if (TASK.test(s) && !(transform && form) && !cycleOn && !cycleOff) return null;

  // Only a sentence that clearly addresses the avatar is ours.
  const aboutAvatar = self || (transform && (form !== undefined || /\b(holographic|hologram|robot|glowing)\b/.test(s))) || cycleOn || cycleOff || reset;
  if (!aboutAvatar) return null;

  const actions: AvatarAction[] = [];
  const said: string[] = [];

  if (reset) {
    actions.push({ type: "reset" });
    return { actions, reply: "Back to my usual self." };
  }
  if (cycleOn) {
    actions.push({ type: "cycle", on: true });
    said.push("I'll keep transforming");
  }
  if (cycleOff && !cycleOn) {
    actions.push({ type: "cycle", on: false });
    said.push("I'll hold this look");
  }

  const patch: Partial<AvatarLook> = {};
  let relative: { scale?: number } | undefined;

  // Eyes are their own clause: "change your eyes to glowing red", "red eyes".
  const eyeClause = s.match(/\beyes?\b[^.,;!?]*/)?.[0] ?? "";
  const beforeEyes = s.match(/\b([a-z#0-9]+) (glowing )?eyes?\b/)?.[1] ?? "";
  const eyeColour = colourIn(eyeClause) ?? (COLOURS[beforeEyes] ? COLOURS[beforeEyes] : undefined);
  if (eyeColour) {
    patch.eye = eyeColour;
    said.push(`${colourName(eyeColour)} eyes`);
  }
  if (/\bglow(ing|y)?\b/.test(eyeClause) || /\bglowing eyes?\b/.test(s)) {
    patch.eyeGlow = 2;
    if (!eyeColour) said.push("glowing eyes");
  }

  // Body colours: whatever is said outside the eyes clause.
  const body = eyeClause ? s.replace(eyeClause, " ") : s;
  const colours = allColours(body).filter((c) => c !== eyeColour || !eyeClause);
  if (colours[0]) patch.primary = colours[0];
  if (colours[1]) patch.secondary = colours[1];

  const material = MATERIAL_WORDS.find(([re]) => re.test(body))?.[1];
  if (material) patch.material = material;
  if (/\bfuturistic\b/.test(s)) patch.glow = 1.2;
  if (/\bglow(ing)?\b/.test(body) && !/\beyes?\b/.test(body)) patch.glow = 1.5;

  if (form) patch.form = form;

  if (/\b(smaller|tiny|tinier|shrink|little)\b/.test(s)) relative = { scale: 0.75 };
  else if (/\b(bigger|larger|huge|grow|giant)\b/.test(s)) relative = { scale: 1.25 };
  else if (/\bnormal size\b/.test(s)) patch.scale = 1;

  if (/\b(stop floating|stay still|stand still|land)\b/.test(s)) patch.float = 0.15;
  else if (/\b(float|floating|hover|levitate|fly)\b/.test(s)) patch.float = 1.8;

  if (Object.keys(patch).length || relative) {
    actions.push({ type: "look", patch, ...(relative ? { relative } : {}) });
    const parts: string[] = [];
    if (relative?.scale) parts.push(relative.scale < 1 ? "smaller" : "bigger");
    if (patch.float !== undefined) parts.push(patch.float > 1 ? "floating" : "settled");
    const desc = [patch.primary ? colourName(patch.primary) : "", patch.material ? MATERIAL_NAME[patch.material] : ""].filter(Boolean).join(" ");
    if (patch.form) {
      const phrase = [desc, FORM_NAME[patch.form].replace(/^an? /, "")].filter(Boolean).join(" ");
      said.unshift(`${/^[aeiou]/.test(phrase) ? "an" : "a"} ${phrase}`);
    } else if (desc) said.unshift(desc);
    said.push(...parts);
  }

  const emotion = EMOTION_WORDS.find(([re]) => re.test(s))?.[1];
  if (emotion) {
    actions.push({ type: "emotion", emotion, seconds: 12 });
    said.push(`feeling ${emotion}`);
  }
  const gesture = GESTURE_WORDS.find(([re]) => re.test(s))?.[1];
  if (gesture) {
    actions.push({ type: "gesture", gesture });
    if (!said.length) said.push(gesture === "wave" ? "hello" : `a ${gesture}`);
  }

  if (!actions.length) return null;
  const line = said.filter(Boolean).join(", ");
  return { actions, reply: line ? `Done — ${line}.` : "Done." };
}

/** The agent's `avatar` tool arguments → the same actions, checked. */
export function actionsFromToolArgs(args: Record<string, unknown>): AvatarCommand {
  const actions: AvatarAction[] = [];
  const said: string[] = [];
  if (args.reset === true) return { actions: [{ type: "reset" }], reply: "Back to my usual self." };
  if (args.face === "real" || args.face === "3d") {
    actions.push({ type: "face", face: args.face });
    said.push(args.face === "real" ? "showing my real face" : "back to my 3D look");
  }

  const colour = (v: unknown) => (typeof v === "string" ? colourIn(` ${v.toLowerCase()} `) : undefined);
  const patch: Partial<AvatarLook> = {};
  if (typeof args.form === "string" && (FORMS as readonly string[]).includes(args.form)) patch.form = args.form as FormId;
  if (typeof args.material === "string" && (MATERIALS as readonly string[]).includes(args.material)) patch.material = args.material as MaterialId;
  const p = colour(args.primary);
  const sc = colour(args.secondary);
  const e = colour(args.eye);
  if (p) patch.primary = p;
  if (sc) patch.secondary = sc;
  if (e) patch.eye = e;
  for (const k of ["glow", "eyeGlow", "scale", "float"] as const) {
    const n = Number(args[k]);
    if (args[k] !== undefined && Number.isFinite(n)) patch[k] = n;
  }
  if (typeof args.model === "string" && args.model.trim()) patch.model = args.model.trim();
  const checked = clampLook(patch, clampLook({}));
  const clean: Partial<AvatarLook> = {};
  for (const k of Object.keys(patch) as (keyof AvatarLook)[]) {
    if (checked[k] !== undefined) (clean as Record<string, unknown>)[k] = checked[k];
  }
  if (patch.model && !checked.model) said.push("that model link isn't a .glb or .gltf file, so I kept my own body");
  if (Object.keys(clean).length) {
    actions.push({ type: "look", patch: clean });
    said.unshift([clean.primary && colourName(clean.primary), clean.material && MATERIAL_NAME[clean.material], clean.form && FORM_NAME[clean.form].replace(/^an? /, "")].filter(Boolean).join(" ") || "new look");
  }
  if (typeof args.emotion === "string" && (EMOTIONS as readonly string[]).includes(args.emotion)) {
    const seconds = Math.min(60, Math.max(2, Number(args.seconds) || 12));
    actions.push({ type: "emotion", emotion: args.emotion as Emotion, seconds });
    said.push(`feeling ${args.emotion}`);
  }
  if (typeof args.gesture === "string" && (GESTURES as readonly string[]).includes(args.gesture)) {
    actions.push({ type: "gesture", gesture: args.gesture as Gesture });
  }
  if (typeof args.transforming === "boolean") {
    actions.push({ type: "cycle", on: args.transforming });
    said.push(args.transforming ? "transforming on my own again" : "holding this look");
  }
  return { actions, reply: actions.length ? `Done — ${said.filter(Boolean).join(", ")}.` : "Nothing to change." };
}

// --- reading the mood of what it says ----------------------------------------

/**
 * A light read of an answer's tone, so the face and body match what is said:
 * an apology looks sorry, good news looks pleased, a question tilts the head.
 */
export function emotionFromText(text: string): { emotion: Emotion; gesture?: Gesture } {
  const s = ` ${String(text ?? "").toLowerCase()} `;
  if (!s.trim()) return { emotion: "neutral" };
  const score = (re: RegExp) => (s.match(re) ?? []).length;
  const sad = score(/\b(sorry|unfortunately|can't|cannot|couldn't|failed|unable|afraid|error|didn't work)\b/g);
  const happy = score(/\b(done|great|glad|awesome|perfect|nice|congrat\w*|good news|all set|ready|sure|happy|love)\b/g);
  const surprised = score(/\b(wow|whoa|oh!|incredible|amazing|huge)\b/g);
  const bang = score(/!/g);
  const question = /\?\s*$/.test(s.trim());
  if (sad > happy && sad > 0) return { emotion: "sad", gesture: "shake" };
  if (surprised > 0) return { emotion: "surprised", gesture: "bounce" };
  if (happy > 0) return { emotion: bang > 0 ? "excited" : "happy", gesture: bang > 0 ? "bounce" : "nod" };
  if (question) return { emotion: "thinking", gesture: "tilt" };
  return { emotion: "neutral" };
}
