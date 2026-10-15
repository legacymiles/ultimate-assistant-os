// ---------------------------------------------------------------------------
// GET /api/dump-finder/geocode?q=
//
// A typed place — a ZIP, a town, a street address, a job-site address — to a
// point, for when the phone's location is off or the load is going somewhere
// other than where the driver is standing. OpenStreetMap's Nominatim, keyless;
// its policy asks for an identifying User-Agent, which only a server can set.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import type { GeocodeHit } from "@/lib/dump-finder/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 200);
  if (!q) return NextResponse.json({ error: "Type a ZIP, town or address." }, { status: 400 });

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "us,ca");

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "UltimateAssistantOS-DumpFinder/1.0", "Accept-Language": "en" },
      signal: AbortSignal.timeout(12_000),
      next: { revalidate: 86_400 },
    });
    if (!res.ok) throw new Error(String(res.status));
    const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
    const hits: GeocodeHit[] = rows.map((r) => ({
      label: r.display_name.replace(/, United States$/, ""),
      lat: Number(r.lat),
      lon: Number(r.lon),
    }));
    return NextResponse.json({ hits });
  } catch {
    return NextResponse.json(
      { error: "Address search is not answering. Try again, or drag the map and use Search this area." },
      { status: 502 },
    );
  }
}
