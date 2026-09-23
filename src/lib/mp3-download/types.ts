// ---------------------------------------------------------------------------
// MP3 Download — the shapes the three stages pass between each other.
//
// Stage 1 searches a catalogue that knows every song ever released (Apple's),
// so "is this the right track?" can be answered against real metadata rather
// than a filename. Stage 3 then hunts for an audio file of that track among
// sources that actually license their audio for download. Those two halves
// deliberately do not share a type: a Track is a *recording as catalogued*,
// a Candidate is *a file someone is allowed to hand you*.
// ---------------------------------------------------------------------------

/** A song as the catalogue knows it. This is what the owner confirms. */
export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** 300px square. Apple serves any size; 300 is the dossier's.  */
  artworkUrl: string;
  /** Apple's public 30-second promo clip, when there is one. */
  previewUrl: string | null;
  durationMs: number;
  /** ISO date, or "" when the catalogue has none. */
  releaseDate: string;
  genre: string;
  explicit: boolean;
  trackNumber: number;
  trackCount: number;
  discNumber: number;
  storeUrl: string;
}

/**
 * How a file may be used. This is the column that decides whether a row gets a
 * Download button at all, so it is a closed set rather than a free string.
 *
 *   public-domain — copyright expired or waived (CC0, PD-Mark, US pre-1929).
 *   cc            — a Creative Commons licence; `label` carries which one.
 *   open          — the host publishes it for download but names no licence.
 *                   Shown, ranked last, and flagged: the owner decides.
 *   youtube       — pulled off YouTube with yt-dlp. YouTube states a licence
 *                   per video and most say "Standard YouTube License", which
 *                   is not a grant to redistribute. The row says so.
 *   preview       — Apple's 30-second promotional clip. Not the track.
 *   own           — a file the owner supplied themselves.
 */
export type LicenceKind = "public-domain" | "cc" | "open" | "youtube" | "preview" | "own";

export interface Licence {
  kind: LicenceKind;
  /** Short human name, e.g. "CC BY 4.0", "Public domain", "30s preview". */
  label: string;
  url?: string;
  /** Present when the licence obliges the owner to credit someone. */
  attribution?: string;
}

export type Provider = "archive" | "openverse" | "youtube" | "apple-preview" | "own";

/** A downloadable audio file, and everything needed to judge it at a glance. */
export interface Candidate {
  id: string;
  provider: Provider;
  providerLabel: string;
  title: string;
  creator: string;
  /** The human page the file came from — always linked, never hidden. */
  pageUrl: string;
  /**
   * The direct media URL, proxied on download.
   *
   * YouTube rows are the exception: there is no stable direct URL, so this
   * carries the watch page and the download goes through yt-dlp instead.
   */
  fileUrl: string;
  /** MP3, OGG, FLAC, M4A, WAV… uppercased. */
  format: string;
  bytes: number | null;
  durationMs: number | null;
  licence: Licence;
  /** 0–100. How likely this file is the confirmed track. See match.ts. */
  score: number;
  /** Why it scored that, in the order that mattered. */
  reasons: string[];
}

/** One row of the library: something the owner actually pulled down. */
export interface Grab {
  id: string;
  at: string;
  /** Title/artist as confirmed in stage 2, not as the file was named. */
  title: string;
  artist: string;
  filename: string;
  provider: Provider;
  providerLabel: string;
  pageUrl: string;
  fileUrl: string;
  format: string;
  bytes: number | null;
  licence: Licence;
}

export interface LibraryState {
  grabs: Grab[];
}

export const LIBRARY_KEY = "mp3-download.library";

export const emptyLibrary = (): LibraryState => ({ grabs: [] });

/** Licence tiers, in the order the source table groups them. */
export const LICENCE_ORDER: LicenceKind[] = [
  "public-domain",
  "cc",
  "youtube",
  "open",
  "own",
  "preview",
];

export const LICENCE_GROUP: Record<LicenceKind, { title: string; note: string }> = {
  "public-domain": {
    title: "Public domain",
    note: "Copyright expired or waived. Yours to keep, use and re-cut.",
  },
  cc: {
    title: "Creative Commons",
    note: "Free to download. Most of these want a credit line — it is on the row.",
  },
  youtube: {
    title: "YouTube · yt-dlp",
    note:
      "Pulled straight off YouTube and converted to MP3 on this machine. YouTube grants no "
      + "redistribution right for most of these — download what you are entitled to.",
  },
  open: {
    title: "Published for download, licence unstated",
    note: "The host offers the file openly but names no licence. Check before you publish anything with it.",
  },
  own: { title: "Your own files", note: "Things you added yourself." },
  preview: {
    title: "Preview clip",
    note: "Apple's public 30-second promo. An audition, not the song.",
  },
};
