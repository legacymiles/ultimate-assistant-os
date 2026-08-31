// ---------------------------------------------------------------------------
// Friends Night Out — geography.
//
// Everything here is straight-line distance. Not driving distance: routing
// needs a keyed service, and for "is this worth the drive" a crow-flies mile is
// close enough to sort by. The UI says "mi away", never "min away", so the
// number never claims more precision than it has.
// ---------------------------------------------------------------------------

import type { Coords, Origin } from "./types";

const EARTH_RADIUS_MI = 3958.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in miles. */
export function distanceMi(a: Coords, b: Coords): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rounded for display: under 10 miles keeps a decimal, above it does not. */
export function formatDistance(mi: number | undefined): string {
  if (mi === undefined || Number.isNaN(mi)) return "";
  if (mi < 0.1) return "here";
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

/**
 * Bounding box around an origin, in degrees.
 *
 * Overpass and Ticketmaster both want a box or a radius rather than a filter
 * pass, so we widen by 15% and let the exact haversine filter trim the corners
 * afterwards. Without the margin, a place sitting exactly on the radius line
 * flickers in and out between refreshes as coordinates round differently.
 */
export function boundingBox(origin: Coords, radiusMi: number) {
  const pad = radiusMi * 1.15;
  const dLat = pad / 69;
  // Longitude degrees shrink toward the poles; clamp so we never divide by ~0.
  const milesPerLonDeg = Math.max(1, Math.cos(toRad(origin.lat)) * 69);
  const dLon = pad / milesPerLonDeg;
  return {
    south: origin.lat - dLat,
    north: origin.lat + dLat,
    west: origin.lon - dLon,
    east: origin.lon + dLon,
  };
}

export function withinRadius(
  origin: Coords,
  point: Coords,
  radiusMi: number,
): boolean {
  return distanceMi(origin, point) <= radiusMi;
}

// ----- place lookup --------------------------------------------------------

export interface PlaceSuggestion {
  label: string;
  lat: number;
  lon: number;
}

/**
 * Turn typed text into coordinates using OpenStreetMap's Nominatim.
 *
 * Keyless, which is why it is here rather than Google Places. Nominatim's usage
 * policy caps this at one request per second and requires an identifying
 * User-Agent, so callers must debounce — see the onboarding component. The call
 * is proxied through our own route for exactly that reason: a browser cannot
 * set User-Agent.
 */
export async function lookupPlace(query: string): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const res = await fetch(`/api/fno/geocode?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: PlaceSuggestion[] };
  return data.results ?? [];
}

/** Browser geolocation, wrapped so callers get a plain promise. */
export function currentPosition(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("This browser has no location support."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? "Location permission was denied — search for your town instead."
              : "Could not read your location — search for your town instead.",
          ),
        ),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  });
}

/** Reverse-geocode coordinates into a label, for the header after a GPS fix. */
export async function labelForCoords(c: Coords): Promise<Origin> {
  try {
    const res = await fetch(`/api/fno/geocode?lat=${c.lat}&lon=${c.lon}`);
    if (res.ok) {
      const data = (await res.json()) as { label?: string };
      if (data.label) return { ...c, label: data.label };
    }
  } catch {
    // Fall through to coordinates — a label is a nicety, not a requirement.
  }
  return { ...c, label: `${c.lat.toFixed(3)}, ${c.lon.toFixed(3)}` };
}
