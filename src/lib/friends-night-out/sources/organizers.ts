// ---------------------------------------------------------------------------
// Organizer subscriptions.
//
// Eventbrite's public event SEARCH was removed in February 2020, which is why
// this app cannot ask "what's on near me" there. What survived is lookup by
// organizer and by venue — and in a mid-size metro that covers a large share of
// the genuinely small stuff: bar trivia, run clubs, maker markets, comedy open
// mics, one-person promoters. Leaving it out entirely, as the first draft of
// this app did, drops the single largest pool of low-visibility ticketed events
// on the floor.
//
// The trick that makes it usable without a search endpoint: you never type an
// organizer in. Paste ONE event link into the Inbox and the app extracts the
// organizer behind it and subscribes to their whole future calendar,
// permanently. One paste becomes a standing feed.
//
// The same idea covers any platform that publishes a calendar .ics — Luma
// calendars in particular — which is why `ical` is a platform here rather than
// being folded into the feed registry: these are followed publishers, not
// places, and they arrive by paste rather than by discovery.
// ---------------------------------------------------------------------------

import type { OrganizerSub, RawEvent, SearchCtx, SourceStatus } from "../types";
import { fetchOneFeed } from "./feeds";
import { inferPrice } from "../normalize";

const EB_API = "https://www.eventbriteapi.com/v3";

export function organizersStatus(ctx: SearchCtx): SourceStatus {
  const subs = ctx.organizers ?? [];
  const needsToken = subs.some((s) => s.platform === "eventbrite");
  const hasToken = Boolean(process.env.EVENTBRITE_TOKEN);

  if (!subs.length) {
    return {
      id: "feed",
      label: "Followed organizers",
      ok: false,
      reason: "Paste an Eventbrite or Luma link in the Inbox to follow its organizer",
    };
  }
  if (needsToken && !hasToken) {
    return {
      id: "feed",
      label: "Followed organizers",
      ok: false,
      reason: "Add EVENTBRITE_TOKEN — the private token is free in your Eventbrite account",
    };
  }
  return { id: "feed", label: "Followed organizers", ok: true };
}

export async function fetchOrganizers(ctx: SearchCtx): Promise<{
  events: RawEvent[];
  errors: { id: string; label: string; error: string }[];
}> {
  const subs = ctx.organizers ?? [];
  const errors: { id: string; label: string; error: string }[] = [];

  const results = await Promise.allSettled(
    subs.map((sub) => fetchOneOrganizer(sub, ctx)),
  );

  const events: RawEvent[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") events.push(...r.value);
    else {
      errors.push({
        id: subs[i].id,
        label: subs[i].label,
        error: r.reason instanceof Error ? r.reason.message : "Fetch failed",
      });
    }
  });
  return { events, errors };
}

async function fetchOneOrganizer(
  sub: OrganizerSub,
  ctx: SearchCtx,
): Promise<RawEvent[]> {
  if (sub.platform === "ical" || sub.platform === "luma") {
    // Luma publishes a plain .ics per calendar, so it needs no special casing
    // beyond storing the URL — the iCal parser already handles the rest.
    return fetchOneFeed(
      { id: sub.id, label: sub.label, url: sub.externalId, kind: "ical" },
      ctx,
    );
  }
  return fetchEventbriteOrganizer(sub, ctx);
}

// ----- Eventbrite ----------------------------------------------------------

interface EbEvent {
  id?: string;
  name?: { text?: string };
  description?: { text?: string };
  url?: string;
  start?: { utc?: string; local?: string };
  end?: { utc?: string };
  is_free?: boolean;
  logo?: { url?: string };
  venue?: {
    name?: string;
    address?: {
      localized_address_display?: string;
      latitude?: string;
      longitude?: string;
    };
  };
  ticket_availability?: {
    minimum_ticket_price?: { major_value?: string };
    maximum_ticket_price?: { major_value?: string };
  };
}

