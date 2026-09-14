// ---------------------------------------------------------------------------
// Image Studio — gallery metadata (localStorage). The image bytes are in
// IndexedDB; see media.ts.
// ---------------------------------------------------------------------------

import type { RefRole } from "./prompt";

export interface GalleryItem {
  id: string;
  agentId: string;
  /** What the user typed. */
  rawPrompt: string;
  /** What the image model was given (rewritten or fallback). */
  prompt: string;
  refRoles: RefRole[];
  mediaId: string;
  model: string;
  offline: boolean;
  createdAt: number;
}

export const GALLERY_KEY = "image-studio:gallery";

export function loadGallery(): GalleryItem[] {
  try {
    const raw = window.localStorage.getItem(GALLERY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((i) => i && typeof i.mediaId === "string") : [];
  } catch {
    return [];
  }
}

export function saveGallery(items: GalleryItem[]): void {
  try {
    window.localStorage.setItem(GALLERY_KEY, JSON.stringify(items));
  } catch {
    /* storage blocked or full — the gallery lives only in memory this session */
  }
}
