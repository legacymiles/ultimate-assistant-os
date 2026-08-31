// ---------------------------------------------------------------------------
// Friends Night Out — shared types.
//
// The app has two halves that look similar and behave completely differently,
// so they are two types, not one with a nullable date:
//
//   FnoEvent   happens ONCE, at a time. "The Fillmore, Saturday 8pm."
//   FnoPlace   is always there. "The ice rink." It has a season, not a date.
//
// Collapsing them loses the distinction the whole app is built on: you sort
// events by when, and places by whether they are open right now.
// ---------------------------------------------------------------------------

// ----- price ---------------------------------------------------------------

/**
 * `unknown` is deliberately a real state rather than a default to "paid".
 *
 * Community calendars almost never state a price. Rendering a guess is worse
 * than rendering nothing: someone who shows up at a $40 door expecting free is
 * more annoyed than someone who was told to check. So unknown gets its own
 * grey treatment everywhere and never borrows another tier's colour.
 */
export type PriceTier = "free" | "paid" | "donation" | "unknown";

export interface Price {
  tier: PriceTier;
  /** Lowest and highest observed, in USD. Absent when the source omits them. */
  min?: number;
  max?: number;
  /** Free text straight from the source — "$10 at the door", "pay what you can". */
  note?: string;
}

// ----- sources -------------------------------------------------------------

export const SOURCE_IDS = [
  "ticketmaster",
  "overpass",
  "feed",
  "ai-sweep",
  "inbox",
  "seed",
] as const;

export type SourceId = (typeof SOURCE_IDS)[number];

/**
 * Where one copy of an event came from. An event carries an array of these:
 * after dedupe, a show that Ticketmaster AND the local paper both listed has
 * two. That count is the main input to the obscurity score, which is why the
 * refs survive the merge instead of collapsing to a single "source" string.
 */
export interface SourceRef {
  id: SourceId;
  /** Human label — the feed's name, or "Ticketmaster". */
  label: string;
  /** Link back to this source's own page for the event. */
  url?: string;
  /** The source's own id, used to avoid re-adding on a later refresh. */
  externalId?: string;
}

/** Whether an adapter can run right now, and if not, why not. */
export interface SourceStatus {
  id: SourceId;
  label: string;
  ok: boolean;
  /** Shown verbatim in the Sources panel: "needs TICKETMASTER_API_KEY". */
  reason?: string;
  /** Populated after a search — how many raw results it returned. */
  count?: number;
  /** Populated when the adapter ran and failed. */
  error?: string;
}

// ----- categories ----------------------------------------------------------

