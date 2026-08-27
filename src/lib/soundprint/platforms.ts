// ---------------------------------------------------------------------------
// Soundprint — the target platform.
//
// Suno only. The app writes the two fields Suno needs and formats them to its
// grammar; you create the song there and paste the link back to play it here.
// ---------------------------------------------------------------------------

import type { PlatformId } from "./types";

export type { PlatformId };

export interface Platform {
  id: PlatformId;
  name: string;
  url: string;
  /** Suno exposes a dedicated negative-prompt field. */
  hasExcludeField: boolean;
  /** Practical ceiling for the style field before coherence drops off. */
  styleSoftLimit: number;
  styleFieldName: string;
  lyricsFieldName: string;
  /** Anything worth knowing when pasting into Suno. */
  tips: string[];
}

export const SUNO: Platform = {
  id: "suno",
  name: "Suno",
  url: "https://suno.com/create",
  hasExcludeField: true,
  styleSoftLimit: 300,
  styleFieldName: "Style of Music",
  lyricsFieldName: "Lyrics",
  tips: [
    "Paste the Style prompt into “Style of Music” and the lyrics into “Lyrics”.",
    "Put the Exclude list into “Exclude Styles” — that's what keeps the drums out.",
    "Turn on the Instrumental switch if you asked for no vocals.",
  ],
};

export const PLATFORMS: Record<PlatformId, Platform> = { suno: SUNO };
