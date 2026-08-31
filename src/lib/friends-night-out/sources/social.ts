// ---------------------------------------------------------------------------
// The Inbox: a pasted link or a photographed flyer becomes a real event.
//
// This is the app's honest substitute for "search Instagram, TikTok and
// Facebook". Those platforms have no public event-search endpoint and scraping
// them breaches their terms, so the app never crawls them. What it does instead
// is accept the artefact the user already has — the link someone sent them, or
// a photo of a flyer taped to a coffee shop window — and turn it into a
// structured event.
//
// It is also the only path in the app that can reach an event with no web
// footprint at all. A flyer for a backyard show exists nowhere a crawler can
// see; a photo of it is the whole record.
//
// Three tiers, tried in order, so the feature never depends on an API key:
//   1. schema.org Event JSON-LD in the page      — exact, free, no key
//   2. OpenGraph tags plus date-guessing         — decent, free, no key
//   3. an LLM reading the page text or the image — best coverage, needs a key
// ---------------------------------------------------------------------------

import { inferCategory, inferFormat, inferPrice } from "../normalize";
import type { EventCategory, Price, RawEvent } from "../types";

const GATEWAY = "https://ai-gateway.vercel.sh/v1/chat/completions";
const FETCH_TIMEOUT_MS = 10_000;

export interface ExtractedDraft {
  title: string;
  description?: string;
  startsAt?: string;
  venueName?: string;
  address?: string;
  price: Price;
  category: EventCategory;
  url?: string;
  imageUrl?: string;
  /** Which tier produced this, shown so the user knows how much to trust it. */
  method: "structured-data" | "page-tags" | "ai-read" | "ai-image";
  /** Fields the extractor could not fill — the form focuses these first. */
  missing: string[];
}

// ----- from a URL ----------------------------------------------------------

/**
 * Hosts that answer a logged-out request with a generic shell instead of the
 * post.
 *
 * These have to be short-circuited rather than parsed, because they do NOT
 * fail — they return HTTP 200 with valid OpenGraph tags for the site itself.
 * Left alone, the extractor happily produces a draft titled "Instagram", which
 * is worse than an error: it looks like it worked.
 */
const LOGIN_WALLED = /(^|\.)(instagram\.com|tiktok\.com|facebook\.com|fb\.com|threads\.net)$/i;

export async function extractFromUrl(rawUrl: string): Promise<{
  draft: ExtractedDraft | null;
  body: string | null;
}> {
  const url = normalizeUrl(rawUrl);
  if (!url) return { draft: null, body: null };

  try {
    if (LOGIN_WALLED.test(new URL(url).hostname)) return { draft: null, body: null };
  } catch {
    return { draft: null, body: null };
  }

  const body = await fetchPage(url);
  if (!body) return { draft: null, body: null };

  const structured = fromJsonLd(body, url);
  if (structured) return { draft: structured, body };

  const tags = fromOpenGraph(body, url);
  const aiKey = process.env.AI_GATEWAY_API_KEY;

  // The tag-based draft is usually missing the date, because OpenGraph has no
  // field for one. If a key exists, let the model read the page for the parts
  // the tags could not give us, seeded with what we already know.
  if (aiKey && (!tags || !tags.startsAt)) {
    const read = await aiReadPage(body, url, aiKey);
    if (read) return { draft: read, body };
  }
  return { draft: tags, body };
}

function fromJsonLd(body: string, url: string): ExtractedDraft | null {
  const blocks = [...body.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )].map((m) => m[1]);

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    const event = findEvent(parsed);
    if (!event) continue;

    const name = typeof event.name === "string" ? event.name.trim() : "";
    if (!name) continue;
    const start =
      typeof event.startDate === "string" ? isoOrUndefined(event.startDate) : undefined;

    const location = event.location as
      | { name?: string; address?: unknown }
      | undefined;
    const address =
      typeof location?.address === "string"
        ? location.address
        : (location?.address as { streetAddress?: string })?.streetAddress;

    return {
      title: name,
      description: asText(event.description),
      startsAt: start,
      venueName: location?.name,
      address,
      price: ldPrice(event),
      category: inferCategory(name, asText(event.description)),
      url,
      imageUrl: ldImage(event.image),
      method: "structured-data",
      missing: [!start ? "date" : null, !location?.name ? "venue" : null].filter(
        Boolean,
      ) as string[],
    };
  }
  return null;
}

