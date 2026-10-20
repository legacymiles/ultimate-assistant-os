// ---------------------------------------------------------------------------
// YouTube videos — the saved list. Pure: every change is (state) → state.
//
// Rules the owner's build checklist asks for, enforced here so every screen
// gets them for free:
//   • newest first — a fresh save goes to the top;
//   • no duplicates — the same video pasted again moves back to the top
//     instead of appearing twice;
//   • deletes can be undone for a few seconds (the toast holds the row).
// ---------------------------------------------------------------------------

import type { ParsedLink, Platform, VideoKind } from "./links";

export interface SavedVideo {
  id: string;
  key: string;
  url: string;
  platform: Platform;
  kind: VideoKind;
  videoId?: string;
  thumb?: string;
  embed?: string;
  start?: number;
  title?: string;
  author?: string;
  addedAt: number;
  watchedAt?: number;
  /** Set once a title lookup has been tried, so it isn't retried forever. */
  looked?: boolean;
}

export interface Library {
  v: 1;
  videos: SavedVideo[];
}

export const EMPTY: Library = { v: 1, videos: [] };

/** Anything read from storage → a valid library. Bad rows are dropped, not fatal. */
export function normalize(raw: unknown): Library {
  const list = (raw as { videos?: unknown } | null)?.videos;
  if (!Array.isArray(list)) return { v: 1, videos: [] };
  const seen = new Set<string>();
  const videos: SavedVideo[] = [];
  for (const r of list) {
    const v = r as Partial<SavedVideo>;
    if (!v || typeof v.id !== "string" || typeof v.key !== "string" || typeof v.url !== "string") continue;
    if (seen.has(v.key)) continue;
    seen.add(v.key);
    videos.push({ ...(v as SavedVideo), addedAt: Number(v.addedAt) || 0 });
  }
  videos.sort((a, b) => b.addedAt - a.addedAt);
  return { v: 1, videos };
}

let n = 0;
const newId = (now: number) => `v${now.toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export interface AddResult {
  library: Library;
  /** Ids that are new. */
  added: string[];
  /** Ids that were already saved and moved back to the top. */
  bumped: string[];
}

export function addLinks(lib: Library, links: ParsedLink[], now = Date.now()): AddResult {
  const added: string[] = [];
  const bumped: string[] = [];
  let videos = [...lib.videos];
  // Walk the paste backwards so the first link pasted ends up on top.
  links.forEach((link, i) => {
    const at = now + (links.length - 1 - i);
    const existing = videos.find((v) => v.key === link.key);
    if (existing) {
      bumped.push(existing.id);
      videos = [{ ...existing, addedAt: at }, ...videos.filter((v) => v.id !== existing.id)];
      return;
    }
    const id = newId(now);
    added.push(id);
    videos.push({
      id,
      key: link.key,
      url: link.url,
      platform: link.platform,
      kind: link.kind,
      videoId: link.videoId,
      thumb: link.thumb,
      embed: link.embed,
      start: link.start,
      addedAt: at,
    });
  });
  videos.sort((a, b) => b.addedAt - a.addedAt);
  return { library: { v: 1, videos }, added, bumped };
}

export function removeVideo(lib: Library, id: string): { library: Library; removed?: SavedVideo } {
  const removed = lib.videos.find((v) => v.id === id);
  return { library: { v: 1, videos: lib.videos.filter((v) => v.id !== id) }, removed };
}

/** Undo: put a deleted video back where it was (by its saved time). */
export function restoreVideo(lib: Library, video: SavedVideo): Library {
  if (lib.videos.some((v) => v.key === video.key)) return lib;
  return normalize({ videos: [...lib.videos, video] });
}

export function setMeta(lib: Library, id: string, meta: { title?: string; author?: string; thumb?: string }): Library {
  return {
    v: 1,
    videos: lib.videos.map((v) =>
      v.id !== id
        ? v
        : {
            ...v,
            title: meta.title?.trim() || v.title,
            author: meta.author?.trim() || v.author,
            thumb: v.thumb || meta.thumb || undefined,
            looked: true,
          },
    ),
  };
}

export function toggleWatched(lib: Library, id: string, now = Date.now()): Library {
  return { v: 1, videos: lib.videos.map((v) => (v.id === id ? { ...v, watchedAt: v.watchedAt ? undefined : now } : v)) };
}

/** What a recommendation request sends: enough to learn taste, nothing private. */
export function tasteOf(lib: Library, max = 25): { title?: string; author?: string; platform: Platform; videoId?: string }[] {
  return lib.videos.slice(0, max).map((v) => ({ title: v.title, author: v.author, platform: v.platform, videoId: v.videoId }));
}
