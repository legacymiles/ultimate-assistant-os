// ---------------------------------------------------------------------------
// The lab compiler: ShotSpec + Strategy + bibles → an official-format H3 prompt.
//
// Deterministic and model-free on purpose: the same inputs always give the
// same prompt, so when two prompts differ the difference IS the technique
// being tested. Each Strategy knob changes exactly one thing about the text.
//
// Format rules come from the Master Guide (official MiniMax base / Ref2VA
// sections, h3-prompt's length and camera discipline).
// ---------------------------------------------------------------------------

import type { Amount, CameraMove, Character, Environment, ShotSpec, Speed, Strategy } from "./model";

export interface CompileInput {
  spec: ShotSpec;
  strategy: Strategy;
  characters: Character[];
  environments: Environment[];
  /** Extra writing instruction (an experiment's), appended to the closing block. */
  instructions?: string;
  /** Previous scene's handover, for scene-by-scene structure. */
  previous?: { endsOn: string } | null;
}

export interface Reference {
  label: string;
  kind: "character" | "environment";
  name: string;
  image: string;
  retention: "fully_preserved" | "partially_preserved";
}

export interface Compiled {
  mode: "ref2va" | "base";
  prompt: string;
  references: Reference[];
  chars: number;
  words: number;
}

// ----- small text helpers -----------------------------------------------------

const clean = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, " ").trim();

function sentences(text: string, n: number): string {
  const t = clean(text);
  if (!t) return "";
  const parts = t.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [t];
  return parts.slice(0, n).join("").trim();
}

