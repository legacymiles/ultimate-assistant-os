// ---------------------------------------------------------------------------
// The compiler's knobs. A technique = one knob set to one value.
//
// Every value says what it does and where the idea came from, so the Guide
// and the Comparisons screen can show provenance next to the evidence.
// ---------------------------------------------------------------------------

import type { Knob, Strategy, TechniqueId } from "./model";

export interface KnobValue {
  value: string;
  label: string;
  does: string;
  source: string;
}

export interface KnobDef {
  knob: Knob;
  label: string;
  question: string;
  values: KnobValue[];
}

export const KNOBS: KnobDef[] = [
  {
    knob: "order",
    label: "Lead block",
    question: "What does the prompt establish first?",
    values: [
      {
        value: "character-first",
        label: "Character first",
        does: "Opens on who is in the shot (look, wardrobe, retention) before the set and the camera.",
        source: "MiniMax ref-en guide: subject_definitions lead the Ref2VA brief",
      },
      {
        value: "environment-first",
        label: "Environment first",
        does: "Opens on the room/world and its layout, then places characters inside it.",
        source: "Lab hypothesis: sets drift when they are described after the people",
      },
      {
        value: "cinematography-first",
        label: "Cinematography first",
        does: "Opens on style, framing, lens feel and the camera move, then subject and action.",
        source: "MiniMax base-en guide: [Shot 1] opens with style + composition",
      },
      {
        value: "action-first",
        label: "Action first",
        does: "Opens on the change that happens, mid-event, then who and where.",
        source: "h3-stitched-film / h3-long-story: anything that must happen is mid-event in frame one",
      },
    ],
  },
  {
    knob: "camera",
    label: "Camera wording",
    question: "How is the camera move written?",
    values: [
      {
        value: "official-prose",
        label: "Official prose",
        does: "One sentence: move type + amplitude + speed + focus (\"The camera pushes in with small amplitude at slow speed toward her eyes\").",
        source: "MiniMax base-en camera vocabulary; h3-prompt camera table",
      },
      {
        value: "plain-big",
        label: "Plain & big",
        does: "Names the move in everyday words and makes it big, tied to the beat (\"the camera whips a full half-circle around them as he turns\").",
        source: "h3-cinematic-prompt: measured moves land when they are large and plain",
      },
      {
        value: "token",
        label: "Token",
        does: "A compact token line (\"Orbit, large amplitude, slow speed\").",
        source: "h3-stitched-film clip plan tokens",
      },
    ],
  },
  {
    knob: "identity",
    label: "Identity handling",
    question: "How is each character's identity carried?",
    values: [
      {
        value: "define-once",
        label: "Define once",
        does: "Full look in the first block only; later shots use the name/label alone.",
        source: "h3-prompt failure pattern: repeated detail makes H3 re-establish (rebuild) the character",
      },
      {
        value: "repeat-every-shot",
        label: "Repeat every shot",
        does: "Repeats face, hair and wardrobe verbatim in every shot block.",
        source: "Jarvis Studio storyboard weaving (world/wardrobe repeated verbatim)",
      },
      {
        value: "anchor-clause",
        label: "Anchor clause",
        does: "Defines once, then one short anchor clause per shot naming the 2-3 most distinctive traits.",
        source: "h3-prompt chained shots: one clause of identity instead of the full description",
      },
    ],
  },
  {
    knob: "length",
    label: "Length budget",
    question: "How long may the prompt be?",
    values: [
      { value: "tight", label: "Tight (~500 chars/shot)", does: "Caption-style: what happens, where the camera is, 4-6 concrete look nouns.", source: "h3-cinematic-prompt ~300-500 chars" },
      { value: "standard", label: "Standard (~1,000/shot)", does: "Full official sections without repetition.", source: "Lab default between the two skills" },
      { value: "rich", label: "Rich (350-500 words)", does: "The official Ref2VA detailed_description band.", source: "MiniMax ref-en: detailed_description 350-500 words" },
    ],
  },
  {
    knob: "structure",
    label: "Shot structure",
    question: "How is one generation split?",
    values: [
      { value: "single-shot", label: "Single shot", does: "One continuous shot: one action, one camera move, no internal cut.", source: "h3-stitched-film one law; seesee75 Director: no cut in a part's last 2 s" },
      { value: "timed-cuts", label: "Timed cuts", does: "[Shot N] At MM:SS.mmm blocks, each cut adding new information.", source: "MiniMax base-en multi-shot format" },
      { value: "scene-by-scene", label: "Scene by scene", does: "One generation per scene beat; continuity carried by explicit handover lines.", source: "h3-long-story: plan in scenes of chained clips" },
    ],
  },
  {
    knob: "environment",
    label: "Set description",
    question: "How is the set written?",
    values: [
      { value: "layout-explicit", label: "Layout explicit", does: "Names where things are (\"door on the far left wall, sofa facing the window, lamp to its right\").", source: "Lab hypothesis for furniture drift" },
      { value: "mood-only", label: "Mood only", does: "Describes the place by feel, light and 3-4 hero objects.", source: "h3-cinematic-prompt: 4-6 concrete nouns, no geometry" },
    ],
  },
  {
    knob: "action",
    label: "Action writing",
    question: "How is what happens written?",
    values: [
      { value: "verb-led-midstate", label: "Verb-led, mid-event", does: "One dominant action, already under way at frame one, led by a strong verb.", source: "h3-cinematic-prompt / h3-long-story law 3" },
      { value: "choreography-beats", label: "Choreography beats", does: "Ordered beats with direction and spatial relation (\"left hook from his right; she ducks under and steps to his left\").", source: "Lab hypothesis for fight / dance accuracy" },
    ],
  },
  {
    knob: "dialogue",
    label: "Dialogue format",
    question: "How are spoken lines written?",
    values: [
      { value: "official-tags", label: "Official tags", does: "(S1) NAME says: <d>[English] …</d>, voice described outside the tag.", source: "MiniMax base-en dialogue rules" },
      { value: "plain", label: "Plain", does: "NAME says, \"…\" in plain prose.", source: "Lab control" },
    ],
  },
  {
    knob: "closing",
    label: "Closing clause",
    question: "Does the prompt end with a consistency clause?",
    values: [
      { value: "consistency-clause", label: "Consistency clause", does: "Ends: impeccable subject consistency, no subtitles/text/logos, no extra people.", source: "h3-prompt closing block" },
      { value: "none", label: "None", does: "Ends on the last shot.", source: "Lab control" },
    ],
  },
];

