// ---------------------------------------------------------------------------
// Viral Studio Content — telling a song from someone's own sound.
//
// The audio tab works like Shazam: a clip with a released song in it gets
// "Artist — Song" as a subtitle under its title. A funny voice, a skit or a
// poster's own sound gets no subtitle at all.
//
// Two sources, cheapest first:
//   post    the network's own sound credit (TikTok's music, YouTube's
//           "Music in this video"). Free, instant, but TikTok credits every
//           voice clip as "original sound - <name>", which is not a song.
//   listen  audio fingerprinting (AudD) — hears the actual track.
//
// Pure: no network, so the rules are tested.
// ---------------------------------------------------------------------------

import type { Song, SoundKind } from "./types";

export interface CreditedSound {
  title: string;
  artist: string;
  original?: boolean;
}

/** "original sound - mike", "som original", "sonido original", "Originalton"… */
const ORIGINAL =
  /\b(original\s*(sound|audio)|som\s+original|sonido\s+original|son\s+original|suono\s+originale|originalton|оригинальный\s+звук|オリジナル楽曲|原声)\b/i;

/** Credits that name a sound, not a song: "sped up", "voiceover", "funny sound"… are still songs; these aren't. */
const NOT_A_SONG = /^(sound|audio|voice ?over|voiceover|nhạc nền|music)$/i;

/** The song a post credits, or null when the credit is the poster's own sound. */
export function songFromCredit(credit: CreditedSound | null | undefined): Song | null {
  if (!credit) return null;
  const title = tidy(credit.title);
  const artist = tidy(credit.artist);
  if (!title) return null;
  if (credit.original) return null;
  if (ORIGINAL.test(title) || ORIGINAL.test(artist)) return null;
  if (NOT_A_SONG.test(title)) return null;
  return { title, artist, via: "post" };
}

/** Whether a credit plainly says "this is the poster's own sound". */
export function isOriginalCredit(credit: CreditedSound | null | undefined): boolean {
  if (!credit) return false;
  return credit.original === true || ORIGINAL.test(credit.title ?? "") || ORIGINAL.test(credit.artist ?? "");
}

/** The subtitle under the title: "Artist — Song", or just the song when the artist is unknown. */
export function songLine(song: Song | null | undefined): string {
  if (!song?.title) return "";
  return song.artist ? `${song.artist} — ${song.title}` : song.title;
}

/** What the finder concluded from a credit and (maybe) a listen. */
export function judgeSound(credit: CreditedSound | null | undefined, heard: Song | null | undefined): { kind: SoundKind; song?: Song } {
  const credited = songFromCredit(credit);
  if (credited) return { kind: "song", song: credited };
  if (heard?.title) return { kind: "song", song: heard };
  if (isOriginalCredit(credit)) return { kind: "original" };
  return { kind: "unknown" };
}

function tidy(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s*\((official|lyric|lyrics|audio|video|official video|official audio|visualizer)[^)]*\)\s*$/i, "")
    .trim()
    .slice(0, 120);
}
