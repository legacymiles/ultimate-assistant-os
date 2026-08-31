// ---------------------------------------------------------------------------
// Friends Night Out — dedupe, series collapsing, scoring and ranking.
//
// This file turns raw adapter output into the list the user sees. The order of
// operations matters, because each stage depends on the one before it:
//
//   1. Dedupe across sources        — merge the same night listed twice
//   2. Collapse series              — merge the same night listed weekly
//   3. Score obscurity + confidence — both need the merged source list
//   4. Rank                         — needs both scores
//
// Two failure modes drove this design, and both are silent:
//
//   Unmerged duplicates make every copy look single-sourced, so a well-known
//   show earns three Hidden Gem badges it has not earned.
//
//   Uncollapsed recurrences are worse. Institutional calendars are mostly
//   weekly (library storytime, Tuesday trivia, Sunday service). Every instance
//   is single-source, community-weighted, small-room — a near-perfect obscurity
//   score, fifty-two times a year. Without step 2 the Hidden Gems view becomes
//   the same six recurring things, forever.
// ---------------------------------------------------------------------------

import { uid } from "../utils";
import { distanceMi } from "./geo";
import type {
  Coords,
  EventCategory,
  EventFormat,
  FnoEvent,
  Price,
  PriceTier,
  RawEvent,
  SortMode,
  SourceId,
  SourceRef,
  Venue,
  VenueSize,
  WatchItem,
} from "./types";

// ----- string similarity ---------------------------------------------------

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "at", "in", "on", "to", "for", "with",
  "presents", "present", "presented", "by", "live", "tour", "show", "concert",
  "event", "featuring", "feat", "ft", "w", "vs", "night", "annual", "official",
]);

/**
 * Strip everything that varies between sources describing the same thing:
 * case, punctuation, the presenter's name, and filler. "The Mountain Goats —
 * Live at The Orange Peel" and "Mountain Goats" both reduce to "mountain
 * goats", which is the entire point.
 */
export function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    // Text after a dash/colon/pipe is usually venue or promoter, not identity.
    .split(/\s+[–—\-|:]\s+/)[0]
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .join(" ")
    .trim();
}

function bigrams(s: string): string[] {
  const clean = s.replace(/\s+/g, " ");
  if (clean.length < 2) return clean ? [clean] : [];
  const out: string[] = [];
  for (let i = 0; i < clean.length - 1; i++) out.push(clean.slice(i, i + 2));
  return out;
}

/**
 * Sørensen–Dice over character bigrams. Chosen over Levenshtein because it
 * ignores word order and tolerates one source appending extra words — which is
 * exactly how the same event differs between a ticket API and a newspaper
 * calendar.
 */
export function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of B) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      counts.set(g, c - 1);
      hits++;
    }
  }
  return (2 * hits) / (A.length + B.length);
}

// ----- matching ------------------------------------------------------------

/** Above this, titles alone are enough. */
const TITLE_STRONG = 0.82;
/** Between this and STRONG, a second independent signal is required. */
const TITLE_WEAK = 0.6;
const VENUE_NAME_THRESHOLD = 0.7;
// A tenth of a mile. Half a mile encloses dozens of distinct venues in any
// downtown core, and coordinates are offered as an ALTERNATIVE to name
// similarity — so a loose radius silently merges two different bars a few
// blocks apart that happen to run similar nights.
const VENUE_DISTANCE_MI = 0.1;
const START_WINDOW_MS = 3 * 60 * 60 * 1000;

/** Origin + path, so two links to the same listing with different query strings match. */
function canonicalUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

function venuesMatch(a: Venue, b: Venue): boolean {
  // A multi-room venue runs different things in different rooms at the same
  // hour. Merging those loses one of them outright, so a room conflict is a
  // hard no regardless of how well everything else lines up.
  if (a.room && b.room && normalizeTitle(a.room) !== normalizeTitle(b.room)) {
    return false;
  }
  if (
    a.lat !== undefined && a.lon !== undefined &&
    b.lat !== undefined && b.lon !== undefined
  ) {
    // Coordinates beat names: two sources spelling a venue differently ("The
    // Orange Peel" vs "Orange Peel Social Aid & Pleasure Club") still agree on
    // where the building is.
    return (
      distanceMi({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }) <=
      VENUE_DISTANCE_MI
    );
  }
  const an = normalizeTitle(a.name);
  const bn = normalizeTitle(b.name);
  if (!an || !bn) return true; // Missing on one side — do not block on it.
  return diceSimilarity(an, bn) >= VENUE_NAME_THRESHOLD;
}