export const EVENT_CATEGORIES = [
  "Music",
  "Nightlife",
  "Food & Drink",
  "Arts",
  "Community",
  "Faith",
  "Family",
  "Sports",
  "Outdoors",
  "Learning",
  "Market",
  "Other",
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const ACTIVITY_CATEGORIES = [
  "On Ice",
  "Climbing",
  "Water",
  "Horses",
  "Air & Heights",
  "Games",
  "Motors",
  "Wellness",
  "Nature",
  "Oddities",
  "Culture",
  "Food & Drink",
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

// ----- geo -----------------------------------------------------------------

export interface Coords {
  lat: number;
  lon: number;
}

export interface Origin extends Coords {
  /** What the user sees: "Asheville, NC". */
  label: string;
}

/**
 * Room size, banded.
 *
 * This is a filter, not just a ranking input — "something under 200 people" is
 * frequently the actual request, and no category or price filter expresses it.
 */
export const VENUE_SIZES = ["intimate", "small", "mid", "large"] as const;
export type VenueSize = (typeof VENUE_SIZES)[number];

export const VENUE_SIZE_LABELS: Record<VenueSize, string> = {
  intimate: "Under 100",
  small: "100–500",
  mid: "500–2,000",
  large: "2,000+",
};

export interface Venue {
  name: string;
  address?: string;
  lat?: number;
  lon?: number;
  /**
   * Rough seated capacity when a source reports it. Feeds the obscurity score:
   * a 20,000-seat arena is not a hidden gem no matter how few sources list it.
   */
  capacity?: number;
  /** Derived from capacity, or from venue-name heuristics when it is absent. */
  sizeBand?: VenueSize;
  /**
   * Room or stage within a multi-room venue. Load-bearing for dedupe: two
   * different sets in two rooms of the same building at the same hour are two
   * events, and merging them loses one.
   */
  room?: string;
}

// ----- events --------------------------------------------------------------

/**
 * What shape the thing is, independent of its subject.
 *
 * Category says "Music"; format says whether it is a ticketed show or an open
 * mic. In a mid-size metro "Music" matches half the list and filters nothing,
 * so format carries most of the narrowing work.
 */
export const EVENT_FORMATS = [
  "show",
  "open-mic",
  "market",
  "class",
  "talk",
  "outdoors",
  "service",
  "fundraiser",
  "party",
  "screening",
  "other",
] as const;

export type EventFormat = (typeof EVENT_FORMATS)[number];

/**
 * A repeating event, collapsed.
 *
 * Without this the app fails in a specific, predictable way: institutional
 * calendars are mostly weekly recurrences (library storytime, Tuesday trivia,
 * Sunday service). Each instance is single-sourced, community-weighted and in a
 * small room — a near-perfect obscurity score, fifty-two times a year. The
 * Hidden Gems view would degenerate into the same six recurring things.
 *
 * So instances collapse into one card, and obscurity decays with frequency: a
 * thing that happens every week is by definition not a thing you are missing.
 */
export interface SeriesInfo {
  /** iCal RRULE when we have one, else a derived label. */
  rule?: string;
  /** "every Tuesday", "first Friday monthly". */
  label: string;
  /** How many instances we collapsed. */
  occurrences: number;
  /** Start times of the next few, so the card can offer them. */
  upcoming: string[];
}

export interface FnoEvent {
  id: string;
  title: string;
  description?: string;
  /** ISO 8601. Always present — an event with no date is not an event. */
  startsAt: string;
  endsAt?: string;
  allDay: boolean;
  venue: Venue;
  /** Derived from the user's origin at search time, not stored by the source. */
  distanceMi?: number;
  category: EventCategory;
  format: EventFormat;
  price: Price;
  url?: string;
  imageUrl?: string;
  /** One entry per source that reported this event. Never empty. */
  sources: SourceRef[];
  /** 0-100, computed in normalize.ts after dedupe. Higher = less known. */
  obscurity: number;
  /**
   * 0-1: how sure we are this event is real and correctly described.
   *
   * Deliberately separate from obscurity, because a single-source event is
   * equally consistent with "genuinely obscure" and with "the model made it
   * up". Collapsing them would put the least-verified pipeline on the app's
   * most prominent surface. The Hidden Gem badge requires BOTH.
   */
  confidence: number;
  /** Set when this card stands for a repeating series rather than one night. */
  series?: SeriesInfo;
  /** When a source URL was last confirmed to still describe this event. */
  lastVerifiedAt?: string;
  /** Watchlist entries this event matched — "you follow The Grey Eagle". */
  watchHits?: string[];
  /** Set when the user saves it. */
  savedAt?: string;
  /** Set when the user marks themselves as going. */
  going?: boolean;
}

// ----- places (Always On) --------------------------------------------------

/** A month-day window like { from: "11-15", to: "03-01" } — may wrap the year. */
export interface SeasonWindow {
  from: string;
  to: string;
}

/**
 * `unknown` exists because OpenStreetMap has no venue-season field.
 *
 * The obvious shortcut — a per-category table saying "ice rink means November
 * to March" — is wrong for most US rinks, which are indoor and run year-round.
 * Dimming a year-round rink and captioning it "opens in November" is worse than
 * saying nothing: it is confidently false AND it hides a valid result. So a
 * season is only asserted from real evidence, and `unknown` never dims.
 */
export type Season = "year-round" | "unknown" | SeasonWindow;

/** How a season was arrived at — drives whether the card dims or just notes it. */
export type SeasonEvidence =
  /** Parsed from the venue's own opening_hours month range. */
  | "stated"
  /** Indoors, so the calendar is irrelevant. */
  | "indoor"
  /** A category where seasonality is inherent (a ski piste, an alpine slide). */
  | "typical"
  | "none";

/**
 * Cross-cutting tags derived from tag COMBINATIONS rather than single tags.
 *
 * The activity categories are verbs — climbing, paddling, skating. They cannot
 * express "abandoned", "underground", "free and weird", or "you can walk right
 * up to it", and those are the axes surprise actually lives on. These are
 * computed, shown as chips, and filterable.
 */
export const VIBE_TAGS = [
  "Abandoned",
  "Underground",
  "Free & Weird",
  "Big View",
  "Big Machines",
  "Only One Near You",
  "Locally Owned",
] as const;

export type VibeTag = (typeof VIBE_TAGS)[number];

export interface FnoPlace {
  id: string;
  name: string;
  category: ActivityCategory;
  /** One line on what it actually is, when the source gives us one. */
  description?: string;
  /**
   * The sentence that does the actual work.
   *
   * "Vertical World — climbing — 4.2 mi" produces no reaction whatever, even
   * when the place is genuinely obscure. "A moss-covered stone ruin in Forest
   * Park that was once a public restroom" is the product. Surprise is a
   * linguistic effect, not a data effect, so a place without a hook is a place
   * the board cannot really sell.
   *
   * Sourced, in order: OpenStreetMap's own `description` tag, then the first
   * sentence of a linked Wikipedia article, then a Wikipedia geosearch join.
   * All three are keyless.
   */
  hook?: string;
  hookSource?: "osm" | "wikipedia";
  lat: number;
  lon: number;
  address?: string;
  distanceMi?: number;
  season: Season;
  /** Why we believe that season — an unevidenced guess must not dim a card. */
  seasonEvidence: SeasonEvidence;
  price: Price;
  url?: string;
  phone?: string;
  /** OSM element id, e.g. "node/1234567". Used to dedupe across refreshes. */
  osmId?: string;
  /** The raw OSM tag that matched, kept so the mapping stays debuggable. */
  osmTag?: string;
  /** Wikipedia article title, when the element links one. */
  wikipedia?: string;
  /** OSM `check_date` — "last verified" — so stale entries can be demoted. */
  checkDate?: string;
  /** True when OSM marks it as a chain (`brand` / `brand:wikidata`). */
  chain?: boolean;
  vibes: VibeTag[];
  sources: SourceRef[];
  /**
   * 0-100, how unlikely you are to already know this exists.
   *
   * Unlike an event's obscurity this is computed against the result set: being
   * the ONLY curling sheet within the radius is what makes a curling sheet
   * remarkable, and that cannot be known from the tag alone.
   */
  obscurity: number;
  savedAt?: string;
  /** Set by "seen it" — stops the board re-showing the same three rinks. */
  dismissedAt?: string;
}

// ----- feeds ---------------------------------------------------------------

/**
 * `tribe` and `localist` are named explicitly because they are the two formats
 * that actually carry small-venue and institutional listings at scale:
 *
 *   tribe     The Events Calendar's WordPress REST API. Bundled free with the
 *             plugin, so it sits on an enormous number of small-venue, church
 *             and nonprofit sites, and takes a real date range.
 *   localist  The calendar platform behind most university and civic sites,
 *             with a public keyless JSON endpoint on the institution's domain.
 *
 * Both return structured JSON with real start times, which beats scraping an
 * RSS description for a date string.
 */
export type FeedKind = "rss" | "ical" | "jsonld" | "tribe" | "localist" | "auto";

export interface Feed {
  id: string;
  label: string;
  url: string;
  /** `auto` sniffs the content type on first fetch and rewrites itself. */
  kind: FeedKind;
  enabled: boolean;
  addedAt: string;
  lastFetchedAt?: string;
  /** Last failure, kept so a silently-dead feed is visible in the UI. */
  lastError?: string;
  /** Result count from the last successful fetch. */
  lastCount?: number;
}

// ----- user preferences ----------------------------------------------------

export interface UserPrefs {
  origin: Origin | null;
  radiusMi: number;
  /** Empty means "all" rather than "none" — an empty filter shows everything. */
  eventCategories: EventCategory[];
  activityCategories: ActivityCategory[];
  /** Whether the AI sweep is allowed to run (it costs tokens). */
  aiSweepEnabled: boolean;
  updatedAt: string;
  /** False until onboarding completes, which is what gates the first-run flow. */
  onboarded: boolean;
}

// ----- search --------------------------------------------------------------

export interface SearchCtx {
  lat: number;
  lon: number;
  radiusMi: number;
  /** ISO date-time window. */
  from: string;
  to: string;
  categories?: EventCategory[];
  /** Feeds to fetch, passed from the client since they live in localStorage. */
  feeds?: Pick<Feed, "id" | "label" | "url" | "kind">[];
  /** Organizer subscriptions, same reason. */
  organizers?: OrganizerSub[];
  /** Skip the AI sweep even when a key exists. */
  skipAiSweep?: boolean;
}

/**
 * How the Upcoming list is ordered.
 *
 * `for-you` is the default rather than `hidden` on purpose. Sorting purely by
 * obscurity puts the least-known thing first regardless of whether anyone could
 * want it, which reliably produces a feed of rummage sales. `for-you` blends
 * obscurity with confidence, watchlist hits and imminence, so the top of the
 * list is "obscure AND plausible AND yours", and `hidden` stays one click away
 * for when the user explicitly wants the deep cuts.
 */
export const SORT_MODES = ["for-you", "hidden", "soon", "near", "cheap"] as const;
export type SortMode = (typeof SORT_MODES)[number];

export const SORT_LABELS: Record<SortMode, string> = {
  "for-you": "For you",
  hidden: "Hidden gems",
  soon: "Soonest",
  near: "Closest",
  cheap: "Cheapest",
};

/**
 * What an adapter returns. Deliberately looser than FnoEvent: adapters do not
 * compute distance, obscurity or ids — normalize.ts owns all three so the
 * scoring lives in exactly one place.
 */
export interface RawEvent {
  title: string;
  description?: string;
  startsAt: string;
  endsAt?: string;
  allDay?: boolean;
  venue: Venue;
  category?: EventCategory;
  format?: EventFormat;
  price?: Price;
  url?: string;
  imageUrl?: string;
  source: SourceRef;
  /**
   * The source's own stable identifier — iCal UID, Eventbrite event id.
   * An exact match here short-circuits fuzzy dedupe entirely, which is both
   * faster and far more accurate than any similarity threshold.
   */
  uid?: string;
  /** Raw iCal RRULE, when the feed published one. */
  rrule?: string;
  /**
   * A URL that independently proves this event exists. The AI sweep must supply
   * one or its results are rejected — a model's claim that it found something
   * is not evidence that it did.
   */
  verifyUrl?: string;
  /** Performer/organiser names pulled from the listing, for watchlist matching. */
  actors?: string[];
}

export interface SearchResponse {
  events: FnoEvent[];
  sources: SourceStatus[];
  /** When the search ran, so the UI can show staleness. */
  searchedAt: string;
}

export interface PlacesResponse {
  places: FnoPlace[];
  sources: SourceStatus[];
  searchedAt: string;
}

// ----- date night ----------------------------------------------------------

export type DateNightSlot = "activity" | "event" | "food";

export interface DateNightPlan {
  id: string;
  /** A short name for the evening — "Rink and a Record Shop". */
  title: string;
  activity?: FnoPlace;
  event?: FnoEvent;
  food?: FnoPlace;
  /** Slots the user pinned; the re-roll leaves these alone. */
  locked: DateNightSlot[];
  /** Sum of the known price mins. Unknown-priced items are excluded and flagged. */
  estimatedCost: { min: number; max: number; hasUnknown: boolean };
  /** Straight-line miles across the whole evening, origin included. */
  travelMi: number;
  savedAt?: string;
}

// ----- persisted shape -----------------------------------------------------

// ----- watchlist & organizer subscriptions --------------------------------

export type WatchKind = "artist" | "venue" | "organizer";

/**
 * A name the user cares about.
 *
 * This is the app's answer to the strongest discovery mechanism it otherwise
 * lacks: an obscure event you have no connection to is noise, but an obscure
 * event featuring a name you follow is exactly the find. Matching events get
 * boosted above pure obscurity, which is what stops the default view from
 * becoming a list of church rummage sales.
 */
export interface WatchItem {
  id: string;
  kind: WatchKind;
  /** As typed. Matching is done on a normalized copy. */
  name: string;
  addedAt: string;
}

/**
 * A publisher whose entire future calendar we now follow.
 *
 * Created automatically: paste one Eventbrite or Luma link into the Inbox and
 * the app extracts the organizer behind it and subscribes permanently. One
 * paste becomes a standing feed — which is the only way a single-user app gets
 * the small-promoter inventory that has no RSS.
 */
export interface OrganizerSub {
  id: string;
  platform: "eventbrite" | "luma" | "ical";
  /** Platform's own id, or the .ics URL for `ical`. */
  externalId: string;
  label: string;
  addedAt: string;
  lastError?: string;
  lastCount?: number;
}

export interface FnoData {
  prefs: UserPrefs;
  feeds: Feed[];
  watchlist: WatchItem[];
  organizers: OrganizerSub[];
  /** Events the user saved, plus everything added through the Inbox. */
  savedEvents: FnoEvent[];
  savedPlaces: FnoPlace[];
  savedPlans: DateNightPlan[];
  /** Last search results, cached so a reload does not refetch everything. */
  cache: {
    events: FnoEvent[];
    places: FnoPlace[];
    eventsAt?: string;
    placesAt?: string;
  };
}
