// ---------------------------------------------------------------------------
// N genuinely different takes on one compiled H3 prompt.
//
// A variation is not a reworded copy. Each one moves four axes at once —
// camera emphasis, lighting, lens, pacing — to a value no other variation
// uses, so rendering three variations is three different films of the same
// beat, and the owner learns which look the shot wants.
//
// Wording follows the h3-prompt skill (skills/h3-prompt/SKILL.md):
//   - the camera is ONE sentence from the fixed vocabulary, type + amplitude +
//     speed, and it REPLACES the old camera sentence (two camera states in one
//     shot is the failure the skill exists to prevent);
//   - lighting replaces the shot's own lighting sentence rather than adding a
//     second one (saying light twice invites H3 to relight mid-shot);
//   - the lens is said in words, never only as numbers;
//   - detail goes in the first shot block only; pacing goes in the closing
//     block, before the consistency clause.
// Pure, deterministic: the same prompt and n always give the same variations.
// ---------------------------------------------------------------------------

export interface H3Variation {
  n: number;
  label: string;
  axes: { camera: string; lighting: string; lens: string; pacing: string };
  prompt: string;
}

export const MAX_VARIATIONS = 6;

interface CameraAlt {
  key: string;
  label: string;
  /** Prose from the skill's vocabulary; `{T}` is the subject when there is one. */
  moving: boolean;
  text: string;
}

// Amplitude rules from the skill: static always small, crane / orbit / arc always large.
const CAMERA: CameraAlt[] = [
  { key: "push", label: "slow push-in", moving: true, text: "The camera pushes in with small amplitude at slow speed" },
  // Handheld drifts rather than travels, so it holds on the subject like the skill's still forms.
  { key: "handheld", label: "handheld", moving: false, text: "The camera is handheld, drifting gently with the operator's breath" },
  { key: "arc", label: "arc around", moving: true, text: "The camera arcs around the subject in a clean, polished curve with large amplitude at slow speed" },
  { key: "static", label: "locked off", moving: false, text: "The camera is locked off, perfectly still" },
  { key: "track", label: "tracking", moving: true, text: "The camera tracks alongside the subject at slow speed" },
  { key: "crane", label: "crane up", moving: true, text: "The camera rises on a crane with large amplitude at slow speed" },
  { key: "pull", label: "pull-out reveal", moving: true, text: "The camera pulls out with medium amplitude at slow speed" },
];

const CAMERA_SIGNS: Record<string, RegExp> = {
  push: /pushes in|drives in|push in|dollies in|dolly in|glides straight in/i,
  handheld: /handheld|held by hand/i,
  arc: /arcs around|half-circle|arc shot|orbit/i,
  static: /locked off|completely still|static shot|perfectly still/i,
  track: /tracks alongside|runs alongside|tracking shot/i,
  crane: /crane|lifts high|pedestal/i,
  pull: /pulls out|pulls all the way back|pull out/i,
};

const LIGHTING = [
  { label: "low-key", text: "Low-key light: one hard key from the side, deep shadows, practical lamps glowing in the background." },
  { label: "soft daylight", text: "Soft, diffused daylight from a large window, gentle fill, low contrast." },
  { label: "golden hour", text: "Golden-hour backlight rims the subjects with warm flare and long shadows." },
  { label: "night neon", text: "Cool blue night light with neon accents reflecting off wet surfaces." },
  { label: "overcast", text: "Flat overcast light, muted colours, soft shadowless faces." },
  { label: "high-key", text: "Bright high-key light, clean whites, almost no shadow." },
];

const LENS = [
  { label: "long lens", text: "Shot on a long lens, shallow depth of field, the background blurred to a soft wash." },
  { label: "wide-angle", text: "Shot on a wide-angle lens with deep focus, the whole set sharp and the space exaggerated." },
  { label: "standard 50mm", text: "Shot on a standard 50mm lens, natural perspective, the subject sharp against a gently soft background." },
  { label: "macro close", text: "Shot on a macro lens very close, razor-thin focus on the subject's detail." },
  { label: "anamorphic", text: "Shot on an anamorphic lens, wide frame, oval bokeh and soft horizontal flares." },
  { label: "35mm documentary", text: "Shot on a 35mm lens at eye height, documentary perspective, moderate depth of field." },
];