function timesMatch(a: RawEvent, b: RawEvent): boolean {
  const at = new Date(a.startsAt).getTime();
  const bt = new Date(b.startsAt).getTime();
  if (!Number.isFinite(at) || !Number.isFinite(bt)) return false;
  // An all-day or time-unknown item publishes as local midnight. Comparing that
  // to a real 8pm start with a 3-hour window fails every time, so all-day
  // matching drops to date-level.
  if (a.allDay || b.allDay) return dayKey(a.startsAt) === dayKey(b.startsAt);
  return Math.abs(at - bt) <= START_WINDOW_MS;
}

/**
 * A second independent signal, used to accept a weaker title match.
 *
 * "Sat Night Jazz w/ the Ellis Quartet" and "Ellis Quartet" score about 0.5 on
 * bigrams — far below the strong threshold — yet a shared performer name or a
 * shared ticket-link host makes them obviously the same night.
 */
function corroborates(a: RawEvent, b: RawEvent): boolean {
  const ua = canonicalUrl(a.url);
  const ub = canonicalUrl(b.url);
  if (ua && ub && ua === ub) return true;

  const actorsA = (a.actors ?? []).map(normalizeTitle).filter(Boolean);
  const actorsB = (b.actors ?? []).map(normalizeTitle).filter(Boolean);
  if (actorsA.some((x) => actorsB.includes(x))) return true;

  // Containment used to count on its own, and it backfired: a series head and
  // one of its instances ("Comedy Night" vs "Comedy Night: Dan Ruiz") are a
  // containment match, and so are the early and late shows of a double-header
  // two and a half hours apart. Generic-prefix titles are exactly the case
  // where containment fires most often and is most often wrong.
  //
  // It still counts, but only when the two starts are nearly identical AND the
  // extra words are few — the "one source appended the venue" case it was
  // meant for, not the "these are different nights" case.
  const ta = normalizeTitle(a.title);
  const tb = normalizeTitle(b.title);
  if (ta && tb && (ta.includes(tb) || tb.includes(ta))) {
    const at = new Date(a.startsAt).getTime();
    const bt = new Date(b.startsAt).getTime();
    if (Math.abs(at - bt) > 30 * 60 * 1000) return false;
    const extra = Math.abs(ta.split(" ").length - tb.split(" ").length);
    return extra <= 2;
  }

  return false;
}

function sameEvent(a: RawEvent, b: RawEvent): boolean {
  // Exact identifiers short-circuit everything. A shared iCal UID or the same
  // ticket URL is proof, not evidence, and it is both faster and far more
  // accurate than any similarity threshold.
  if (a.uid && b.uid && a.uid === b.uid) return true;
  const ua = canonicalUrl(a.url);
  const ub = canonicalUrl(b.url);
  if (ua && ub && ua === ub && timesMatch(a, b)) return true;

  if (!timesMatch(a, b)) return false;
  if (!venuesMatch(a.venue, b.venue)) return false;

  const score = diceSimilarity(normalizeTitle(a.title), normalizeTitle(b.title));
  if (score >= TITLE_STRONG) return true;
  if (score >= TITLE_WEAK && corroborates(a, b)) return true;
  return false;
}

// ----- merging -------------------------------------------------------------

/** Specificity order — a merge never downgrades what we know about price. */
const PRICE_RANK: Record<PriceTier, number> = {
  unknown: 0,
  donation: 1,
  free: 2,
  paid: 3,
};

