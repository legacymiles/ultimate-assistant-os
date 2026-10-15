// ---------------------------------------------------------------------------
// Turning OpenStreetMap into a list of places a load can go.
//
// The data comes from the Overpass API: one query asks for every tag
// combination mappers use for asphalt plants, landfills, transfer stations,
// recycling centres, scrap yards and concrete plants around a point. This file
// is the pure half — the query text, the classifier that decides which kind a
// mapped feature is, and the reshaping into `Site` rows. The network half is
// the route at src/app/api/dump-finder/sites.
//
// What OSM does NOT know is whether a plant will take your millings today, what
// it charges a ton, or whether it only deals with account holders. The app says
// so on screen, and the owner's own notes per site are where that lives.
// ---------------------------------------------------------------------------

import type { SiteKind } from "./kinds";

export const METERS_PER_MILE = 1609.344;

export interface Site {
  /** `osm:node/123`, `osm:way/456` — or `mine:<uuid>` for a spot the owner added. */
  id: string;
  kinds: SiteKind[];
  name: string;
  /** True when OSM had no name and this one was made up from the kind. */
  unnamed: boolean;
  lat: number;
  lon: number;
  distanceMi: number;
  address?: string;
  phone?: string;
  website?: string;
  hours?: string;
  operator?: string;
  /** What the site says it takes, from the `recycling:*` tags. */
  accepts: string[];
  /** The `fee` tag as written: "yes", "no", or a price. */
  fee?: string;
  /** Where to fix or add details at the source. */
  sourceUrl?: string;
}

/** Overpass element, as returned with `out center tags`. */
export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

// --- distance --------------------------------------------------------------

export function milesBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3958.7613; // mean Earth radius, miles
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// --- the query -------------------------------------------------------------

const ASPHALT_NAME = "asphalt|blacktop|bitumin|millings|hot ?mix|paving";
const ASPHALT_PRODUCT = "asphalt|bitumen|tarmac|blacktop";
const CONCRETE_PRODUCT = "concrete|aggregate|gravel|ready.?mix";

/**
 * The Overpass QL for every candidate site within `radiusM` metres of a point.
 * `out center` gives ways and relations (a landfill is usually a polygon) one
 * point to pin them at.
 */
export function buildQuery(lat: number, lon: number, radiusM: number): string {
  const a = `(around:${Math.round(radiusM)},${lat.toFixed(5)},${lon.toFixed(5)})`;
  return [
    "[out:json][timeout:40];",
    "(",
    // Asphalt plants and paving yards — the millings.
    `  nwr["man_made"="works"]["product"~"${ASPHALT_PRODUCT}",i]${a};`,
    `  nwr["industrial"~"asphalt",i]${a};`,
    `  nwr["landuse"="industrial"]["name"~"${ASPHALT_NAME}",i]${a};`,
    `  nwr["man_made"="works"]["name"~"${ASPHALT_NAME}",i]${a};`,
    `  nwr["industrial"]["name"~"${ASPHALT_NAME}",i]${a};`,
    `  nwr["craft"]["name"~"asphalt|blacktop|paving",i]${a};`,
    `  nwr["recycling:asphalt"="yes"]${a};`,
    // Concrete, aggregate and C&D rubble.
    `  nwr["man_made"="works"]["product"~"${CONCRETE_PRODUCT}",i]${a};`,
    `  nwr["industrial"~"concrete",i]${a};`,
    `  nwr["recycling:concrete"="yes"]${a};`,
    `  nwr["recycling:rubble"="yes"]${a};`,
    // Waste.
    `  nwr["landuse"="landfill"]${a};`,
    `  nwr["amenity"="waste_transfer_station"]${a};`,
    `  nwr["amenity"="recycling"]["recycling_type"="centre"]${a};`,
    // Scrap.
    `  nwr["industrial"="scrap_yard"]${a};`,
    `  nwr["shop"="scrap"]${a};`,
    ");",
    "out center tags;",
  ].join("\n");
}

// --- classification --------------------------------------------------------

const yes = (v: string | undefined) => v === "yes";
const has = (v: string | undefined, re: RegExp) => !!v && re.test(v);

/** Lifecycle tags that mean the place no longer takes anything. */
function isDefunct(t: Record<string, string>): boolean {
  if (yes(t.disused) || yes(t.abandoned) || yes(t.demolished)) return true;
  if (t["landfill:status"] && /closed|capped|inactive/i.test(t["landfill:status"])) return true;
  return /^(closed|disused|abandoned)$/i.test(t.status ?? "") || t.access === "no";
}

/**
 * Which kinds this feature is, strongest first, or `[]` when it is none of
 * them (or is a closed one). The order is the pin colour: an asphalt plant that
 * also takes concrete is drawn as asphalt, because that is the rarer thing.
 */