function fromOpenGraph(body: string, url: string): ExtractedDraft | null {
  const og = (prop: string) =>
    body.match(
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`,
        "i",
      ),
    )?.[1] ??
    body.match(
      new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`,
        "i",
      ),
    )?.[1];

  const title =
    decodeEntities(og("og:title")) ??
    decodeEntities(body.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]);
  if (!title) return null;

  // A listing, search or landing page advertises the SITE, not an event. Its
  // og:title is the site name or a category heading, and turning that into a
  // draft produces a confidently-wrong event the user then has to notice and
  // delete. Better to report nothing found.
  const siteName = decodeEntities(og("og:site_name"))?.trim().toLowerCase();
  const cleanTitle = title.trim();
  if (siteName && cleanTitle.toLowerCase().startsWith(siteName)) return null;
  if (cleanTitle.split(/\s+/).length < 3) return null;
  // Reject titles that read as a directory heading rather than one event.
  // The word boundaries matter: "Charity Event at the Barn" is a real event and
  // has to survive, while "Asheville Events, Calendar & Tickets" must not. The
  // discriminator is shape — a listing page names a place and a category with
  // no date; an event names itself and usually carries one.
  const listingWords =
    /\b(events|calendar|tickets|things to do|what'?s on|discover|browse|search results)\b/i;
  const hasDate =
    /\b\d{1,2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(cleanTitle);
  if (listingWords.test(cleanTitle) && !hasDate) return null;

  const description = decodeEntities(og("og:description"));
  const text = `${title} ${description ?? ""}`;

  return {
    title: title.trim(),
    description: description?.trim(),
    startsAt: guessDate(text),
    venueName: undefined,
    price: inferPrice(text),
    category: inferCategory(title, description),
    url,
    imageUrl: og("og:image"),
    method: "page-tags",
    missing: ["venue", guessDate(text) ? null : "date"].filter(Boolean) as string[],
  };
}

// ----- AI tiers ------------------------------------------------------------

async function aiReadPage(
  body: string,
  url: string,
  apiKey: string,
): Promise<ExtractedDraft | null> {
  // Strip markup so the token budget goes to content rather than class names.
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12_000);

  const parsed = await askModel(apiKey, [
    {
      role: "system",
      content:
        "You extract a single event from page text into strict JSON. If a field is not stated on the page, use null. Never invent a date, a venue or a price.",
    },
    {
      role: "user",
      content: [
        `Page: ${url}`,
        "",
        "Extract the ONE event this page is about. Reply with JSON only:",
        '{"title":"","description":"","start":"ISO 8601 or null","venue_name":"",',
        '"address":"","price_note":""}',
        "",
        `Today is ${new Date().toISOString().slice(0, 10)}, so resolve relative`,
        "dates like 'this Friday' against that. If the year is not stated,",
        "assume the next occurrence.",
        "",
        text,
      ].join("\n"),
    },
  ]);
  if (!parsed?.title) return null;

  return {
    title: parsed.title,
    description: parsed.description ?? undefined,
    startsAt: parsed.start ? isoOrUndefined(parsed.start) : undefined,
    venueName: parsed.venue_name ?? undefined,
    address: parsed.address ?? undefined,
    price: inferPrice(parsed.price_note ?? parsed.description),
    category: inferCategory(parsed.title, parsed.description ?? undefined),
    url,
    method: "ai-read",
    missing: [!parsed.start ? "date" : null, !parsed.venue_name ? "venue" : null]
      .filter(Boolean) as string[],
  };
}

/**
 * Read a photographed flyer.
 *
 * The one path that reaches events with no web presence at all — a poster in a
 * coffee shop window is often the only record a backyard show has.
 */
export async function extractFromImage(
  dataUrl: string,
): Promise<ExtractedDraft | null> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) return null;
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(dataUrl)) return null;

  const parsed = await askModel(apiKey, [
    {
      role: "system",
      content:
        "You read event flyers and posters into strict JSON. If something is not printed on the flyer, use null. Never invent a detail.",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "Read this event flyer. Reply with JSON only:",
            '{"title":"","description":"","start":"ISO 8601 or null","venue_name":"",',
            '"address":"","price_note":""}',
            "",
            `Today is ${new Date().toISOString().slice(0, 10)}. Flyers usually omit`,
            "the year — assume the next occurrence of the printed date.",
            "Put door time, age limits and anything else printed into description.",
          ].join("\n"),
        },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ]);
  if (!parsed?.title) return null;

  return {
    title: parsed.title,
    description: parsed.description ?? undefined,
    startsAt: parsed.start ? isoOrUndefined(parsed.start) : undefined,
    venueName: parsed.venue_name ?? undefined,
    address: parsed.address ?? undefined,
    price: inferPrice(parsed.price_note ?? parsed.description),
    category: inferCategory(parsed.title, parsed.description ?? undefined),
    method: "ai-image",
    missing: [!parsed.start ? "date" : null, !parsed.venue_name ? "venue" : null]
      .filter(Boolean) as string[],
  };
}

