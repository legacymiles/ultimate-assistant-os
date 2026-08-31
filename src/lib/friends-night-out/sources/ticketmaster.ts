// ---------------------------------------------------------------------------
// Ticketmaster Discovery API v2 adapter.
//
// The one ticketed source with a genuinely open door: a free key, 5,000 calls
// a day, and real geo search. Everything sold through Ticketmaster, LiveNation
// and their subsidiaries shows up here.
//
// It is also, by design, the LOW-obscurity source. If a thing is on sale here,
// six aggregators already know about it. Its value is coverage and accurate
// prices; the hidden gems come from elsewhere.
//
// Docs: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
// ---------------------------------------------------------------------------

import type { EventCategory, RawEvent, SearchCtx, SourceStatus } from "../types";

const BASE = "https://app.ticketmaster.com/discovery/v2/events.json";

export function ticketmasterStatus(): SourceStatus {
  const ok = Boolean(process.env.TICKETMASTER_API_KEY);
  return {
    id: "ticketmaster",
    label: "Ticketmaster",
    ok,
    reason: ok
      ? undefined
      : "Add TICKETMASTER_API_KEY — the key is free at developer.ticketmaster.com",
  };
}

interface TmImage {
  url?: string;
  width?: number;
  ratio?: string;
}

interface TmVenue {
  name?: string;
  address?: { line1?: string };
  city?: { name?: string };
  state?: { stateCode?: string };
  location?: { latitude?: string; longitude?: string };
  // Ticketmaster reports this only sometimes; when present it is the strongest
  // "everybody already knows about this" signal we get.
  capacity?: number;
}

interface TmEvent {
  id?: string;
  name?: string;
  url?: string;
  info?: string;
  description?: string;
  pleaseNote?: string;
  images?: TmImage[];
  dates?: {
    start?: { dateTime?: string; localDate?: string; localTime?: string; noSpecificTime?: boolean };
  };
  priceRanges?: { min?: number; max?: number; currency?: string }[];
  classifications?: { segment?: { name?: string }; genre?: { name?: string } }[];
  _embedded?: { venues?: TmVenue[] };
}

export async function fetchTicketmaster(ctx: SearchCtx): Promise<RawEvent[]> {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) return [];

  const url = new URL(BASE);
  url.searchParams.set("apikey", apiKey);
  // `latlong` is deprecated in favour of a geohash-encoded `geoPoint`.
  url.searchParams.set("geoPoint", geohash(ctx.lat, ctx.lon, 9));
  url.searchParams.set("radius", String(Math.max(1, Math.round(ctx.radiusMi))));
  url.searchParams.set("unit", "miles");
  url.searchParams.set("startDateTime", toTmTime(ctx.from));
  url.searchParams.set("endDateTime", toTmTime(ctx.to));
  url.searchParams.set("size", "200");
  url.searchParams.set("sort", "date,asc");

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    // Ticket inventory changes, but not minute to minute for discovery purposes.
    next: { revalidate: 900 },
  });

  if (res.status === 401) throw new Error("Ticketmaster rejected the API key.");
  if (res.status === 429) throw new Error("Ticketmaster rate limit reached — try again shortly.");
  if (!res.ok) throw new Error(`Ticketmaster returned ${res.status}`);

  const data = (await res.json()) as { _embedded?: { events?: TmEvent[] } };
  const events = data._embedded?.events ?? [];
  return events.map(toRawEvent).filter((e): e is RawEvent => e !== null);
}

function toRawEvent(ev: TmEvent): RawEvent | null {
  const title = ev.name?.trim();
  if (!title) return null;

  const startsAt = resolveStart(ev);
  if (!startsAt) return null;

  const venue = ev._embedded?.venues?.[0];
  const lat = Number(venue?.location?.latitude);
  const lon = Number(venue?.location?.longitude);

  const range = ev.priceRanges?.[0];
  // Ticketmaster's own free events do exist (radio promos, community days),
  // and they report min 0 rather than omitting the range.
  const price =
    range && (range.min !== undefined || range.max !== undefined)
      ? range.min === 0 && (range.max ?? 0) === 0
        ? { tier: "free" as const, note: "Free" }
        : { tier: "paid" as const, min: range.min, max: range.max }
      : { tier: "unknown" as const };

  return {
    title,
    description: [ev.info, ev.description, ev.pleaseNote]
      .filter(Boolean)
      .join(" ")
      .trim() || undefined,
    startsAt,
    allDay: ev.dates?.start?.noSpecificTime === true,
    venue: {
      name: venue?.name ?? "Venue TBA",
      address: [venue?.address?.line1, venue?.city?.name, venue?.state?.stateCode]
        .filter(Boolean)
        .join(", ") || undefined,
      lat: Number.isFinite(lat) ? lat : undefined,
      lon: Number.isFinite(lon) ? lon : undefined,
      capacity: venue?.capacity,
    },
    category: mapCategory(ev),
    price,
    url: ev.url,
    imageUrl: bestImage(ev.images),
    source: {
      id: "ticketmaster",
      label: "Ticketmaster",
      url: ev.url,
      externalId: ev.id,
    },
  };
}

function resolveStart(ev: TmEvent): string | null {
  const start = ev.dates?.start;
  if (start?.dateTime) return start.dateTime;
  if (start?.localDate) {
    // No time given — anchor to 7pm local so it sorts into the evening rather
    // than to midnight, where it would read as "yesterday" in a grouped list.
    const time = start.localTime ?? "19:00:00";
    const parsed = new Date(`${start.localDate}T${time}`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

function mapCategory(ev: TmEvent): EventCategory | undefined {
  const segment = ev.classifications?.[0]?.segment?.name?.toLowerCase() ?? "";
  const genre = ev.classifications?.[0]?.genre?.name?.toLowerCase() ?? "";
  if (segment.includes("music")) return "Music";
  if (segment.includes("sports")) return "Sports";
  if (genre.includes("comedy")) return "Arts";
  if (segment.includes("arts") || segment.includes("theatre")) return "Arts";
  if (segment.includes("film")) return "Arts";
  if (segment.includes("family")) return "Family";
  return undefined;
}

/** Widest 16:9 image — the posters look wrong cropped from a square source. */
function bestImage(images: TmImage[] | undefined): string | undefined {
  if (!images?.length) return undefined;
  const wide = images.filter((i) => i.ratio === "16_9" && i.url);
  const pool = wide.length ? wide : images.filter((i) => i.url);
  if (!pool.length) return undefined;
  return pool.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0].url;
}

/** Ticketmaster wants UTC with no milliseconds: 2026-08-30T00:00:00Z */
function toTmTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 19)}Z`;
}

// ----- geohash -------------------------------------------------------------

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/**
 * Standard geohash encoder. Nine characters is roughly a 5-metre cell, far
 * more precision than a radius search needs, but the API takes the hash as an
 * anchor point and applies `radius` itself, so extra precision costs nothing.
 */
export function geohash(lat: number, lon: number, precision = 9): string {
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  let hash = "";
  let bit = 0;
  let ch = 0;
  let even = true;

  while (hash.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lon > mid) {
        ch = (ch << 1) | 1;
        lonMin = mid;
      } else {
        ch = ch << 1;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat > mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch = ch << 1;
        latMax = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}
