// ---------------------------------------------------------------------------
// Auteur — the studio's vocabulary.
//
// Templates say WHAT KIND of film this is and carry production defaults.
// Genres say how it FEELS and carry tone, light and camera tendencies. They
// are separate axes on purpose: a Commercial can be Horror, a Music Video can
// be Comedy. The director reads both.
// ---------------------------------------------------------------------------

import type { AspectRatio, CameraMovement, Framing, Reference } from "./types";

export interface Template {
  id: string;
  name: string;
  blurb: string;
  /** Default running time the breakdown aims for. */
  targetSec: number;
  /** Each generated clip is this long by default (H3 clips are short). */
  shotSec: number;
  aspect: AspectRatio;
  /** Story beats the breakdown follows in order. */
  beats: string[];
  /** One line the director folds into every prompt. */
  production: string;
  pacing: "slow" | "measured" | "brisk" | "rapid";
  /** Two hues for the template card's gradient. */
  hue: [number, number];
}

export const TEMPLATES: Template[] = [
  {
    id: "short-film",
    name: "Short Film",
    blurb: "A complete story with a beginning, a turn and an ending.",
    targetSec: 60,
    shotSec: 6,
    aspect: "16:9",
    beats: ["Establish", "Meet", "Complication", "Turn", "Climax", "Resolution"],
    production: "narrative short film, cinematic 35mm look, naturalistic performances",
    pacing: "measured",
    hue: [28, 350],
  },
  {
    id: "music-video",
    name: "Music Video",
    blurb: "Performance and story cut to a track.",
    targetSec: 60,
    shotSec: 6,
    aspect: "16:9",
    beats: ["Intro", "Verse", "Build", "Chorus", "Bridge", "Final chorus"],
    production: "music video, stylised, rhythmic cutting, bold colour, performance energy",
    pacing: "brisk",
    hue: [290, 200],
  },
  {
    id: "commercial",
    name: "Commercial",
    blurb: "A 30-second spot that sells a feeling.",
    targetSec: 30,
    shotSec: 6,
    aspect: "16:9",
    beats: ["Hook", "Problem", "Reveal", "Payoff", "Brand"],
    production: "high-end TV commercial, polished, clean product-forward cinematography",
    pacing: "brisk",
    hue: [200, 160],
  },
  {
    id: "product-ad",
    name: "Product Ad",
    blurb: "The product is the hero. Every frame flatters it.",
    targetSec: 24,
    shotSec: 6,
    aspect: "16:9",
    beats: ["Tease", "Detail", "In use", "Hero"],
    production: "premium product film, macro detail, studio lighting, slow deliberate motion",
    pacing: "slow",
    hue: [45, 20],
  },
  {
    id: "ugc-ad",
    name: "UGC Ad",
    blurb: "Feels like a real person filmed it on their phone.",
    targetSec: 30,
    shotSec: 6,
    aspect: "9:16",
    beats: ["Hook", "Show", "Proof", "Call to action"],
    production: "authentic UGC style, phone footage, natural light, direct-to-camera, vertical",
    pacing: "rapid",
    hue: [150, 60],
  },
  {
    id: "trailer",
    name: "Movie Trailer",
    blurb: "Escalating moments, big title cards, no spoilers.",
    targetSec: 60,
    shotSec: 6,
    aspect: "16:9",
    beats: ["Calm", "Disruption", "Escalation", "Montage", "Title", "Button"],
    production: "feature film trailer, epic scale, dramatic contrast, wide anamorphic frames",
    pacing: "rapid",
    hue: [0, 40],
  },
  {
    id: "social",
    name: "Social Media Video",
    blurb: "Vertical, fast, made to stop the scroll.",
    targetSec: 20,
    shotSec: 5,
    aspect: "9:16",
    beats: ["Hook", "Beat", "Beat", "Payoff"],
    production: "vertical social video, punchy, bright, high-energy, centre-framed subject",
    pacing: "rapid",
    hue: [320, 30],
  },
  {
    id: "fashion",
    name: "Fashion Film",
    blurb: "Movement, fabric, attitude, light.",
    targetSec: 40,
    shotSec: 6,
    aspect: "9:16",
    beats: ["Arrival", "Pose", "Motion", "Detail", "Exit"],
    production: "editorial fashion film, high-fashion styling, controlled studio and location light",
    pacing: "measured",
    hue: [330, 270],
  },
  {
    id: "documentary",
    name: "Documentary",
    blurb: "Observed, honest, patient.",
    targetSec: 60,
    shotSec: 6,
    aspect: "16:9",
    beats: ["Place", "Person", "Process", "Moment", "Reflection"],
    production: "observational documentary, natural available light, handheld, real texture",
    pacing: "slow",
    hue: [180, 100],
  },
  {
    id: "cinematic-scene",
    name: "Cinematic Scene",
    blurb: "One scene, staged and shot like a feature.",
    targetSec: 36,
    shotSec: 6,
    aspect: "16:9",
    beats: ["Establish", "Coverage", "Reaction", "Beat", "Out"],
    production: "single feature-film scene, classic coverage, motivated light, deliberate blocking",
    pacing: "measured",
    hue: [220, 260],
  },
  {
    id: "horror-short",
    name: "Horror Short",
    blurb: "Dread first, the scare last.",
    targetSec: 48,
    shotSec: 6,
    aspect: "16:9",
    beats: ["Normal", "Wrong", "Search", "Reveal", "Scare", "Aftermath"],
    production: "horror short, oppressive shadow, slow reveals, negative space, unsettling stillness",
    pacing: "slow",
    hue: [0, 260],
  },
  {
    id: "explainer",
    name: "Explainer",
    blurb: "Show how something works, step by step.",
    targetSec: 36,
    shotSec: 6,
    aspect: "16:9",
    beats: ["Question", "Step", "Step", "Step", "Result"],
    production: "clear explainer video, clean staging, readable compositions, even lighting",
    pacing: "measured",
    hue: [200, 220],
  },
  {
    id: "travel",
    name: "Travel Film",
    blurb: "A place, felt.",
    targetSec: 48,
    shotSec: 6,
    aspect: "16:9",
    beats: ["Arrival", "Streets", "People", "Golden hour", "Night"],
    production: "travel film, sweeping establishing shots, golden hour, drone and gimbal movement",
    pacing: "measured",
    hue: [190, 40],
  },
];

