// ---------------------------------------------------------------------------
// Friends Night Out — starting state and demo data.
//
// Two things live here, and the distinction between them matters:
//
//   DEFAULT_FEEDS is empty on purpose. The first design of this app shipped a
//   "add your local calendar URLs" screen, which is the cold-start problem
//   dressed up as a feature — nobody does that work, so a new user would open
//   the app to ticketed events only, which are the events they could already
//   find. Auto-discovery replaced it: the app asks OpenStreetMap which
//   libraries, churches, breweries and arts centres are inside the radius and
//   probes their sites for calendars. Manual adds remain as an escape hatch.
//
//   DEMO_EVENTS / DEMO_PLACES are clearly-labelled fiction, shown only before
//   onboarding so the empty app has something to look at. Every one carries the
//   `seed` source and renders behind a "demo data" banner. They are never mixed
//   into real results, because a plausible-looking invented event is exactly
//   the failure this app spends most of its code preventing.
// ---------------------------------------------------------------------------

import type { Feed, FnoEvent, FnoPlace } from "./types";

export const DEFAULT_FEEDS: Omit<Feed, "id" | "addedAt">[] = [];

/** Anchor for the demo set. Real coordinates, invented listings. */
export const DEMO_ORIGIN = { label: "Demo — Asheville, NC", lat: 35.5951, lon: -82.5515 };

function daysFromNow(days: number, hour = 19): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

const demoSource = { id: "seed" as const, label: "Demo data" };

export const DEMO_EVENTS: FnoEvent[] = [
  {
    id: "demo-evt-1",
    title: "Basement Tape Swap & Listening Night",
    description:
      "Bring a tape, leave with someone else's. Cassette decks provided, first pour is free.",
    startsAt: daysFromNow(2, 20),
    allDay: false,
    venue: { name: "Foundry Records", address: "Downtown", lat: 35.5945, lon: -82.5540, sizeBand: "intimate" },
    distanceMi: 0.5,
    category: "Music",
    format: "party",
    price: { tier: "free", note: "Free" },
    sources: [demoSource],
    obscurity: 91,
    confidence: 0.9,
  },
  {
    id: "demo-evt-2",
    title: "St. Brendan's Parish Fish Fry",
    description: "Fourth-Friday fish fry in the parish hall. Plates $12, kids eat free.",
    startsAt: daysFromNow(5, 17),
    allDay: false,
    venue: { name: "St. Brendan's Parish Hall", lat: 35.6050, lon: -82.5400, sizeBand: "small" },
    distanceMi: 1.4,
    category: "Faith",
    format: "fundraiser",
    price: { tier: "paid", min: 12, max: 12 },
    sources: [demoSource],
    obscurity: 84,
    confidence: 0.88,
    series: { label: "monthly on a Friday", occurrences: 3, upcoming: [daysFromNow(5, 17)] },
  },
  {
    id: "demo-evt-3",
    title: "Riverside Winter Market",
    description: "Forty growers and makers under the bridge. Cash and cards, dogs welcome.",
    startsAt: daysFromNow(3, 9),
    allDay: true,
    venue: { name: "River Arts Bridge", lat: 35.5830, lon: -82.5720, sizeBand: "mid" },
    distanceMi: 2.1,
    category: "Market",
    format: "market",
    price: { tier: "free", note: "Free entry" },
    sources: [demoSource],
    obscurity: 66,
    confidence: 0.85,
  },
  {
    id: "demo-evt-4",
    title: "Open Mic — Poetry & Anything Else",
    description: "Sign-up at 6.30, five minutes each, no judging.",
    startsAt: daysFromNow(1, 19),
    allDay: false,
    venue: { name: "The Green Door Café", lat: 35.5960, lon: -82.5480, sizeBand: "intimate" },
    distanceMi: 0.8,
    category: "Arts",
    format: "open-mic",
    price: { tier: "donation", note: "Pay what you can" },
    sources: [demoSource],
    obscurity: 78,
    confidence: 0.86,
    series: { label: "every Tuesday", occurrences: 9, upcoming: [daysFromNow(1, 19), daysFromNow(8, 19)] },
  },
  {
    id: "demo-evt-5",
    title: "Blue Ridge Amphitheatre — Touring Act",
    description: "A big touring show, listed here so you can see what a low-obscurity result looks like.",
    startsAt: daysFromNow(12, 20),
    allDay: false,
    venue: { name: "Blue Ridge Amphitheatre", capacity: 7000, lat: 35.5700, lon: -82.5300, sizeBand: "large" },
    distanceMi: 3.4,
    category: "Music",
    format: "show",
    price: { tier: "paid", min: 45, max: 189 },
    sources: [demoSource, { id: "seed", label: "Demo ticketing" }],
    obscurity: 12,
    confidence: 0.95,
  },
];

