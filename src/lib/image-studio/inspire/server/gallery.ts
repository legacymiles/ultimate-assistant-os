// What a given caller can see: the starter set, everyone's public images, and
// their own private ones.

import "server-only";

import type { InspireImage } from "../types";
import { getImage, listImages } from "./store";
import { isSeedId, seedImages } from "./images";

export async function visibleImages(callerId: string | null): Promise<InspireImage[]> {
  let stored: InspireImage[] = [];
  try {
    stored = await listImages({ ownerId: callerId });
  } catch (err) {
    // A missing table must not blank Explore: the starter set still shows.
    console.error("[inspire] list failed:", err);
  }
  return [...stored, ...seedImages()];
}

/** One image, or null when it does not exist or the caller may not see it. */
export async function visibleImage(id: string, callerId: string | null, owner = false): Promise<InspireImage | null> {
  if (isSeedId(id)) return seedImages().find((s) => s.id === id) ?? null;
  const img = await getImage(id);
  if (!img) return null;
  if (img.visibility === "public" || (callerId && img.ownerId === callerId) || owner) return img;
  return null;
}