export interface Genre {
  id: string;
  name: string;
  tone: string;
  lighting: string;
  palette: string;
  /** Camera habits the breakdown leans on. */
  camera: string;
  /** Preferred movements, most typical first. */
  movements: CameraMovement[];
  /** Hue for the genre chip. */
  hue: number;
}

export const GENRES: Genre[] = [
  {
    id: "comedy",
    name: "Comedy",
    tone: "light, playful, timing-driven",
    lighting: "bright, even, high-key",
    palette: "warm saturated colour",
    camera: "clean static frames that let the joke land, quick punch-ins",
    movements: ["static", "push in", "pan left"],
    hue: 48,
  },
  {
    id: "drama",
    name: "Drama",
    tone: "grounded, intimate, emotionally honest",
    lighting: "soft motivated light, gentle contrast",
    palette: "muted naturals, warm skin tones",
    camera: "slow pushes, held close-ups, patient coverage",
    movements: ["push in", "static", "handheld"],
    hue: 30,
  },
  {
    id: "romance",
    name: "Romance",
    tone: "tender, hopeful, charged with longing",
    lighting: "golden backlight, soft glow, city lights as bokeh",
    palette: "warm golds, soft pinks, deep evening blues",
    camera: "shallow focus, slow push-ins, two-shots that drift closer",
    movements: ["push in", "orbit", "tracking"],
    hue: 340,
  },
  {
    id: "horror",
    name: "Horror",
    tone: "dread, unease, the wrongness of the ordinary",
    lighting: "low-key, single hard sources, deep shadow",
    palette: "desaturated, cold, sickly greens and blacks",
    camera: "slow creeping pushes, unmotivated holds, sudden static reveals",
    movements: ["push in", "static", "handheld", "tilt up"],
    hue: 0,
  },
  {
    id: "action",
    name: "Action",
    tone: "kinetic, urgent, physical",
    lighting: "hard directional light, practical sparks and flares",
    palette: "high contrast, teal shadows, orange highlights",
    camera: "tracking shots, whip pans, handheld energy, low angles",
    movements: ["tracking", "handheld", "shake", "pan right"],
    hue: 20,
  },
  {
    id: "thriller",
    name: "Thriller",
    tone: "tense, paranoid, coiled",
    lighting: "sharp contrast, venetian shadows, cold practicals",
    palette: "steel blue, sodium orange, black",
    camera: "long lenses, surveillance-like framing, slow zooms",
    movements: ["zoom in", "push in", "static", "tracking"],
    hue: 210,
  },
  {
    id: "sci-fi",
    name: "Sci-Fi",
    tone: "awe, scale, cool precision",
    lighting: "clean hard light, neon accents, volumetric haze",
    palette: "cyan, chrome, deep violet",
    camera: "wide anamorphic frames, slow crane moves, symmetrical compositions",
    movements: ["crane up", "push in", "orbit", "tracking"],
    hue: 190,
  },
  {
    id: "fantasy",
    name: "Fantasy",
    tone: "wonder, myth, the impossible made real",
    lighting: "magical rim light, dappled forest sun, glowing sources",
    palette: "emerald, gold, twilight purple",
    camera: "sweeping wides, rising crane reveals, slow orbits",
    movements: ["crane up", "orbit", "tracking", "pull out"],
    hue: 130,
  },
  {
    id: "crime",
    name: "Crime",
    tone: "hard, moral grey, streetwise",
    lighting: "neon and sodium street light, rain-slicked reflections",
    palette: "noir greens, amber, wet black",
    camera: "over-the-shoulder tension, low tracking shots, static wides",
    movements: ["tracking", "static", "push in", "handheld"],
    hue: 60,
  },
  {
    id: "mystery",
    name: "Mystery",
    tone: "curious, withheld, quietly unsettling",
    lighting: "pools of light in darkness, soft fog",
    palette: "sepia, slate, candle amber",
    camera: "slow reveals, POV drifts, details in insert shots",
    movements: ["push in", "pan left", "tilt down", "static"],
    hue: 40,
  },
  {
    id: "emotional",
    name: "Emotional",
    tone: "raw, vulnerable, cathartic",
    lighting: "window light, soft wrap, dusk",
    palette: "warm neutrals, faded pastels",
    camera: "held close-ups on faces, slow pushes, reactions over actions",
    movements: ["push in", "static", "handheld"],
    hue: 15,
  },
  {
    id: "musical",
    name: "Musical",
    tone: "exuberant, choreographed, larger than life",
    lighting: "theatrical spots, saturated washes",
    palette: "primary colours, stage gold",
    camera: "wide shots that hold choreography, orbiting the lead, crane rises",
    movements: ["orbit", "crane up", "tracking", "pull out"],
    hue: 300,
  },
  {
    id: "adventure",
    name: "Adventure",
    tone: "bold, open, forward momentum",
    lighting: "sun-drenched, natural, golden hour",
    palette: "earth tones, sky blue, sun gold",
    camera: "epic wides, drone-like rises, following the hero",
    movements: ["crane up", "tracking", "pull out"],
    hue: 100,
  },
  {
    id: "noir",
    name: "Noir",
    tone: "cynical, shadowed, elegant",
    lighting: "hard single source, blinds, smoke",
    palette: "monochrome, deep blacks, one accent colour",
    camera: "dutch angles, high contrast close-ups, static compositions",
    movements: ["static", "push in", "tilt up"],
    hue: 240,
  },
  {
    id: "coming-of-age",
    name: "Coming-of-age",
    tone: "nostalgic, bittersweet, alive",
    lighting: "summer light, lens flare, fairy lights at night",
    palette: "sun-faded film colours",
    camera: "handheld intimacy, wide shots of small figures in big places",
    movements: ["handheld", "tracking", "static", "pull out"],
    hue: 35,
  },
];