async function fetchEventbriteOrganizer(
  sub: OrganizerSub,
  ctx: SearchCtx,
): Promise<RawEvent[]> {
  const token = process.env.EVENTBRITE_TOKEN;
  if (!token) return [];

  const url = new URL(`${EB_API}/organizations/${sub.externalId}/events/`);
  url.searchParams.set("status", "live");
  url.searchParams.set("order_by", "start_asc");
  url.searchParams.set("expand", "venue,ticket_availability");
  url.searchParams.set("start_date.range_start", `${ctx.from.slice(0, 19)}Z`);
  url.searchParams.set("start_date.range_end", `${ctx.to.slice(0, 19)}Z`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    next: { revalidate: 1800 },
  });
  if (res.status === 401) throw new Error("Eventbrite rejected the token.");
  if (res.status === 404) throw new Error("That Eventbrite organizer no longer exists.");
  if (!res.ok) throw new Error(`Eventbrite returned ${res.status}`);

  const data = (await res.json()) as { events?: EbEvent[] };
  return (data.events ?? []).flatMap((ev) => {
    const title = ev.name?.text?.trim();
    const start = ev.start?.utc ?? ev.start?.local;
    if (!title || !start) return [];

    const lat = Number(ev.venue?.address?.latitude);
    const lon = Number(ev.venue?.address?.longitude);
    const min = Number(ev.ticket_availability?.minimum_ticket_price?.major_value);
    const max = Number(ev.ticket_availability?.maximum_ticket_price?.major_value);

    const price = ev.is_free
      ? { tier: "free" as const, note: "Free" }
      : Number.isFinite(min)
        ? { tier: "paid" as const, min, max: Number.isFinite(max) ? max : min }
        : inferPrice(ev.description?.text);

    return [{
      title,
      description: ev.description?.text?.trim().slice(0, 800),
      startsAt: new Date(start).toISOString(),
      endsAt: ev.end?.utc ? new Date(ev.end.utc).toISOString() : undefined,
      allDay: false,
      venue: {
        name: ev.venue?.name?.trim() || sub.label,
        address: ev.venue?.address?.localized_address_display,
        lat: Number.isFinite(lat) ? lat : undefined,
        lon: Number.isFinite(lon) ? lon : undefined,
      },
      price,
      url: ev.url,
      imageUrl: ev.logo?.url,
      uid: ev.id ? `eventbrite:${ev.id}` : undefined,
      actors: [sub.label],
      // Deliberately filed as `feed`, not a source of its own: for the obscurity
      // score a followed small promoter behaves like a community calendar, not
      // like a mass-market ticketing platform.
      source: { id: "feed" as const, label: sub.label, url: ev.url, externalId: ev.id },
    }];
  });
}

// ----- turning a pasted link into a subscription ---------------------------

/** Luma paths that are site chrome rather than someone's calendar. */
const LUMA_RESERVED = new Set([
  "discover", "home", "explore", "pricing", "signin", "sign-in", "login",
  "about", "terms", "privacy", "new", "create", "help", "blog", "settings",
  "calendar", "event", "u", "s", "api", "docs",
]);

export interface OrganizerHint {
  platform: OrganizerSub["platform"];
  externalId: string;
  label: string;
}

/**
 * Recognise a followable publisher behind a pasted URL.
 *
 * Eventbrite embeds the organizer id in the page rather than the URL, so the
 * caller fetches the page and passes the body in. Luma exposes a calendar slug
 * in the path and serves an .ics for it directly.
 */
export function organizerFromUrl(
  rawUrl: string,
  body?: string,
): OrganizerHint | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");

  if (host.endsWith("eventbrite.com") || host.endsWith("eventbrite.co.uk")) {
    // Only a real event or organizer page identifies a publisher. Eventbrite's
    // own search and discovery pages (/d/..., /b/...) embed Eventbrite's
    // corporate organizer id, so parsing those would silently subscribe the
    // user to Eventbrite itself.
    if (!/^\/(e|o|organizations)\//.test(url.pathname)) return null;
    // The organizer id appears in the page as JSON — several shapes over the
    // years, so try the ones still in circulation.
    const m =
      body?.match(/"organizer_id"\s*:\s*"?(\d{6,})"?/) ??
      body?.match(/organizations\/(\d{6,})/) ??
      body?.match(/"organizerId"\s*:\s*"?(\d{6,})"?/);
    if (!m) return null;
    const nameMatch =
      body?.match(/"organizer"\s*:\s*{[^}]*"name"\s*:\s*"([^"]{2,80})"/) ??
      body?.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
    return {
      platform: "eventbrite",
      externalId: m[1],
      label: nameMatch?.[1]?.trim() || "Eventbrite organizer",
    };
  }

  if (host === "lu.ma" || host.endsWith(".lu.ma")) {
    // lu.ma/<slug> for a calendar, lu.ma/<eventcode> for one event. Only a
    // calendar is followable; an event code yields a one-shot .ics that would
    // go stale, so it is left to the normal Inbox path.
    const slug = url.pathname.replace(/^\//, "").split("/")[0];
    if (!slug || slug.length < 3) return null;
    // Luma's own site sections are not calendars; lu.ma/discover/ics is a 404
    // waiting to be added as a permanently-broken subscription.
    if (LUMA_RESERVED.has(slug.toLowerCase())) return null;
    return {
      platform: "luma",
      externalId: `https://lu.ma/${slug}/ics`,
      label: `lu.ma/${slug}`,
    };
  }

  return null;
}
