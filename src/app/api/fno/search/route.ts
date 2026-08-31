import { NextResponse } from "next/server";
import { normalizeEvents } from "@/lib/friends-night-out/normalize";
import { fetchAiSweep, aiSweepStatus } from "@/lib/friends-night-out/sources/aiSweep";
import { fetchFeeds, feedsStatus } from "@/lib/friends-night-out/sources/feeds";
import { fetchOrganizers, organizersStatus } from "@/lib/friends-night-out/sources/organizers";
import {
  fetchTicketmaster,
  ticketmasterStatus,
} from "@/lib/friends-night-out/sources/ticketmaster";
import type {
  RawEvent,
  SearchCtx,
  SearchResponse,
  SourceStatus,
  WatchItem,
} from "@/lib/friends-night-out/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// POST /api/fno/search
//
// Runs every configured adapter in parallel, merges the results and scores
// them. The contract that matters: ONE ADAPTER FAILING NEVER FAILS THE SEARCH.
// A Ticketmaster outage or a dead parish calendar returns partial results with
// that source marked broken, because a thin list the user can understand beats
// an error page.
// ---------------------------------------------------------------------------

interface Body extends Omit<SearchCtx, "from" | "to"> {
  from?: string;
  to?: string;
  placeLabel?: string;
  watchlist?: WatchItem[];
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!Number.isFinite(body.lat) || !Number.isFinite(body.lon)) {
    return NextResponse.json({ error: "lat and lon are required" }, { status: 400 });
  }

  const now = new Date();
  const ctx: SearchCtx = {
    lat: body.lat,
    lon: body.lon,
    radiusMi: clamp(body.radiusMi ?? 25, 1, 200),
    from: body.from ?? now.toISOString(),
    // Ninety days is the horizon where community calendars still have content;
    // past that, everything is arena tours and the list stops being useful.
    to: body.to ?? new Date(now.getTime() + 90 * 86_400_000).toISOString(),
    feeds: body.feeds ?? [],
    organizers: body.organizers ?? [],
    skipAiSweep: body.skipAiSweep,
  };

  const statuses: SourceStatus[] = [];
  const raw: RawEvent[] = [];

  const [tm, feeds, orgs, sweep] = await Promise.allSettled([
    ticketmasterStatus().ok ? fetchTicketmaster(ctx) : Promise.resolve([]),
    fetchFeeds(ctx),
    organizersStatus(ctx).ok ? fetchOrganizers(ctx) : Promise.resolve({ events: [], errors: [] }),
    aiSweepStatus(ctx).ok
      ? fetchAiSweep(ctx, body.placeLabel ?? `${body.lat.toFixed(3)}, ${body.lon.toFixed(3)}`)
      : Promise.resolve([]),
  ]);

  // ----- Ticketmaster -----
  const tmStatus = ticketmasterStatus();
  if (tm.status === "fulfilled") {
    raw.push(...tm.value);
    statuses.push({ ...tmStatus, count: tm.value.length });
  } else {
    statuses.push({ ...tmStatus, ok: false, error: errorText(tm.reason) });
  }

  // ----- community calendars -----
  const feedStatus = feedsStatus(ctx.feeds);
  if (feeds.status === "fulfilled") {
    raw.push(...feeds.value.events);
    statuses.push({
      ...feedStatus,
      count: feeds.value.events.length,
      // Name the specific dead feeds rather than a generic failure: a calendar
      // that silently stopped publishing is invisible otherwise.
      error: feeds.value.errors.length
        ? feeds.value.errors.map((e) => `${e.label}: ${e.error}`).join("; ")
        : undefined,
    });
  } else {
    statuses.push({ ...feedStatus, ok: false, error: errorText(feeds.reason) });
  }

  // ----- followed organizers -----
  const orgStatus = organizersStatus(ctx);
  if (orgs.status === "fulfilled") {
    raw.push(...orgs.value.events);
    statuses.push({
      ...orgStatus,
      count: orgs.value.events.length,
      error: orgs.value.errors.length
        ? orgs.value.errors.map((e) => `${e.label}: ${e.error}`).join("; ")
        : undefined,
    });
  } else {
    statuses.push({ ...orgStatus, ok: false, error: errorText(orgs.reason) });
  }

  // ----- AI sweep -----
  const sweepStatus = aiSweepStatus(ctx);
  if (sweep.status === "fulfilled") {
    raw.push(...sweep.value);
    statuses.push({ ...sweepStatus, count: sweep.value.length });
  } else {
    statuses.push({ ...sweepStatus, ok: false, error: errorText(sweep.reason) });
  }

  const events = normalizeEvents(raw, {
    origin: { lat: ctx.lat, lon: ctx.lon },
    radiusMi: ctx.radiusMi,
    watchlist: body.watchlist,
  });

  const payload: SearchResponse = {
    events,
    sources: statuses,
    searchedAt: new Date().toISOString(),
  };
  return NextResponse.json(payload);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Source failed";
}
