// ---------------------------------------------------------------------------
// POST /api/youtube-videos/recommend  { videos: TasteItem[] } → RecResponse
//
// Picks for the "For you" tab, best tier available (see lib/youtube-videos/
// recommend.ts): YouTube search with YOUTUBE_API_KEY, else the AI reading the
// saved titles, else taste read locally. Always 200 with something useful —
// a missing key or a failed call drops one tier and says so in `note`.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { aiConfigured, aiFetch, UNPICKED_MODEL } from "@/lib/ai/provider";
import {
  aiPrompt,
  basicRecommendations,
  dedupe,
  parseAi,
  queriesFor,
  type Recommendation,
  type RecResponse,
  type TasteItem,
} from "@/lib/youtube-videos/recommend";

export const runtime = "nodejs";

function readTaste(body: unknown): TasteItem[] {
  const list = (body as { videos?: unknown } | null)?.videos;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 40).flatMap((r) => {
    const v = r as Partial<TasteItem>;
    if (!v || typeof v.platform !== "string") return [];
    return [
      {
        platform: v.platform.slice(0, 20),
        title: typeof v.title === "string" ? v.title.slice(0, 200) : undefined,
        author: typeof v.author === "string" ? v.author.slice(0, 100) : undefined,
        videoId: typeof v.videoId === "string" ? v.videoId.slice(0, 40) : undefined,
      },
    ];
  });
}

interface YtSearch {
  items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; thumbnails?: { high?: { url?: string }; medium?: { url?: string } } } }[];
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function fromYouTube(taste: TasteItem[], key: string): Promise<Recommendation[]> {
  const saved = new Set(taste.map((t) => t.videoId).filter(Boolean));
  const queries = queriesFor(taste);
  const results = await Promise.all(
    queries.map(async (q) => {
      const u = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=6&safeSearch=moderate&q=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`;
      const res = await fetch(u, { signal: AbortSignal.timeout(7_000) });
      if (!res.ok) return [];
      const d = (await res.json()) as YtSearch;
      return (d.items ?? []).flatMap((it): Recommendation[] => {
        const id = it.id?.videoId;
        if (!id || saved.has(id)) return [];
        return [
          {
            id: `yt-${id}`,
            type: "video",
            videoId: id,
            title: decode(it.snippet?.title ?? "Video"),
            channel: it.snippet?.channelTitle,
            reason: `Because you save ${q}`,
            url: `https://www.youtube.com/watch?v=${id}`,
            thumb: it.snippet?.thumbnails?.high?.url ?? it.snippet?.thumbnails?.medium?.url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          },
        ];
      });
    }),
  );
  // Interleave the queries so the first row isn't six of one thing.
  const out: Recommendation[] = [];
  for (let i = 0; i < 6; i++) for (const r of results) if (r[i]) out.push(r[i]);
  return dedupe(out).slice(0, 12);
}

async function fromAi(taste: TasteItem[]): Promise<Recommendation[]> {
  const res = await aiFetch({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: UNPICKED_MODEL,
      temperature: 0.7,
      max_tokens: 900,
      messages: [
        { role: "system", content: "You recommend videos. Reply with JSON only." },
        { role: "user", content: aiPrompt(taste) },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return [];
  const d = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return parseAi(d.choices?.[0]?.message?.content ?? "");
}

export async function POST(req: Request) {
  const taste = readTaste(await req.json().catch(() => null));
  const known = taste.filter((t) => t.title || t.author);
  if (!taste.length) {
    return NextResponse.json<RecResponse>({ mode: "empty", items: [], note: "Save a few videos and picks for you show up here." });
  }

  const ytKey = process.env.YOUTUBE_API_KEY?.trim();
  if (ytKey && known.length) {
    try {
      const items = await fromYouTube(known, ytKey);
      if (items.length) return NextResponse.json<RecResponse>({ mode: "youtube", items, note: "Real videos from YouTube, picked from what you save." });
    } catch {
      /* drop a tier */
    }
  }

  if (aiConfigured() && known.length) {
    try {
      const items = await fromAi(known);
      if (items.length) {
        return NextResponse.json<RecResponse>({
          mode: "ai",
          items,
          note: ytKey ? "YouTube didn't answer just now, so these are searches Jarvis picked from your saves." : "Searches Jarvis picked from your saves. Add a YouTube key to get real videos here.",
        });
      }
    } catch {
      /* drop a tier */
    }
  }

  const items = basicRecommendations(known);
  return NextResponse.json<RecResponse>({
    mode: items.length ? "basic" : "empty",
    items,
    note: items.length ? "Searches built from the words and channels you save most." : "Titles are still loading for your saves. Picks show up once they do.",
  });
}
