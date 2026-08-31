// ---------------------------------------------------------------------------
// OpenStreetMap Overpass adapter — the Always On board.
//
// Keyless, no account, no sign-up, which is why the whole standing-activity
// side of the app rests on it: someone with zero API keys still gets a full
// board of things to go do.
//
// Two things this file does that a plain POI query does not:
//
//   It ranks by RARITY, not distance. A metro has forty climbing gyms and
//   exactly one curling sheet. Distance-sorting floats the nearest generic
//   thing to the top, which is precisely the maps-app failure mode. Being the
//   only one of its kind within the radius is what makes a thing remarkable,
//   and that can only be computed against the whole result set — never from
//   the tag alone.
//
//   It attaches a hook line. "Vertical World — climbing — 4.2 mi" produces no
//   reaction even when the place is obscure. Surprise is a linguistic effect,
//   so a place with no sentence explaining why it is interesting is a place the
//   board cannot sell.
//
// Overpass is a shared volunteer resource. This file is deliberately polite:
// batched queries rather than one per category, a real
// timeout, an endpoint pool with backoff, a descriptive User-Agent, a result
// cap, and an hour of in-process caching. Places do not move.
// ---------------------------------------------------------------------------

import { uid } from "../../utils";
import { boundingBox, distanceMi } from "../geo";
import {
  ACTIVITY_TAGS,
  deriveSeason,
  isClosed,
  isOffLimits,
  type ActivityTag,
} from "../categories";
import type {
  ActivityCategory,
  Coords,
  FnoPlace,
  Price,
  SourceStatus,
  VibeTag,
} from "../types";

/**
 * Mirror pool. The main instance regularly returns dispatcher errors under
 * load, and a discovery app that fails on first open has no second chance —
 * so a single endpoint is not an option.
 */
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  // overpass.osm.jp was in this list until its TLS certificate expired, which
  // surfaced as an opaque "fetch failed" on every batch that reached it. If a
  // mirror is added back here, check the cert first.
];

// Measured against a real 40-mile metro box: the full 118-clause union takes
// Overpass roughly 55 seconds as ONE request, which is far too long to sit in
// front of. Overpass cost scales with clauses x area, so the union is split
// into batches that run concurrently on different mirrors — same coverage, a
// fraction of the wall time, and one slow batch no longer blocks the rest.
const BATCH_SIZE = 24;

/**
 * Conservative ceiling on the area the Always On board sweeps.
 *
 * A 25-mile box across the full tag table completes in about twenty seconds. A
 * 40-mile box came back 500 — but that finding is NOT solid, and the comment
 * that used to sit here overstated it as a hard limit of the service. Under
 * sustained testing the public mirrors began returning the same 500 for a
 * single-clause query that had succeeded in 1.4 seconds minutes earlier, so a
 * 500 here is indistinguishable from rate limiting, and the 40-mile refusal may
 * have been nothing more than that.
 *
 * The cap stays because it is the value that is actually known to work, and
 * because being wrong in this direction costs a smaller circle rather than a
 * broken board. If it is raised, verify from a cold IP over several hours
 * rather than in a tight loop — and consider tiling the bbox into quadrants
 * first, which lowers per-request cost even though it raises request count.
 *
 * Events are unaffected: they come from APIs and feeds with no such limit, so a
 * 60-mile event radius works. The UI states the cap rather than quietly
 * returning less.
 */
export const PLACES_MAX_RADIUS_MI = 25;
const SERVER_TIMEOUT_S = 60;
const CLIENT_TIMEOUT_MS = 65_000;
const MAX_ELEMENTS = 400;

/**
 * Process-level cache.
 *
 * Next does not cache POST requests, so `next: { revalidate }` on the Overpass
 * call was buying nothing — and combined with an AbortSignal it made the
 * request fail outright inside the App Router. Places move rarely enough that
 * an hour in memory removes essentially all repeat load.
 */
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; elements: OverpassElement[] }>();

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export function overpassStatus(): SourceStatus {
  // No key, no configuration, nothing to check — this adapter is always live.
  return { id: "overpass", label: "OpenStreetMap", ok: true };
}

