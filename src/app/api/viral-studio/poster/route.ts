// GET /api/viral-studio/poster?u=<post link>
//
// A fresh cover image for a post, as a redirect. TikTok and Instagram cover
// links are signed and expire within days, so tiles never store one — they
// ask here, and the browser caches the answer for a few hours.

import { NextResponse } from "next/server";

import { parseLink } from "@/lib/social-import/platform";
import { resolveSocialPost } from "@/lib/social-import/resolve";
import { assertPublic, fetchJson } from "@/lib/social-import/safeFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("u") ?? "";
  const link = parseLink(raw);
  if (!link) return new Response(null, { status: 404 });
  try {
    await assertPublic(link.url);
  } catch {
    return new Response(null, { status: 404 });
  }

  let image: string | null = null;
  if (link.platform === "tiktok") {
    const o = await fetchJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(link.url.href)}`);
    image = typeof o?.thumbnail_url === "string" ? o.thumbnail_url : null;
  }
  if (!image) {
    const post = await resolveSocialPost(link.url.href, { followLinks: 0 }).catch(() => null);
    image = post?.thumbnailUrl ?? null;
  }
  if (!image || !/^https:\/\//i.test(image)) {
    // No cover: the tile draws its own placeholder. Cache the miss briefly so
    // a wall of covers doesn't re-ask on every render.
    return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=900" } });
  }
  return NextResponse.redirect(image, { status: 302, headers: { "cache-control": "public, max-age=14400" } });
}
