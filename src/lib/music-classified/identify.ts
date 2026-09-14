// ---------------------------------------------------------------------------
// Working out WHICH song was meant — pure, no network.
//
// People paste a YouTube link, an Apple Music share, a Spotify link, or just
// type "blinding lights weeknd". Every one of those ends in the same place: an
// iTunes catalogue record, because that API is keyless, returns a canonical
// title/artist/genre/year, and carries a 30-second preview the browser can
// measure tempo and key from. The link itself is only ever a way to get a
// search term.
// ---------------------------------------------------------------------------

import { firstUrl, youTubeId } from "@/lib/social-import/platform";

export type LinkSource = "youtube" | "apple" | "spotify" | "web";

export interface Identity {
  title: string;
  artist: string;
  album?: string;
  year?: string;
  sourceGenre?: string;
  artwork?: string;
  /** 30s AAC preview from Apple's CDN (CORS-open). Measured, never stored. */
  previewUrl?: string;
  /** The link the user pasted, if any. */
  link?: string;
  /** True when the catalogue confirmed the song; false when all we have is a title. */
  matched: boolean;
}

export type ParsedInput =
  | { kind: "link"; url: URL; source: LinkSource }
  | { kind: "name"; query: string };

export function parseSongInput(text: string): ParsedInput | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const raw = firstUrl(trimmed);
  if (raw) {
    try {
      const url = new URL(raw);
      return { kind: "link", url, source: linkSource(url) };
    } catch {
      /* not a usable URL — treat the text as a name */
    }
  }
  return { kind: "name", query: trimmed.replace(/\s+/g, " ") };
}

export function linkSource(url: URL): LinkSource {
  const host = url.hostname.toLowerCase();
  if (/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(host) && youTubeId(url)) return "youtube";
  if (/(^|\.)(music|itunes|geo\.music)\.apple\.com$/.test(host)) return "apple";
  if (/(^|\.)open\.spotify\.com$/.test(host)) return "spotify";
  return "web";
}

/** The track id in an Apple Music link: `?i=` on album links, the tail of /song/ links. */
export function appleTrackId(url: URL): string | null {
  const i = url.searchParams.get("i");
  if (i && /^\d+$/.test(i)) return i;
  const m = url.pathname.match(/\/song\/(?:[^/]+\/)?(\d+)\/?$/);
  return m ? m[1] : null;
}

// Bracketed noise that YouTube titles carry and catalogue titles never do.
const NOISE =
  /\s*[([][^)\]]*\b(official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|m\/?v|remaster(ed)?|explicit|clean|color coded)\b[^)\]]*[)\]]/gi;

/** "The Weeknd - Blinding Lights (Official Video)" + "TheWeekndVEVO" → title/artist. */
export function cleanVideoTitle(raw: string, channel = ""): { title: string; artist: string } {
  let t = raw.replace(NOISE, "").replace(/\s*[|｜].*$/, "").trim();
  t = t.replace(/\s+(official\s+(music\s+)?video|lyrics?)$/i, "").trim();
  const split = t.split(/\s+[-–—]\s+/);
  const unquote = (s: string) => s.replace(/^["'“‘]+|["'”’]+$/g, "").trim();
  if (split.length >= 2) {
    return { artist: unquote(split[0]), title: unquote(split.slice(1).join(" - ")) };
  }
  return { title: unquote(t), artist: cleanChannel(channel) };
}

export function cleanChannel(channel: string): string {
  return channel
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/VEVO$/i, "")
    .replace(/\s*(official|music)$/i, "")
    .trim();
}

/** Apple's og:title, "Blinding Lights by The Weeknd on Apple Music". */
export function parseAppleOgTitle(og: string): { title: string; artist: string } | null {
  const m = og.match(/^(.*?)\s+by\s+(.*?)(?:\s+on Apple\s*Music)?$/i);
  return m ? { title: m[1].trim(), artist: m[2].trim() } : null;
}

/** Spotify's og:description, "The Weeknd · After Hours · Song · 2020". */
export function parseSpotifyDescription(desc: string): { artist: string; year?: string } | null {
  const parts = desc.split(/\s+·\s+/).map((s) => s.trim());
  if (parts.length < 2 || !parts[0]) return null;
  const year = parts.find((p) => /^\d{4}$/.test(p));
  return { artist: parts[0], year };
}

/** The track id in any open.spotify.com track link (with or without /intl-xx/). */
export function spotifyTrackId(url: URL): string | null {
  return url.pathname.match(/\/track\/([A-Za-z0-9]{22})/)?.[1] ?? null;
}

/**
 * Title and artist from Spotify's embed page. The normal track page is a bare
 * web-player shell with no metadata for a server fetch; the embed page carries
 * the track as JSON ("title", then "artists":[{"name":…}]).
 */
export function parseSpotifyEmbed(html: string): { title: string; artist: string } | null {
  const unescape = (s: string) => {
    try {
      return JSON.parse(`"${s}"`) as string;
    } catch {
      return s;
    }
  };
  const title = html.match(/"title":"((?:[^"\\]|\\.)*)"/)?.[1];
  const artist = html.match(/"artists":\[\{"name":"((?:[^"\\]|\\.)*)"/)?.[1];
  return title ? { title: unescape(title), artist: artist ? unescape(artist) : "" } : null;
}

