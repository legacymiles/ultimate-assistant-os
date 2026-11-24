// ---------------------------------------------------------------------------
// Image Studio › Inspire — the words everything else is sorted by.
//
// Two lists that look alike and are not the same thing:
//
//   CHIP_CATEGORIES   the 16 drawers of the Prompt Builder's chip library
//                     (Characters, Wardrobe, Pose, Typography …). Every chip
//                     in the system carries exactly one of these.
//   DNA_GROUPS        the 10 headings Prompt DNA shows under an image
//                     (Subject, Art Style, Lighting …). Each chip category
//                     folds into one group, so a chip saved from an image
//                     lands in the right builder drawer and vice versa.
//
// Each group owns a hue. That hue is the chip's glow everywhere in the app,
// so the colour of a chip tells you what kind of ingredient it is before you
// read it.
// ---------------------------------------------------------------------------

export type DnaGroupId =
  | "subject"
  | "style"
  | "lighting"
  | "camera"
  | "composition"
  | "environment"
  | "texture"
  | "color"
  | "mood"
  | "effects";

export interface DnaGroup {
  id: DnaGroupId;
  label: string;
  /** OKLCH hue, 0–360. */
  hue: number;
  /** What this kind of ingredient does to a picture, in one line. */
  role: string;
}

export const DNA_GROUPS: DnaGroup[] = [
  { id: "subject", label: "Subject / Character", hue: 28, role: "Who or what the picture is about." },
  { id: "style", label: "Art Style", hue: 300, role: "The medium and rendering technique." },
  { id: "lighting", label: "Lighting", hue: 85, role: "Where light comes from and how hard it falls." },
  { id: "camera", label: "Camera / Lens", hue: 210, role: "Lens, angle and how the frame is shot." },
  { id: "composition", label: "Composition", hue: 175, role: "How things are arranged inside the frame." },
  { id: "environment", label: "Environment", hue: 145, role: "The place, setting and background." },
  { id: "texture", label: "Texture / Detail", hue: 55, role: "Surface quality and level of detail." },
  { id: "color", label: "Color Palette", hue: 340, role: "The colours that dominate the image." },
  { id: "mood", label: "Mood / Atmosphere", hue: 255, role: "The feeling the picture gives off." },
  { id: "effects", label: "Visual Effects", hue: 190, role: "Fog, glow, particles and other effects." },
];

export type ChipCategoryId =
  | "character"
  | "subject"
  | "wardrobe"
  | "accessories"
  | "pose"
  | "scene"
  | "environment"
  | "camera"
  | "lighting"
  | "style"
  | "composition"
  | "color"
  | "texture"
  | "effects"
  | "typography"
  | "mood";

export interface ChipCategory {
  id: ChipCategoryId;
  label: string;
  group: DnaGroupId;
}

/** Order matters: it is also the order the builder assembles a prompt in. */
export const CHIP_CATEGORIES: ChipCategory[] = [
  { id: "character", label: "Characters", group: "subject" },
  { id: "subject", label: "Subjects", group: "subject" },
  { id: "wardrobe", label: "Wardrobe", group: "subject" },
  { id: "accessories", label: "Accessories", group: "subject" },
  { id: "pose", label: "Pose", group: "composition" },
  { id: "scene", label: "Scene", group: "environment" },
  { id: "environment", label: "Environment", group: "environment" },
  { id: "style", label: "Art Styles", group: "style" },
  { id: "typography", label: "Typography", group: "style" },
  { id: "camera", label: "Camera", group: "camera" },
  { id: "composition", label: "Composition", group: "composition" },
  { id: "lighting", label: "Lighting", group: "lighting" },
  { id: "color", label: "Color Palettes", group: "color" },
  { id: "texture", label: "Textures", group: "texture" },
  { id: "effects", label: "Visual Effects", group: "effects" },
  { id: "mood", label: "Mood", group: "mood" },
];

const CATEGORY_BY_ID = new Map(CHIP_CATEGORIES.map((c) => [c.id, c]));
const GROUP_BY_ID = new Map(DNA_GROUPS.map((g) => [g.id, g]));

export function isChipCategory(v: unknown): v is ChipCategoryId {
  return typeof v === "string" && CATEGORY_BY_ID.has(v as ChipCategoryId);
}

export function categoryOf(id: ChipCategoryId): ChipCategory {
  return CATEGORY_BY_ID.get(id) ?? CHIP_CATEGORIES[1];
}

export function groupOf(category: ChipCategoryId): DnaGroup {
  return GROUP_BY_ID.get(categoryOf(category).group)!;
}

export function groupById(id: DnaGroupId): DnaGroup {
  return GROUP_BY_ID.get(id) ?? DNA_GROUPS[0];
}

/** The hue a chip glows with. */
export function hueOf(category: ChipCategoryId): number {
  return groupOf(category).hue;
}

/** Position in assembly order; unknown categories sort last. */
export function categoryRank(id: ChipCategoryId): number {
  const i = CHIP_CATEGORIES.findIndex((c) => c.id === id);
  return i < 0 ? CHIP_CATEGORIES.length : i;
}

// ----- the gallery's own facets ---------------------------------------------

export const GALLERY_CATEGORIES = [
  { id: "tshirt", label: "T-shirt Designs" },
  { id: "logo", label: "Logos" },
  { id: "typography", label: "Typography" },
  { id: "character", label: "Characters" },
  { id: "3d", label: "3D Art" },
  { id: "photography", label: "Photography" },
  { id: "poster", label: "Posters" },
  { id: "illustration", label: "Illustrations" },
  { id: "streetwear", label: "Streetwear" },
  { id: "product", label: "Product Design" },
  { id: "digital-art", label: "Digital Art" },
] as const;

export type GalleryCategoryId = (typeof GALLERY_CATEGORIES)[number]["id"];

export const ART_STYLES = [
  "Cyberpunk",
  "Minimalist",
  "Retro / Vintage",
  "Photorealistic",
  "Anime",
  "3D Render",
  "Vaporwave",
  "Watercolor",
  "Line Art",
  "Surreal",
  "Brutalist",
  "Y2K",
] as const;

export const SUBJECTS = [
  "Person",
  "Creature",
  "Animal",
  "Object",
  "Vehicle",
  "Architecture",
  "Landscape",
  "Lettering",
  "Food",
  "Abstract",
] as const;

export function isGalleryCategory(v: unknown): v is GalleryCategoryId {
  return typeof v === "string" && GALLERY_CATEGORIES.some((c) => c.id === v);
}

export function galleryCategoryLabel(id: string): string {
  return GALLERY_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}
