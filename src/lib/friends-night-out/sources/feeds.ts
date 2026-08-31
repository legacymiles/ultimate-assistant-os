// ---------------------------------------------------------------------------
// Calendar feed adapter — the hidden-gem engine.
//
// Ticketmaster tells you what a promoter paid to advertise. This file tells you
// what the library, the parish, the parks department, the brewery and the
// university are doing, which is where the events nobody hears about actually
// live. All of it is public, keyless and legal.
//
// Five formats, in descending order of how much we trust their dates:
//
//   tribe     The Events Calendar's WP REST API — real ISO dates, real venues.
//             Bundled free with the plugin, so it is on a huge number of
//             small-venue, church and nonprofit sites.
//   localist  University and civic calendars. Public keyless JSON.
//   ical      Anything publishing .ics, including recurrence rules.
//   jsonld    schema.org Event blocks embedded in an ordinary web page.
//   rss       Last resort. RSS has no date field for when an event HAPPENS —
//             pubDate is when the post was written — so the start time has to
//             be read out of the text, and that is why it ranks last.
// ---------------------------------------------------------------------------

import { inferPrice } from "../normalize";
import type { Feed, FeedKind, RawEvent, SearchCtx, SourceStatus } from "../types";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 4_000_000;

export function feedsStatus(feeds: SearchCtx["feeds"]): SourceStatus {
  const count = feeds?.length ?? 0;
  return {
    id: "feed",
    label: "Community calendars",
    ok: count > 0,
    reason:
      count > 0
        ? undefined
        : "No calendars yet — run Find calendars near me, or add one by URL",
  };
}

export async function fetchFeeds(ctx: SearchCtx): Promise<{
  events: RawEvent[];
  errors: { id: string; label: string; error: string }[];
}> {
  const feeds = ctx.feeds ?? [];
  const errors: { id: string; label: string; error: string }[] = [];

  // One slow or hanging feed must never hold up the other twenty.
  const results = await Promise.allSettled(
    feeds.map((f) => fetchOneFeed(f, ctx)),
  );

  const events: RawEvent[] = [];
  results.forEach((r, i) => {
    const feed = feeds[i];
    if (r.status === "fulfilled") {
      events.push(...r.value);
    } else {
      errors.push({
        id: feed.id,
        label: feed.label,
        error: r.reason instanceof Error ? r.reason.message : "Fetch failed",
      });
    }
  });

  return { events, errors };
}

export async function fetchOneFeed(
  feed: Pick<Feed, "id" | "label" | "url" | "kind">,
  ctx: SearchCtx,
): Promise<RawEvent[]> {
  const { body, contentType } = await getText(feed.url);
  const kind = feed.kind === "auto" ? sniffKind(feed.url, contentType, body) : feed.kind;

  switch (kind) {
    case "tribe":
      return parseTribe(body, feed.label, feed.url);
    case "localist":
      return parseLocalist(body, feed.label, feed.url);
    case "ical":
      return parseIcal(body, feed.label, feed.url, ctx);
    case "jsonld":
      return parseJsonLd(body, feed.label, feed.url);
    case "rss":
      return parseRss(body, feed.label, feed.url);
    default:
      return [];
  }
}

// ----- fetching ------------------------------------------------------------