export async function overpassQuery(
  query: string,
  startMirror = 0,
): Promise<OverpassElement[]> {
  const cached = cache.get(query);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.elements;

  let lastError: Error | null = null;

  for (let i = 0; i < MIRRORS.length; i++) {
    // Batches start at different mirrors, so a parallel fan-out spreads across
    // the pool instead of every batch hitting the same instance at once.
    const mirror = MIRRORS[(startMirror + i) % MIRRORS.length];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch(mirror, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Public instances rate-limit generic agents harder than identified
          // ones, so this is a practical requirement rather than etiquette.
          "User-Agent":
            "FriendsNightOut/1.0 (personal event finder; +https://github.com/ultimate-assistant-os)",
        },
        body: `data=${encodeURIComponent(query)}`,
        cache: "no-store",
      });

      // 429 and 504 are Overpass saying "busy", not "wrong".
      if (res.status === 429 || res.status === 504) {
        lastError = new Error("OpenStreetMap is busy right now.");
      } else if (!res.ok) {
        lastError = new Error(`OpenStreetMap returned ${res.status}`);
      } else {
        const text = await res.text();
        // A dispatcher failure arrives as a 200 with an error in the body,
        // so status alone is not enough to trust the response.
        if (/runtime error|Dispatcher_Client/i.test(text.slice(0, 400))) {
          lastError = new Error("OpenStreetMap is busy right now.");
        } else {
          const data = JSON.parse(text) as { elements?: OverpassElement[] };
          const elements = data.elements ?? [];
          cache.set(query, { at: Date.now(), elements });
          return elements;
        }
      }
    } catch (err) {
      lastError =
        err instanceof Error && err.name === "AbortError"
          ? new Error("OpenStreetMap timed out.")
          : err instanceof Error
            ? err
            : new Error("Overpass request failed");
      // A mirror failing is normal and recoverable, but silently swallowing WHY
      // makes an outage indistinguishable from an empty area. The cause code is
      // the part that actually identifies a socket-level failure.
      const cause = (err as { cause?: { code?: string } })?.cause?.code;
      console.warn(
        `[fno] overpass mirror failed: ${mirror} — ${lastError.message}${cause ? ` (${cause})` : ""}`,
      );
    } finally {
      clearTimeout(timer);
    }

    // Jittered backoff before the next mirror — hammering the pool in lockstep
    // is how a client gets blocked from all of them at once.
    if (i < MIRRORS.length - 1) {
      await sleep(300 + Math.random() * 700);
    }
  }

  throw lastError ?? new Error("Could not reach OpenStreetMap.");
}

