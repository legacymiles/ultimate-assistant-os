// ---------------------------------------------------------------------------
// What the person is making, and the technical rules that come with it.
//
// The rules are the hidden layer: they are appended to the prompt at generate
// time so a T-shirt graphic comes back isolated and print-safe and a logo comes
// back flat and centred, without the person having to know those words. The
// builder shows them under "Behind the scenes" for anyone curious, but never
// asks anyone to manage them.
// ---------------------------------------------------------------------------

export type DeliverableId =
  | "tshirt"
  | "hoodie"
  | "poster"
  | "logo"
  | "social"
  | "album"
  | "character"
  | "product"
  | "artwork"
  | "custom";

export interface Deliverable {
  id: DeliverableId;
  label: string;
  /** One line under the tile. */
  blurb: string;
  /** "2:3", "1:1" … what the image model is asked for. */
  aspect: string;
  width: number;
  height: number;
  /** Print or screen target, shown in the technical layer. */
  target: string;
  /** Instructions added to every prompt for this deliverable. */
  rules: string[];
  /** Chips the builder suggests first for this deliverable. */
  starters: string[];
}

export const DELIVERABLES: Deliverable[] = [
  {
    id: "tshirt",
    label: "T-shirt Design",
    blurb: "Front print, isolated, screen-print ready",
    aspect: "1:1",
    width: 1024,
    height: 1024,
    target: "Print: 4500×5400 px at 300 DPI after upscale",
    rules: [
      "standalone t-shirt graphic isolated on a plain solid background, no garment, no mockup",
      "centered composition with clear margins, nothing touching the edges",
      "bold clean shapes and strong outlines that survive screen printing",
      "limited colour palette, no photographic background, no tiny hairline detail",
      "no watermark, no signature, no extra text unless asked for",
    ],
    starters: ["centered composition", "isolated subject", "screen print style", "black ink only"],
  },
  {
    id: "hoodie",
    label: "Hoodie Design",
    blurb: "Oversized back print, bold and symmetrical",
    aspect: "4:5",
    width: 896,
    height: 1120,
    target: "Print: back panel 3600×4500 px at 300 DPI",
    rules: [
      "large back-print graphic for a hoodie, isolated on a plain solid background, no garment",
      "tall vertical layout that fills a back panel, symmetrical where possible",
      "heavy linework and high contrast so it reads from across a room",
      "limited colour palette suited to screen or DTF printing",
      "no watermark, no mockup, no model",
    ],
    starters: ["symmetrical composition", "distressed texture", "high contrast"],
  },
  {
    id: "poster",
    label: "Poster",
    blurb: "Portrait layout with room for type",
    aspect: "2:3",
    width: 832,
    height: 1248,
    target: "Print: 18×24 in at 300 DPI after upscale",
    rules: [
      "portrait poster layout with a clear focal point and visual hierarchy",
      "leave a calm band of negative space for a title",
      "keep important elements inside a safe margin away from the trim edge",
      "any lettering large, legible and spelled exactly as given",
    ],
    starters: ["negative space", "stacked headline", "halftone texture"],
  },
  {
    id: "logo",
    label: "Logo",
    blurb: "Flat vector mark, centred, scalable",
    aspect: "1:1",
    width: 1024,
    height: 1024,
    target: "Vector-ready: trace to SVG",
    rules: [
      "flat vector logo mark, simple geometric shapes, no gradients unless asked",
      "single centered mark on a plain solid background with generous padding",
      "must read clearly at 32 px: no fine detail, no photographic texture",
      "two or three colours at most, high contrast between mark and background",
      "no mockup, no shadow, no 3D bevel, no extra text unless a wordmark is asked for",
    ],
    starters: ["flat vector", "centered composition", "negative space"],
  },
  {
    id: "social",
    label: "Social Media Graphic",
    blurb: "4:5 feed post, thumb-stopping",
    aspect: "4:5",
    width: 1080,
    height: 1350,
    target: "Screen: 1080×1350 px (Instagram portrait)",
    rules: [
      "vertical 4:5 social feed graphic with one strong focal point",
      "keep the subject inside the central safe area; corners may be cropped by apps",
      "bold readable shapes and high contrast that stand out on a small phone screen",
    ],
    starters: ["energetic", "high contrast", "minimal composition"],
  },
  {
    id: "album",
    label: "Album Cover",
    blurb: "Square art, iconic at thumbnail size",
    aspect: "1:1",
    width: 1024,
    height: 1024,
    target: "Streaming: 3000×3000 px",
    rules: [
      "square album cover artwork, iconic and readable as a small thumbnail",
      "one memorable central image; leave space for an artist name and title",
      "cohesive moody colour grade",
    ],
    starters: ["moody", "centered composition", "film grain"],
  },
  {
    id: "character",
    label: "Character Design",
    blurb: "Full body, clean read, consistent design",
    aspect: "2:3",
    width: 832,
    height: 1248,
    target: "Concept sheet: full body at 2:3",
    rules: [
      "full body character design, the whole figure visible head to toe",
      "neutral or simple background so the silhouette reads clearly",
      "clear costume details, consistent proportions, readable silhouette",
      "three-quarter view unless another angle is asked for",
    ],
    starters: ["full body shot", "three-quarter view", "rim light"],
  },
  {
    id: "product",
    label: "Product Photography",
    blurb: "Hero shot, studio light, sharp focus",
    aspect: "4:5",
    width: 896,
    height: 1120,
    target: "E-commerce: 2000×2500 px",
    rules: [
      "professional product photograph, the product is the hero and in sharp focus",
      "controlled studio lighting with soft reflections and clean shadows",
      "simple uncluttered background that complements the product",
      "true-to-life materials and proportions; no warped labels or extra parts",
    ],
    starters: ["product photography", "soft studio lighting", "sharp focus"],
  },
  {
    id: "artwork",
    label: "Digital Artwork",
    blurb: "Free canvas, 3:2 cinematic",
    aspect: "3:2",
    width: 1216,
    height: 832,
    target: "Screen: 3:2, upscale for print",
    rules: ["finished digital artwork with a clear focal point and considered composition"],
    starters: ["cinematic lighting", "atmospheric haze", "ultra-detailed"],
  },
  {
    id: "custom",
    label: "Custom",
    blurb: "No rules added — your words only",
    aspect: "1:1",
    width: 1024,
    height: 1024,
    target: "Square, nothing added",
    rules: [],
    starters: [],
  },
];

export function deliverableById(id: string | undefined | null): Deliverable {
  return DELIVERABLES.find((d) => d.id === id) ?? DELIVERABLES[DELIVERABLES.length - 1];
}
