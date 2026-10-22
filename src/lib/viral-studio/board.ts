// ---------------------------------------------------------------------------
// Viral Studio Content — the pure board logic.
//
// No storage, no network, no React: everything here is a function of its
// arguments, so the rules the owner keeps repeating (newest first, no
// duplicates, deleting is one step and can be undone) are tested, not hoped.
// ---------------------------------------------------------------------------

import { coerceTags } from "./filters";
import type { Board, Clip, Playback, TabId } from "./types";

/** Every link in a blob of pasted text, cleaned and de-duplicated, in order. */
export function extractLinks(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const bare = found.length
    ? []
    : (text.match(/(?:^|\s)((?:www\.)?(?:tiktok|instagram|youtube|youtu|facebook|fb|x|twitter|pinterest)\.[a-z.]+\/\S+)/gi) ?? []).map(
        (s) => `https://${s.trim()}`,
      );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...found, ...bare]) {
    const url = raw.replace(/[),.!?\]]+$/, "");
    const key = linkKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

/**
 * The identity of a link, for "is this already on the board?". Two pastes of
 * the same post differ in tracking junk (?is_from_webapp, ?igsh, utm_…),
 * www./m. prefixes and trailing slashes; none of that makes it a different
 * video. YouTube's ?v= and ?t= are the only query parts that matter, and only
 * v identifies the video.
 */
export function linkKey(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile|vm|vt)\./, "");
  const yt = youTubeRef(url);
  if (yt) return `youtube:${yt}`;
  const tt = tiktokRef(url);
  if (tt) return `tiktok:${tt}`;
  const ig = instagramRef(url);
  if (ig) return `instagram:${ig}`;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return `${host}${path}`;
}

/** The identity of a clip already on the board — its playback ref when it has one. */
export function clipKey(clip: Pick<Clip, "url" | "play">): string | null {
  const p = clip.play;
  if (p.kind === "youtube" || p.kind === "tiktok" || p.kind === "instagram") return `${p.kind}:${p.ref}`;
  return linkKey(clip.url);
}

export function youTubeRef(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  if (!/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(host)) return null;
  const ok = (id: string | null | undefined) => (id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null);
  if (host === "youtu.be") return ok(url.pathname.slice(1, 12));
  const v = ok(url.searchParams.get("v"));
  if (v) return v;
  return ok(url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1]);
}

/** The numeric video id in a full TikTok link. Short vm./vt. links have none until resolved. */
export function tiktokRef(url: URL): string | null {
  if (!/(^|\.)tiktok\.com$/i.test(url.hostname)) return null;
  return url.pathname.match(/\/(?:video|photo)\/(\d{6,25})/)?.[1] ?? url.pathname.match(/\/player\/v1\/(\d{6,25})/)?.[1] ?? null;
}

export function instagramRef(url: URL): string | null {
  if (!/(^|\.)(instagram\.com|instagr\.am)$/i.test(url.hostname)) return null;
  return url.pathname.match(/\/(?:reels?|p|tv)\/([A-Za-z0-9_-]{5,40})/)?.[1] ?? null;
}

export function clipsIn(board: Board, tab: TabId): Clip[] {
  return board.clips.filter((c) => c.tab === tab);
}

export function countsByTab(board: Board): Record<TabId, number> {
  const out: Record<TabId, number> = { audio: 0, fights: 0, dances: 0, motion: 0 };
  for (const c of board.clips) out[c.tab] = (out[c.tab] ?? 0) + 1;
  return out;
}

/** The clip in `tab` that is the same video as `candidate`, if any. */
export function findDuplicate(board: Board, tab: TabId, candidate: Pick<Clip, "url" | "play">): Clip | null {
  const key = clipKey(candidate);
  const raw = linkKey(candidate.url);
  if (!key && !raw) return null;
  return (
    board.clips.find((c) => {
      if (c.tab !== tab) return false;
      const k = clipKey(c);
      return (key && k === key) || (raw && linkKey(c.url) === raw);
    }) ?? null
  );
}