export function metaContent(html: string, prop: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop.replace(/[.:]/g, "\\$&")}["'][^>]*>`,
    "i",
  );
  const tag = html.match(re)?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content) : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// ----- catalogue matching ---------------------------------------------------

export interface ItunesTrack {
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  releaseDate?: string;
  primaryGenreName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  kind?: string;
}

export function itunesToIdentity(r: ItunesTrack, link?: string): Identity {
  return {
    title: r.trackName ?? "",
    artist: r.artistName ?? "",
    album: r.collectionName,
    year: r.releaseDate?.slice(0, 4),
    sourceGenre: r.primaryGenreName,
    // The 100px art is blurry in the record panel; Apple serves any size.
    artwork: r.artworkUrl100?.replace(/\/100x100bb\./, "/300x300bb."),
    previewUrl: r.previewUrl,
    link,
    matched: true,
  };
}

const tokens = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(feat|ft|featuring|with)\b.*$/, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter(Boolean);

function overlap(want: string, got: string): number {
  const w = tokens(want);
  if (!w.length) return 0;
  const g = new Set(tokens(got));
  return w.filter((t) => g.has(t)).length / w.length;
}

// Versions nobody means unless they said so.
const VARIANT = /\b(remix|live|karaoke|instrumental|sped up|slowed|acapella|cover|tribute|8d|nightcore)\b/i;

/**
 * How well a catalogue track answers what was asked, 0–1.
 * `artist` may be empty when the user typed one run-on phrase; then the whole
 * phrase is matched against title and artist together.
 */
export function matchScore(r: ItunesTrack, want: { title: string; artist: string }): number {
  const title = r.trackName ?? "";
  const artist = r.artistName ?? "";
  let score: number;
  if (want.artist) {
    score = overlap(want.title, title) * 0.6 + overlap(want.artist, artist) * 0.4;
  } else {
    const all = `${title} ${artist}`;
    const phrase = overlap(want.title, all);
    // Every word of the TITLE should appear in what was typed, or "love" would
    // match every song called Love.
    const titleCovered = overlap(title.replace(/\(.*?\)/g, ""), want.title);
    score = phrase * 0.6 + titleCovered * 0.4;
  }
  const wanted = `${want.title} ${want.artist}`;
  if (VARIANT.test(title) && !VARIANT.test(wanted)) score -= 0.25;
  return Math.max(0, Math.min(1, score));
}

/** Best-first, dropping duplicates of the same title+artist (singles vs album cuts). */
export function rankMatches(results: ItunesTrack[], want: { title: string; artist: string }) {
  const seen = new Set<string>();
  return results
    .filter((r) => r.trackName && r.artistName && (!r.kind || r.kind === "song"))
    .map((r) => ({ r, score: matchScore(r, want) }))
    .sort((a, b) => b.score - a.score)
    .filter(({ r }) => {
      const k = `${r.trackName}|${r.artistName}`.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** Below this, the catalogue found something else and we should not pretend. */
export const MATCH_THRESHOLD = 0.55;
