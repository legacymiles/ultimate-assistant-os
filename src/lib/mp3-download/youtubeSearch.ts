// ---------------------------------------------------------------------------
// Searching YouTube without yt-dlp and without a key.
//
// The PC bridge fetches files the deployed site cannot — but the rows you
// click to start that were also coming from yt-dlp, so on the live site there
// was nothing to click in the first place. Bridging the search too would mean
// waking the PC and waiting ten seconds just to see a list, and showing
// nothing whenever it slept.
//
// So the site asks YouTube the way a browser does. The results page ships its
// data as a JSON blob called ytInitialData; every entry carries the video id,
// the real title, the channel and the runtime, which is exactly what the
// scorer needs. No key, no quota, no binary, and it runs anywhere.
//
// This is a public page's own payload, so it can change shape. Every step
// degrades to an empty list rather than an error, and yt-dlp stays the
// preferred route wherever it exists because it is a maintained parser and
// this is not.
// ---------------------------------------------------------------------------

import { rank, scoreCandidate } from "./match";
import type { Candidate, Track } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/125.0.0.0 Safari/537.36";

/** "4:23" or "1:02:11" → milliseconds. */
function lengthMs(text: string | undefined): number | null {
  if (!text) return null;
  const parts = text.split(":").map(Number);
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0) * 1000;
}

/**
 * The balanced object starting at `from`, so a nested `}` inside a string does
 * not end the scan early. A regex cannot do this correctly and the payload is
 * a megabyte of arbitrary text, including titles full of braces and quotes.
 */
function balancedObject(html: string, from: number): string | null {
  const start = html.indexOf("{", from);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return html.slice(start, i + 1);
  }
  return null;
}

interface VideoRenderer {
  videoId?: string;
  title?: { runs?: { text?: string }[]; simpleText?: string };
  ownerText?: { runs?: { text?: string }[] };
  longBylineText?: { runs?: { text?: string }[] };
  lengthText?: { simpleText?: string };
  badges?: { metadataBadgeRenderer?: { style?: string } }[];
}

interface RawHit {
  id: string;
  title: string;
  channel: string;
  durationMs: number | null;
}

/** Walk the payload for every video entry, wherever YouTube nested it today. */
function collect(node: unknown, out: RawHit[], seen: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out, seen);
    return;
  }

  const record = node as Record<string, unknown>;
  const video = record.videoRenderer as VideoRenderer | undefined;

  if (video?.videoId && !seen.has(video.videoId)) {
    const title = video.title?.runs?.[0]?.text ?? video.title?.simpleText ?? "";
    const duration = lengthMs(video.lengthText?.simpleText);
    // No runtime means a live stream or a premiere: never the recording.
    if (title && duration !== null) {
      seen.add(video.videoId);
      out.push({
        id: video.videoId,
        title,
        channel:
          video.ownerText?.runs?.[0]?.text ?? video.longBylineText?.runs?.[0]?.text ?? "YouTube",
        durationMs: duration,
      });
    }
  }

  for (const key of Object.keys(record)) collect(record[key], out, seen);
}

/**
 * The top YouTube results for the confirmed track, scored against it.
 *
 * `downloadable` is false when nothing here can actually fetch a file — the
 * rows are still worth showing, because seeing the song exist and being told
 * how to get it beats an empty table, but the UI must not promise a download
 * it cannot perform.
 */
export async function searchYouTubeKeyless(track: Track, limit = 8): Promise<Candidate[]> {
  const query = `${track.artist} ${track.title}`.replace(/\s+/g, " ").trim();
  if (!query) return [];

  let html: string;
  try {
    const res = await fetch(
      "https://www.youtube.com/results?hl=en&gl=US&search_query=" + encodeURIComponent(query),
      {
        headers: {
          "user-agent": UA,
          "accept-language": "en-US,en;q=0.9",
          // Without these YouTube serves a consent interstitial in some
          // regions and the payload never appears.
          cookie: "CONSENT=YES+cb; SOCS=CAI",
        },
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      },
    );
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }

  const marker = html.indexOf("ytInitialData");
  if (marker < 0) return [];
  const json = balancedObject(html, marker);
  if (!json) return [];

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }

  const hits: RawHit[] = [];
  collect(data, hits, new Set());

  const out: Candidate[] = [];
  for (const hit of hits.slice(0, limit * 3)) {
    const { score, reasons } = scoreCandidate(track, {
      title: hit.title,
      creator: hit.channel,
      durationMs: hit.durationMs,
    });
    out.push({
      id: "youtube:" + hit.id,
      provider: "youtube",
      providerLabel: "YouTube",
      title: hit.title,
      creator: hit.channel,
      pageUrl: "https://www.youtube.com/watch?v=" + hit.id,
      fileUrl: "https://www.youtube.com/watch?v=" + hit.id,
      format: "MP3",
      bytes: null,
      durationMs: hit.durationMs,
      licence: {
        kind: "youtube",
        label: "YouTube · rights not verified",
        url: "https://www.youtube.com/watch?v=" + hit.id,
      },
      score,
      reasons,
    });
  }

  const confident = rank(out.filter((c) => c.score >= 30)).slice(0, limit);
  if (confident.length > 0) return confident;
  return rank(out.filter((c) => c.score >= 15)).slice(0, 3);
}
