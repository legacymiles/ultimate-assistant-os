// GET /api/viral-studio/poster?yt=<video id>   — a YouTube clip's real thumbnail
// GET /api/viral-studio/poster?u=<post link>   — any other post's real cover
//
// Served from our own origin on purpose: the hover reveal draws the poster as
// a WebGL texture, and a browser refuses to let a page read pixels from
// another site's image without CORS headers, which these CDNs don't send.
// TikTok and Instagram cover links are signed and expire within days, so they
// are looked up fresh here and cached by the browser, never stored.

import { parseLink } from "@/lib/social-import/platform";
import { resolveSocialPost } from "@/lib/social-import/resolve";
import { assertPublic, fetchBytes, fetchJson } from "@/lib/social-import/safeFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 4_000_000;

function miss(): Response {
  // No cover: the tile draws its own placeholder. Cached briefly so a wall of
  // tiles doesn't re-ask on every render.
  return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=900" } });
}

async function image(url: string | null): Promise<Response | null> {
  if (!url || !/^https:\/\//i.test(url)) return null;
  const got = await fetchBytes(url, { maxBytes: MAX_BYTES, accept: "image/avif,image/webp,image/jpeg,image/*" }).catch(() => null);
  if (!got || !got.type.startsWith("image/")) return null;
  // YouTube answers a missing maxres size with a 120×90 grey placeholder; anything that small is not the frame.
  if (got.bytes.length < 2_500) return null;
  return new Response(new Uint8Array(got.bytes), {
    headers: {
      "content-type": got.type,
      "content-length": String(got.bytes.length),
      "cache-control": "public, max-age=21600, stale-while-revalidate=86400",
    },
  });
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;

  const yt = params.get("yt");
  if (yt) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(yt)) return miss();
    // Sharpest first: maxres exists for most uploads, hq for every one.
    for (const size of ["maxresdefault", "hq720", "hqdefault"]) {
      const res = await image(`https://i.ytimg.com/vi/${yt}/${size}.jpg`);
      if (res) return res;
    }
    return miss();
  }

  const link = parseLink(params.get("u") ?? "");
  if (!link) return miss();
  try {
    await assertPublic(link.url);
  } catch {
    return miss();
  }

  let cover: string | null = null;
  if (link.platform === "tiktok") {
    const o = await fetchJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(link.url.href)}`);
    cover = typeof o?.thumbnail_url === "string" ? o.thumbnail_url : null;
  }
  const first = await image(cover);
  if (first) return first;

  const post = await resolveSocialPost(link.url.href, { followLinks: 0 }).catch(() => null);
  return (await image(post?.thumbnailUrl ?? null)) ?? miss();
}