/**
 * Put a clip at the front of the board — newest first, always. Returns the
 * board unchanged (same object) when that video is already in the tab, so the
 * caller can tell "added" from "already there" by identity.
 */
export function addClip(board: Board, clip: Clip): Board {
  if (findDuplicate(board, clip.tab, clip)) return board;
  return { clips: [clip, ...board.clips] };
}

export function removeClip(board: Board, id: string): { board: Board; removed: Clip | null; index: number } {
  const index = board.clips.findIndex((c) => c.id === id);
  if (index < 0) return { board, removed: null, index: -1 };
  const clips = board.clips.slice();
  const [removed] = clips.splice(index, 1);
  return { board: { clips }, removed, index };
}

/** Undo a delete: the clip goes back exactly where it was. */
export function restoreClip(board: Board, clip: Clip, index: number): Board {
  if (board.clips.some((c) => c.id === clip.id)) return board;
  const clips = board.clips.slice();
  clips.splice(Math.max(0, Math.min(index, clips.length)), 0, clip);
  return { clips };
}

/** Storage keys a clip owns — what to delete server-side once the delete is final. */
export function storedKeys(clip: Clip): string[] {
  return clip.play.kind === "file" ? [clip.play.key, clip.play.posterKey].filter((k): k is string => !!k) : [];
}

/** Read whatever was saved, dropping anything malformed rather than crashing the board. */
export function sanitize(raw: unknown): Board {
  const list = (raw as Board | null)?.clips;
  if (!Array.isArray(list)) return { clips: [] };
  const seen = new Set<string>();
  const clips: Clip[] = [];
  for (const c of list) {
    if (!c || typeof c.id !== "string" || typeof c.url !== "string" || !c.play || !c.tab) continue;
    if (!["audio", "fights", "dances", "motion"].includes(c.tab)) continue;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const clip: Clip = { ...c, title: c.title ?? "", author: c.author ?? "" };
    if (clip.song && (typeof clip.song.title !== "string" || !clip.song.title)) delete clip.song;
    if (clip.sound && !["song", "original", "unknown"].includes(clip.sound)) delete clip.sound;
    if (clip.tags) clip.tags = coerceTags(clip.tags, clip.tab);
    clips.push(clip);
  }
  return { clips };
}

/** Where a pasted link should play from when the server couldn't be reached at all. */
export function offlinePlayback(url: string): Playback {
  try {
    const u = new URL(url);
    const yt = youTubeRef(u);
    if (yt) return { kind: "youtube", ref: yt };
    const tt = tiktokRef(u);
    if (tt) return { kind: "tiktok", ref: tt };
    const ig = instagramRef(u);
    if (ig) return { kind: "instagram", ref: ig };
  } catch {
    // Not a URL — nothing to play.
  }
  return { kind: "none" };
}

/** Portrait unless the link says otherwise: viral clips are vertical; a YouTube /watch link usually isn't. */
export function guessVertical(url: string): boolean {
  try {
    const u = new URL(url);
    if (youTubeRef(u)) return /\/shorts\//.test(u.pathname);
  } catch {
    // Unknown shape — assume the common case.
  }
  return true;
}

export type LeadSize = "big" | "wide" | "none";

/**
 * How large the newest clip should be so the wall ends on a full row: a 2×2
 * feature, a 2-wide banner, or a plain tile. `extra` counts the cells after
 * the clips (the add-a-link tile). Picks the size that leaves the fewest empty
 * cells, the bigger one on a tie. Under three clips there is no wall to
 * anchor, and a 2×2 on a two-column phone would be a whole screen.
 */
export function leadSize(count: number, cols: number, extra = 1): LeadSize {
  if (count < 3 || cols < 2) return "none";
  const options: [LeadSize, number][] = cols >= 3 ? [["big", 4], ["wide", 2], ["none", 1]] : [["wide", 2], ["none", 1]];
  let best: LeadSize = "none";
  let bestEmpty = Infinity;
  for (const [size, cells] of options) {
    const empty = (cols - ((count - 1 + cells + extra) % cols)) % cols;
    if (empty < bestEmpty) {
      best = size;
      bestEmpty = empty;
    }
  }
  return best;
}
