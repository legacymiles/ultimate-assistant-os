// ---------------------------------------------------------------------------
// The resolver — a dance name in, a verified playable video out.
//
// This is the honesty gate of the whole app, and it is shared deliberately:
// the build-time seed script, the manual "add by name" route and Dance of the
// Day all call `resolveVideo`. There is exactly one definition of "playable",
// so a daily pick can never be held to a weaker standard than the seed.
//
// Three stages, each of which can reject:
//
//   1. search    YouTube's results page, scraped for video ids. No key exists
//                for this; the Data API needs one and has a quota, and the
//                results page does not.
//   2. oEmbed    keyless, returns title/channel/thumbnail. A 404 here means
//                the video is private, deleted, or never existed — which is
//                what catches a hallucinated id.
//   3. embed     `playableInEmbed` on the watch page. oEmbed answers "does it
//                exist", NOT "will it play in an iframe". A video whose owner
//                disabled embedding passes stage 2 and would ship as a tile
//                that looks fine and plays nothing. This stage is the whole
//                difference between a wall that works and a wall of dead air.
//
// Server-only: every call here talks to youtube.com.
// ---------------------------------------------------------------------------

import type { DanceVideo } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** YouTube's "under 4 minutes" filter — dances are clips, not lectures. */
const SHORT_FILTER = "EgIYAQ%253D%253D";

const TIMEOUT_MS = 12_000;

async function get(url: string): Promise<Response | null> {
  try {
    return await fetch(url, {
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Network failure and timeout are the same thing to every caller: no
    // candidate. Never let a fetch reject bubble into a 500.
    return null;
  }
}

/** Stage 1 — candidate ids, most relevant first, de-duplicated. */
export async function searchYouTube(query: string, limit = 8): Promise<string[]> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    query
  )}&sp=${SHORT_FILTER}`;
  const res = await get(url);
  if (!res?.ok) return [];
  const html = await res.text();
  const ids = [...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map((m) => m[1]);
  // The results page repeats each id across several render blocks, so the raw
  // match list is ~4x longer than the real result count. Order is preserved by
  // Set, and order IS relevance.
  return [...new Set(ids)].slice(0, limit);
}

interface OEmbed {
  title: string;
  author_name: string;
  thumbnail_url: string;
}

/** Stage 2 — exists and is public. */
async function oembed(id: string): Promise<OEmbed | null> {
  const res = await get(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`
  );
  if (!res?.ok) return null;
  try {
    const j = (await res.json()) as OEmbed;
    return j.title && j.author_name ? j : null;
  } catch {
    return null;
  }
}

/** Stage 3 — will actually play inside an iframe on our page. */
async function playableInEmbed(id: string): Promise<boolean> {
  const res = await get(`https://www.youtube.com/watch?v=${id}`);
  if (!res?.ok) return false;
  const html = await res.text();
  if (/"playableInEmbed":false/.test(html)) return false;
  // Absence of the flag is treated as playable — it is present on every normal
  // watch page, and a layout change upstream should degrade to "try it" rather
  // than silently emptying the whole wall.
  return !/"status":"(UNPLAYABLE|LOGIN_REQUIRED|ERROR)"/.test(html);
}

/**
 * Verify one id all the way through. Returns null if any stage rejects, which
 * is the only way a video is allowed to be discarded.
 */
export async function verifyVideo(id: string): Promise<DanceVideo | null> {
  const meta = await oembed(id);
  if (!meta) return null;
  if (!(await playableInEmbed(id))) return null;
  return {
    kind: "youtube",
    ref: id,
    // hqdefault is the one thumbnail size that exists for every video,
    // including Shorts. maxresdefault 404s on plenty of them.
    poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    channel: meta.author_name,
    sourceTitle: meta.title,
    verifiedAt: new Date().toISOString(),
  };
}

export interface ResolveOptions {
  /** Video ids already used, so two dances never resolve to the same clip. */
  exclude?: Set<string>;
  /** Candidates to try before giving up. */
  tries?: number;
}

/**
 * Search, then verify candidates in relevance order until one passes.
 *
 * Returns null when nothing passes. Callers must treat null as "no dance",
 * never as "ship it without a video".
 */
export async function resolveVideo(
  query: string,
  opts: ResolveOptions = {}
): Promise<DanceVideo | null> {
  const { exclude, tries = 4 } = opts;
  const ids = (await searchYouTube(query)).filter((id) => !exclude?.has(id));
  for (const id of ids.slice(0, tries)) {
    const video = await verifyVideo(id);
    if (video) return video;
  }
  return null;
}

/** The default query for a dance name. Tuned overrides live in seed.names.ts. */
export function danceQuery(name: string): string {
  return `${name} tiktok dance`;
}