function end(s: string): string {
  const t = clean(s);
  if (!t) return "";
  return /[.!?…"]$/.test(t) ? t : `${t}.`;
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function upperName(name: string): string {
  return clean(name).toUpperCase();
}

function timestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

// ----- camera ----------------------------------------------------------------------

const PROSE: Record<CameraMove, string> = {
  static: "is locked off, perfectly still",
  handheld: "is handheld, drifting gently with the operator's breath",
  "push-in": "pushes in",
  "pull-out": "pulls out",
  "dolly-in": "dollies in on a smooth slider",
  track: "tracks alongside the subject",
  "pan-left": "pans left across the scene",
  "pan-right": "pans right across the scene",
  "tilt-up": "tilts up",
  "tilt-down": "tilts down",
  "crane-up": "rises on a crane",
  "crane-down": "descends on a crane",
  arc: "arcs around the subject in a clean, polished curve",
  orbit: "orbits slowly around the subject",
  "zoom-in": "zooms in",
  "zoom-out": "zooms out",
  pov: "is a point-of-view shot through the subject's eyes",
  shake: "shakes",
};

const PLAIN: Record<CameraMove, string> = {
  static: "stays completely still",
  handheld: "is held by hand and moves with the action",
  "push-in": "drives in close",
  "pull-out": "pulls all the way back",
  "dolly-in": "glides straight in",
  track: "runs alongside, keeping pace",
  "pan-left": "swings left",
  "pan-right": "swings right",
  "tilt-up": "sweeps up",
  "tilt-down": "sweeps down",
  "crane-up": "lifts high above",
  "crane-down": "drops down from high above",
  arc: "swings a wide half-circle around",
  orbit: "circles all the way around",
  "zoom-in": "snaps in",
  "zoom-out": "snaps out",
  pov: "sees through their eyes",
  shake: "jolts hard",
};

const TOKEN: Record<CameraMove, string> = {
  static: "Static shot",
  handheld: "Handheld",
  "push-in": "Push in",
  "pull-out": "Pull out",
  "dolly-in": "Dolly in",
  track: "Tracking shot",
  "pan-left": "Pan left",
  "pan-right": "Pan right",
  "tilt-up": "Tilt up",
  "tilt-down": "Tilt down",
  "crane-up": "Pedestal up",
  "crane-down": "Pedestal down",
  arc: "Arc shot",
  orbit: "Orbit",
  "zoom-in": "Zoom in",
  "zoom-out": "Zoom out",
  pov: "POV",
  shake: "Shake strongly",
};

const STILL = new Set<CameraMove>(["static", "pov"]);

/** Official modifiers: medium/normal is written by leaving the modifier out. */
function modifiers(amount: Amount, speed: Speed): string {
  const parts: string[] = [];
  if (amount !== "medium") parts.push(`with ${amount} amplitude`);
  if (speed !== "medium") parts.push(`at ${speed} speed`);
  return parts.join(" ");
}

export function cameraSentence(spec: ShotSpec, style: Strategy["camera"], subject: string): string {
  const { move, amount, speed, focus } = spec.camera;
  const target = clean(focus) || subject;
  if (style === "token") {
    const mods = [amount !== "medium" ? `${amount} amplitude` : "", speed !== "medium" ? `${speed} speed` : ""].filter(Boolean);
    return end([TOKEN[move], ...mods].join(", ") + (target && !STILL.has(move) ? `, toward ${target}` : ""));
  }
  if (style === "plain-big") {
    // Plain words, scaled up: small moves become medium, medium become large.
    const big = amount === "small" ? "" : " — a big, unmistakable move";
    const beat = spec.beats[0] ? `, timed to ${clean(spec.beats[0]).replace(/[.!?]+$/, "")}` : "";
    if (STILL.has(move)) return end(`The camera ${PLAIN[move]}${target ? `, holding on ${target}` : ""}`);
    return end(`The camera ${PLAIN[move]}${target ? ` ${move === "track" ? "with" : "toward"} ${target}` : ""}${beat}${big}`);
  }
  if (STILL.has(move)) return end(`The camera ${PROSE[move]}${target ? `, holding on ${target}` : ""}`);
  const mods = modifiers(amount, speed);
  return end(`The camera ${PROSE[move]}${mods ? ` ${mods}` : ""}${target ? ` toward ${target}` : ""}`);
}

// ----- identity --------------------------------------------------------------------

/**
 * The look written into the first block. The budget is per SHOT, not per
 * person, so a two-hander spends it twice: with more than one character
 * defined, each gets the shorter form, or the block alone runs past the
 * ~1,500-character ceiling the guide sets (and the linter enforces).
 */
function characterLook(c: Character, length: Strategy["length"], cast = 1): string {
  const lean = cast > 1;
  // Leaner for a two-hander, but the three budgets must stay distinct even
  // then, or the Length knob would do nothing in a two-person shot and any
  // experiment on it would be measuring noise.
  const n = length === "tight" ? 1 : length === "standard" ? (lean ? 1 : 2) : lean ? 2 : 4;
  const hair = length === "tight" && lean ? "" : sentences(c.hair, 1);
  const body = length === "rich" || (length === "standard" && !lean) ? sentences(c.body, 1) : "";
  const look = [sentences(c.face, n), hair, body].filter(Boolean).join(" ");
  const wear = sentences(c.wardrobe, 1);
  const acc = length === "rich" && !lean ? sentences(c.accessories, 1) : "";
  return clean([look, wear ? `Wearing ${wear.replace(/^wearing\s+/i, "")}` : "", acc].filter(Boolean).map(end).join(" "));
}

/** The 2-3 most distinctive traits: rules first (they are what the owner said must hold), then hair, then wardrobe. */
export function anchorClause(c: Character): string {
  const bits = [c.continuityRules[0], sentences(c.hair, 1), sentences(c.wardrobe, 1)]
    .map((b) => clean(b).replace(/[.!?]+$/, ""))
    .filter(Boolean)
    .slice(0, 3);
  return bits.length ? `${upperName(c.name)} (${bits.join("; ")})` : upperName(c.name);
}

/**
 * The set, written once in the first block. Two economies, both of which also
 * make the prompt read better: the set's own lighting is left out when the
 * shot already states its lighting (saying it twice invites H3 to relight
 * mid-shot), and a shot with more than one character spends fewer sentences
 * here, because the budget is per shot and the cast has already taken its share.
 */
function environmentText(e: Environment, s: Strategy, lean: boolean, shotStatesLight: boolean): string {
  const light = shotStatesLight ? "" : sentences(e.lighting, 1);
  if (s.environment === "layout-explicit") {
    return [
      sentences(e.description, s.length === "tight" || lean ? 1 : 2),
      lean ? "" : sentences(e.architecture, 1),
      sentences(e.doorsWindows, 1),
      sentences(e.furniture, lean ? 1 : 2),
      sentences(e.spatial, 1),
      light,
    ]
      .filter(Boolean)
      .map(end)
      .join(" ");
  }
  return [sentences(e.description, s.length === "tight" || lean ? 1 : 2), light, s.length === "tight" || lean ? "" : sentences(e.objects, 1)]
    .filter(Boolean)
    .map(end)
    .join(" ");
}

// ----- action & dialogue ------------------------------------------------------------

/**
 * What happens. With choreography beats the beats ARE the action, so the
 * action sentence is not written again above them - restating it was costing
 * ~200 characters of the per-shot budget and asking H3 to perform the same
 * move twice.
 */
function actionText(spec: ShotSpec, s: Strategy): string {
  const action = clean(spec.action);
  const lower = (t: string) => clean(t).replace(/^./, (c) => c.toLowerCase()).replace(/[.!?]+$/, "");
  if (s.action === "choreography-beats" && spec.beats.length) {
    const [first, ...rest] = spec.beats;
    return [
      end(`Already under way in the first frame, ${lower(first)}`),
      ...rest.map((b, i) => end(`${i === rest.length - 1 ? "Finally" : "Then"}, ${lower(b)}`)),
    ].join(" ");
  }
  return action ? end(`Already under way in the first frame, ${lower(action)}`) : "";
}

function speakerIndex(spec: ShotSpec, speaker: string): number {
  const i = spec.characterIds.indexOf(speaker);
  return i >= 0 ? i + 1 : spec.characterIds.length + 1;
}

function dialogueText(spec: ShotSpec, s: Strategy, names: Map<string, string>): string {
  return spec.dialogue
    .filter((d) => clean(d.line))
    .map((d) => {
      const name = names.get(d.speaker) ?? "A VOICE";
      const delivery = clean(d.delivery);
      if (s.dialogue === "plain") {
        return end(`${name} ${d.voiceover ? "says off-screen" : "says"}${delivery ? `, ${delivery},` : ""} "${clean(d.line)}"`);
      }
      const id = `(S${speakerIndex(spec, d.speaker)})`;
      const how = d.voiceover ? "says in an off-screen voiceover" : "says";
      const voice = delivery ? ` in ${delivery.replace(/^in\s+/i, "")}` : "";
      const lips = d.voiceover ? ` ${name}'s lips stay closed.` : "";
      return `${id} ${name} ${how}${voice}: <d>[English] ${clean(d.line)}</d>${lips}`;
    })
    .join(" ");
}

// ----- shot blocks -------------------------------------------------------------------

interface Ctx {
  spec: ShotSpec;
  s: Strategy;
  chars: Character[];
  env: Environment | null;
  labels: Map<string, string>;
  names: Map<string, string>;
  previous: string;
}

function subjectRef(c: Character, ctx: Ctx): string {
  const label = ctx.labels.get(c.id);
  return `${upperName(c.name)}${label ? ` (${label})` : ""}`;
}

function castBlock(ctx: Ctx, first: boolean): string {
  if (!ctx.chars.length) return "";
  return ctx.chars
    .map((c) => {
      const ref = subjectRef(c, ctx);
      if (first || ctx.s.identity === "repeat-every-shot") return end(`${ref}: ${characterLook(c, ctx.s.length, ctx.chars.length)}`);
      if (ctx.s.identity === "anchor-clause") return end(`${anchorClause(c)}${ctx.labels.get(c.id) ? ` (${ctx.labels.get(c.id)})` : ""}`);
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function setBlock(ctx: Ctx, first: boolean): string {
  if (!ctx.env) return "";
  const label = ctx.labels.get(ctx.env.id);
  const name = `the ${upperName(ctx.env.name)}${label ? ` (${label})` : ""}`;
  if (!first && ctx.s.identity !== "repeat-every-shot") return end(`In ${name}`);
  return end(`In ${name}: ${environmentText(ctx.env, ctx.s, ctx.chars.length > 1, Boolean(clean(ctx.spec.lighting)))}`);
}

function cineBlock(ctx: Ctx, first: boolean, framing: string, seconds: number): string {
  const subj = ctx.chars[0] ? upperName(ctx.chars[0].name) : "";
  const style = first ? clean(ctx.spec.style) : "";
  const light = first ? clean(ctx.spec.lighting) : "";
  const frame = clean(framing) ? `A ${clean(framing).replace(/^an?\s+/i, "")}, ${seconds.toFixed(seconds % 1 ? 1 : 0)} seconds` : "";
  return [style ? end(cap(style)) : "", frame ? end(frame) : "", light ? end(cap(light)) : "", cameraSentence(ctx.spec, ctx.s.camera, subj)]
    .filter(Boolean)
    .join(" ");
}

function shotBody(ctx: Ctx, first: boolean, framing: string, seconds: number, action: string): string {
  const blocks: Record<string, string> = {
    character: castBlock(ctx, first),
    environment: setBlock(ctx, first),
    cinematography: cineBlock(ctx, first, framing, seconds),
    action,
  };
  const order: Record<Strategy["order"], string[]> = {
    "character-first": ["character", "environment", "cinematography", "action"],
    "environment-first": ["environment", "character", "cinematography", "action"],
    "cinematography-first": ["cinematography", "character", "environment", "action"],
    "action-first": ["action", "character", "environment", "cinematography"],
  };
  return order[ctx.s.order].map((k) => blocks[k]).filter(Boolean).join(" ");
}

function shotsText(ctx: Ctx): string {
  const { spec, s } = ctx;
  const dlg = dialogueText(spec, s, ctx.names);
  if (s.structure === "timed-cuts" && spec.beats.length > 1) {
    const n = Math.min(spec.beats.length, 4);
    const slot = spec.durationSec / n;
    return spec.beats
      .slice(0, n)
      .map((beat, i) => {
        const text = end(beat.replace(/^./, (c) => c.toUpperCase()));
        if (i === 0) {
          const firstAction = [s.action === "verb-led-midstate" ? end(`Already under way in the first frame, ${clean(beat).replace(/^./, (c) => c.toLowerCase())}`) : text]
            .join(" ");
          return `[Shot 1] ${shotBody(ctx, true, spec.framing, slot, firstAction)}${dlg ? ` ${dlg}` : ""}`;
        }
        const at = timestamp(slot * i);
        return `[Shot ${i + 1}] At ${at}, the camera cuts to ${shotBody({ ...ctx, spec: { ...spec, beats: [] } }, false, spec.framing, slot, text)}`;
      })
      .join("\n\n");
  }
  const prefix =
    s.structure === "scene-by-scene"
      ? `This scene continues directly from the previous one${ctx.previous ? `, which ended on ${ctx.previous.replace(/[.!?]+$/, "")}` : ""}. `
      : "";
  return `[Shot 1] ${prefix}${shotBody(ctx, true, spec.framing, spec.durationSec, actionText(spec, s))}${dlg ? ` ${dlg}` : ""}`;
}

function closing(ctx: Ctx, instructions: string): string {
  const parts = [clean(ctx.spec.mood) ? end(`Mood: ${clean(ctx.spec.mood)}`) : ""];
  if (clean(instructions)) parts.push(end(clean(instructions)));
  if (ctx.s.closing === "consistency-clause") {
    parts.push("Impeccable subject consistency across every shot. No subtitles, no on-screen text, no logos, no extra people.");
  }
  return parts.filter(Boolean).join(" ");
}

function soundLines(spec: ShotSpec): string {
  const ambience = clean(spec.sound) || "The natural sound of the place and the action";
  const music = clean(spec.music) || "No music; natural sound only.";
  return `overall_soundscape: ${end(ambience)} No dialogue except what is written, no music in the ambience.\nnon_diegetic_music: ${end(music)}`;
}

// ----- the compiler ------------------------------------------------------------------

export function compile(input: CompileInput): Compiled {
  const { spec, strategy: s } = input;
  const chars = spec.characterIds.map((id) => input.characters.find((c) => c.id === id)).filter((c): c is Character => Boolean(c));
  const env = spec.environmentId ? input.environments.find((e) => e.id === spec.environmentId) ?? null : null;

  // Identity first: characters, then the environment. Nine at most.
  const references: Reference[] = [];
  const labels = new Map<string, string>();
  for (const c of chars) {
    if (c.referenceImages[0] && references.length < 9) {
      const label = `<Subject ${references.length + 1}>`;
      labels.set(c.id, label);
      references.push({ label, kind: "character", name: c.name, image: c.referenceImages[0], retention: "fully_preserved" });
    }
  }
  if (env?.referenceImages[0] && references.length < 9) {
    const label = `<Subject ${references.length + 1}>`;
    labels.set(env.id, label);
    references.push({ label, kind: "environment", name: env.name, image: env.referenceImages[0], retention: "partially_preserved" });
  }
  const names = new Map(chars.map((c) => [c.id, upperName(c.name)]));
  const ctx: Ctx = { spec, s, chars, env, labels, names, previous: clean(input.previous?.endsOn) };
  const description = [shotsText(ctx), closing(ctx, input.instructions ?? "")].filter(Boolean).join("\n\n");

  let prompt: string;
  if (references.length) {
    const defs = references
      .map((r) => {
        if (r.kind === "character") {
          const c = chars.find((x) => x.name === r.name)!;
          return `${r.label} is ${upperName(c.name)}: ${characterLook(c, "standard", chars.length)} Retention: fully_preserved.`;
        }
        return `${r.label} is the set ${upperName(r.name)}: ${sentences(env!.description, 2) || "the location"} Retention: partially_preserved.`;
      })
      .join("\n");
    const retention = references
      .map((r) =>
        r.kind === "character"
          ? `${r.label} (appears in [Shot 1]): fully_preserved - the identity, face, hair, skin and wardrobe of ${upperName(r.name)} are retained exactly.`
          : `${r.label} (appears in [Shot 1]): partially_preserved - the layout, materials, dressing and light are retained; the camera may see new angles of it.`,
      )
      .join("\n");
    const shotCount = s.structure === "timed-cuts" && spec.beats.length > 1 ? Math.min(spec.beats.length, 4) : 1;
    prompt = [
      `subject_definitions:\n${defs}`,
      `summary: [reference generation] ${clean(spec.title) || "Untitled"} — ${shotCount} shot${shotCount === 1 ? "" : "s"}, ${spec.durationSec}s: ${clean(spec.framing)}, ${spec.camera.move}.`,
      `retention_analysis:\n${retention}`,
      `detailed_description: ${description}`,
      soundLines(spec),
    ].join("\n");
  } else {
    prompt = [`integrated_multimodal_description: ${description}`, soundLines(spec)].join("\n");
  }
  return {
    mode: references.length ? "ref2va" : "base",
    prompt,
    references,
    chars: prompt.length,
    words: prompt.split(/\s+/).filter(Boolean).length,
  };
}

/** WanGP treats line breaks as separate prompts — flatten before sending. */
export function flatten(prompt: string): string {
  return prompt.replace(/\s*\n+\s*/g, " ").trim();
}
