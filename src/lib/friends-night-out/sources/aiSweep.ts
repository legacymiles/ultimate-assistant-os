// ---------------------------------------------------------------------------
// AI discovery sweep.
//
// This is the app's answer to "search Instagram, TikTok and Facebook" — a
// request that cannot be honoured directly, because none of those platforms has
// a public event-search endpoint and scraping them breaches their terms. What
// IS true is that public Instagram and Facebook event pages, community forum
// threads and small-venue announcements are indexed by search engines. So the
// sweep asks a model with web access what is happening in the area, and takes
// back structured events.
//
// The critical rule, and the reason this file is longer than it looks: a model
// saying an event exists is not evidence that it does. Every returned event
// must carry a URL, and every URL is fetched and checked server-side before the
// event is allowed through. Unverifiable results are dropped, not down-ranked.
// Without that gate the least reliable pipeline in the app would be feeding its
// most prominent surface, because single-source finds score highest on
// obscurity by construction.
// ---------------------------------------------------------------------------

import { inferPrice } from "../normalize";
import { DEFAULT_MODEL, aiKey, aiUrl } from "@/lib/ai/provider";
import type { RawEvent, SearchCtx, SourceStatus } from "../types";

const GATEWAY = aiUrl();
const VERIFY_TIMEOUT_MS = 7_000;
const MAX_EVENTS = 25;

export function aiSweepStatus(ctx?: SearchCtx): SourceStatus {
  const hasKey = Boolean(aiKey());
  if (!hasKey) {
    return {
      id: "ai-sweep",
      label: "AI sweep",
      ok: false,
      reason: "Add AI_GATEWAY_API_KEY to search the open web for local events",
    };
  }
  if (ctx?.skipAiSweep) {
    return { id: "ai-sweep", label: "AI sweep", ok: false, reason: "Turned off in Sources" };
  }
  return { id: "ai-sweep", label: "AI sweep", ok: true };
}

interface SweptEvent {
  title?: string;
  description?: string;
  start?: string;
  venue_name?: string;
  address?: string;
  price_note?: string;
  source_url?: string;
  organizer?: string;
}

export async function fetchAiSweep(
  ctx: SearchCtx,
  placeLabel: string,
): Promise<RawEvent[]> {
  const apiKey = aiKey();
  if (!apiKey || ctx.skipAiSweep) return [];

  const model = process.env.AI_MODEL ?? DEFAULT_MODEL;
  const from = ctx.from.slice(0, 10);
  const to = ctx.to.slice(0, 10);

  const prompt = [
    `Find real, specific events happening near ${placeLabel} between ${from} and ${to}.`,
    `Stay within about ${Math.round(ctx.radiusMi)} miles of ${placeLabel}.`,
    "",
    "Focus HARD on the things that ticketing sites do not list:",
    "- community gatherings, church socials, potlucks, fundraisers",
    "- farmers and makers markets, flea markets, craft fairs",
    "- shows at bars, breweries, record shops, bookstores, house venues",
    "- open mics, poetry nights, trivia, film screenings in odd places",
    "- festivals, parades, block parties, seasonal one-offs",
    "",
    "Do NOT return arena concerts, professional sports or anything on sale",
    "through a major ticketing platform — those are already easy to find.",
    "",
    "RULES, which matter more than volume:",
    "1. Every event MUST include source_url: a real page that states this event,",
    "   its date and its location. If you cannot give a URL, omit the event.",
    "2. Never invent, guess or extrapolate an event. Ten real events beat fifty.",
    "3. start must be ISO 8601 with a time, e.g. 2026-09-04T19:00:00.",
    "4. If you are unsure of the price, leave price_note empty rather than guessing.",
    "",
    'Reply with JSON only: {"events":[{"title","description","start","venue_name",',
    '"address","price_note","source_url","organizer"}]}',
  ].join("\n");

  let payload: { events?: SweptEvent[] };
  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You find real local events and return strict JSON. You never fabricate an event, a date or a URL. Omitting an uncertain event is always correct; inventing one is never acceptable.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });
    if (!res.ok) throw new Error(`AI gateway returned ${res.status}`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    payload = extractJson(data.choices?.[0]?.message?.content ?? "");
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "AI sweep failed",
    );
  }

  const candidates = (payload.events ?? []).slice(0, MAX_EVENTS);

  // Verify in parallel — this is the gate, so it runs on every candidate.
  const verdicts = await Promise.all(
    candidates.map((ev) => verify(ev)),
  );

  const out: RawEvent[] = [];
  candidates.forEach((ev, i) => {
    if (!verdicts[i]) return;
    const built = toRawEvent(ev);
    if (built) out.push(built);
  });
  return out;
}

