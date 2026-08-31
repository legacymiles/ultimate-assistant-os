import { NextResponse } from "next/server";
import { discoverFeeds } from "@/lib/friends-night-out/sources/discover";

export const runtime = "nodejs";
// Probing up to forty small sites for calendars genuinely takes this long.
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// POST /api/fno/discover  { lat, lon, radiusMi }
//
// "Find calendars near me." Asks OpenStreetMap which libraries, churches,
// community centres, breweries, theatres and arts centres are inside the
// radius, then probes each of their websites for a machine-readable calendar.
//
// Nothing is subscribed automatically — the response is a list of proposals the
// user confirms. Which calendars belong on your board is a taste decision, and
// silently subscribing someone to a parish newsletter is not the app's call.
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  let body: { lat?: number; lon?: number; radiusMi?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { lat, lon } = body;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat and lon are required" }, { status: 400 });
  }
  const radiusMi = Math.max(1, Math.min(100, body.radiusMi ?? 25));

  try {
    const found = await discoverFeeds({ lat: lat!, lon: lon! }, radiusMi);
    return NextResponse.json({ feeds: found });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Discovery failed";
    return NextResponse.json({ feeds: [], error: message });
  }
}
