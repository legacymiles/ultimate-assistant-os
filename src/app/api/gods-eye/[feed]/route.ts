import { NextResponse } from "next/server";
import { FEEDS, type FeedName } from "@/lib/gods-eye/feeds";

export const runtime = "nodejs";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// GET /api/gods-eye/:feed
//
// A thin caching proxy in front of the public, keyless sources God's Eye View
// draws: OpenSky / adsb.lol flights, adsb.lol military, CelesTrak TLEs, USGS
// earthquakes, TfL JamCams and the submarine cable map. The browser can't call
// most of them directly (CORS, size, rate limits), and several ask callers not
// to hammer them — so each feed has a TTL and serves its last good copy when
// the upstream fails.
// ---------------------------------------------------------------------------

export async function GET(req: Request, ctx: { params: Promise<{ feed: string }> }) {
  const { feed } = await ctx.params;
  if (!(feed in FEEDS)) {
    return NextResponse.json({ error: `Unknown feed "${feed}"` }, { status: 404 });
  }
  const url = new URL(req.url);
  try {
    const result = await FEEDS[feed as FeedName](url.searchParams);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=10" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Feed unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
