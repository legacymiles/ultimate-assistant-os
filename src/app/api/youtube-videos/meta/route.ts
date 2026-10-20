// ---------------------------------------------------------------------------
// GET /api/youtube-videos/meta?url=… → { title?, author?, thumb? }
//
// Title, channel and thumbnail for a saved link, through each platform's
// public oEmbed endpoint. Only those endpoints are ever called — the pasted
// URL is passed to them as a parameter, never fetched itself — so this can't
// be turned into a way to make the server fetch arbitrary addresses.
//
// Never fails loudly: an unknown site, a private video or a slow platform all
// come back as {} with a 200, and the card simply keeps its link as the title.
// Owner/session-gated by middleware like every /api route.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { parseLink, type Platform } from "@/lib/youtube-videos/links";

export const runtime = "nodejs";

const OEMBED: Partial<Record<Platform, (u: string) => string>> = {
  youtube: (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
  vimeo: (u) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}`,
  tiktok: (u) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`,
  x: (u) => `https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(u)}`,
  reddit: (u) => `https://www.reddit.com/oembed?url=${encodeURIComponent(u)}`,
};

interface OEmbed {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
  html?: string;
}

/** X's oEmbed has no title; the post text sits inside its blockquote. */
function textFromHtml(html: string): string | undefined {
  const m = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  if (!m) return undefined;
  const t = m[1].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 140) : undefined;
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url") ?? "";
  const link = parseLink(raw);
  const endpoint = link ? OEMBED[link.platform] : undefined;
  if (!link || !endpoint) return NextResponse.json({});
  try {
    const res = await fetch(endpoint(link.url), {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; JarvisWatchLater/1.0)" },
      signal: AbortSignal.timeout(6_000),
      next: { revalidate: 86_400 },
    });
    if (!res.ok) return NextResponse.json({});
    const d = (await res.json()) as OEmbed;
    const title = d.title?.trim() || (d.html ? textFromHtml(d.html) : undefined);
    const thumb = d.thumbnail_url && /^https:\/\//.test(d.thumbnail_url) ? d.thumbnail_url : undefined;
    return NextResponse.json(
      { title: title?.slice(0, 200), author: d.author_name?.slice(0, 100), thumb },
      { headers: { "Cache-Control": "private, max-age=86400" } },
    );
  } catch {
    return NextResponse.json({});
  }
}