/**
 * Confirm the cited page exists and actually describes THIS event.
 *
 * A 200 alone is not enough: a model that invents a URL usually invents a
 * plausible one on a real domain, and a soft-404 answers 200 with the homepage.
 *
 * The first version accepted a title word OR the date, and that OR was a hole
 * big enough to drive through — a venue's own /events index page contains both
 * the date and a title word for everything it lists, so a fabricated event
 * citing that index passed. Both must now match, and bare index URLs are
 * rejected outright.
 */
async function verify(ev: SweptEvent): Promise<boolean> {
  const url = ev.source_url?.trim();
  const title = ev.title?.trim();
  if (!url || !title || !ev.start) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (isIndexUrl(url)) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "FriendsNightOut/1.0 (personal event finder; verifying a citation)",
      },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return false;

    const body = (await res.text()).slice(0, 400_000).toLowerCase();

    // Distinctive words only: matching on "the" or "night" would pass anything.
    const words = title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 5);
    const titleMatches = words.length > 0 && words.some((w) => body.includes(w));
    if (!titleMatches) return false;

    const d = new Date(ev.start);
    if (Number.isNaN(d.getTime())) return false;
    const month = d.toLocaleDateString("en-US", { month: "long" }).toLowerCase();
    const shortMonth = d.toLocaleDateString("en-US", { month: "short" }).toLowerCase();
    const day = String(d.getDate());
    const dateMatches =
      body.includes(`${month} ${day}`) ||
      body.includes(`${shortMonth} ${day}`) ||
      body.includes(`${day} ${month}`) ||
      body.includes(d.toISOString().slice(0, 10));

    return dateMatches;
  } catch {
    // A site that times out or blocks us has not verified anything. Drop it.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A listing index is not a citation.
 *
 * A page at /events or /calendar lists everything the venue is doing, so it
 * corroborates any date and any title the model cares to invent. A real
 * citation points at one event: a deeper path, or one carrying a date or a slug.
 */
function isIndexUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    if (!path || path === "/") return true;
    const segments = path.split("/").filter(Boolean);
    const last = segments[segments.length - 1]?.toLowerCase() ?? "";
    const indexish = /^(events?|calendar|whats-?on|shows?|schedule|listings?|programme?|tickets?)$/;
    // A single generic segment with nothing after it is an index.
    if (segments.length <= 1 && indexish.test(last)) return true;
    // /events/2026-09 style archives are indexes too — a real event slug has
    // words in it, not only a date.
    if (indexish.test(segments[0]?.toLowerCase() ?? "") && segments.length === 2) {
      if (/^\d{4}(-\d{2})*$/.test(last)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function toRawEvent(ev: SweptEvent): RawEvent | null {
  const title = ev.title?.trim();
  if (!title || !ev.start) return null;
  const start = new Date(ev.start);
  if (Number.isNaN(start.getTime())) return null;

  return {
    title,
    description: ev.description?.trim(),
    startsAt: start.toISOString(),
    allDay: false,
    venue: {
      name: ev.venue_name?.trim() || "Venue listed on the source page",
      address: ev.address?.trim() || undefined,
    },
    price: inferPrice(ev.price_note || ev.description),
    url: ev.source_url,
    // Only reached after verify() fetched this page and confirmed both the
    // title and the date appear on it.
    verifiedAt: new Date().toISOString(),
    actors: ev.organizer ? [ev.organizer] : undefined,
    source: {
      id: "ai-sweep",
      label: "AI sweep",
      url: ev.source_url,
    },
  };
}

/** Models wrap JSON in prose or fences more often than not. */
function extractJson(content: string): { events?: SweptEvent[] } {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) return {};
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as { events?: SweptEvent[] };
  } catch {
    return {};
  }
}