function mergePrice(a: Price | undefined, b: Price | undefined): Price {
  if (!a) return b ?? { tier: "unknown" };
  if (!b) return a;
  // A source naming an actual number beats one naming only a tier.
  const aHasNumbers = a.min !== undefined || a.max !== undefined;
  const bHasNumbers = b.min !== undefined || b.max !== undefined;
  if (aHasNumbers !== bHasNumbers) return aHasNumbers ? a : b;
  return PRICE_RANK[a.tier] >= PRICE_RANK[b.tier] ? a : b;
}

function mergeVenue(a: Venue, b: Venue): Venue {
  return {
    name: a.name.length >= b.name.length ? a.name : b.name,
    address: a.address ?? b.address,
    lat: a.lat ?? b.lat,
    lon: a.lon ?? b.lon,
    capacity: a.capacity ?? b.capacity,
    room: a.room ?? b.room,
  };
}

interface Bucket {
  raw: RawEvent;
  sources: SourceRef[];
  actors: Set<string>;
  /** Every start time seen for this identity — the input to series detection. */
  starts: string[];
  rrule?: string;
}

function absorb(bucket: Bucket, item: RawEvent): void {
  const a = bucket.raw;
  bucket.raw = {
    ...a,
    // The longer title usually carries the subtitle worth reading.
    title: a.title.length >= item.title.length ? a.title : item.title,
    description:
      (a.description?.length ?? 0) >= (item.description?.length ?? 0)
        ? a.description ?? item.description
        : item.description ?? a.description,
    endsAt: a.endsAt ?? item.endsAt,
    allDay: a.allDay ?? item.allDay,
    venue: mergeVenue(a.venue, item.venue),
    category: a.category ?? item.category,
    format: a.format ?? item.format,
    price: mergePrice(a.price, item.price),
    url: a.url ?? item.url,
    imageUrl: a.imageUrl ?? item.imageUrl,
    uid: a.uid ?? item.uid,
    verifiedAt: a.verifiedAt ?? item.verifiedAt,
  };
  bucket.rrule = bucket.rrule ?? item.rrule;
  for (const actor of item.actors ?? []) bucket.actors.add(actor);
  // Two listings from one source are one listing, not evidence of reach.
  if (
    !bucket.sources.some(
      (s) => s.id === item.source.id && s.label === item.source.label,
    )
  ) {
    bucket.sources.push(item.source);
  }
}

// ----- obscurity -----------------------------------------------------------

/**
 * How strongly a listing on this source implies the event is already widely
 * known. Higher means "everyone can see this".
 *
 * Ticketmaster is the ceiling: if a thing is on sale there, every event
 * aggregator in the country already carries it. A single church or library
 * calendar is the floor — it reaches whoever already reads that calendar and
 * nobody else.
 */
const VISIBILITY_WEIGHT: Record<SourceId, number> = {
  ticketmaster: 1.0,
  seed: 0.5,
  "ai-sweep": 0.35,
  feed: 0.25,
  overpass: 0.25,
  inbox: 0.05,
};

/**
 * How much a recurrence discounts obscurity.
 *
 * A thing that happens every week is not a thing you are missing — you can go
 * next Tuesday. Weekly recurrences are discounted hard; a quarterly one barely
 * at all.
 */
function seriesFactor(cadenceDays: number | undefined): number {
  // Keyed on the DETECTED CADENCE rather than how many instances happened to
  // land in the fetch window. Counting occurrences made the damping depend on
  // the window length: a weekly service inside a 30-day window yields four
  // instances and would keep near-maximum obscurity, even though a weekly
  // fixture is the definition of something you are not missing.
  if (cadenceDays === undefined) return 1;
  if (cadenceDays <= 9) return 0.3; // daily or weekly
  if (cadenceDays <= 18) return 0.5; // fortnightly
  if (cadenceDays <= 45) return 0.7; // monthly
  return 0.9; // quarterly or rarer — still mostly a find
}

/**
 * 0-100, higher = less likely you already knew about it.
 *
 * Four independent signals, because each catches a case the others miss:
 *   - source count      a show on six sites is not a secret
 *   - source visibility one Ticketmaster listing beats three church bulletins
 *   - venue scale       an arena is public knowledge regardless of listings
 *   - recurrence        a weekly fixture is not a discovery
 */
