// ---------------------------------------------------------------------------
// Seedance Studio — curated dropdown options. Each mood carries a hue so
// placeholder clips (no API key) get a mood-appropriate colour, and so the
// timeline reads at a glance.
// ---------------------------------------------------------------------------

import type { AspectRatio, SegmentType } from "./types";

export interface MoodOption {
  label: string;
  hue: number;
  /** A short phrase appended to the Seedance prompt. */
  phrase: string;
}

export const MOODS: MoodOption[] = [
  { label: "Cinematic", hue: 210, phrase: "cinematic, dramatic lighting, shallow depth of field" },
  { label: "Dramatic", hue: 8, phrase: "dramatic, bold contrast, intense shadows and highlights" },
  { label: "Sad", hue: 220, phrase: "sad, desaturated blue tones, soft rain, slow and heavy" },
  { label: "Melancholic", hue: 228, phrase: "melancholic, muted palette, wistful stillness" },
  { label: "Bittersweet", hue: 275, phrase: "bittersweet, warm-cool contrast, tender and reflective" },
  { label: "Dreamy", hue: 285, phrase: "dreamy, soft focus, ethereal haze, gentle glow" },
  { label: "Romantic", hue: 345, phrase: "romantic, soft warm light, delicate bokeh" },
  { label: "Nostalgic", hue: 35, phrase: "nostalgic, warm film look, golden hour grain" },
  { label: "Hopeful", hue: 48, phrase: "hopeful, rising warm light, airy and uplifting" },
  { label: "Euphoric", hue: 330, phrase: "euphoric, vibrant, glowing highlights, radiant" },
  { label: "Energetic", hue: 20, phrase: "energetic, high-contrast, fast kinetic motion" },
  { label: "Triumphant", hue: 42, phrase: "triumphant, epic golden light, sweeping and grand" },
  { label: "Epic", hue: 200, phrase: "epic, vast scale, volumetric god rays" },
  { label: "Tense", hue: 355, phrase: "tense, suspenseful, cold flicker, unease" },
  { label: "Aggressive", hue: 0, phrase: "aggressive, harsh strobing, gritty and raw" },
  { label: "Dark & Moody", hue: 255, phrase: "dark and moody, low-key lighting, deep shadows" },
  { label: "Eerie", hue: 130, phrase: "eerie, sickly green cast, fog, unsettling calm" },
  { label: "Mysterious", hue: 265, phrase: "mysterious, silhouettes, shafts of light in haze" },
  { label: "Serene", hue: 172, phrase: "serene, calm pastel palette, slow graceful drift" },
  { label: "Chill", hue: 188, phrase: "chill, cool relaxed tones, laid-back tempo" },
  { label: "Playful", hue: 150, phrase: "playful, bright punchy colours, bouncy energy" },
  { label: "Whimsical", hue: 300, phrase: "whimsical, storybook colours, magical sparkle" },
  { label: "Surreal", hue: 312, phrase: "surreal, impossible geometry, otherworldly" },
];

export const EFFECTS: { label: string; phrase: string }[] = [
  { label: "None", phrase: "" },
  { label: "Slow motion", phrase: "silky slow motion, high frame rate" },
  { label: "Speed ramp", phrase: "dynamic speed ramp from slow to fast" },
  { label: "Crash zoom", phrase: "sudden crash zoom punch-in" },
  { label: "Dolly zoom", phrase: "vertigo dolly-zoom, background warping" },
  { label: "Orbit shot", phrase: "camera orbits 360 around the subject" },
  { label: "Whip pan", phrase: "fast whip-pan motion blur transition" },
  { label: "Dutch angle", phrase: "tilted dutch-angle framing" },
  { label: "Fisheye", phrase: "wide fisheye lens distortion" },
  { label: "Tilt-shift", phrase: "tilt-shift miniature, selective focus" },
  { label: "Anamorphic flare", phrase: "anamorphic widescreen with blue lens flares" },
  { label: "Film grain", phrase: "35mm film grain, halation, gate weave" },
  { label: "VHS retro", phrase: "VHS tape artefacts, scanlines, chroma bleed" },
  { label: "Datamosh", phrase: "datamosh pixel-melt glitch transitions" },
  { label: "Glitch", phrase: "digital glitch, RGB split, signal tears" },
  { label: "Infrared", phrase: "infrared thermal false-colour palette" },
  { label: "Double exposure", phrase: "double-exposure blend of two scenes" },
  { label: "Kaleidoscope", phrase: "kaleidoscopic mirrored symmetry" },
  { label: "Prism refraction", phrase: "prismatic light refraction and rainbows" },
  { label: "Light streaks", phrase: "long-exposure light streaks and trails" },
  { label: "Strobe", phrase: "rhythmic strobe flashes on the beat" },
  { label: "Freeze frame", phrase: "freeze-frame hit then resume motion" },
  { label: "Liquid morph", phrase: "liquid morph, fluid shape-shifting" },
  { label: "Particle burst", phrase: "particles dissolve and reform the frame" },
  { label: "Ink bleed", phrase: "ink-bleed and paint-splash reveal" },
];

export const ASPECT_RATIOS: { label: string; value: AspectRatio }[] = [
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" },
  { label: "1:1", value: "1:1" },
];

// Model clips are 5–10s; the editor allows a wider range for shaping the reel.
export const SEEDANCE_MIN = 5;
export const SEEDANCE_MAX = 10;
export const EDIT_MIN_DURATION = 1;
export const EDIT_MAX_DURATION = 15;
export const DEFAULT_DURATION = 5;

export function moodHue(label: string): number {
  return MOODS.find((m) => m.label === label)?.hue ?? 195;
}

/** Compose the full Seedance prompt from a segment + project-level base prompt. */
export function composePrompt(opts: {
  basePrompt: string;
  prompt: string;
  mood: string;
  effect: string;
  type?: SegmentType;
}): string {
  const parts: string[] = [];
  if (opts.type === "lipsync") {
    parts.push(
      "a character singing along to the music, lip-synced, expressive mouth movements matching the lyrics and rhythm",
    );
  } else {
    parts.push("cinematic b-roll footage");
  }
  if (opts.basePrompt.trim()) parts.push(opts.basePrompt.trim());
  if (opts.prompt.trim()) parts.push(opts.prompt.trim());
  const moodPhrase = MOODS.find((m) => m.label === opts.mood)?.phrase;
  if (moodPhrase) parts.push(moodPhrase);
  const effectPhrase = EFFECTS.find((e) => e.label === opts.effect)?.phrase;
  if (effectPhrase) parts.push(effectPhrase);
  return parts.join(", ");
}
