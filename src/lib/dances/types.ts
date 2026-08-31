// ---------------------------------------------------------------------------
// Dance Vault — shared types.
//
// A record is one dance: the name people say, the song behind it, who made it,
// and what YOU think of it. The two halves of a record come from different
// places and are kept separate on purpose:
//
//   editorial   name, song, artist, creator, year, difficulty
//               written by a human — a search result cannot produce these
//   video       a verified, playable source
//               resolved by machine and re-verifiable at any time
//
// `video` is optional in the type but never absent in shipped seed data: a
// dance that resolves to nothing playable is dropped rather than shown as an
// empty tile. The optionality exists for the moment between a manual add and
// its resolution, and for a source that dies after shipping.
// ---------------------------------------------------------------------------

/** Where a record came from. Drives the Dance of the Day band and nothing else. */
export type DanceSource = "seed" | "manual" | "daily";

/**
 * A verified, playable source for one dance.
 *
 * `kind` is the rung of the playback ladder this source sits on. `local` is
 * preferred wherever it exists — instant, no network, no third-party branding —
 * but `youtube` is what ships, because it needs nothing installed.
 */
export interface DanceVideo {
  kind: "youtube" | "local";
  /** youtube: the 11-char video id. local: the filename under /dances/. */
  ref: string;
  /** i.ytimg.com for youtube (never expires) or a local jpg. */
  poster: string;
  /** Who posted the video that plays — not necessarily the choreographer. */
  channel?: string;
  /** The uploader's own title, kept so a wrong match is recognisable. */
  sourceTitle?: string;
  /** When the embed check last passed. */
  verifiedAt: string;
}

export interface Dance {
  id: string;
  /** "Renegade" — the name people actually say. */
  name: string;
  /** Alternate names, so search finds it under any of them. */
  aka: string[];
  song?: string;
  artist?: string;
  /** The choreographer, where documented. Absent beats guessed. */
  creator?: string;
  /** The year it broke, not the year the song came out. */
  year?: number;
  /** Free-form: "arms-only", "group", "budots", "trend-2026". */
  tags: string[];
  /** 1 = anyone can do it, 5 = you cannot do it. */
  difficulty?: number;
  /**
   * 0–100, yours. `undefined` means unrated, which is deliberately NOT zero:
   * "haven't judged it" and "judged it worthless" are different facts, and the
   * toolbar sorts on the difference.
   */
  score?: number;
  notes?: string;
  /** What plays on hover. */
  video?: DanceVideo;
  /** The original TikTok, when known — opened from the modal, for credit. */
  tiktokUrl?: string;
  source: DanceSource;
  /** Only when source === "daily": the day it was picked, as YYYY-MM-DD. */
  dailyDate?: string;
  /**
   * True when the name was derived from a video title rather than confirmed.
   * The UI marks these as drafts so an auto-derived name is never mistaken for
   * a claim about what the dance is called.
   */
  nameProvisional?: boolean;
  /** One line on why it was trending. Only set by Dance of the Day. */
  why?: string;
  addedAt: string;
  updatedAt: string;
}

export interface BoardData {
  dances: Dance[];
}

// --- Dance of the Day, server side -----------------------------------------

/** One day's outcome. A day with no playable candidate is recorded, not retried. */
export interface DailyPick {
  /** YYYY-MM-DD. */
  date: string;
  status: "ok" | "none";
  /** Present when status === "ok". */
  dance?: Dance;
  /** Why nothing was picked, for the band to show honestly. */
  reason?: string;
}

export interface DailyFile {
  picks: DailyPick[];
  /** Debounce stamp — ten app opens in an afternoon must fire one search. */
  lastRunAt?: string;
}
