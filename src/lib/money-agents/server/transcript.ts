import "server-only";

// ---------------------------------------------------------------------------
// A YouTube video's own captions, read the way the player reads them.
//
// Best effort and free: the watch page names its caption tracks, and each
// track is a small timed-text document. When YouTube hands back nothing (no
// captions, a consent wall, a datacenter block), this returns null and the
// route moves on to the next way of finding moments — it never throws.
// ---------------------------------------------------------------------------

import type { Segment } from "../logic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export function youTubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/live\/|\/embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}

/** Timed text is often entity-encoded twice ("&amp;#39;"), so decode until it stops changing. */
function decode(s: string): string {
  let out = s;
  for (let i = 0; i < 3; i++) {
    const next = decodeOnce(out);
    if (next === out) break;
    out = next;
  }
  return out.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function decodeOnce(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Timed text (srv1 `<text start dur>` or srv3 `<p t d>`) → segments. Exported for tests. */
export function parseTimedText(xml: string): Segment[] {
  const out: Segment[] = [];
  for (const m of xml.matchAll(/<text[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)) {
    const text = decode(m[2]);
    if (text) out.push({ start: Number(m[1]), text });
  }
  if (out.length) return out;
  for (const m of xml.matchAll(/<p[^>]*\bt="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = decode(m[2]);
    if (text) out.push({ start: Number(m[1]) / 1000, text });
  }
  return out;
}

export async function youTubeTranscript(url: string): Promise<{ segments: Segment[]; title: string; duration: number } | null> {
  const id = youTubeId(url);
  if (!id) return null;
  try {
    const page = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!page.ok) return null;
    const html = await page.text();
    const title = decode(html.match(/<meta name="title" content="([^"]*)"/)?.[1] ?? "");
    const duration = Number(html.match(/"lengthSeconds":"(\d+)"/)?.[1] ?? 0);
    const tracksRaw = html.match(/"captionTracks":(\[.*?\])/)?.[1];
    if (!tracksRaw) return null;
    const tracks = JSON.parse(tracksRaw) as { baseUrl: string; languageCode?: string; kind?: string }[];
    const pick =
      tracks.find((t) => t.languageCode?.startsWith("en") && t.kind !== "asr") ??
      tracks.find((t) => t.languageCode?.startsWith("en")) ??
      tracks[0];
    if (!pick?.baseUrl) return null;
    const res = await fetch(pick.baseUrl.replace(/\\u0026/g, "&"), {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const segments = parseTimedText(await res.text());
    return segments.length ? { segments, title, duration } : null;
  } catch {
    return null;
  }
}
