// ---------------------------------------------------------------------------
// POST /api/dances/resolve   { name?, tiktokUrl?, exclude?: string[] }
//
// Adding a dance by hand goes through the same gate the seed did. There is no
// "trust me" path into the vault.
//
// A TikTok link is read for credit metadata (keyless oEmbed) but is NOT the
// playable source — TikTok embeds cannot hover-autoplay. The playable video is
// resolved from the dance name either way.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";

import { danceQuery, resolveVideo } from "@/lib/dances/resolve";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface TikTokOEmbed {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

/** Keyless. Returns null for a deleted, private or malformed link. */
async function tiktokMeta(url: string): Promise<TikTokOEmbed | null> {
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as TikTokOEmbed;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: { name?: string; tiktokUrl?: string; exclude?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request body." }, { status: 400 });
  }

  const tiktokUrl = body.tiktokUrl?.trim();
  const meta = tiktokUrl ? await tiktokMeta(tiktokUrl) : null;

  // A name is required to search for. A TikTok caption is a poor name but a
  // usable starting point, and the user can correct it in the form.
  const name = body.name?.trim() || meta?.title?.slice(0, 60) || "";
  if (!name) {
    return NextResponse.json(
      { error: "Give a dance name, or a TikTok link that still resolves." },
      { status: 400 }
    );
  }

  const video = await resolveVideo(danceQuery(name), {
    exclude: new Set(body.exclude ?? []),
  });

  return NextResponse.json({
    name,
    video,
    // Told apart deliberately: "no link given" and "the link is dead" mean
    // different things to someone who just pasted one.
    tiktok: tiktokUrl ? { url: tiktokUrl, resolved: !!meta, author: meta?.author_name } : null,
    // Not an error. The dance can still be saved; it just has no video yet.
    unresolved: !video,
  });
}