/**
 * Distinct PUBLISHERS, not distinct source rows.
 *
 * An institution routinely publishes the same event to its own iCal and to a
 * Localist instance on the same domain. Counting those as two sources rewarded
 * one publisher twice for being redundant — raising confidence and lowering
 * obscurity for what is really a single claim.
 */
function distinctPublishers(sources: SourceRef[]): number {
  const keys = new Set<string>();
  for (const s of sources) {
    let key = `${s.id}:${s.label.toLowerCase()}`;
    if (s.url) {
      try {
        key = `${s.id}:${new URL(s.url).hostname.replace(/^www\./, "")}`;
      } catch {
        // Keep the label-based key.
      }
    }
    keys.add(key);
  }
  return Math.max(1, keys.size);
}

export function obscurityScore(
  sources: SourceRef[],
  venue?: Venue,
  cadenceDays?: number,
): number {
  if (!sources.length) return 50;

  const count = distinctPublishers(sources);
  // 1 source → 1.0, 2 → 0.6, 3 → 0.43, 4+ → tails toward 0.
  const countFactor = 1 / (1 + (count - 1) * 0.65);

  const loudest = Math.max(...sources.map((s) => VISIBILITY_WEIGHT[s.id] ?? 0.4));
  const visibilityFactor = 1 - loudest * 0.75;

  let scale = 1;
  const cap = venue?.capacity;
  if (cap) {
    if (cap >= 10_000) scale = 0.2;
    else if (cap >= 3_000) scale = 0.45;
    else if (cap >= 1_000) scale = 0.75;
  }

  const raw =
    (countFactor * 0.45 + visibilityFactor * 0.55) * scale * seriesFactor(cadenceDays);
  return Math.round(Math.max(0, Math.min(1, raw)) * 100);
}

// ----- confidence ----------------------------------------------------------

/**
 * Weak prior on the source, NOT the score itself.
 *
 * The first version of this was a lookup table on source identity wearing a
 * score's clothing, and it produced a perverse result: the AI sweep is the only
 * source in the app subjected to a real evidence test — its cited page is
 * fetched and must corroborate the event or the event is discarded — yet it
 * started at 0.30 and topped out below the badge threshold, permanently marked
 * "unverified". Ticketmaster meanwhile scored 0.95 with no verification
 * performed at all. The ladder ranked prestige, not evidence.
 *
 * So the prior is small and the evidence terms below do the work.
 */
const SOURCE_PRIOR: Record<SourceId, number> = {
  ticketmaster: 0.45,
  seed: 0.4,
  inbox: 0.4, // a human looked at it
  overpass: 0.4,
  feed: 0.35,
  "ai-sweep": 0.25,
};

/**
 * 0-1: how sure we are the event is real and correctly described.
 *
 * Kept strictly separate from obscurity, because a single-source event is
 * equally consistent with "genuinely obscure" and with "hallucinated" — and
 * collapsing the two would put the least-verified pipeline on the app's most
 * prominent surface.
 *
 * Scored from evidence actually obtained rather than from who reported it:
 * a fetch-verified AI find should be able to outrank an unchecked feed entry,
 * because it has been checked and the feed entry has not.
 */