export function templateById(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}

export function genreById(id: string): Genre | undefined {
  return GENRES.find((g) => g.id === id);
}

export const ASPECTS: AspectRatio[] = ["16:9", "9:16", "1:1"];

/** MiniMax H3 renders 4–15 seconds per clip. */
export const MIN_SHOT_SEC = 4;
export const MAX_SHOT_SEC = 15;

export type Resolution = "768P" | "2K";
export const RESOLUTIONS: { id: Resolution; label: string; hint: string }[] = [
  { id: "768P", label: "768P", hint: "Draft quality, cheaper and faster" },
  { id: "2K", label: "2K", hint: "Final quality" },
];

/** The framings the breakdown cycles through when it has nothing better. */
export const COVERAGE_ORDER: Framing[] = [
  "wide",
  "medium",
  "close-up",
  "medium close-up",
  "medium wide",
  "extreme close-up",
  "insert",
  "extreme wide",
];

/** Reference kinds with the label and hint shown in the asset library. */
export const REFERENCE_KINDS: { id: Reference["kind"]; label: string; hint: string }[] = [
  { id: "character", label: "Character", hint: "A person or creature who must look the same in every shot" },
  { id: "location", label: "Location", hint: "A place, set or environment" },
  { id: "object", label: "Object / product", hint: "A prop, product, vehicle or item to feature" },
  { id: "style", label: "Style", hint: "A look, grade, film still or artwork to match" },
  { id: "image", label: "Image", hint: "A general visual reference" },
  { id: "video", label: "Video", hint: "Motion, pacing or camera reference" },
  { id: "audio", label: "Audio", hint: "Music or sound the cut plays to" },
];


/** Hue used to paint animatics and posters when there is no clip. */
export function hueFor(project: { genreIds: string[]; templateId: string }): number {
  const g = project.genreIds.map(genreById).find(Boolean);
  if (g) return g.hue;
  return templateById(project.templateId).hue[0];
}
