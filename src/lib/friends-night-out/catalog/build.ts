import "server-only";

// Builds one city's catalogue: every place worth going, filed in a section with
// 1–5 stars. Four stages, each reported through onProgress:
//
//   places    the existing OpenStreetMap activity search (+ notable parks)
//   discover  a web-search model per section, for what OSM tags can't find
//   verify    every discovered place must match a real named OSM element
//   rate      AI section + stars + hook, per the owner's rubric
//
// Every stage fails soft. No AI key → OSM-only with estimated stars.
import { boundingBox, distanceMi } from "../geo";
import { SECTIONS, type SectionId } from "../sections";
import { PLACES_MAX_RADIUS_MI, fetchPlaces, overpassQuery, type OverpassElement } from "../sources/overpass";
import { enrichHooks } from "../sources/wikipedia";
import type { Coords, FnoPlace } from "../types";
import { discoverSection, rateBatch, type RateItem } from "./ai";
import { heuristicStars } from "./rubric";
import { defaultSection } from "./sectionMap";
import { buildNameQueries, dedupeByNameAndPlace, matchByName, type Candidate } from "./verify";

export interface CatalogSource {
  kind: "osm" | "web" | "wikipedia";
  label: string;
  url?: string;
}

export interface CatalogPlace {
  key: string;
  name: string;
  section: SectionId;
  aiStars: number;
  starsEstimated: boolean;
  aiReason?: string;
  hook?: string;
  address?: string;
  lat: number;
  lon: number;
  distanceMi: number;
  priceTier?: "free";
  osmId?: string;
  kind?: string;
  sources: CatalogSource[];
  /** OSM rarity 0–100 when known; drives estimated stars. */
  obscurity?: number;
  why?: string;
}

export interface BuildProgress {
  stage: "places" | "discover" | "verify" | "rate" | "done";
  message: string;
}

export interface BuildResult {
  places: CatalogPlace[];
  radiusMi: number;
  stats: { osm: number; discovered: number; verified: number; dropped: number; aiRated: number };
}

const RATE_BATCH = 40;
/** Two at a time: bursts get 429s from the model's provider. */
const RATE_CONCURRENCY = 2;

function addressOf(tags: Record<string, string> = {}): string | undefined {
  const parts = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:city"],
    tags["addr:state"],
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

function fromActivity(p: FnoPlace): CatalogPlace {
  const sources: CatalogSource[] = [{ kind: "osm", label: "OpenStreetMap" }];
  if (p.wikipedia) sources.push({ kind: "wikipedia", label: "Wikipedia" });
  if (p.url) sources.push({ kind: "web", label: "Website", url: p.url });
  return {
    key: p.osmId ?? p.id,
    name: p.name,
    section: defaultSection(p.category, p.osmTag),
    aiStars: heuristicStars(p.obscurity),
    starsEstimated: true,
    hook: p.hook,
    address: p.address,
    lat: p.lat,
    lon: p.lon,
    distanceMi: p.distanceMi ?? 0,
    priceTier: p.price.tier === "free" ? "free" : undefined,
    osmId: p.osmId,
    kind: p.osmTag,
    sources,
    obscurity: p.obscurity,
  };
}

function fromElement(el: OverpassElement, center: Coords, section: SectionId, extra: Partial<CatalogPlace> = {}): CatalogPlace | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  const name = el.tags?.name;
  if (lat === undefined || lon === undefined || !name) return null;
  const osmId = `${el.type}/${el.id}`;
  const sources: CatalogSource[] = [{ kind: "osm", label: "OpenStreetMap" }];
  const site = el.tags?.website ?? el.tags?.["contact:website"];
  if (site) sources.push({ kind: "web", label: "Website", url: site });
  return {
    key: osmId,
    name,
    section,
    aiStars: 3,
    starsEstimated: true,
    address: addressOf(el.tags),
    lat,
    lon,
    distanceMi: distanceMi(center, { lat, lon }),
    osmId,
    sources,
    ...extra,
  };
}

/** Parks notable enough to have a Wikidata entry — the plain neighbourhood ones are noise. */
async function notableParks(center: Coords, radiusMi: number, bbox: string): Promise<CatalogPlace[]> {
  const q = `[out:json][timeout:60];(nwr["leisure"="park"]["name"]["wikidata"](${bbox});nwr["boundary"="protected_area"]["name"]["wikidata"](${bbox}););out tags center 150;`;
  const els = await overpassQuery(q);
  return els
    .map((el) => fromElement(el, center, "parks", { kind: "Park" }))
    .filter((p): p is CatalogPlace => !!p && p.distanceMi <= radiusMi);
}

async function inBatches<T, R>(items: T[], size: number, concurrency: number, fn: (b: T[]) => Promise<R>): Promise<R[]> {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  const out: R[] = new Array(batches.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
      while (next < batches.length) {
        const i = next++;
        out[i] = await fn(batches[i]);
      }
    }),
  );
  return out;
}

