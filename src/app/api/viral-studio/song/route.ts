// POST /api/viral-studio/song   { url, key? }
//
// The audio tab's Find song button: names the song in a clip already on the
// board. The post's own sound credit first (TikTok), then listening to the
// audio. Returns { sound, song?, stats? } or { error } in plain words.

import { NextResponse } from "next/server";

import { currentUid } from "@/lib/dance-studio/server/library";
import { parseLink } from "@/lib/social-import/platform";
import { tiktokDetails } from "@/lib/social-import/videoDownload";
import { judgeSound, songFromCredit } from "@/lib/viral-studio/song";
import { audioSource } from "@/lib/viral-studio/server/resolveLink";
import { listen } from "@/lib/viral-studio/server/songFinder";
import { ownsKey } from "@/lib/viral-studio/server/storage";
import type { Playback } from "@/lib/viral-studio/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let url = "";
  let key: unknown = null;
  try {
    const body = await req.json();
    url = String(body?.url ?? "").trim();
    key = body?.key ?? null;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const link = parseLink(url);
  if (!link) return NextResponse.json({ error: "This clip has no link to check." }, { status: 400 });

  const details = link.platform === "tiktok" ? await tiktokDetails(link.url).catch(() => null) : null;
  const music = details?.music ?? null;
  const stats = details?.stats
    ? { views: details.stats.views, likes: details.stats.likes, postedAt: details.stats.postedAt, readAt: new Date().toISOString() }
    : undefined;

  if (songFromCredit(music)) {
    const judged = judgeSound(music, null);
    return NextResponse.json({ sound: judged.kind, song: judged.song, stats });
  }

  // Only the owner's own saved file is ever read; anything else is heard through the post's link.
  const uid = key ? await currentUid().catch(() => null) : null;
  const play: Playback = uid && ownsKey(uid, key) ? { kind: "file", key } : { kind: "none" };
  const heard = await listen(await audioSource(play, link.url.href));
  if (!heard.ok) {
    // An "original sound" credit is still an answer when listening isn't possible.
    const judged = judgeSound(music, null);
    if (judged.kind === "original") return NextResponse.json({ sound: "original", stats });
    return NextResponse.json({ error: heard.error, limit: heard.limit ?? false, stats }, { status: heard.limit ? 429 : 502 });
  }
  const judged = judgeSound(music, heard.song);
  return NextResponse.json({ sound: judged.kind, song: judged.song, stats });
}
