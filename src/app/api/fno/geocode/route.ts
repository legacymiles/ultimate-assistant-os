import { NextResponse } from "next/server";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// GET /api/fno/geocode?q=asheville      → { results: [{ label, lat, lon }] }
// GET /api/fno/geocode?lat=..&lon=..    → { label }
//
// A thin proxy in front of OpenStreetMap's Nominatim. It exists for two
// reasons the browser cannot work around on its own:
//
//   1. Nominatim's usage policy requires an identifying User-Agent, and a
//      browser is not allowed to set that header.
//   2. Nominatim does not send permissive CORS headers for all deployments.
//
// Keyless by design — this is the only geocoder in the app, so setting a
// location never depends on a paid service.
// ---------------------------------------------------------------------------

const NOMINATIM = "https://nominatim.openstreetmap.org";

// Nominatim asks for a real contact point so they can reach an operator whose
// client misbehaves. A repo URL is the accepted form for open-source clients.
const UA =
  "FriendsNightOut/1.0 (Ultimate Assistant OS; https://github.com/ultimate-assistant-os)";

interface NominatimHit {
  display_name?: string;
  lat?: string;
  lon?: string;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");

  try {
    if (lat && lon) return NextResponse.json(await reverse(lat, lon));
    if (q) return NextResponse.json({ results: await forward(q) });
    return NextResponse.json({ error: "q or lat+lon required" }, { status: 400 });
  } catch (err) {
    // A geocoder outage should not break the app — the caller falls back to
    // raw coordinates, so an empty result is a better answer than a 500.
    const message = err instanceof Error ? err.message : "Lookup failed";
    return NextResponse.json({ results: [], error: message }, { status: 200 });
  }
}

async function forward(q: string) {
  const search = new URL(`${NOMINATIM}/search`);
  search.searchParams.set("q", q);
  search.searchParams.set("format", "jsonv2");
  search.searchParams.set("limit", "6");
  search.searchParams.set("addressdetails", "0");

  const res = await fetch(search, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    // Places do not move. A day of caching keeps us well inside Nominatim's
    // one-request-per-second policy even with an impatient typist upstream.
    next: { revalidate: 86_400 },
  });
  if (!res.ok) throw new Error(`Nominatim returned ${res.status}`);

  const hits = (await res.json()) as NominatimHit[];
  return hits
    .filter((h) => h.lat && h.lon)
    .map((h) => ({
      label: shorten(h.display_name ?? ""),
      lat: Number(h.lat),
      lon: Number(h.lon),
    }))
    .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lon));
}

async function reverse(lat: string, lon: string) {
  const search = new URL(`${NOMINATIM}/reverse`);
  search.searchParams.set("lat", lat);
  search.searchParams.set("lon", lon);
  search.searchParams.set("format", "jsonv2");
  // Town-level. Zooming closer returns a street address, which is more
  // precision than a header label wants and reads as a privacy leak.
  search.searchParams.set("zoom", "10");

  const res = await fetch(search, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 86_400 },
  });
  if (!res.ok) throw new Error(`Nominatim returned ${res.status}`);

  const hit = (await res.json()) as NominatimHit;
  return { label: shorten(hit.display_name ?? "") };
}

/**
 * Nominatim returns the full civic hierarchy — "Asheville, Buncombe County,
 * North Carolina, 28801, United States". The first two meaningful parts plus
 * the state is what a person recognises, so keep three and drop the rest.
 */
function shorten(displayName: string): string {
  const parts = displayName.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 3) return parts.join(", ");
  const country = parts[parts.length - 1];
  const isUs = /united states/i.test(country);
  const keep = isUs ? parts.slice(0, 3) : [...parts.slice(0, 2), country];
  // Drop a bare postcode if it landed in the kept slice.
  return keep.filter((p) => !/^\d{4,}$/.test(p)).join(", ");
}