export async function fetchPlaces(
  origin: Coords,
  requestedRadiusMi: number,
): Promise<{ places: FnoPlace[]; radiusMi: number; capped: boolean }> {
  const radiusMi = Math.min(requestedRadiusMi, PLACES_MAX_RADIUS_MI);
  const capped = radiusMi < requestedRadiusMi;
  const box = boundingBox(origin, radiusMi);
  const bbox = `${box.south},${box.west},${box.north},${box.east}`;

  // Every filter AND altFilter — a tag whose `matches` accepts two spellings
  // would otherwise silently return only the first one.
  const filters = ACTIVITY_TAGS.flatMap((t) => [t.filter, ...(t.altFilters ?? [])]);
  const batches: string[][] = [];
  for (let i = 0; i < filters.length; i += BATCH_SIZE) {
    batches.push(filters.slice(i, i + BATCH_SIZE));
  }

  const results = await Promise.allSettled(
    batches.map((batch, i) => {
      const clauses = batch.map((f) => `nwr${f}(${bbox});`).join("");
      return overpassQuery(
        `[out:json][timeout:${SERVER_TIMEOUT_S}];(${clauses});out tags center ${MAX_ELEMENTS};`,
        i,
      );
    }),
  );

  // A partial failure just thins the board. Every batch failing means OSM is
  // genuinely unreachable, and the caller must say so rather than render an
  // empty board as though the area were dull.
  if (results.every((r) => r.status === "rejected")) {
    const first = results[0] as PromiseRejectedResult | undefined;
    throw first?.reason instanceof Error
      ? first.reason
      : new Error("Could not reach OpenStreetMap.");
  }
  const elements = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  // ---- pass 1: filter and classify --------------------------------------
  interface Candidate {
    el: OverpassElement;
    tags: Record<string, string>;
    tag: ActivityTag;
    lat: number;
    lon: number;
    dist: number;
  }

  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const el of elements) {
    const tags = el.tags ?? {};

    // OSM records closure by prefixing the key rather than deleting the
    // element, so without this the board sends people to venues that shut
    // years ago — the failure that destroys trust fastest.
    if (isClosed(tags)) continue;

    // Never hand out directions to somewhere private or dangerous. Withholding
    // the "free" chip was not enough — the card, and its directions link,
    // stayed on the board.
    if (isOffLimits(tags)) continue;

    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;

    const dist = distanceMi(origin, { lat, lon });
    if (dist > radiusMi) continue;

    const tag = ACTIVITY_TAGS.find((t) => t.matches(tags));
    if (!tag) continue;

    const name = tags.name?.trim();
    // The query already requires a name where one is needed, but a few tags
    // are allowed through without one; those get the type as their name.
    if (!name && !ALLOW_UNNAMED.has(tag.label)) continue;

    // The same feature is frequently mapped twice — a building way plus a
    // node inside it. Name and rounded position collapse the pair.
    const key = `${(name ?? tag.label).toLowerCase()}@${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    candidates.push({ el, tags, tag, lat, lon, dist });
  }

  // ---- pass 2: rarity, which needs the whole set ------------------------
  const countsByLabel = new Map<string, number>();
  for (const c of candidates) {
    countsByLabel.set(c.tag.label, (countsByLabel.get(c.tag.label) ?? 0) + 1);
  }

  // Repeated names inside one radius are a chain even when OSM has no `brand`.
  const countsByName = new Map<string, number>();
  for (const c of candidates) {
    const n = c.tags.name?.toLowerCase().trim();
    if (n) countsByName.set(n, (countsByName.get(n) ?? 0) + 1);
  }

  const out: FnoPlace[] = [];
  for (const c of candidates) {
    const { tags, tag } = c;
    const sameKind = countsByLabel.get(tag.label) ?? 1;
    const nameRepeats = countsByName.get(tags.name?.toLowerCase().trim() ?? "") ?? 1;
    // `operator:wikidata` was in this test and it was badly wrong: the National
    // Park Service, the Forest Service and every state park system carry it, so
    // every Blue Ridge Parkway overlook and Forest Service waterfall took the
    // largest penalty in the formula for being publicly operated — demoting the
    // exact category the board is best at.
    //
    // The repeated-name rule is also gated now: three same-named features in a
    // radius is common for park-system sub-areas and for one place mapped as
    // both a node and a way, neither of which is a chain.
    const brandedChain = Boolean(tags.brand || tags["brand:wikidata"]);
    const repeatedName = nameRepeats >= 3 && CHAIN_PRONE.has(tag.category);
    const chain = brandedChain || repeatedName;

    const { season, evidence } = deriveSeason(tag, tags);
    const wikipedia = tags.wikipedia;

    out.push({
      id: uid("place"),
      name: tags.name?.trim() || tag.label,
      category: tag.category,
      description: tag.describe(tags),
      // OSM's own description is the best hook available and needs no extra
      // request. Wikipedia enrichment fills the gaps afterwards.
      hook: cleanHook(tags.description),
      hookSource: tags.description ? "osm" : undefined,
      lat: c.lat,
      lon: c.lon,
      address: buildAddress(tags),
      distanceMi: c.dist,
      season,
      seasonEvidence: evidence,
      price: priceFromTags(tags, tag),
      url: tags.website ?? tags["contact:website"],
      phone: tags.phone ?? tags["contact:phone"],
      osmId: `${c.el.type}/${c.el.id}`,
      osmTag: tag.label,
      wikipedia,
      checkDate: tags.check_date,
      chain,
      vibes: deriveVibes(tags, tag, sameKind, chain),
      sources: [
        {
          id: "overpass",
          label: "OpenStreetMap",
          url: `https://www.openstreetmap.org/${c.el.type}/${c.el.id}`,
          externalId: `${c.el.type}/${c.el.id}`,
        },
      ],
      obscurity: scorePlace({
        base: tag.base,
        sameKind,
        heritage: Boolean(tags.heritage),
        historic: Boolean(tags.historic),
        described: Boolean(tags.description),
        chain,
      }),
    });
  }

  // Rarity-first, not distance-first. Distance becomes a filter in the UI.
  out.sort((a, b) => b.obscurity - a.obscurity || (a.distanceMi ?? 0) - (b.distanceMi ?? 0));
  return { places: out, radiusMi, capped };
}

