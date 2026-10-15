// ---------------------------------------------------------------------------
// GET /api/dump-finder/sites?lat=&lon=&mi=
//
// Every asphalt plant, landfill, transfer station, recycling centre, scrap yard
// and concrete plant OpenStreetMap knows of within `mi` miles, nearest first.
//
// Overpass is free and keyless, so this works with no setup — but its public
// servers are shared and sometimes busy, so it tries three in turn and keeps a
// short in-memory cache. A driver re-opening the app in the same yard should
// not cost a public server another 40-mile query.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { METERS_PER_MILE, buildQuery, toSites, type OsmElement } from "@/lib/dump-finder/sites";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const CACHE_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; elements: OsmElement[] }>();

async function ask(query: string): Promise<OsmElement[]> {
  const failures: string[] = [];
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "UltimateAssistantOS-DumpFinder/1.0",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(45_000),
        cache: "no-store",
      });
      if (!res.ok) {
        failures.push(`${new URL(url).host} ${res.status}`);
        continue;
      }
      const json = (await res.json()) as { elements?: OsmElement[]; remark?: string };
      if (json.remark && /timed out|out of memory/i.test(json.remark)) {
        failures.push(`${new URL(url).host} ran out of time`);
        continue;
      }
      return json.elements ?? [];
    } catch (err) {
      failures.push(`${new URL(url).host} ${(err as Error).name === "TimeoutError" ? "timed out" : "unreachable"}`);
    }
  }
  throw new Error(failures.join("; "));
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const mi = Math.min(60, Math.max(1, Number(params.get("mi")) || 25));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: "Send lat and lon as numbers." }, { status: 400 });
  }

  // Cache by a ~1 km cell and the radius, and query a little wider than asked
  // so every point inside the cell is still fully covered.
  const cellLat = Math.round(lat * 100) / 100;
  const cellLon = Math.round(lon * 100) / 100;
  const key = `${cellLat},${cellLon},${mi}`;
  const hit = cache.get(key);
  let elements: OsmElement[];
  if (hit && Date.now() - hit.at < CACHE_MS) {
    elements = hit.elements;
  } else {
    try {
      elements = await ask(buildQuery(cellLat, cellLon, mi * METERS_PER_MILE + 1500));
    } catch (err) {
      return NextResponse.json(
        {
          error:
            "The OpenStreetMap servers are busy right now. Try again in a minute, or shrink the radius.",
          detail: (err as Error).message,
        },
        { status: 502 },
      );
    }
    cache.set(key, { at: Date.now(), elements });
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  }

  return NextResponse.json({
    sites: toSites(elements, lat, lon, mi),
    fetchedAt: new Date(hit?.at ?? Date.now()).toISOString(),
  });
}
