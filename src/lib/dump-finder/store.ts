// ---------------------------------------------------------------------------
// What Dump Finder remembers, as one synced blob.
//
// OpenStreetMap is the list of places; this is what the owner learns about
// them — "takes millings, $6/ton, closes 3:30, scale house on the left" — plus
// the spots no mapper has added yet, and the last radius, filter and place, so
// the app opens where it was left. It follows every device through the hub's
// app_state sync, and works local-only with no Supabase.
// ---------------------------------------------------------------------------

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { ALL_KINDS, isSiteKind, type SiteKind } from "./kinds";

export const KEY = "dump-finder:v1";

export interface MySpot {
  id: string;
  name: string;
  kinds: SiteKind[];
  lat: number;
  lon: number;
  createdAt: string;
}

export interface Place {
  lat: number;
  lon: number;
  label: string;
  /** "gps" — the device; "search" — a typed address; "map" — Search this area. */
  source: "gps" | "search" | "map";
  /** GPS accuracy in metres, when the device reported one. */
  accuracyM?: number;
}

export interface FinderData {
  /** Free-text notes, keyed by site id (`osm:way/123` or `mine:…`). */
  notes: Record<string, string>;
  spots: MySpot[];
  radiusMi: number;
  kinds: SiteKind[];
  layer: "map" | "satellite";
  lastPlace: Place | null;
}

export const RADIUS_STOPS = [5, 10, 25, 50] as const;

export const EMPTY: FinderData = {
  notes: {},
  spots: [],
  radiusMi: 25,
  kinds: [...ALL_KINDS],
  layer: "map",
  lastPlace: null,
};

/** Read, repairing anything a half-written or older blob got wrong. */
export function load(): FinderData {
  const raw = loadLocal<Partial<FinderData>>(KEY, {});
  const kinds = Array.isArray(raw.kinds) ? raw.kinds.filter(isSiteKind) : EMPTY.kinds;
  return {
    notes: raw.notes && typeof raw.notes === "object" ? raw.notes : {},
    spots: Array.isArray(raw.spots) ? raw.spots.filter((s) => s && typeof s.lat === "number") : [],
    radiusMi: typeof raw.radiusMi === "number" ? Math.min(50, Math.max(1, raw.radiusMi)) : EMPTY.radiusMi,
    kinds,
    layer: raw.layer === "satellite" ? "satellite" : "map",
    lastPlace: raw.lastPlace && typeof raw.lastPlace.lat === "number" ? raw.lastPlace : null,
  };
}

export function save(data: FinderData): void {
  saveSynced(KEY, data);
}

export interface GeocodeHit {
  label: string;
  lat: number;
  lon: number;
}