export function confidenceScore(item: RawEvent, sources: SourceRef[]): number {
  let score = Math.max(...sources.map((s) => SOURCE_PRIOR[s.id] ?? 0.3));

  // The strongest evidence available: the cited page was fetched and confirmed
  // to describe this event. Only the AI sweep currently earns this, and it is
  // the reason the sweep is no longer capped below its own badge threshold.
  if (item.verifiedAt) score += 0.2;

  // Independent corroboration — by distinct publisher, so an institution
  // posting the same event to its own iCal and its Localist does not count
  // twice.
  const publishers = distinctPublishers(sources);
  if (publishers > 1) score += 0.12 * Math.min(3, publishers - 1);

  if (item.url) score += 0.05;
  if (item.venue.lat !== undefined && item.venue.lon !== undefined) score += 0.05;
  // Price is deliberately NOT an input. Its absence says something about a
  // venue's admin habits, not about whether the event is real — and unlisted
  // price correlates almost perfectly with the small DIY events this app
  // exists to surface, so scoring it taxed the target class.

  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

export const HIDDEN_GEM_OBSCURITY = 65;
export const HIDDEN_GEM_CONFIDENCE = 0.6;

/**
 * The badge requires both halves: obscure enough to be a find, verified enough
 * to be worth driving to.
 */
export function isHiddenGem(e: Pick<FnoEvent, "obscurity" | "confidence">): boolean {
  return e.obscurity >= HIDDEN_GEM_OBSCURITY && e.confidence >= HIDDEN_GEM_CONFIDENCE;
}

// ----- inference -----------------------------------------------------------

const CATEGORY_HINTS: [RegExp, EventCategory][] = [
  [/\b(mass|worship|service|church|gospel|prayer|parish|congregation|vigil|revival)\b/i, "Faith"],
  [/\b(farmers?\s*market|flea|swap\s*meet|craft\s*fair|bazaar|vendor|makers?\s*market)\b/i, "Market"],
  [/\b(dj|rave|club night|after ?party|warehouse|late night|dance party|house music)\b/i, "Nightlife"],
  [/\b(concert|band|live music|open mic|orchestra|symphony|acoustic|jam|gig|tour|songwriter)\b/i, "Music"],
  [/\b(tasting|brewery|winery|dinner|food truck|potluck|supper|cook ?off|brunch|pop ?up)\b/i, "Food & Drink"],
  [/\b(gallery|exhibit|theatre|theater|play|ballet|museum|film|screening|poetry|comedy|improv)\b/i, "Arts"],
  [/\b(game|match|tournament|race|5k|marathon|league|derby|pickleball)\b/i, "Sports"],
  [/\b(hike|trail|paddle|birding|clean ?up|garden|nature walk|camp|stargaz)\b/i, "Outdoors"],
  [/\b(workshop|class|lecture|seminar|talk|training|tutorial|book club|storytime)\b/i, "Learning"],
  [/\b(kids|family|toddler|all ages|youth|scout)\b/i, "Family"],
  [/\b(meeting|fundraiser|benefit|volunteer|town hall|block party|festival|parade)\b/i, "Community"],
];

export function inferCategory(title: string, description?: string): EventCategory {
  const text = `${title} ${description ?? ""}`;
  for (const [pattern, category] of CATEGORY_HINTS) if (pattern.test(text)) return category;
  return "Other";
}

const FORMAT_HINTS: [RegExp, EventFormat][] = [
  [/\bopen mic|open ?jam|songwriter round\b/i, "open-mic"],
  [/\bmarket|bazaar|flea|craft fair|pop ?up|vendor\b/i, "market"],
  [/\bclass|workshop|lesson|clinic|training|storytime\b/i, "class"],
  [/\blecture|talk|panel|reading|seminar|q&a\b/i, "talk"],
  [/\bhike|paddle|trail|ride|cleanup|birding|walk\b/i, "outdoors"],
  [/\bmass|worship|service|vigil|prayer\b/i, "service"],
  [/\bfundraiser|benefit|charity|drive\b/i, "fundraiser"],
  [/\bscreening|film|movie|cinema\b/i, "screening"],
  [/\bparty|dj|rave|dance|social|mixer\b/i, "party"],
  [/\bconcert|live|band|show|tour|performance|matinee\b/i, "show"],
];

export function inferFormat(title: string, description?: string): EventFormat {
  const text = `${title} ${description ?? ""}`;
  for (const [pattern, format] of FORMAT_HINTS) if (pattern.test(text)) return format;
  return "other";
}

/**
 * Room size from capacity, with a name-based fallback.
 *
 * The fallback matters because capacity is missing far more often than it is
 * present, and "under 100 people" is a filter users actually reach for. A venue
 * called "Arena" or "Amphitheatre" is not intimate even when nobody said so.
 */
export function inferSizeBand(venue: Venue): VenueSize | undefined {
  const cap = venue.capacity;
  if (cap) {
    if (cap < 100) return "intimate";
    if (cap < 500) return "small";
    if (cap < 2000) return "mid";
    return "large";
  }
  const name = venue.name.toLowerCase();
  if (/\b(arena|stadium|amphitheat|coliseum|pavilion|fairgrounds|speedway)\b/.test(name)) {
    return "large";
  }
  if (/\b(theatre|theater|hall|auditorium|ballroom|center|centre)\b/.test(name)) {
    return "mid";
  }
  if (/\b(bar|pub|tavern|cafe|café|coffee|bookstore|record|gallery|basement|garage|porch|library|church|barn)\b/.test(name)) {
    return "intimate";
  }
  return undefined;
}

const FREE_HINTS = /\b(free admission|free entry|no cover|free to attend|admission is free|free event)\b/i;
const DONATION_HINTS = /\b(donation|pay what you (can|wish)|suggested contribution|sliding scale|by donation)\b/i;
const PRICE_NUMBER = /\$\s?(\d{1,4}(?:\.\d{2})?)/g;

/**
 * Read a price out of free text, returning `unknown` when unsure.
 *
 * The bias is deliberate: this never infers "free" from silence. A wrong "free"
 * badge sends someone to a $40 door, which is a worse failure than an honest
 * "price not listed".
 */
export function inferPrice(text: string | undefined): Price {
  if (!text) return { tier: "unknown" };
  if (DONATION_HINTS.test(text)) return { tier: "donation", note: "Donation" };
  if (FREE_HINTS.test(text)) return { tier: "free", note: "Free" };

  const numbers = [...text.matchAll(PRICE_NUMBER)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 2000);
  if (numbers.length) {
    return { tier: "paid", min: Math.min(...numbers), max: Math.max(...numbers) };
  }
  // A bare "free" is only trusted with no competing dollar figure nearby.
  if (/\bfree\b/i.test(text) && !/\$/.test(text)) return { tier: "free", note: "Free" };
  return { tier: "unknown" };
}

// ----- series --------------------------------------------------------------

/** Identity of a repeating thing: same title, same venue. */
function seriesKey(item: RawEvent): string {
  const title = normalizeTitle(item.title);
  const venue = normalizeTitle(item.venue.name);
  return `${title}::${venue}`;
}

/** Median gap between occurrences, in days. Undefined for a one-off. */
export function medianGapDays(starts: string[]): number | undefined {
  if (starts.length < 2) return undefined;
  const times = starts.map((s) => new Date(s).getTime()).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  if (!gaps.length) return undefined;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] / 86_400_000;
}