export function classify(tags: Record<string, string> | undefined): SiteKind[] {
  const t = tags ?? {};
  if (isDefunct(t)) return [];
  const kinds: SiteKind[] = [];
  const add = (k: SiteKind) => {
    if (!kinds.includes(k)) kinds.push(k);
  };

  const name = t.name ?? "";
  const works = t.man_made === "works";
  const industrialish = works || t.landuse === "industrial" || !!t.industrial || !!t.craft;
  const asphaltName = new RegExp(ASPHALT_NAME, "i").test(name);

  if (
    (works && has(t.product, new RegExp(ASPHALT_PRODUCT, "i")))
    || has(t.industrial, /asphalt/i)
    || yes(t["recycling:asphalt"])
    || (industrialish && asphaltName)
  ) {
    add("millings");
  }

  if (
    (works && has(t.product, new RegExp(CONCRETE_PRODUCT, "i")))
    || has(t.industrial, /concrete/i)
    || yes(t["recycling:concrete"])
    || yes(t["recycling:rubble"])
    || yes(t["recycling:hardcore"])
  ) {
    add("concrete");
  }

  if (t.landuse === "landfill") add("landfill");
  if (t.amenity === "waste_transfer_station") add("transfer");
  if (t.amenity === "recycling" && t.recycling_type === "centre") add("recycling");

  if (
    t.industrial === "scrap_yard"
    || t.shop === "scrap"
    || yes(t["recycling:scrap_metal"])
  ) {
    add("scrap");
  }

  return kinds;
}

// --- reshaping -------------------------------------------------------------

/** `recycling:green_waste=yes` → "green waste". Only the ones marked yes. */
export function acceptedMaterials(tags: Record<string, string> | undefined): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(tags ?? {})) {
    if (!k.startsWith("recycling:") || v !== "yes") continue;
    const what = k.slice("recycling:".length).replace(/_/g, " ").trim();
    if (what) out.push(what);
  }
  return out.sort();
}

function addressOf(t: Record<string, string>): string | undefined {
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  const place = [t["addr:city"], t["addr:state"]].filter(Boolean).join(", ");
  const line = [street, [place, t["addr:postcode"]].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return line || t["addr:full"] || undefined;
}

const UNNAMED: Record<SiteKind, string> = {
  millings: "Asphalt plant",
  concrete: "Concrete / aggregate yard",
  landfill: "Landfill",
  transfer: "Transfer station",
  recycling: "Recycling center",
  scrap: "Scrap yard",
};

export function toSite(el: OsmElement, originLat: number, originLon: number): Site | null {
  const kinds = classify(el.tags);
  if (kinds.length === 0) return null;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  const t = el.tags ?? {};
  const named = t.name || t.operator || t.brand;
  const website = t.website || t["contact:website"] || t.url;
  return {
    id: `osm:${el.type}/${el.id}`,
    kinds,
    name: named || UNNAMED[kinds[0]],
    unnamed: !named,
    lat,
    lon,
    distanceMi: milesBetween(originLat, originLon, lat, lon),
    address: addressOf(t),
    phone: t.phone || t["contact:phone"] || undefined,
    website: website && /^https?:\/\//i.test(website) ? website : website ? `https://${website}` : undefined,
    hours: t.opening_hours || undefined,
    operator: t.operator && t.operator !== named ? t.operator : undefined,
    accepts: acceptedMaterials(t),
    fee: t.fee || t.charge || undefined,
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
  };
}

/**
 * Overpass elements → sites inside the radius, nearest first, one row per
 * feature. A plant mapped twice (the site polygon and a node on it with the
 * same name) collapses to the nearer copy.
 */
export function toSites(
  elements: OsmElement[],
  originLat: number,
  originLon: number,
  radiusMi: number,
): Site[] {
  const byId = new Map<string, Site>();
  for (const el of elements) {
    const s = toSite(el, originLat, originLon);
    if (!s || s.distanceMi > radiusMi) continue;
    byId.set(s.id, s);
  }
  const sorted = [...byId.values()].sort((a, b) => a.distanceMi - b.distanceMi);
  const seen: Site[] = [];
  for (const s of sorted) {
    const twin = !s.unnamed
      && seen.find(
        (o) => !o.unnamed
          && o.name.toLowerCase() === s.name.toLowerCase()
          && milesBetween(o.lat, o.lon, s.lat, s.lon) < 0.35,
      );
    if (twin) {
      for (const k of s.kinds) if (!twin.kinds.includes(k)) twin.kinds.push(k);
      twin.phone ??= s.phone;
      twin.website ??= s.website;
      twin.hours ??= s.hours;
      twin.address ??= s.address;
      twin.accepts = [...new Set([...twin.accepts, ...s.accepts])].sort();
      continue;
    }
    seen.push(s);
  }
  return seen;
}