async function getText(url: string): Promise<{ body: string; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept:
          "application/json, text/calendar, application/rss+xml, application/xml, text/html;q=0.9",
        "User-Agent": "FriendsNightOut/1.0 (personal event finder)",
      },
      next: { revalidate: 1800 },
    });
    if (!res.ok) throw new Error(`Returned ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    const body = await res.text();
    if (body.length > MAX_BYTES) {
      // A city-wide .ics can be enormous. Truncating mid-record is safe: the
      // parsers are block-based and simply drop the incomplete tail.
      return { body: body.slice(0, MAX_BYTES), contentType };
    }
    return { body, contentType };
  } finally {
    clearTimeout(timer);
  }
}

export function sniffKind(url: string, contentType: string, body: string): FeedKind {
  if (/wp-json\/tribe\/events/i.test(url)) return "tribe";
  if (/\/api\/2\/events/i.test(url)) return "localist";
  if (/text\/calendar/i.test(contentType) || /^BEGIN:VCALENDAR/m.test(body)) return "ical";
  if (/\.ics(\?|$)/i.test(url)) return "ical";
  if (/json/i.test(contentType) && /"start_date"|"start"/.test(body.slice(0, 4000))) {
    return /"events"\s*:/.test(body.slice(0, 4000)) && /"venue"/.test(body.slice(0, 8000))
      ? "tribe"
      : "localist";
  }
  if (/<rss|<feed[\s>]|<channel>/i.test(body.slice(0, 2000))) return "rss";
  if (/application\/ld\+json/i.test(body)) return "jsonld";
  return "rss";
}

// ----- The Events Calendar (WordPress) -------------------------------------

interface TribeEvent {
  title?: string;
  description?: string;
  excerpt?: string;
  url?: string;
  start_date?: string;
  end_date?: string;
  all_day?: boolean;
  cost?: string;
  image?: { url?: string } | false;
  venue?: {
    venue?: string;
    address?: string;
    city?: string;
    state?: string;
    geo_lat?: number | string;
    geo_lng?: number | string;
  };
  organizer?: { organizer?: string }[];
}

function parseTribe(body: string, label: string, feedUrl: string): RawEvent[] {
  const data = safeJson<{ events?: TribeEvent[] }>(body);
  if (!data?.events) return [];

  return data.events.flatMap((ev) => {
    const title = strip(ev.title);
    if (!title || !ev.start_date) return [];
    // Tribe returns "2026-09-04 19:00:00" in the site's local timezone with no
    // offset. Treating that as UTC shifts every event by hours, so it is parsed
    // as local time deliberately.
    const startsAt = parseLocalish(ev.start_date);
    if (!startsAt) return [];

    const lat = Number(ev.venue?.geo_lat);
    const lon = Number(ev.venue?.geo_lng);
    const description = strip(ev.description || ev.excerpt);

    return [{
      title,
      description,
      startsAt,
      endsAt: ev.end_date ? parseLocalish(ev.end_date) ?? undefined : undefined,
      allDay: Boolean(ev.all_day),
      venue: {
        name: ev.venue?.venue?.trim() || label,
        address: [ev.venue?.address, ev.venue?.city, ev.venue?.state]
          .filter(Boolean).join(", ") || undefined,
        lat: Number.isFinite(lat) && lat !== 0 ? lat : undefined,
        lon: Number.isFinite(lon) && lon !== 0 ? lon : undefined,
      },
      price: ev.cost ? inferPrice(ev.cost) : inferPrice(description),
      url: ev.url,
      imageUrl: typeof ev.image === "object" && ev.image ? ev.image.url : undefined,
      actors: (ev.organizer ?? []).map((o) => o.organizer).filter(Boolean) as string[],
      verifyUrl: ev.url,
      source: { id: "feed", label, url: ev.url ?? feedUrl },
    }];
  });
}

// ----- Localist ------------------------------------------------------------

interface LocalistItem {
  event?: {
    title?: string;
    description_text?: string;
    description?: string;
    localist_url?: string;
    photo_url?: string;
    free?: boolean;
    ticket_cost?: string;
    event_instances?: { event_instance?: { start?: string; end?: string; all_day?: boolean } }[];
    geo?: { latitude?: string; longitude?: string };
    location_name?: string;
    address?: string;
  };
}

function parseLocalist(body: string, label: string, feedUrl: string): RawEvent[] {
  const data = safeJson<{ events?: LocalistItem[] }>(body);
  if (!data?.events) return [];

  return data.events.flatMap((wrapper) => {
    const ev = wrapper.event;
    const title = strip(ev?.title);
    if (!ev || !title) return [];

    const lat = Number(ev.geo?.latitude);
    const lon = Number(ev.geo?.longitude);
    const description = strip(ev.description_text || ev.description);

    // Localist nests every occurrence of a recurring event. Emitting all of
    // them lets the series collapser see the real cadence rather than guessing
    // from one instance.
    const instances = ev.event_instances ?? [];
    return instances.flatMap((wrap) => {
      const inst = wrap.event_instance;
      if (!inst?.start) return [];
      return [{
        title,
        description,
        startsAt: new Date(inst.start).toISOString(),
        endsAt: inst.end ? new Date(inst.end).toISOString() : undefined,
        allDay: Boolean(inst.all_day),
        venue: {
          name: ev.location_name?.trim() || label,
          address: ev.address?.trim() || undefined,
          lat: Number.isFinite(lat) ? lat : undefined,
          lon: Number.isFinite(lon) ? lon : undefined,
        },
        price: ev.free
          ? { tier: "free" as const, note: "Free" }
          : inferPrice(ev.ticket_cost || description),
        url: ev.localist_url,
        imageUrl: ev.photo_url,
        verifyUrl: ev.localist_url,
        source: { id: "feed" as const, label, url: ev.localist_url ?? feedUrl },
      }];
    });
  });
}

// ----- iCal ----------------------------------------------------------------

/**
 * Minimal iCal parse: unfold, split VEVENTs, read the fields we use.
 *
 * Deliberately not a full RFC 5545 implementation. Recurrence is expanded for
 * the three FREQ values that cover essentially every community calendar
 * (DAILY, WEEKLY, MONTHLY) and capped, because the point of expanding at all is
 * to let the series collapser see the cadence — not to render a year of
 * instances the user will never scroll to.
 */
function parseIcal(body: string, label: string, feedUrl: string, ctx: SearchCtx): RawEvent[] {
  // RFC 5545 folds long lines with a leading space or tab on the continuation.
  const unfolded = body.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const blocks = unfolded.split(/BEGIN:VEVENT/i).slice(1);
  const windowEnd = new Date(ctx.to).getTime();
  const out: RawEvent[] = [];

  for (const block of blocks) {
    const body2 = block.split(/END:VEVENT/i)[0];
    const title = strip(icalField(body2, "SUMMARY"));
    const dtstart = icalRawField(body2, "DTSTART");
    if (!title || !dtstart) continue;

    const start = parseIcalDate(dtstart.value, dtstart.params);
    if (!start) continue;

    const dtend = icalRawField(body2, "DTEND");
    const end = dtend ? parseIcalDate(dtend.value, dtend.params) : null;
    const allDay = /VALUE=DATE(?!-TIME)/i.test(dtstart.params);
    const description = strip(icalField(body2, "DESCRIPTION"));
    const location = strip(icalField(body2, "LOCATION"));
    const url = icalField(body2, "URL")?.trim();
    const uidValue = icalField(body2, "UID")?.trim();
    const rrule = icalField(body2, "RRULE")?.trim();
    const geo = icalField(body2, "GEO");
    const [gLat, gLon] = (geo ?? "").split(";").map(Number);

    const base: RawEvent = {
      title,
      description,
      startsAt: start,
      endsAt: end ?? undefined,
      allDay,
      venue: {
        name: location || label,
        address: location || undefined,
        lat: Number.isFinite(gLat) ? gLat : undefined,
        lon: Number.isFinite(gLon) ? gLon : undefined,
      },
      price: inferPrice(`${title} ${description ?? ""}`),
      url,
      uid: uidValue,
      rrule,
      verifyUrl: url,
      source: { id: "feed", label, url: url ?? feedUrl },
    };

    out.push(base);
    if (rrule) {
      for (const occurrence of expandRrule(start, rrule, windowEnd)) {
        out.push({ ...base, startsAt: occurrence });
      }
    }
  }

  return out;
}

function icalField(block: string, name: string): string | undefined {
  return icalRawField(block, name)?.value;
}

function icalRawField(
  block: string,
  name: string,
): { params: string; value: string } | undefined {
  const re = new RegExp(`^${name}((?:;[^:\\n]*)?):(.*)$`, "im");
  const m = block.match(re);
  if (!m) return undefined;
  return {
    params: m[1] ?? "",
    // iCal escapes commas, semicolons and newlines inside TEXT values.
    value: m[2]
      .replace(/\\n/gi, " ")
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";")
      .replace(/\\\\/g, "\\")
      .trim(),
  };
}

function parseIcalDate(value: string, params: string): string | null {
  const v = value.trim();
  // 20260904T190000Z, 20260904T190000, or 20260904 for an all-day entry.
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) {
    const parsed = new Date(v);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const [, y, mo, d, h = "00", mi = "00", s = "00", z] = m;
  if (z || /TZID=UTC/i.test(params)) {
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString();
  }
  // No timezone marker: treat as local. A floating time is meant to be read in
  // the reader's own zone, and for a local event finder that is correct.
  return new Date(+y, +mo - 1, +d, +h, +mi, +s).toISOString();
}

/** Cap so one badly-specified INTERVAL cannot flood the whole result set. */
const MAX_OCCURRENCES = 12;

function expandRrule(start: string, rrule: string, windowEnd: number): string[] {
  const parts = Object.fromEntries(
    rrule.split(";").map((p) => {
      const [k, v] = p.split("=");
      return [k?.toUpperCase(), v];
    }),
  ) as Record<string, string | undefined>;

  const freq = parts.FREQ?.toUpperCase();
  if (!freq || !["DAILY", "WEEKLY", "MONTHLY"].includes(freq)) return [];

  const interval = Math.max(1, Number(parts.INTERVAL ?? 1) || 1);
  const count = parts.COUNT ? Number(parts.COUNT) : undefined;
  const until = parts.UNTIL ? parseIcalDate(parts.UNTIL, "") : null;
  const untilMs = until ? new Date(until).getTime() : Infinity;
  const stop = Math.min(windowEnd, untilMs);

  const out: string[] = [];
  const cursor = new Date(start);
  for (let i = 1; i < (count ?? Infinity) && out.length < MAX_OCCURRENCES; i++) {
    if (freq === "DAILY") cursor.setDate(cursor.getDate() + interval);
    else if (freq === "WEEKLY") cursor.setDate(cursor.getDate() + 7 * interval);
    else cursor.setMonth(cursor.getMonth() + interval);

    if (cursor.getTime() > stop) break;
    out.push(cursor.toISOString());
  }
  return out;
}

// ----- JSON-LD -------------------------------------------------------------

interface LdEvent {
  "@type"?: string | string[];
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  image?: string | string[] | { url?: string };
  location?: {
    name?: string;
    address?: string | { streetAddress?: string; addressLocality?: string; addressRegion?: string };
    geo?: { latitude?: number | string; longitude?: number | string };
  };
  offers?: { price?: number | string; lowPrice?: number | string; highPrice?: number | string; priceCurrency?: string } | { price?: number | string }[];
  performer?: { name?: string } | { name?: string }[];
}

function parseJsonLd(body: string, label: string, feedUrl: string): RawEvent[] {
  const blocks = [...body.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )].map((m) => m[1]);

  const found: LdEvent[] = [];
  for (const block of blocks) {
    const parsed = safeJson<unknown>(block);
    if (parsed) collectEvents(parsed, found);
  }

  return found.flatMap((ev) => {
    const title = strip(ev.name);
    if (!title || !ev.startDate) return [];
    const start = new Date(ev.startDate);
    if (Number.isNaN(start.getTime())) return [];

    const lat = Number(ev.location?.geo?.latitude);
    const lon = Number(ev.location?.geo?.longitude);
    const address =
      typeof ev.location?.address === "string"
        ? ev.location.address
        : [
            ev.location?.address?.streetAddress,
            ev.location?.address?.addressLocality,
            ev.location?.address?.addressRegion,
          ].filter(Boolean).join(", ") || undefined;

    const performers = Array.isArray(ev.performer) ? ev.performer : ev.performer ? [ev.performer] : [];

    return [{
      title,
      description: strip(ev.description),
      startsAt: start.toISOString(),
      endsAt: ev.endDate && !Number.isNaN(new Date(ev.endDate).getTime())
        ? new Date(ev.endDate).toISOString() : undefined,
      allDay: false,
      venue: {
        name: ev.location?.name?.trim() || label,
        address,
        lat: Number.isFinite(lat) ? lat : undefined,
        lon: Number.isFinite(lon) ? lon : undefined,
      },
      price: ldPrice(ev),
      url: ev.url ?? feedUrl,
      imageUrl: ldImage(ev.image),
      actors: performers.map((p) => p.name).filter(Boolean) as string[],
      verifyUrl: ev.url ?? feedUrl,
      source: { id: "feed" as const, label, url: ev.url ?? feedUrl },
    }];
  });
}

/** JSON-LD nests events under @graph, arrays, and sub-properties. Walk it all. */
function collectEvents(node: unknown, out: LdEvent[], depth = 0): void {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) {
    for (const n of node) collectEvents(n, out, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === "string" && /Event$/i.test(t))) {
    out.push(obj as LdEvent);
  }
  if (obj["@graph"]) collectEvents(obj["@graph"], out, depth + 1);
  if (obj.itemListElement) collectEvents(obj.itemListElement, out, depth + 1);
  if (obj.item) collectEvents(obj.item, out, depth + 1);
}

function ldPrice(ev: LdEvent): RawEvent["price"] {
  const offers = Array.isArray(ev.offers) ? ev.offers[0] : ev.offers;
  if (!offers) return inferPrice(`${ev.name ?? ""} ${ev.description ?? ""}`);
  const single = Number(offers.price);
  const low = Number((offers as { lowPrice?: number | string }).lowPrice);
  const high = Number((offers as { highPrice?: number | string }).highPrice);
  const min = Number.isFinite(single) ? single : Number.isFinite(low) ? low : undefined;
  const max = Number.isFinite(high) ? high : min;
  if (min === undefined) return { tier: "unknown" };
  if (min === 0 && (max ?? 0) === 0) return { tier: "free", note: "Free" };
  return { tier: "paid", min, max };
}

function ldImage(image: LdEvent["image"]): string | undefined {
  if (!image) return undefined;
  if (typeof image === "string") return image;
  if (Array.isArray(image)) return typeof image[0] === "string" ? image[0] : undefined;
  return image.url;
}

// ----- RSS -----------------------------------------------------------------

/**
 * RSS has no field for when an event happens — `pubDate` is when the post was
 * written. So the start time has to be recovered from the text, and anything
 * without a recoverable date is dropped rather than filed under the publish
 * date, which would scatter events across the wrong days.
 */
function parseRss(body: string, label: string, feedUrl: string): RawEvent[] {
  const items = [
    ...body.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi),
    ...body.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi),
  ].map((m) => m[1]);

  const out: RawEvent[] = [];
  for (const item of items) {
    const title = strip(decodeXml(tag(item, "title")));
    if (!title) continue;
    const description = strip(decodeXml(
      tag(item, "description") ?? tag(item, "summary") ?? tag(item, "content"),
    ));
    const link = tag(item, "link") ?? attr(item, "link", "href");

    // Some event plugins publish a real start date in a namespaced element.
    const explicit =
      tag(item, "ev:startdate") ?? tag(item, "start_date") ?? tag(item, "dc:date");
    const startsAt = explicit
      ? isoOrNull(explicit)
      : guessDateFromText(`${title} ${description ?? ""}`);
    if (!startsAt) continue;

    out.push({
      title,
      description,
      startsAt,
      allDay: false,
      venue: { name: label },
      price: inferPrice(`${title} ${description ?? ""}`),
      url: link?.trim(),
      verifyUrl: link?.trim(),
      source: { id: "feed", label, url: link?.trim() ?? feedUrl },
    });
  }
  return out;
}

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

/**
 * Pull a date out of prose. Handles "September 4", "Sep 4, 2026" and
 * "2026-09-04", optionally followed by a time.
 *
 * A year-less date is assumed to be the next occurrence, which is right for a
 * calendar listing: "September 4" published in October means next September.
 */
function guessDateFromText(text: string): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const time = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);

  let base: Date | null = null;
  if (iso) {
    base = new Date(+iso[1], +iso[2] - 1, +iso[3]);
  } else {
    const m = text.match(new RegExp(`\\b(${MONTHS})\\.?\\s+(\\d{1,2})(?:\\s*,\\s*(\\d{4}))?\\b`, "i"));
    if (!m) return null;
    const month = new Date(`${m[1]} 1, 2000`).getMonth();
    if (Number.isNaN(month)) return null;
    const now = new Date();
    const year = m[3] ? +m[3] : now.getFullYear();
    base = new Date(year, month, +m[2]);
    if (!m[3] && base.getTime() < now.getTime() - 86_400_000) {
      base.setFullYear(year + 1);
    }
  }

  if (time) {
    let hour = +time[1] % 12;
    if (/pm/i.test(time[3])) hour += 12;
    base.setHours(hour, time[2] ? +time[2] : 0, 0, 0);
  } else {
    // No time given: 7pm reads as an evening event rather than sorting to
    // midnight, where a grouped list would show it under the wrong heading.
    base.setHours(19, 0, 0, 0);
  }
  return Number.isNaN(base.getTime()) ? null : base.toISOString();
}

// ----- shared helpers ------------------------------------------------------

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return undefined;
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function attr(xml: string, name: string, attribute: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}[^>]*\\b${attribute}=["']([^"']+)["']`, "i"));
  return m?.[1];
}

function decodeXml(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

/** Strip tags and collapse whitespace; feed descriptions are usually HTML. */
function strip(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const clean = s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return clean.length ? clean.slice(0, 800) : undefined;
}

function safeJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isoOrNull(value: string): string | null {
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "2026-09-04 19:00:00" with no offset — parse as local, never as UTC. */
function parseLocalish(value: string): string | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)).toISOString();
  }
  return isoOrNull(value);
}