function describeInterval(starts: string[]): string {
  if (starts.length < 2) return "recurring";
  const times = starts.map((s) => new Date(s).getTime()).sort((a, b) => a - b);
  const days = medianGapDays(starts) ?? 0;
  const weekday = new Date(times[0]).toLocaleDateString(undefined, { weekday: "long" });
  if (days <= 1.5) return "daily";
  if (days <= 9) return `every ${weekday}`;
  if (days <= 18) return `every other ${weekday}`;
  if (days <= 45) return `monthly on a ${weekday}`;
  return "occasional";
}

// ----- the pipeline --------------------------------------------------------

export interface NormalizeOptions {
  origin: Coords;
  radiusMi: number;
  /** Drop anything starting before this. Defaults to now. */
  notBefore?: Date;
  /** Names the user follows — matches get boosted and badged. */
  watchlist?: WatchItem[];
}

export function normalizeEvents(
  raw: RawEvent[],
  options: NormalizeOptions,
): FnoEvent[] {
  const cutoff = (options.notBefore ?? new Date()).getTime();

  // ---- stage 1: dedupe across sources, bucketed by day -------------------
  // Bucketing keeps this near-linear: two events on different days can never
  // merge, so there is no reason to compare them.
  const byDay = new Map<string, Bucket[]>();
  const byUid = new Map<string, Bucket>();

  for (const item of raw) {
    const t = new Date(item.startsAt).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;

    if (item.uid) {
      const hit = byUid.get(item.uid);
      if (hit) {
        // Same UID on a different date is the feed publishing one instance of a
        // recurring series, not a duplicate. Record the date and move on.
        if (!hit.starts.includes(item.startsAt)) hit.starts.push(item.startsAt);
        absorb(hit, item);
        continue;
      }
    }

    const day = dayKey(item.startsAt);
    const candidates = [
      ...(byDay.get(day) ?? []),
      ...(byDay.get(dayKey(item.startsAt, -1)) ?? []),
      ...(byDay.get(dayKey(item.startsAt, 1)) ?? []),
    ];

    const hit = candidates.find((c) => sameEvent(c.raw, item));
    if (hit) {
      absorb(hit, item);
      continue;
    }

    const bucket: Bucket = {
      raw: item,
      sources: [item.source],
      actors: new Set(item.actors ?? []),
      starts: [item.startsAt],
      rrule: item.rrule,
    };
    const list = byDay.get(day) ?? [];
    list.push(bucket);
    byDay.set(day, list);
    if (item.uid) byUid.set(item.uid, bucket);
  }

  const allBuckets = [...new Set([...byDay.values()].flat())];

  // ---- stage 2: collapse recurring instances into one card ---------------
  const bySeries = new Map<string, Bucket[]>();
  for (const b of allBuckets) {
    const key = seriesKey(b.raw);
    const list = bySeries.get(key) ?? [];
    list.push(b);
    bySeries.set(key, list);
  }

  const collapsed: {
    bucket: Bucket;
    occurrences: number;
    cadenceDays?: number;
    label?: string;
    upcoming: string[];
  }[] = [];
  for (const group of bySeries.values()) {
    // Every start time this identity appears at, whether it arrived as separate
    // buckets (three feed entries) or one bucket with an RRULE.
    const starts = [...new Set(group.flatMap((b) => b.starts))].sort();
    const isSeries = starts.length >= 3 || Boolean(group[0].rrule);

    if (!isSeries) {
      for (const b of group) {
        collapsed.push({ bucket: b, occurrences: b.starts.length, upcoming: b.starts });
      }
      continue;
    }

    // Keep the soonest instance as the face of the series, and carry the rest.
    const soonest = group.sort(
      (a, b) => new Date(a.raw.startsAt).getTime() - new Date(b.raw.startsAt).getTime(),
    )[0];
    for (const other of group.slice(1)) {
      for (const s of other.sources) {
        if (!soonest.sources.some((x) => x.id === s.id && x.label === s.label)) {
          soonest.sources.push(s);
        }
      }
    }
    collapsed.push({
      bucket: soonest,
      occurrences: starts.length,
      cadenceDays: medianGapDays(starts),
      label: describeInterval(starts),
      upcoming: starts.slice(0, 6),
    });
  }

  // ---- stages 3 and 4: score, filter by distance, emit -------------------
  // Word-boundary matching. A plain substring test made "Mercury" match Mercury
  // Lounge, Mercury Rev and "Mercury Retrograde Tarot Night" alike, and a
  // watchlist entry is supposed to be a name, not a wildcard.
  const watch = (options.watchlist ?? [])
    .map((w) => ({ name: w.name, tokens: normalizeTitle(w.name).split(" ").filter(Boolean) }))
    .filter((w) => w.tokens.length > 0 && w.tokens.join("").length >= 3);

  const out: FnoEvent[] = [];
  for (const entry of collapsed) {
    const item = entry.bucket.raw;
    const sources = entry.bucket.sources;

    const hasCoords = item.venue.lat !== undefined && item.venue.lon !== undefined;
    const dist = hasCoords
      ? distanceMi(options.origin, { lat: item.venue.lat!, lon: item.venue.lon! })
      : undefined;
    // Events with no coordinates are kept. A newspaper calendar often gives only
    // a venue name, and those are exactly the finds worth surfacing — they just
    // cannot be distance-filtered, so they pass through unfiltered.
    if (dist !== undefined && dist > options.radiusMi) continue;

    const venue: Venue = { ...item.venue };
    venue.sizeBand = venue.sizeBand ?? inferSizeBand(venue);

    const haystack = `${item.title} ${item.venue.name} ${[...entry.bucket.actors].join(" ")}`;
    const normHay = normalizeTitle(haystack);
    const hayTokens = new Set(normHay.split(" ").filter(Boolean));
    const watchHits = watch
      // Every token of the watched name has to appear as a whole word.
      .filter((w) => w.tokens.every((t) => hayTokens.has(t)))
      .map((w) => w.name);

    out.push({
      id: uid("evt"),
      title: item.title.trim(),
      description: item.description?.trim(),
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      allDay: item.allDay ?? false,
      venue,
      distanceMi: dist,
      category: item.category ?? inferCategory(item.title, item.description),
      format: item.format ?? inferFormat(item.title, item.description),
      price: item.price ?? inferPrice(`${item.title} ${item.description ?? ""}`),
      url: item.url,
      imageUrl: item.imageUrl,
      sources,
      obscurity: obscurityScore(sources, venue, entry.cadenceDays),
      confidence: confidenceScore(item, sources),
      lastVerifiedAt: item.verifiedAt,
      series:
        entry.occurrences >= 3 || entry.bucket.rrule
          ? {
              rule: entry.bucket.rrule,
              label: entry.label ?? "recurring",
              occurrences: entry.occurrences,
              upcoming: entry.upcoming,
            }
          : undefined,
      watchHits: watchHits.length ? watchHits : undefined,
    });
  }

  return out;
}