export const BASE_STRATEGY: Strategy = {
  order: "cinematography-first",
  camera: "official-prose",
  identity: "define-once",
  length: "standard",
  structure: "single-shot",
  environment: "mood-only",
  action: "verb-led-midstate",
  dialogue: "official-tags",
  closing: "consistency-clause",
};

export function knobDef(knob: Knob): KnobDef {
  const def = KNOBS.find((k) => k.knob === knob);
  if (!def) throw new Error(`Unknown knob ${knob}`);
  return def;
}

export function isValidValue(knob: Knob, value: unknown): boolean {
  return typeof value === "string" && knobDef(knob).values.some((v) => v.value === value);
}

/** Keep only real knob=value pairs (an LLM or an old save can send anything). */
export function cleanOverrides(raw: unknown): Partial<Strategy> {
  const out: Partial<Strategy> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const def of KNOBS) {
    const v = (raw as Record<string, unknown>)[def.knob];
    if (isValidValue(def.knob, v)) (out as Record<string, unknown>)[def.knob] = v;
  }
  return out;
}

export function merge(...layers: (Partial<Strategy> | undefined)[]): Strategy {
  const out: Strategy = { ...BASE_STRATEGY };
  for (const layer of layers) if (layer) Object.assign(out, cleanOverrides(layer));
  return out;
}

export function techniqueId(knob: Knob, value: string): TechniqueId {
  return `${knob}=${value}` as TechniqueId;
}

export function parseTechnique(id: string): { knob: Knob; value: string } | null {
  const [knob, value] = id.split("=");
  if (!knob || !value) return null;
  if (!KNOBS.some((k) => k.knob === knob)) return null;
  return { knob: knob as Knob, value };
}

export function techniqueLabel(id: string): string {
  const t = parseTechnique(id);
  if (!t) return id;
  const def = knobDef(t.knob);
  return `${def.label}: ${def.values.find((v) => v.value === t.value)?.label ?? t.value}`;
}

/** The techniques where `a` and `b` differ, as b's values (what b changes). */
export function differingTechniques(a: Strategy, b: Strategy): TechniqueId[] {
  return KNOBS.filter((k) => a[k.knob] !== b[k.knob]).map((k) => techniqueId(k.knob, b[k.knob]));
}
