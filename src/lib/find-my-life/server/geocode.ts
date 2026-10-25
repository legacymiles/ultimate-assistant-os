import "server-only";

// ---------------------------------------------------------------------------
// "Where is that, in words?" — a street-level address for a fix, from
// OpenStreetMap's Nominatim. Best effort: 3 seconds, cached by rounded spot,
// and a fix keeps working without it (the page shows coordinates instead).
// Nominatim's policy asks for an identifying User-Agent and gentle use.
// ---------------------------------------------------------------------------

const cache = new Map<string, { text: string; at: number }>();
const DAY = 86_400_000;

export async function addressFor(lat: number, lng: number): Promise<string | undefined> {
  // ~100 m buckets: walking around the kitchen doesn't need a new lookup.
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY) return hit.text || undefined;
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");
    const res = await fetch(url, {
      headers: { "User-Agent": "UltimateAssistantOS-FindMyLife/1.0", "Accept-Language": "en" },
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) return undefined;
    const j = (await res.json()) as { name?: string; address?: Record<string, string> };
    const a = j.address ?? {};
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    const town = a.city || a.town || a.village || a.suburb || a.county || "";
    const place = j.name && j.name !== a.road ? j.name : "";
    const text = [place || street, town].filter(Boolean).join(", ").slice(0, 140);
    if (cache.size > 2000) cache.clear();
    cache.set(key, { text, at: Date.now() });
    return text || undefined;
  } catch {
    return undefined;
  }
}