// ----- ranking -------------------------------------------------------------

/**
 * The default ordering.
 *
 * This used to be `obscurity x confidence`, which was mathematically backwards:
 * confidence RISES with corroboration and obscurity FALLS with it, so the
 * product peaked in the middle and pushed the single-source local find — the
 * entire point of the app — away from the top. It also double-counted
 * corroboration, which had already moved obscurity down.
 *
 * Confidence is now a GATE, not a multiplier: below the floor an event cannot
 * lead regardless of how obscure it is, and above the floor it stops mattering
 * and obscurity decides. A watchlist match reorders within a tier rather than
 * jumping the whole list.
 */
export const CONFIDENCE_FLOOR = 0.45;

export function forYouScore(e: FnoEvent): number {
  // Below the floor it still appears, but beneath everything that cleared it.
  const gated = e.confidence >= CONFIDENCE_FLOOR ? 1 : 0;
  const base = e.obscurity / 100;
  // Scaled by confidence and capped well under the obscurity range, so a
  // followed name promotes an event among its peers instead of over everything.
  const watch = e.watchHits?.length ? 0.2 * e.confidence : 0;
  // No imminence bonus: the view is already grouped into time buckets and has
  // an explicit "Soonest" sort, so a third recency term only dragged tonight's
  // filler above a genuinely interesting show next week.
  return gated * 10 + base + watch;
}

export function sortEvents(events: FnoEvent[], mode: SortMode): FnoEvent[] {
  const byDate = (a: FnoEvent, b: FnoEvent) =>
    new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  const list = [...events];

  switch (mode) {
    case "hidden":
      // Confidence still gates the list; it just stops driving the order.
      return list.sort(
        (a, b) => b.obscurity - a.obscurity || b.confidence - a.confidence || byDate(a, b),
      );
    case "soon":
      return list.sort(byDate);
    case "near":
      return list.sort(
        (a, b) => (a.distanceMi ?? 1e6) - (b.distanceMi ?? 1e6) || byDate(a, b),
      );
    case "cheap": {
      const cost = (e: FnoEvent) =>
        e.price.tier === "free" ? 0
        : e.price.tier === "donation" ? 0.5
        : e.price.min ?? (e.price.tier === "unknown" ? 1e5 : 1e4);
      return list.sort((a, b) => cost(a) - cost(b) || byDate(a, b));
    }
    case "for-you":
    default:
      return list.sort((a, b) => forYouScore(b) - forYouScore(a) || byDate(a, b));
  }
}

function dayKey(iso: string, offsetDays = 0): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