export const DEMO_PLACES: FnoPlace[] = [
  {
    id: "demo-place-1",
    name: "Old Toll House Ruin",
    category: "Oddities",
    description: "Ruins you can walk to",
    hook: "A moss-covered stone shell on the old turnpike, left standing when the road moved half a mile north in 1931.",
    hookSource: "osm",
    lat: 35.6120,
    lon: -82.5620,
    distanceMi: 1.9,
    season: "unknown",
    seasonEvidence: "none",
    price: { tier: "free", note: "Free to visit" },
    vibes: ["Abandoned", "Only One Near You", "Free & Weird"],
    sources: [demoSource],
    obscurity: 93,
  },
  {
    id: "demo-place-2",
    name: "Craggy Ridge Fire Lookout",
    category: "Air & Heights",
    description: "Fire lookout tower",
    hook: "A 1930s lookout you can still climb, with the original Osborne firefinder table bolted to the floor.",
    hookSource: "wikipedia",
    lat: 35.7010,
    lon: -82.3900,
    distanceMi: 14.2,
    season: { from: "04-15", to: "10-15" },
    seasonEvidence: "typical",
    price: { tier: "free", note: "Free to visit" },
    vibes: ["Big View", "Only One Near You"],
    sources: [demoSource],
    obscurity: 90,
  },
  {
    id: "demo-place-3",
    name: "Hominy Creek Curling Club",
    category: "On Ice",
    description: "Curling club — most run learn-to-curl nights",
    hook: "The only curling sheet in the county, running open learn-to-curl nights most Thursdays through the winter.",
    hookSource: "osm",
    lat: 35.5600,
    lon: -82.6100,
    distanceMi: 4.6,
    season: "year-round",
    seasonEvidence: "indoor",
    price: { tier: "paid", note: "$25 learn-to-curl" },
    vibes: ["Only One Near You", "Locally Owned"],
    sources: [demoSource],
    obscurity: 88,
  },
  {
    id: "demo-place-4",
    name: "Starlight Drive-In",
    category: "Motors",
    description: "Drive-in movie theatre",
    hook: "One of the last single-screen drive-ins in the state; the projector booth is the original 1952 building.",
    hookSource: "wikipedia",
    lat: 35.5300,
    lon: -82.4900,
    distanceMi: 6.8,
    season: { from: "04-15", to: "10-15" },
    seasonEvidence: "typical",
    price: { tier: "paid", note: "$9 per car" },
    vibes: ["Only One Near You", "Locally Owned", "Big Machines"],
    sources: [demoSource],
    obscurity: 87,
  },
  {
    id: "demo-place-5",
    name: "Westside Lanes",
    category: "Games",
    description: "Bowling alley",
    lat: 35.5880,
    lon: -82.5900,
    distanceMi: 2.4,
    season: "year-round",
    seasonEvidence: "indoor",
    price: { tier: "unknown" },
    vibes: ["Locally Owned"],
    sources: [demoSource],
    obscurity: 24,
  },
];
