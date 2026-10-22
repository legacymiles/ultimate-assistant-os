// POST /api/viral-studio/tag   { items: [{ id, tab, title, author?, song?, isSong?, url? , needStats? }] }
//
// Mood and category tags for clips already on the board (they were added
// before tags existed), plus TikTok's view counts where they're missing, so
// "Trending now" has numbers to work from. Up to 20 clips per call.

import { NextResponse } from "next/server";

import { parseLink } from "@/lib/social-import/platform";
import { tiktokDetails } from "@/lib/social-import/videoDownload";
import { tagClips, type TagInput } from "@/lib/viral-studio/server/tagger";
import { isTabId, type ClipStats } from "@/lib/viral-studio/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let raw: unknown[] = [];
  try {
    const body = await req.json();
    raw = Array.isArray(body?.items) ? body.items.slice(0, 20) : [];
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- validated field by field below
  const items = (raw as any[]).filter((i) => i && typeof i.id === "string" && isTabId(i.tab));
  const tagInputs: TagInput[] = items.map((i) => ({
    id: i.id,
    tab: i.tab,
    title: String(i.title ?? "").slice(0, 200),
    author: String(i.author ?? "").slice(0, 80),
    song: String(i.song ?? "").slice(0, 160),
    isSong: i.isSong === true,
  }));

  const stats: Record<string, ClipStats> = {};
  await Promise.all(
    items
      .filter((i) => i.needStats === true)
      .map(async (i) => {
        const link = parseLink(String(i.url ?? ""));
        if (link?.platform !== "tiktok") return;
        const d = await tiktokDetails(link.url).catch(() => null);
        if (d?.stats && (d.stats.views !== null || d.stats.postedAt)) stats[i.id] = { ...d.stats, readAt: new Date().toISOString() };
      }),
  );

  const tags = await tagClips(tagInputs).catch(() => ({}));
  return NextResponse.json({ tags, stats });
}