interface ModelDraft {
  title?: string;
  description?: string;
  start?: string;
  venue_name?: string;
  address?: string;
  price_note?: string;
}

async function askModel(
  apiKey: string,
  messages: unknown[],
): Promise<ModelDraft | null> {
  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.AI_MODEL ?? "anthropic/claude-sonnet-4-6",
        messages,
        temperature: 0.1,
        max_tokens: 900,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : content;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as ModelDraft;
    return parsed.title ? parsed : null;
  } catch {
    return null;
  }
}

// ----- turning a draft into an event --------------------------------------

export function draftToRawEvent(draft: ExtractedDraft): RawEvent | null {
  if (!draft.startsAt) return null;
  return {
    title: draft.title,
    description: draft.description,
    startsAt: draft.startsAt,
    allDay: false,
    venue: { name: draft.venueName ?? "Venue not listed", address: draft.address },
    category: draft.category,
    format: inferFormat(draft.title, draft.description),
    price: draft.price,
    url: draft.url,
    imageUrl: draft.imageUrl,
    source: { id: "inbox", label: sourceLabel(draft), url: draft.url },
  };
}

function sourceLabel(draft: ExtractedDraft): string {
  if (draft.method === "ai-image") return "Flyer photo";
  if (!draft.url) return "Added by you";
  try {
    return new URL(draft.url).hostname.replace(/^www\./, "");
  } catch {
    return "Added by you";
  }
}

// ----- helpers -------------------------------------------------------------

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        // Identifying as a bot gets served the OpenGraph-rich version by most
        // sites, which is exactly the markup this file wants.
        "User-Agent":
          "FriendsNightOut/1.0 (personal event finder; +reads OpenGraph tags)",
      },
    });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 600_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return u.toString();
  } catch {
    return null;
  }
}

function findEvent(node: unknown, depth = 0): Record<string, unknown> | null {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findEvent(n, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === "string" && /Event$/i.test(t))) return obj;
  return findEvent(obj["@graph"] ?? obj.itemListElement ?? obj.item, depth + 1);
}

function ldPrice(event: Record<string, unknown>): Price {
  const offersRaw = event.offers;
  const offers = (Array.isArray(offersRaw) ? offersRaw[0] : offersRaw) as
    | { price?: number | string; lowPrice?: number | string; highPrice?: number | string }
    | undefined;
  if (!offers) return inferPrice(asText(event.description));
  const min = Number(offers.price ?? offers.lowPrice);
  const max = Number(offers.highPrice ?? offers.price ?? offers.lowPrice);
  if (!Number.isFinite(min)) return { tier: "unknown" };
  if (min === 0) return { tier: "free", note: "Free" };
  return { tier: "paid", min, max: Number.isFinite(max) ? max : min };
}

function ldImage(image: unknown): string | undefined {
  if (typeof image === "string") return image;
  if (Array.isArray(image) && typeof image[0] === "string") return image[0];
  if (image && typeof image === "object") {
    const url = (image as { url?: unknown }).url;
    if (typeof url === "string") return url;
  }
  return undefined;
}

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 800) : undefined;
}

function isoOrUndefined(value: string): string | undefined {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function decodeEntities(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

function guessDate(text: string): string | undefined {
  const m = text.match(
    new RegExp(`\\b(${MONTHS})\\.?\\s+(\\d{1,2})(?:\\s*,?\\s*(\\d{4}))?\\b`, "i"),
  );
  if (!m) return undefined;
  const month = new Date(`${m[1]} 1, 2000`).getMonth();
  if (Number.isNaN(month)) return undefined;
  const now = new Date();
  const year = m[3] ? Number(m[3]) : now.getFullYear();
  const d = new Date(year, month, Number(m[2]));
  if (!m[3] && d.getTime() < now.getTime() - 86_400_000) d.setFullYear(year + 1);

  const time = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (time) {
    let hour = Number(time[1]) % 12;
    if (/pm/i.test(time[3])) hour += 12;
    d.setHours(hour, time[2] ? Number(time[2]) : 0, 0, 0);
  } else {
    d.setHours(19, 0, 0, 0);
  }
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
