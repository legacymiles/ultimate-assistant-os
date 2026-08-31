// ---------------------------------------------------------------------------
// Calendar auto-discovery.
//
// Without this, the app's premise is outsourced to the user: "add RSS and iCal
// URLs for your area" is the cold-start problem restated as a feature. Nobody
// does that work, so a new user opens the app and sees ticketed events only —
// exactly the events they could already find.
//
// So the app finds the calendars itself, keylessly, in two hops:
//
//   1. Ask OpenStreetMap which libraries, churches, community centres,
//      theatres, museums, breweries and arts centres sit inside the radius.
//      OSM records their websites, which gives us a list of local institutional
//      hostnames without a search API.
//
//   2. Probe each hostname for a machine-readable calendar: The Events Calendar
//      REST endpoint, a WordPress events feed, an .ics link in the page head,
//      or schema.org Event blocks in the page itself.
//
// Everything found is proposed, never auto-subscribed — the user confirms which
// calendars to keep, because a parish newsletter feed is a taste decision.
// ---------------------------------------------------------------------------

import { boundingBox } from "../geo";
import type { Coords, FeedKind } from "../types";
import { overpassQuery } from "./overpass";

export interface DiscoveredFeed {
  label: string;
  url: string;
  kind: FeedKind;
  /** Which OSM feature led us here — shown so the user can judge relevance. */
  via: string;
  /** How many upcoming events the probe actually saw. */
  sampleCount: number;
}

/** Institutions whose calendars carry the events ticket sites never list. */
const INSTITUTION_FILTERS = [
  '["amenity"="library"]',
  '["amenity"="community_centre"]',
  '["amenity"="place_of_worship"]',
  '["amenity"="theatre"]',
  '["amenity"="arts_centre"]',
  '["amenity"="social_facility"]',
  '["tourism"="museum"]',
  '["tourism"="gallery"]',
  '["craft"="brewery"]',
  '["microbrewery"="yes"]',
  '["amenity"="college"]',
  '["amenity"="university"]',
  '["leisure"="park"]["operator"]',
  '["shop"="books"]',
  '["amenity"="cafe"]["live_music"="yes"]',
];

const PROBE_TIMEOUT_MS = 6_000;
/** Politeness cap: never hammer more than this many hosts in one run. */
const MAX_HOSTS = 40;
const CONCURRENCY = 6;

export async function discoverFeeds(
  origin: Coords,
  radiusMi: number,
): Promise<DiscoveredFeed[]> {
  const hosts = await institutionSites(origin, radiusMi);
  const found: DiscoveredFeed[] = [];

  // Bounded concurrency: forty simultaneous probes against forty small
  // WordPress sites is rude and gets us rate-limited or blocked.
  for (let i = 0; i < hosts.length; i += CONCURRENCY) {
    const batch = hosts.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((h) => probeHost(h)));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) found.push(r.value);
    }
  }

  // One calendar per host — a site exposing both an .ics and a REST endpoint is
  // one calendar published twice, and subscribing to both would double that
  // source's weight in the obscurity score.
  const seen = new Set<string>();
  return found.filter((f) => {
    const host = safeHost(f.url);
    if (!host || seen.has(host)) return false;
    seen.add(host);
    return true;
  });
}

interface Institution {
  name: string;
  website: string;
  kindLabel: string;
}

async function institutionSites(
  origin: Coords,
  radiusMi: number,
): Promise<Institution[]> {
  const box = boundingBox(origin, radiusMi);
  const bbox = `${box.south},${box.west},${box.north},${box.east}`;
  // Only elements that actually carry a website — everything else is noise for
  // this query, and the filter keeps the response small.
  const body = INSTITUTION_FILTERS.map(
    (f) => `nwr${f}["website"](${bbox});`,
  ).join("\n");

  const elements = await overpassQuery(`[out:json][timeout:40];(${body});out tags center 200;`);

  const out: Institution[] = [];
  const seenHosts = new Set<string>();

  for (const el of elements) {
    const tags = el.tags ?? {};
    const website = tags.website ?? tags["contact:website"];
    const name = tags.name;
    if (!website || !name) continue;

    const host = safeHost(website);
    // One probe per hostname: a diocese with twelve parishes on one domain is
    // one calendar, and a chain brewery is one site.
    if (!host || seenHosts.has(host)) continue;
    seenHosts.add(host);

    out.push({
      name,
      website,
      kindLabel:
        tags.amenity ?? tags.tourism ?? tags.craft ?? tags.shop ?? "venue",
    });
    if (out.length >= MAX_HOSTS) break;
  }
  return out;
}