/** Types where the kind alone is the draw, so a missing name is acceptable. */
const ALLOW_UNNAMED = new Set([
  "Cave",
  "Natural arch",
  "Waterfall",
  "Hot spring",
  "Geyser",
  "Viewpoint",
  "Bird hide",
  "Whitewater put-in",
  "Swimming hole",
  "Zip line",
  "Maze",
  "Alpine slide",
  "Crag",
  "Via ferrata",
  "Sledding hill",
]);

// ----- scoring -------------------------------------------------------------

/** Categories where a chain is a real possibility, so "local" means something. */
const CHAIN_PRONE = new Set<ActivityCategory>([
  "Games",
  "Food & Drink",
  "Motors",
  "Wellness",
  "Culture",
]);

interface ScoreInput {
  base: number;
  sameKind: number;
  heritage: boolean;
  historic: boolean;
  described: boolean;
  chain: boolean;
}

/**
 * 0-100. Higher means "you probably do not know this is here".
 *
 * Two corrections from the first version are worth naming, because both made
 * the score measure something close to the opposite of what it claims:
 *
 *   Having a Wikipedia article used to be worth +0.35 — the single largest
 *   term. But an article is evidence a place is DOCUMENTED, not that it is
 *   unknown, and the two correlate the wrong way at the top end. It put the
 *   most-visited paid attraction in the state in the top ten. Documentation and
 *   fame are now separated: the article supplies the hook line, and fame is
 *   measured directly from pageviews in `fameAdjustment`.
 *
 *   Rarity was the smallest weighted term while the category baseline was the
 *   largest, so the board was really ranked by what KIND of thing something is,
 *   with rarity as a tiebreaker that could never reorder anything. Rarity now
 *   carries the most weight, and uses a log curve so "one of forty" is
 *   distinguishable from "one of three" — the reciprocal collapsed everything
 *   above three into the same value.
 */
export function scorePlace(input: ScoreInput): number {
  const baseline = input.base / 100;

  // 1 → 1.0, 2 → 0.63, 4 → 0.5, 12 → 0.28, 40 → 0.0
  const rarity =
    input.sameKind <= 1
      ? 1
      : Math.max(0, 1 - Math.log(input.sameKind) / Math.log(40));

  const notability =
    (input.heritage ? 0.1 : 0) +
    (input.historic ? 0.1 : 0) +
    (input.described ? 0.1 : 0);

  // A chain is the definitional opposite of a discovery — the user has seen the
  // billboard. Demoted rather than hidden, so a filter can still surface it.
  const chainPenalty = input.chain ? -0.4 : 0;

  const raw = baseline * 0.35 + rarity * 0.4 + notability + chainPenalty;
  return Math.round(Math.max(0, Math.min(1, raw)) * 100);
}

