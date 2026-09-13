// ---------------------------------------------------------------------------
// Dance Studio — shared types.
//
// Three records, kept apart so they recombine freely:
//
//   ReferenceDance   a motion clip (the thing that gets copied)
//   Character        a reusable identity (the thing that does the dancing)
//   Generation       one render of dance × character, with everything used
//
// Dance 001 + Character A, Dance 001 + Character B, Dance 002 + Character A —
// each is just another Generation pointing at the same two ids. Nothing is
// copied, so a character made once serves every dance.
// ---------------------------------------------------------------------------

import type { Platform } from "@/lib/social-import/platform";

export type GenerationStatus = "queued" | "generating" | "saving" | "done" | "error";
export type Resolution = "768p" | "2k";
export type AspectRatio = "9:16" | "16:9" | "1:1";

export interface ReferenceDance {
  id: string;
  name: string;
  /** The clip actually sent as the motion reference — already cut to fit the model. */
  videoKey: string;
  /** The untouched original, when the clip was cut or converted from it. */
  originalKey?: string;
  /** Where in the original the clip starts, when it was cut. */
  clipStartSec?: number;
  posterKey?: string;
  durationSec: number;
  width?: number;
  height?: number;
  source?: { url: string; platform: Platform | "upload"; author?: string };
  createdAt: string;
}

export interface Character {
  id: string;
  name: string;
  /** Primary reference image — the one every provider receives. */
  imageKey: string;
  /** Extra angles/outfits, sent only when the provider accepts several images. */
  extraImageKeys: string[];
  /** Words that help identity ("orange fox mascot, green hoodie"). */
  description?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationSettings {
  resolution: Resolution;
  aspectRatio: AspectRatio;
  durationSec: number;
  useExtraImages: boolean;
}

export interface Generation {
  id: string;
  danceId: string;
  characterId: string;
  /** Snapshot, so the record still reads correctly if the character is renamed or deleted. */
  characterName: string;
  status: GenerationStatus;
  providerId: string;
  model: string;
  /** What the user typed. */
  userPrompt: string;
  /** The full prompt the provider received. */
  prompt: string;
  settings: GenerationSettings;
  /** The provider's opaque, JSON-serializable job reference. */
  operation?: unknown;
  videoKey?: string;
  error?: string;
  warnings: string[];
  estimatedCostUsd?: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface StudioLibrary {
  dances: ReferenceDance[];
  characters: Character[];
  generations: Generation[];
}

export interface ProviderPricing {
  outputPerSec: Record<Resolution, number>;
  referenceVideoPerSec?: number;
  perImage?: number;
}

export interface ProviderInfo {
  id: string;
  label: string;
  model: string;
  ready: boolean;
  /** Why it isn't ready, in words the user can act on. */
  reason?: string;
  /** Ready, but something will likely stop a render (e.g. account balance). */
  notice?: string;
  resolutions: Resolution[];
  /** Primary image included. */
  maxCharacterImages: number;
  pricing?: ProviderPricing;
}

export interface StudioState {
  library: StudioLibrary;
  provider: ProviderInfo;
  storage: { remote: boolean; note: string };
}

export interface ImportedSource {
  sourceKey: string;
  posterKey?: string;
  contentType: string;
  sizeBytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  title: string;
  author: string;
  platform: Platform;
  url: string;
  trail: string[];
}
