// ---------------------------------------------------------------------------
// Hook lines from Wikipedia. Keyless.
//
// This file exists because of a single observation: a genuinely obscure place
// presented as a name and a noun produces no reaction at all. "Stone House —
// ruins — 3.1 mi" is data. "A moss-covered stone ruin in Forest Park that was
// once a public restroom" is the reason someone drives out there on a Saturday.
// Surprise is a linguistic effect, and the board needs a sentence to carry it.
//
// Three keyless sources, tried in order:
//   1. OpenStreetMap's own `description` tag — already fetched, free. Covers
//      roughly a fifth of elements.
//   2. The Wikipedia REST summary, when the element carries a `wikipedia` tag.
//      Around a quarter of interesting elements do, and that quarter is very
//      nearly the interesting subset.
//   3. A Wikipedia geosearch join for the rest: articles near the coordinates,
//      matched back by name. This is what catches the places nobody thought to
//      cross-link in OSM.
//
// Enrichment is best-effort throughout: a place with no hook still renders.
// ---------------------------------------------------------------------------

import { diceSimilarity, normalizeTitle } from "../normalize";
import { fameAdjustment } from "./overpass";
import type { FnoPlace } from "../types";

const REST = "https://en.wikipedia.org/api/rest_v1/page/summary";
const API = "https://en.wikipedia.org/w/api.php";
const PAGEVIEWS =
  "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user";

// Wikipedia asks for a descriptive agent with a contact path, and enforces it.
const UA =
  "FriendsNightOut/1.0 (personal event finder; +https://github.com/ultimate-assistant-os)";

const TIMEOUT_MS = 6_000;
/** Only the places a user will actually look at are worth a request. */
const MAX_ENRICH = 40;
const CONCURRENCY = 5;

/**
 * Attach hook lines to the most promising places, in place-order.
 *
 * Called after ranking, so the budget is spent on what will appear at the top
 * of the board rather than on the two hundredth result.
 */
export async function enrichHooks(places: FnoPlace[]): Promise<FnoPlace[]> {
  // A place that already has an OSM description still needs a fame reading if
  // it links an article — otherwise the best-documented landmarks skip the
  // pageview check purely because a mapper wrote them a sentence.
  const targets = places
    .map((p, index) => ({ p, index }))
    .filter(({ p }) => !p.hook || Boolean(p.wikipedia))
    .slice(0, MAX_ENRICH);

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async ({ p }) => {
        const found = await hookFor(p);
        if (!found) return null;
        const views = await monthlyPageviews(found.title);
        return { ...found, views };
      }),
    );
    results.forEach((r, j) => {
      if (r.status === "fulfilled" && r.value) {
        const { index } = batch[j];
        places[index] = {
          ...places[index],
          hook: places[index].hook ?? r.value.hook,
          hookSource: places[index].hook ? places[index].hookSource : "wikipedia",
          monthlyViews: r.value.views,
          // The article supplies the sentence. Whether it MOVES the score is
          // decided by how many people read it — see fameAdjustment.
          obscurity: clamp(places[index].obscurity + fameAdjustment(r.value.views)),
        };
      }
    });
  }
  return places;
}

interface Enrichment {
  hook: string;
  /** The article the hook came from, so pageviews can be read for it. */
  title: string;
}

async function hookFor(place: FnoPlace): Promise<Enrichment | null> {
  if (place.wikipedia) {
    const title = articleTitle(place.wikipedia);
    if (title) {
      const direct = await summaryFor(place.wikipedia);
      if (direct) return { hook: direct, title };
    }
  }
  return geoMatch(place);
}

/**
 * Monthly readers of an article, as a median over recent complete months.
 *
 * Keyless and unauthenticated. The median rather than the latest month because
 * the current month is always partial — reading it raw would make every article
 * look like it had just lost most of its audience.
 */
export async function monthlyPageviews(title: string): Promise<number | undefined> {
  const end = new Date();
  // Step back to the first of last month, so only complete months are counted.
  end.setUTCDate(1);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 4);

  const stamp = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}0100`;

  const url = `${PAGEVIEWS}/${encodeURIComponent(title.replace(/ /g, "_"))}/monthly/${stamp(start)}/${stamp(end)}`;
  const json = await getJson<{ items?: { views?: number }[] }>(url);
  const views = (json?.items ?? [])
    .map((i) => i.views)
    .filter((v): v is number => typeof v === "number");
  if (!views.length) return undefined;
  views.sort((a, b) => a - b);
  return views[Math.floor(views.length / 2)];
}

/**
 * `wikipedia` is tagged as "en:Stone House (Portland, Oregon)" — a language
 * prefix plus the article title.
 */
async function summaryFor(tag: string): Promise<string | null> {
  const [lang, ...rest] = tag.split(":");
  const title = rest.length ? rest.join(":") : tag;
  // Only the English endpoint is wired up; a de:/fr: tag is skipped rather than
  // fetched against the wrong wiki.
  if (rest.length && lang !== "en") return null;

  const json = await getJson<{ extract?: string; type?: string }>(
    `${REST}/${encodeURIComponent(title.replace(/ /g, "_"))}`,
  );
  if (!json?.extract) return null;
  // Disambiguation pages produce a useless "may refer to" sentence.
  if (json.type === "disambiguation") return null;
  return firstSentence(json.extract);
}

/**
 * Find an article by coordinates, then confirm it is about THIS place.
 *
 * The name check is the important half: geosearch returns whatever is nearby,
 * and attaching a neighbouring monument's description to a climbing gym would
 * be worse than leaving the card bare.
 */
async function geoMatch(place: FnoPlace): Promise<Enrichment | null> {
  const url =
    `${API}?action=query&list=geosearch&gscoord=${place.lat}%7C${place.lon}` +
    `&gsradius=400&gslimit=8&format=json&origin=*`;

  const json = await getJson<{
    query?: { geosearch?: { title?: string; dist?: number }[] };
  }>(url);
  const hits = json?.query?.geosearch ?? [];
  if (!hits.length) return null;

  const target = normalizeTitle(place.name);
  if (target.length < 4) return null;

  for (const hit of hits) {
    if (!hit.title) continue;
    // Strip the parenthetical qualifier Wikipedia uses for disambiguation.
    const candidate = normalizeTitle(hit.title.replace(/\s*\([^)]*\)\s*$/, ""));
    if (diceSimilarity(target, candidate) < 0.8) continue;
    const summary = await summaryFor(`en:${hit.title}`);
    if (summary) return { hook: summary, title: hit.title };
  }
  return null;
}

/** "en:Stone House (Portland, Oregon)" -> "Stone House (Portland, Oregon)". */
function articleTitle(tag: string): string | null {
  const [lang, ...rest] = tag.split(":");
  if (rest.length && lang !== "en") return null;
  return rest.length ? rest.join(":") : tag;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** One sentence is a hook; a paragraph is a wall the user will not read. */
function firstSentence(extract: string): string | null {
  const clean = extract.replace(/\s+/g, " ").trim();
  if (clean.length < 20) return null;
  const match = clean.match(/^.{20,240}?[.!?](?=\s|$)/);
  const sentence = match ? match[0] : clean.slice(0, 240);
  return sentence.trim();
}

async function getJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "application/json" },
      // Articles change slowly and this is a courtesy to a free service.
      next: { revalidate: 604_800 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