/**
 * Fame, in obscurity points, from monthly Wikipedia pageviews.
 *
 * This is the piece that turns the Wikipedia dependency from a fame amplifier
 * into an obscurity oracle. An article with a few hundred readers a month is
 * exactly the target: documented enough to have a real sentence written about
 * it, unread enough that nobody nearby has heard of it. Forty thousand readers
 * a month is a landmark.
 *
 * Keyless, and the article title is already in hand from building the hook.
 */
export function fameAdjustment(monthlyViews: number | undefined): number {
  if (monthlyViews === undefined) return 0;
  if (monthlyViews < 500) return 12;
  if (monthlyViews < 5_000) return 3;
  if (monthlyViews < 20_000) return -8;
  return -25;
}

function deriveVibes(
  tags: Record<string, string>,
  tag: ActivityTag,
  sameKind: number,
  chain: boolean,
): VibeTag[] {
  const vibes: VibeTag[] = [];
  const historic = tags.historic ?? "";

  if (/^(ruins|archaeological_site|mine|wreck)$/.test(historic) || tags.man_made === "kiln") {
    vibes.push("Abandoned");
  }
  if (
    tags.natural === "cave_entrance" ||
    historic === "mine" ||
    tags.man_made === "adit" ||
    tags.man_made === "mineshaft"
  ) {
    vibes.push("Underground");
  }
  if (tags.tourism === "viewpoint" || /observation/.test(tags["tower:type"] ?? "")) {
    vibes.push("Big View");
  }
  if (
    /^(aircraft|locomotive|railway_car|tank|ship)$/.test(historic) ||
    tags.man_made === "gasometer" ||
    tags.railway === "miniature"
  ) {
    vibes.push("Big Machines");
  }
  if (sameKind === 1) vibes.push("Only One Near You");
  if (isFreeByNature(tags, tag) && tag.base >= 70) vibes.push("Free & Weird");
  // Only meaningful where chains actually exist. A ruin is not "locally owned"
  // in any sense a reader cares about, and stamping it on every card turned the
  // chip into decoration.
  if (!chain && CHAIN_PRONE.has(tag.category)) vibes.push("Locally Owned");

  return vibes;
}

// ----- price ---------------------------------------------------------------

/**
 * OSM's `fee` tag is present on roughly 1.5% of elements, so the honest answer
 * here is usually "unknown". The UI omits the chip entirely in that case rather
 * than painting most of the board grey — an empty field beats an empty badge.
 *
 * What can be asserted is free-BY-NATURE: a public overlook, a memorial, a
 * piece of street art or a nature reserve does not charge admission, whether or
 * not a mapper said so.
 */
function isFreeByNature(tags: Record<string, string>, tag: ActivityTag): boolean {
  if (tags.fee === "no") return true;
  if (tags.access === "permit") return false;
  void tag;
  // Deliberately narrow. Nature reserves and their viewpoints were on this list
  // and they charge routinely — a state park twenty minutes away can be $19 at
  // the gate, and its overlooks sit inside the paid boundary. An affirmatively
  // wrong "Free" chip is worse than the omitted chip this design is otherwise
  // careful about, so only street-level features nobody gates are asserted.
  return (
    tags.tourism === "artwork" ||
    tags.historic === "memorial" ||
    tags.historic === "boundary_stone" ||
    tags.man_made === "geoglyph"
  );
}

function priceFromTags(tags: Record<string, string>, tag: ActivityTag): Price {
  if (tags.fee === "no") return { tier: "free", note: "Free" };
  if (tags.charge) return { tier: "paid", note: tags.charge };
  if (tags.fee === "yes" || tags["fee:conditional"]) return { tier: "paid" };
  if (isFreeByNature(tags, tag)) return { tier: "free", note: "Free to visit" };
  return { tier: "unknown" };
}

// ----- misc ----------------------------------------------------------------

function buildAddress(tags: Record<string, string>): string | undefined {
  const parts = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:city"],
    tags["addr:state"],
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

function cleanHook(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length < 12) return undefined;
  return clean.length > 240 ? `${clean.slice(0, 237)}…` : clean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