const PACING = [
  { label: "slow", text: "Slow, deliberate pacing: the action takes the whole shot and ends on a held beat." },
  { label: "brisk", text: "Brisk, energetic pacing: the action lands early and the shot keeps moving." },
  { label: "three beats", text: "Measured pacing in three clear beats, each given equal time." },
  { label: "build", text: "Pacing that starts still and builds, the movement quickening toward the end of the shot." },
  { label: "snap", text: "Snappy pacing: one sharp motion, then stillness." },
  { label: "flowing", text: "Smooth, flowing pacing with no pauses, one continuous movement." },
];

const LIGHT_WORDS = /\b(light|lit|lighting|lamp|lamps|sun|sunlight|daylight|moonlight|shadow|shadows|glow|backlit|backlight|neon|candle)\b/i;
const LENS_SENTENCE = /^Shot on an? [^.]*lens\b/;

/** Split text into sentences, keeping dialogue tags (<d>…</d>) whole. */
function sentencesOf(text: string): string[] {
  const keep: string[] = [];
  const masked = text.replace(/<d>[\s\S]*?<\/d>/g, (m) => `\u0000${keep.push(m) - 1}\u0000`);
  return masked
    .split(/(?<=[.!?]["”’)]?)\s+/)
    .map((p) => p.replace(/\u0000(\d+)\u0000/g, (_, i: string) => keep[Number(i)]).trim())
    .filter(Boolean);
}

const TOKEN_CAMERA = /^(Static shot|Handheld|Push in|Pull out|Dolly in|Tracking shot|Pan (?:left|right)|Tilt (?:up|down)|Pedestal|Arc shot|Orbit|Zoom (?:in|out)|POV|Shake)\b/;

function cameraIndex(sents: string[]): number {
  const i = sents.findIndex((s) => /^The camera\b/.test(s));
  return i >= 0 ? i : sents.findIndex((s) => TOKEN_CAMERA.test(s));
}

function cameraTarget(sentence: string): string {
  const m = /(?:toward|holding on|with)\s+((?:the\s+)?[A-Z][A-Z0-9'’ -]{1,40}?(?:\s\(<Subject \d+>\))?)(?=[,.]|\s—|$)/.exec(sentence);
  return m ? m[1].trim() : "";
}

function currentMove(sentence: string): string | null {
  for (const [k, re] of Object.entries(CAMERA_SIGNS)) if (re.test(sentence)) return k;
  return null;
}

function cameraSentenceFor(alt: CameraAlt, target: string): string {
  if (!target) return `${alt.text}.`;
  return alt.moving ? `${alt.text} toward ${target}.` : `${alt.text}, holding on ${target}.`;
}

/** Where the per-shot prose lives in a compiled prompt. */
function descriptionBounds(prompt: string): { start: number; end: number } {
  const m = /(integrated_multimodal_description|detailed_description):\s*/.exec(prompt);
  const start = m ? m.index + m[0].length : 0;
  const sound = prompt.indexOf("\noverall_soundscape:", start);
  return { start, end: sound >= 0 ? sound : prompt.length };
}

/**
 * Rewrite the first shot block and the closing block of `prompt` with one
 * value per axis. Exported for tests; use variations().
 */
export function applyAxes(
  prompt: string,
  axes: { camera: CameraAlt; lighting: string; lens: string; pacing: string },
): string {
  const { start, end } = descriptionBounds(prompt);
  const desc = prompt.slice(start, end);
  // First shot block = up to the first blank line; the closing block is the last paragraph.
  const paras = desc.split(/\n\n/);
  const firstIdx = paras.findIndex((p) => /\[Shot 1\]/.test(p));
  const fi = firstIdx >= 0 ? firstIdx : 0;
  const first = paras[fi];
  const tag = /^\s*\[Shot 1\]\s*/.exec(first)?.[0] ?? "";
  let sents = sentencesOf(first.slice(tag.length));

  // Camera: replace the existing camera sentence, or add one.
  const camIdx = cameraIndex(sents);
  const target = camIdx >= 0 ? cameraTarget(sents[camIdx]) : "";
  const camera = cameraSentenceFor(axes.camera, target);
  // Lens: drop an earlier variation's lens sentence, then say the new one just before the camera.
  sents = sents.filter((s) => !LENS_SENTENCE.test(s));
  const camAt = cameraIndex(sents);
  if (camAt >= 0) sents.splice(camAt, 1, axes.lens, camera);
  else sents.push(axes.lens, camera);
  // Lighting: the compiler writes the shot's light right before the camera
  // sentence (style · framing · light · camera), so replace that one; with no
  // light stated there, add the new light before the lens.
  const lensAt = sents.indexOf(axes.lens);
  const before = lensAt > 0 ? sents[lensAt - 1] : "";
  if (before && LIGHT_WORDS.test(before) && !/<d>/.test(before) && !/^Already under way/.test(before) && !/:\s/.test(before)) sents.splice(lensAt - 1, 1, axes.lighting);
  else sents.splice(Math.max(0, lensAt), 0, axes.lighting);
  paras[fi] = `${tag}${sents.join(" ")}`;

  // Pacing: in the closing block, before the consistency clause.
  const lastIdx = paras.length - 1;
  if (lastIdx !== fi && !/\[Shot \d+\]/.test(paras[lastIdx])) {
    const closing = paras[lastIdx];
    const clause = closing.indexOf("Impeccable subject consistency");
    paras[lastIdx] = clause >= 0 ? `${closing.slice(0, clause)}${axes.pacing} ${closing.slice(clause)}` : `${closing} ${axes.pacing}`.trim();
  } else {
    paras.push(axes.pacing);
  }
  return `${prompt.slice(0, start)}${paras.join("\n\n")}${prompt.slice(end)}`;
}

/**
 * `n` variations of a compiled H3 prompt (1..MAX_VARIATIONS). Variation i
 * takes the i-th value of every axis, skipping the camera move the prompt
 * already uses, so no two variations share a camera, light, lens or pacing,
 * and none repeats the original camera.
 */
export function variations(prompt: string, n: number): H3Variation[] {
  const count = Math.max(0, Math.min(MAX_VARIATIONS, Math.round(Number(n) || 0)));
  if (!count || !prompt.trim()) return [];
  const { start, end } = descriptionBounds(prompt);
  const firstBlock = prompt.slice(start, end).split(/\n\n/).find((p) => /\[Shot 1\]/.test(p)) ?? prompt.slice(start, end);
  const sents = sentencesOf(firstBlock.replace(/^\s*\[Shot 1\]\s*/, ""));
  const camSentence = sents[cameraIndex(sents)] ?? "";
  const used = currentMove(camSentence);
  const cams = CAMERA.filter((c) => c.key !== used);
  const out: H3Variation[] = [];
  for (let i = 0; i < count; i++) {
    const camera = cams[i % cams.length];
    const lighting = LIGHTING[i % LIGHTING.length];
    const lens = LENS[i % LENS.length];
    const pacing = PACING[i % PACING.length];
    out.push({
      n: i + 1,
      label: `${camera.label} · ${lighting.label} · ${lens.label} · ${pacing.label} pacing`,
      axes: { camera: camera.label, lighting: lighting.label, lens: lens.label, pacing: pacing.label },
      prompt: applyAxes(prompt, { camera, lighting: lighting.text, lens: lens.text, pacing: pacing.text }),
    });
  }
  return out;
}
