// ---------------------------------------------------------------------------
// Server-side: turn whatever was pasted into a catalogue-confirmed song.
// Every fetch goes through social-import's safeFetch, so a pasted link can't
// point the server at a private address.
// ---------------------------------------------------------------------------

import { fetchJson, fetchText } from "@/lib/social-import/safeFetch";
import {
  appleTrackId,
  cleanVideoTitle,
  itunesToIdentity,
  MATCH_THRESHOLD,
  metaContent,
  parseAppleOgTitle,
  parseSongInput,
  parseSpotifyDescription,
  parseSpotifyEmbed,
  rankMatches,
  spotifyTrackId,
  type Identity,
  type ItunesTrack,
} from "./identify";

export interface IdentifyResult {
  identity: Identity;
  /** Other plausible matches, so a wrong pick is one click from right. */
  alternatives: Identity[];
  warning?: string;
}

async function itunesSearch(term: string, limit = 10): Promise<ItunesTrack[]> {
  const url = `https://itunes.apple.com/search?media=music&entity=song&limit=${limit}&term=${encodeURIComponent(term)}`;
  const json = await fetchJson(url);
  return Array.isArray(json?.results) ? (json.results as ItunesTrack[]) : [];
}

/** Search the catalogue for a title/artist pair; unmatched keeps what we know. */
async function confirm(
  want: { title: string; artist: string },
  link: string | undefined,
  extra: Partial<Identity> = {},
): Promise<IdentifyResult> {
  const term = `${want.artist} ${want.title}`.trim();
  const ranked = term ? rankMatches(await itunesSearch(term), want) : [];
  const alternatives = ranked.slice(1, 6).map(({ r }) => itunesToIdentity(r, link));
  if (ranked[0] && ranked[0].score >= MATCH_THRESHOLD) {
    return { identity: itunesToIdentity(ranked[0].r, link), alternatives };
  }
  return {
    identity: { ...extra, title: want.title, artist: want.artist, link, matched: false },
    alternatives: ranked.slice(0, 5).map(({ r }) => itunesToIdentity(r, link)),
    warning: want.title
      ? `Couldn't confirm "${want.title}" in the music catalogue — filing from the title alone.`
      : "Couldn't work out which song that is.",
  };
}

export async function identifySong(input: string): Promise<IdentifyResult | { error: string }> {
  const parsed = parseSongInput(input);
  if (!parsed) return { error: "Type a song name or paste a link." };

  if (parsed.kind === "name") {
    // "Title - Artist", "Title by Artist" or one run-on phrase. Dashes are
    // ambiguous (people write both orders), so both halves go in the search
    // term and the scorer, which reads the whole phrase, sorts it out.
    const by = parsed.query.match(/^(.*?)\s+by\s+(.+)$/i);
    const want = by ? { title: by[1], artist: by[2] } : { title: parsed.query, artist: "" };
    const ranked = rankMatches(await itunesSearch(parsed.query), want);
    if (ranked[0] && ranked[0].score >= MATCH_THRESHOLD) {
      return {
        identity: itunesToIdentity(ranked[0].r),
        alternatives: ranked.slice(1, 6).map(({ r }) => itunesToIdentity(r)),
      };
    }
    const dash = parsed.query.split(/\s+[-–—]\s+/);
    return {
      identity: {
        title: dash.length > 1 ? dash[0] : parsed.query,
        artist: dash.length > 1 ? dash.slice(1).join(" - ") : "",
        matched: false,
      },
      alternatives: ranked.slice(0, 5).map(({ r }) => itunesToIdentity(r)),
      warning: ranked.length
        ? "No confident match — pick the right one below, or keep it as typed."
        : "Not found in the music catalogue — filing from the name as typed.",
    };
  }

  const link = parsed.url.toString();

  if (parsed.source === "youtube") {
    const o = await fetchJson(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(link)}`,
    );
    if (!o?.title) return { error: "That YouTube video couldn't be read — is it private or removed?" };
    return confirm(cleanVideoTitle(String(o.title), String(o.author_name ?? "")), link, {
      artwork: o.thumbnail_url,
    });
  }

  if (parsed.source === "apple") {
    const id = appleTrackId(parsed.url);
    if (id) {
      const json = await fetchJson(`https://itunes.apple.com/lookup?id=${id}`);
      const track = (json?.results as ItunesTrack[] | undefined)?.find((r) => r.trackName);
      if (track) return { identity: itunesToIdentity(track, link), alternatives: [] };
    }
    const html = await fetchText(link, 600_000);
    const og = html && parseAppleOgTitle(metaContent(html, "og:title") ?? "");
    if (!og) return { error: "That Apple Music link doesn't point at a song." };
    return confirm(og, link);
  }

  if (parsed.source === "spotify") {
    // The track page is a web-player shell with no metadata; the embed page has it.
    const id = spotifyTrackId(parsed.url);
    const embed = id ? await fetchText(`https://open.spotify.com/embed/track/${id}`, 600_000) : null;
    const fromEmbed = embed ? parseSpotifyEmbed(embed) : null;
    if (fromEmbed) return confirm(fromEmbed, link);
    // Older page shape, kept as a fallback in case the embed changes.
    const html = await fetchText(link, 600_000);
    const title = html ? metaContent(html, "og:title") : null;
    const desc = html ? parseSpotifyDescription(metaContent(html, "og:description") ?? "") : null;
    if (!title) return { error: "That Spotify link couldn't be read — is it a track (not a playlist or album)?" };
    return confirm({ title, artist: desc?.artist ?? "" }, link, { year: desc?.year });
  }

  // Anything else: a web page's title is the best clue there is.
  const html = await fetchText(link, 600_000);
  const title = html ? (metaContent(html, "og:title") ?? html.match(/<title[^>]*>([^<]*)</i)?.[1]) : null;
  if (!title) return { error: "Couldn't read that page. Try the song name instead." };
  return confirm(cleanVideoTitle(title), link);
}
