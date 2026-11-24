// Image Studio › Inspire — shared shapes. Plain data only: these cross the wire
// between the browser and the routes, and are stored as JSON.

import type { ChipCategoryId, GalleryCategoryId } from "./taxonomy";

/** One prompt ingredient: a word or phrase plus what kind of ingredient it is. */
export interface Chip {
  text: string;
  category: ChipCategoryId;
  /** What it contributes to the picture. Shown on hover. */
  why?: string;
}

export type Visibility = "private" | "public";

/** Where an image came from. Drives the badge on the card and the library tab. */
export type ImageSource = "seed" | "upload" | "generated" | "reverse" | "reference";

export interface InspireImage {
  id: string;
  /** null for the starter set that ships with the app. */
  ownerId: string | null;
  creator: string;
  title: string;
  description: string;
  /**
   * Exactly what the creator wrote. Never rewritten by AI, never edited after
   * publishing — AI output lives in `enhancedPrompt`, beside it.
   */
  prompt: string;
  /** An AI-improved version, kept apart from the original. */
  enhancedPrompt?: string;
  model: string;
  style: string;
  subject: string;
  category: GalleryCategoryId;
  chips: Chip[];
  visibility: Visibility;
  source: ImageSource;
  width: number;
  height: number;
  /** Full-size and thumbnail addresses. Seeds point at /public, the rest at the file route. */
  src: string;
  thumb: string;
  /** Average colour, painted behind the image while it loads. */
  tint: string;
  createdAt: string;
  /** Builder output only: how it was made, so it can be made again. */
  generation?: GenerationRecord;
  /** Starter showcase: leads the Explore hero. */
  featured?: boolean;
  /** Hero chips pinned to the part of the picture they describe (image fractions). */
  pins?: { chip: Chip; x: number; y: number }[];
}

export interface GenerationRecord {
  deliverable: string;
  chips: Chip[];
  visiblePrompt: string;
  technicalPrompt: string;
  references: { purpose: ReferencePurpose; imageId?: string; name: string }[];
  settings: { aspect: string; width: number; height: number; variant: number };
  lane: string;
  /** Earlier prompts this one grew out of, newest first. */
  history: string[];
}

export type ReferencePurpose = "style" | "character" | "clothing" | "composition" | "color" | "environment";

export const REFERENCE_PURPOSES: { id: ReferencePurpose; label: string; hint: string }[] = [
  { id: "style", label: "Art style", hint: "Borrow the rendering technique and medium." },
  { id: "character", label: "Character", hint: "Keep this person or character's identity." },
  { id: "clothing", label: "Clothing", hint: "Dress the subject in these garments." },
  { id: "composition", label: "Composition", hint: "Follow this framing and layout." },
  { id: "color", label: "Color", hint: "Use this palette." },
  { id: "environment", label: "Environment", hint: "Place the subject in this setting." },
];

// ----- the personal library -------------------------------------------------

export type LibraryKind = "image" | "prompt" | "chip" | "reference";

export type PromptOrigin = "saved" | "reverse" | "remix" | "builder" | "enhanced";

export interface PromptVersion {
  text: string;
  at: string;
  note?: string;
}

interface LibraryBase {
  id: string;
  kind: LibraryKind;
  collectionIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** A saved image. Points at the image; never copies the creator's content. */
export interface LibraryImage extends LibraryBase {
  kind: "image";
  imageId: string;
}

export interface LibraryPrompt extends LibraryBase {
  kind: "prompt";
  title: string;
  text: string;
  chips: Chip[];
  origin: PromptOrigin;
  /** The image it came from, if any. */
  imageId?: string;
  /** Older wordings, newest first. */
  versions: PromptVersion[];
}

export interface LibraryChip extends LibraryBase {
  kind: "chip";
  chip: Chip;
  favorite: boolean;
  custom: boolean;
}

export interface LibraryReference extends LibraryBase {
  kind: "reference";
  imageId: string;
  purpose: ReferencePurpose;
  name: string;
}

export type LibraryItem = LibraryImage | LibraryPrompt | LibraryChip | LibraryReference;

export interface Collection {
  id: string;
  name: string;
  createdAt: string;
}

export interface Me {
  signedIn: boolean;
  id: string | null;
  email: string | null;
  owner: boolean;
  /** No Supabase: one local account, files on disk. */
  local: boolean;
  ai: boolean;
  plan: { id: string; label: string; aiPerDay: number | null; aiUsedToday: number };
}
