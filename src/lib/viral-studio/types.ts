// ---------------------------------------------------------------------------
// Viral Studio Content — shared types.
//
// One board, four tabs. A clip is a link someone pasted into a tab, plus
// whatever it takes to show a poster and play it on hover. Nothing is seeded:
// every clip on the board was put there by the person using it.
// ---------------------------------------------------------------------------

import type { Platform } from "@/lib/social-import/platform";

export type TabId = "audio" | "fights" | "dances" | "motion";

export interface TabDef {
  id: TabId;
  label: string;
  /** For the phone's tab bar, where four full labels don't fit. */
  short: string;
  /** What belongs here, in the user's words. Shown under the tab name. */
  hint: string;
  /** Sound is the point of the audio tab, so it starts unmuted there. */
  soundByDefault: boolean;
}

export const TABS: readonly TabDef[] = [
  { id: "audio", label: "Viral audio", short: "Audio", hint: "Sounds & songs", soundByDefault: true },
  { id: "fights", label: "Fights", short: "Fights", hint: "Knockouts, scraps, highlights", soundByDefault: false },
  { id: "dances", label: "Dances", short: "Dances", hint: "Trends & choreo", soundByDefault: false },
  { id: "motion", label: "Motion", short: "Motion", hint: "Surfing, hoops, rap performances…", soundByDefault: false },
] as const;

export function isTabId(v: unknown): v is TabId {
  return typeof v === "string" && TABS.some((t) => t.id === v);
}

/**
 * How a clip plays, best first:
 *   file       the video itself, downloaded once into the owner's storage —
 *              instant, works for any network, survives the post being deleted
 *   youtube    a muted hover-mounted embed (YouTube is never downloaded:
 *              datacenter IPs get bot-walled and its embed already autoplays)
 *   tiktok     TikTok's own embed player, which accepts autoplay
 *   instagram  Instagram's embed — it shows, but asks for a tap to play
 *   none       a poster and a link out; the tile says so
 */
export type Playback =
  | { kind: "file"; key: string; posterKey?: string }
  | { kind: "youtube"; ref: string }
  | { kind: "tiktok"; ref: string }
  | { kind: "instagram"; ref: string }
  | { kind: "none" };

/** A released song heard in a clip. Shown as the subtitle under the clip's title, audio tab only. */
export interface Song {
  title: string;
  artist: string;
  /** Where the name came from: the post's own sound credit, or listening to the audio. */
  via: "post" | "listen";
  /** A page to play the song (Spotify, Apple Music…), when the finder had one. */
  link?: string;
}

/**
 * What the song finder concluded:
 *   song      a released song — `song` holds its name
 *   original  someone's own sound (a voice, a joke, a skit), not a song
 *   unknown   it listened and couldn't tell; the Find song button stays
 */
export type SoundKind = "song" | "original" | "unknown";

/** How the post was doing when it was read. */
export interface ClipStats {
  views?: number | null;
  likes?: number | null;
  postedAt?: string | null;
  /** When these numbers were read. */
  readAt?: string;
}

export interface ClipTags {
  moods: string[];
  categories: string[];
  /** The owner set these by hand; the auto-tagger never overwrites them. */
  byHand?: boolean;
}

export interface Clip {
  id: string;
  tab: TabId;
  /** The link as pasted (cleaned of share text). */
  url: string;
  platform: Platform;
  title: string;
  author: string;
  play: Playback;
  /** Portrait footage (Shorts, TikTok, Reels). Decides how an embed is cropped to fill the tile. */
  vertical?: boolean;
  /** A short plain-English line when the best playback wasn't possible. */
  note?: string;
  addedAt: string;
  /** Audio tab: the song in it, once found. */
  song?: Song;
  sound?: SoundKind;
  stats?: ClipStats;
  tags?: ClipTags;
}

export interface Board {
  clips: Clip[];
}

/** What POST /api/viral-studio/add sends back — a clip minus the parts the browser owns. */
export interface ResolvedLink {
  url: string;
  platform: Platform;
  title: string;
  author: string;
  play: Playback;
  vertical?: boolean;
  note?: string;
  song?: Song;
  sound?: SoundKind;
  stats?: ClipStats;
  tags?: ClipTags;
}
