// ---------------------------------------------------------------------------
// A clip whose video the server couldn't get — and the ways out of it.
//
// Facebook and Instagram hide many videos from anyone who isn't signed in, and
// a server is never signed in. That used to leave a grey tile and a sentence
// telling you what to do somewhere else. Now the tile itself carries the fixes:
//
//   Connect Facebook   once — the Jarvis Record extension sends the sign-in
//                      Chrome already has (or paste it on a phone); every stuck
//                      clip from that site is then fetched again by itself
//   Upload the video   pick the saved video from your phone or computer; it
//                      goes straight into your storage and the tile plays it
//   Try again          ask for the link again
//
// Pure, so the rules are tested rather than eyeballed.
// ---------------------------------------------------------------------------

import type { Platform } from "@/lib/social-import/platform";

import type { Clip, ResolvedLink } from "./types";

/** Sites a saved sign-in unlocks (matches cookieStore's COOKIE_SITES). */
export const CONNECT_SITES = ["facebook", "instagram"] as const;
export type ConnectSite = (typeof CONNECT_SITES)[number];

/** The sizes and kinds of video an upload accepts. */
export const UPLOAD_MAX_BYTES = 500 * 1024 * 1024;
export const UPLOAD_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;

/**
 * The one line under a tile that couldn't get its video. Short, because the
 * tile carries the fixes as buttons — the sentence doesn't have to explain them.
 */
export function stuckNote(site: string, nothingToPlay: boolean, error: string, signedOut: boolean, needsLogin: boolean): string | undefined {
  if (!nothingToPlay) return error ? `Playing through ${site}'s player — the file couldn't be saved.` : undefined;
  if (signedOut) return `${site} wouldn't hand over this video. Sign in to save the video itself.`;
  if (needsLogin) return `${site} only shows this video to signed-in people. Connect ${site} once, or upload the video.`;
  return `${site} wouldn't hand over this video. Upload it, or try again later.`;
}

/** Nothing to play inline: the tile shows its fixes. */
export function isStuck(clip: Pick<Clip, "play">): boolean {
  return clip.play.kind === "none";
}

/** The site to offer "Connect" for, or null when connecting wouldn't help. */
export function connectSiteFor(clip: Pick<Clip, "play" | "platform">): ConnectSite | null {
  if (!isStuck(clip)) return null;
  return (CONNECT_SITES as readonly string[]).includes(clip.platform) ? (clip.platform as ConnectSite) : null;
}

/** Stuck clips worth asking for again now that `site` is connected. */
export function retryAfterConnect(clips: Clip[], site: ConnectSite): Clip[] {
  return clips.filter((c) => isStuck(c) && c.platform === site);
}

/**
 * A fresh answer for a stuck clip, merged in. Only an answer that can actually
 * play replaces the clip's playback; anything the owner set (tags by hand, the
 * song) is kept. Returns null when the retry didn't help.
 */
export function mergeRetry(clip: Clip, fresh: ResolvedLink): Clip | null {
  if (fresh.play.kind === "none") return null;
  const next: Clip = {
    ...clip,
    play: fresh.play,
    title: clip.title || fresh.title,
    author: clip.author || fresh.author,
    vertical: fresh.vertical ?? clip.vertical,
    stats: clip.stats ?? fresh.stats,
    song: clip.song ?? fresh.song,
    sound: clip.sound ?? fresh.sound,
    tags: clip.tags ?? fresh.tags,
  };
  if (fresh.note) next.note = fresh.note;
  else delete next.note;
  delete next.needsLogin;
  return next;
}

/** A clip after its video was uploaded by hand. */
export function withUpload(clip: Clip, key: string, vertical?: boolean): Clip {
  const next: Clip = { ...clip, play: { kind: "file", key }, vertical: vertical ?? clip.vertical };
  delete next.note;
  delete next.needsLogin;
  return next;
}

/** Why a picked file can't be uploaded, in words — or null when it can. */
export function uploadProblem(file: { type: string; size: number; name?: string }): string | null {
  const type = uploadType(file);
  if (!type) return "Pick a video file (MP4, MOV or WebM).";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > UPLOAD_MAX_BYTES) return `That video is over ${Math.round(UPLOAD_MAX_BYTES / 1024 / 1024)} MB. Trim it and try again.`;
  return null;
}

/** The content type to store a picked file as. iPhones sometimes report none for a .mov. */
export function uploadType(file: { type: string; name?: string }): (typeof UPLOAD_TYPES)[number] | null {
  const t = file.type.toLowerCase();
  if ((UPLOAD_TYPES as readonly string[]).includes(t)) return t as (typeof UPLOAD_TYPES)[number];
  if (t === "video/x-m4v" || t === "video/m4v") return "video/mp4";
  const ext = file.name?.split(".").pop()?.toLowerCase();
  if (!t || t === "application/octet-stream") {
    if (ext === "mp4" || ext === "m4v") return "video/mp4";
    if (ext === "mov") return "video/quicktime";
    if (ext === "webm") return "video/webm";
  }
  return null;
}

/** Plain-English site names for the buttons. */
export const SITE_LABEL: Record<ConnectSite, string> = { facebook: "Facebook", instagram: "Instagram" };

export function isConnectSite(p: Platform | string): p is ConnectSite {
  return (CONNECT_SITES as readonly string[]).includes(p);
}
