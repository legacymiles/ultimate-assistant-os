// ---------------------------------------------------------------------------
// Turning bytes into a stored, served image — and merging the starter set into
// what Explore lists.
// ---------------------------------------------------------------------------

import "server-only";

import sharp from "sharp";
import { SEED, SEED_DIR, seedSize } from "../seed";
import tints from "../seed-tints.json";
import { extractChips } from "../extract";
import { libraryChip } from "../chipLibrary";
import { groupOf } from "../taxonomy";
import type { InspireImage } from "../types";
import { HttpError } from "./access";
import { putImageBytes } from "./store";

const MAX_BYTES = 12 * 1024 * 1024;
const LAUNCH = Date.parse("2026-11-24T12:00:00Z");

let seedCache: InspireImage[] | null = null;

/** The starter set as gallery images. Only seeds whose file was drawn are listed. */
export function seedImages(): InspireImage[] {
  if (seedCache) return seedCache;
  const t = tints as Record<string, string>;
  seedCache = SEED.filter((s) => t[s.id]).map((s) => {
    const { width, height } = seedSize(s.aspect);
    return {
      id: s.id,
      ownerId: null,
      creator: s.creator,
      title: s.title,
      description: s.description,
      prompt: s.prompt,
      model: "Flux 2 Klein 4B",
      style: s.style,
      subject: s.subject,
      category: s.category,
      chips: extractChips(s.prompt),
      visibility: "public",
      source: "seed",
      width,
      height,
      src: `${SEED_DIR}/${s.id}.webp`,
      thumb: `${SEED_DIR}/${s.id}-thumb.webp`,
      tint: t[s.id],
      createdAt: new Date(LAUNCH - s.age * 86_400_000).toISOString(),
      ...(s.featured ? { featured: true } : {}),
      ...(s.pins
        ? { pins: s.pins.map(([text, category, x, y]) => ({ chip: { text, category, why: libraryChip(text)?.why ?? groupOf(category).role }, x, y })) }
        : {}),
    } satisfies InspireImage;
  });
  return seedCache;
}

export function isSeedId(id: string): boolean {
  return id.startsWith("seed-");
}

export interface Ingested {
  width: number;
  height: number;
  tint: string;
}

/**
 * Validate an uploaded or generated image by actually decoding it (a renamed
 * file or a script never gets stored), strip its metadata (GPS, camera
 * serials), store a webp at most 2048 px on its long side plus a 480 px
 * thumbnail, and measure its average colour.
 */
export async function ingest(id: string, dataUrl: string): Promise<Ingested> {
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new HttpError(400, "That isn't an image file.");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > MAX_BYTES) throw new HttpError(413, "That image is over 12 MB. Use a smaller one.");
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buf).metadata();
  } catch {
    throw new HttpError(400, "That file couldn't be opened as an image.");
  }
  if (!meta.width || !meta.height) throw new HttpError(400, "That file couldn't be opened as an image.");
  if (meta.width * meta.height > 40_000_000) throw new HttpError(413, "That image is too large to process.");
  const base = sharp(buf).rotate();
  const full = await base.clone().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toBuffer({ resolveWithObject: true });
  const thumb = await base.clone().resize({ width: 480, withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();
  const { dominant } = await sharp(full.data).stats();
  await putImageBytes(id, full.data, thumb);
  return { width: full.info.width, height: full.info.height, tint: `rgb(${dominant.r} ${dominant.g} ${dominant.b})` };
}

export function fileUrl(id: string, thumb = false): string {
  return `/api/image-studio/inspire/file/${id}${thumb ? "?size=thumb" : ""}`;
}