/** Candidate calendar paths, in descending order of data quality. */
function candidatePaths(): { path: string; kind: FeedKind }[] {
  return [
    // Structured JSON with real dates and venues — by far the best outcome.
    { path: "/wp-json/tribe/events/v1/events", kind: "tribe" },
    { path: "/api/2/events", kind: "localist" },
    // iCal, which also carries recurrence rules.
    { path: "/events.ics", kind: "ical" },
    { path: "/events/?ical=1", kind: "ical" },
    // WordPress feeds.
    { path: "/events/feed/", kind: "rss" },
    { path: "/feed/?post_type=tribe_events", kind: "rss" },
    // Last resort: read the events page itself for embedded schema.org data.
    { path: "/events/", kind: "jsonld" },
    { path: "/calendar/", kind: "jsonld" },
  ];
}

async function probeHost(inst: Institution): Promise<DiscoveredFeed | null> {
  const base = normalizeBase(inst.website);
  if (!base) return null;

  for (const candidate of candidatePaths()) {
    const url = `${base}${candidate.path}`;
    const hit = await probeUrl(url, candidate.kind);
    if (hit && hit.count > 0) {
      return {
        label: inst.name,
        url,
        kind: candidate.kind,
        via: inst.kindLabel.replace(/_/g, " "),
        sampleCount: hit.count,
      };
    }
  }

  // Nothing at a guessable path — check whether the homepage advertises a
  // calendar via <link rel="alternate" type="text/calendar">, which is the
  // standards-compliant way to publish one.
  const advertised = await findAdvertisedCalendar(base);
  if (advertised) {
    const hit = await probeUrl(advertised, "ical");
    if (hit && hit.count > 0) {
      return {
        label: inst.name,
        url: advertised,
        kind: "ical",
        via: inst.kindLabel.replace(/_/g, " "),
        sampleCount: hit.count,
      };
    }
  }
  return null;
}

/**
 * Fetch a candidate and decide whether it is really a calendar with content.
 *
 * The count check matters: a lot of sites answer every path with a soft-200
 * "page not found", and a valid-but-empty calendar is not worth subscribing to.
 */
async function probeUrl(
  url: string,
  kind: FeedKind,
): Promise<{ count: number } | null> {
  try {
    const body = await getWithTimeout(url);
    if (!body) return null;

    switch (kind) {
      case "tribe": {
        const data = JSON.parse(body) as { events?: unknown[] };
        return Array.isArray(data.events) ? { count: data.events.length } : null;
      }
      case "localist": {
        const data = JSON.parse(body) as { events?: unknown[] };
        return Array.isArray(data.events) ? { count: data.events.length } : null;
      }
      case "ical": {
        if (!/BEGIN:VCALENDAR/i.test(body)) return null;
        return { count: (body.match(/BEGIN:VEVENT/gi) ?? []).length };
      }
      case "rss": {
        if (!/<rss|<feed[\s>]/i.test(body.slice(0, 1500))) return null;
        return { count: (body.match(/<item[\s>]/gi) ?? []).length };
      }
      case "jsonld": {
        const blocks = body.match(/application\/ld\+json/gi);
        if (!blocks) return null;
        // Only count it if an actual Event type is present — most sites ship
        // JSON-LD for Organization or BreadcrumbList and nothing else.
        const events = body.match(/"@type"\s*:\s*"[A-Za-z]*Event"/g);
        return events ? { count: events.length } : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

async function findAdvertisedCalendar(base: string): Promise<string | null> {
  try {
    const body = await getWithTimeout(base);
    if (!body) return null;
    const m = body.match(
      /<link[^>]+type=["']text\/calendar["'][^>]*href=["']([^"']+)["']/i,
    ) ?? body.match(
      /<link[^>]+href=["']([^"']+)["'][^>]*type=["']text\/calendar["']/i,
    );
    if (!m) return null;
    return new URL(m[1], base).toString();
  } catch {
    return null;
  }
}

async function getWithTimeout(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "application/json, text/calendar, application/rss+xml, text/html;q=0.8",
        "User-Agent": "FriendsNightOut/1.0 (personal event finder; calendar discovery)",
      },
      next: { revalidate: 86_400 },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 500_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBase(website: string): string | null {
  try {
    const u = new URL(website.startsWith("http") ? website : `https://${website}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}
