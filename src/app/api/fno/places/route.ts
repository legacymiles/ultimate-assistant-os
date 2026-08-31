import { NextResponse } from "next/server";
import {
  PLACES_MAX_RADIUS_MI,
  fetchPlaces,
  overpassStatus,
} from "@/lib/friends-night-out/sources/overpass";
import { enrichHooks } from "@/lib/friends-night-out/sources/wikipedia";
import type { PlacesResponse } from "@/lib/friends-night-out/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// ---------------------------------------------------------------------------
// POST /api/fno/places  { lat, lon, radiusMi }
//
// The Always On board. Overpass for the places, then Wikipedia for the hook
// lines. Both keyless, so this endpoint works with no configuration at all —
// it is the reason the app is useful before the user has set up anything.
//
// Hook enrichment is deliberately non-fatal: if Wikipedia is slow or down, the
// board still renders, just with plainer cards.
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
  const radiusMi = Math.max(1, Math.min(200, body.radiusMi ?? 25));

  try {
    const { places, capped } = await fetchPlaces({ lat: lat!, lon: lon! }, radiusMi);

    let enriched = places;
    try {
      enriched = await enrichHooks(places);
      // Enrichment nudges obscurity up for anything that turned out to have a
      // Wikipedia article, so the order has to be recomputed — otherwise the
      // board renders visibly unsorted, which reads as a bug even though every
      // individual score is right.
      enriched = [...enriched].sort(
        (a, b) => b.obscurity - a.obscurity || (a.distanceMi ?? 0) - (b.distanceMi ?? 0),
      );
    } catch {
      // A missing hook makes a card plainer, not broken. Never fail on it.
    }

    const payload: PlacesResponse = {
      places: enriched,
      sources: [
        {
          ...overpassStatus(),
          count: enriched.length,
          // Say it out loud. Silently searching a smaller circle than the user
          // asked for reads as "there is nothing out there", which is a lie.
          reason: capped
            ? `Places are searched to ${PLACES_MAX_RADIUS_MI} mi — a wider sweep across every tag is more than OpenStreetMap's free service will run. Events still use your full radius.`
            : undefined,
        },
      ],
      searchedAt: new Date().toISOString(),
    };
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "OpenStreetMap request failed";
    // 200 with an empty list and an explained source: the client renders the
    // Sources panel reason rather than an error page, which is the same
    // contract every other adapter follows.
    const payload: PlacesResponse = {
      places: [],
      sources: [{ ...overpassStatus(), ok: false, error: message }],
      searchedAt: new Date().toISOString(),
    };
    return NextResponse.json(payload);
  }
}