/**
 * AI section + stars + reason for these places, in batches; mutates them and
 * returns how many were rated. Places the AI skipped keep estimated stars.
 */
export async function ratePlaces(places: CatalogPlace[], label: string): Promise<number> {
  const byKey = new Map(places.map((p) => [p.key, p]));
  const items: RateItem[] = places.map((p) => ({
    key: p.key,
    name: p.name,
    section: p.section,
    kind: p.kind,
    hook: p.hook,
    why: p.why,
    address: p.address,
  }));
  let rated = 0;
  const maps = await inBatches(items, RATE_BATCH, RATE_CONCURRENCY, (b) => rateBatch(b, label));
  for (const m of maps) {
    for (const [key, r] of m) {
      const p = byKey.get(key);
      if (!p) continue;
      p.section = r.section;
      p.aiStars = r.stars;
      p.starsEstimated = false;
      p.aiReason = r.reason;
      if (r.hook && !p.hook) p.hook = r.hook;
      rated++;
    }
  }
  return rated;
}

export async function buildCatalog(
  input: { center: Coords; label: string; radiusMi: number; useAi: boolean; rateInline: boolean },
  onProgress: (p: BuildProgress) => void = () => {},
): Promise<BuildResult> {
  const { center, label, useAi } = input;
  const radiusMi = Math.min(input.radiusMi, PLACES_MAX_RADIUS_MI);
  const box = boundingBox(center, radiusMi);
  const bbox = `${box.south},${box.west},${box.north},${box.east}`;

  // ----- map search, and discovery → verification, run side by side -----
  // Discovery answers in ~10 s, the map search takes minutes; checking web
  // finds against the map while the big search is still running keeps the
  // whole build inside the 300 s function limit.
  onProgress({ stage: "places", message: `Searching the map around ${label}…` });
  if (useAi) onProgress({ stage: "discover", message: "Searching the web for hidden gems, food and more…" });

  const discoverAndVerify = async (): Promise<{ candidates: Candidate[]; verified: CatalogPlace[]; dropped: number }> => {
    if (!useAi) return { candidates: [], verified: [], dropped: 0 };
    const candidates = (await Promise.all(SECTIONS.map((s) => discoverSection(s.id, label, radiusMi)))).flat();
    if (!candidates.length) return { candidates, verified: [], dropped: 0 };
    onProgress({ stage: "verify", message: `Checking ${candidates.length} web finds against the map…` });
    const results = await Promise.allSettled(
      buildNameQueries(candidates.map((c) => c.name), bbox).map((q, i) => overpassQuery(q, i + 1)),
    );
    const elements = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    const { matched, unmatched } = matchByName(candidates, elements, center, radiusMi);
    const verified = matched.flatMap((m) => {
      const p = fromElement(m.element, center, m.candidate.section, {
        why: m.candidate.why,
        address: addressOf(m.element.tags) ?? m.candidate.address,
      });
      if (!p) return [];
      p.sources.push({ kind: "web", label: "Web search" });
      return [p];
    });
    onProgress({
      stage: "verify",
      message: `${verified.length} web finds confirmed, ${unmatched.length} couldn't be confirmed and were left out.`,
    });
    return { candidates, verified, dropped: unmatched.length };
  };

  const [activity, parks, web] = await Promise.all([
    fetchPlaces(center, radiusMi)
      .then(({ places }) => enrichHooks(places).catch(() => places))
      .catch(() => [] as FnoPlace[]),
    notableParks(center, radiusMi, bbox).catch(() => [] as CatalogPlace[]),
    discoverAndVerify(),
  ]);
  const osmPlaces = [...activity.map(fromActivity), ...parks];
  onProgress({ stage: "places", message: `Found ${osmPlaces.length} places on the map.` });
  const { candidates, verified, dropped } = web;

  // Discovered first so its "why" survives a merge with the plainer OSM copy.
  const places = dedupeByNameAndPlace([...verified, ...osmPlaces]);

  // ----- rate (inline only when nothing will persist) -------------------
  // A saved build returns with estimated stars and is rated afterwards in
  // rounds (rateInRounds via /api/fno/areas/:id/rate): rating 500 places in one
  // request overran the 300 s limit and hit provider 429s.
  let aiRated = 0;
  if (useAi && input.rateInline && places.length) {
    onProgress({ stage: "rate", message: `Rating ${places.length} places…` });
    aiRated = await ratePlaces(places, label);
  }

  places.sort((a, b) => b.aiStars - a.aiStars || a.distanceMi - b.distanceMi);
  onProgress({ stage: "done", message: `${places.length} places ready.` });
  return {
    places,
    radiusMi,
    stats: { osm: osmPlaces.length, discovered: candidates.length, verified: verified.length, dropped, aiRated },
  };
}
