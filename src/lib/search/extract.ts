// ---------------------------------------------------------------------------
// Reading a page, so an agent can analyse it instead of guessing from a
// snippet.
//
// A 160-character snippet is enough for a human deciding what to click and
// nowhere near enough for a model answering a question. This is the part that
// makes the search service usable by an agent: ask for `extract` and the top
// results come back with the page's actual text.
//
// Dependency-free on purpose. Readability and cheerio would both do a slightly
// better job on hostile markup, and neither is worth adding to a hub that
// already ships a 3D engine — the heuristic below (prefer <article>/<main>,
// strip chrome, score paragraph density) gets the readable body out of ordinary
// pages, and the Tavily extractor is the fallback for the ones it can't.
//
// SECURITY: this endpoint takes a URL from a caller and fetches it from the
// server, which is the exact shape of an SSRF. Every hop is resolved and
// checked against the private address ranges before anything is read, so a
// caller cannot use it to read a cloud metadata endpoint, a database on the
// VPS's private network, or the SearXNG instance on the laptop.
// ---------------------------------------------------------------------------

import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { SEARCH_LIMITS } from "./config";
import { tavilyExtract } from "./providers/tavily";
import type { ExtractedPage } from "./types";

// ---------------------------------------------------------------------------
// Address safety
// ---------------------------------------------------------------------------

/**
 * Private, loopback, link-local and carrier-grade-NAT space, plus the two
 * addresses that matter most on a VPS: 169.254.169.254 (cloud metadata, which
 * on most providers hands out credentials to anything that asks) and the
 * Docker bridge range.
 */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private + docker default
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 and 192.0.2.0/24
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (addr === "::1" || addr === "::") return true;
  if (addr.startsWith("fe80") || addr.startsWith("fc") || addr.startsWith("fd")) return true;
  // IPv4-mapped (::ffff:10.0.0.1) smuggles a private v4 address through a v6 check.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIpv4(ip);
  if (isIP(ip) === 6) return isPrivateIpv6(ip);
  return true; // Not an address we can reason about — refuse.
}

/**
 * Resolve the host and refuse anything that lands inside the house.
 *
 * Checking the hostname string is not enough: `localtest.me` and any attacker
 * -controlled domain can have an A record pointing at 127.0.0.1. The DNS
 * answer is what has to be checked, and ALL of it — a host with two A records
 * where only one is public is still a way in.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That isn't a URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http and https can be read, not ${url.protocol.replace(":", "")}.`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("That address is on a private network, so it won't be fetched.");
    return url;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new Error(`${host} could not be resolved.`);
  }
  if (addresses.length === 0) throw new Error(`${host} has no address.`);
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error(`${host} resolves to a private network address, so it won't be fetched.`);
  }
  return url;
}

// ---------------------------------------------------------------------------
// HTML → text
// ---------------------------------------------------------------------------

/** Elements whose contents are never part of the article. */
const STRIP_BLOCKS =
  /<(script|style|noscript|template|svg|iframe|form|nav|aside|header|footer|button|select|video|audio|canvas)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Self-closing or unclosed chrome that the block pattern misses. */
const STRIP_VOID = /<(?:script|style|link|meta|source|track|input|img|br|hr)\b[^>]*\/?>/gi;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#x27": "'",
  "#x2F": "/",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name: string) => {
    const direct = ENTITIES[name] ?? ENTITIES[name.toLowerCase()];
    if (direct) return direct;
    if (name.startsWith("#x") || name.startsWith("#X")) {
      const code = Number.parseInt(name.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (name.startsWith("#")) {
      const code = Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return whole;
  });
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (!match) return null;
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? "").trim() || null;
}

function metaContent(html: string, patterns: RegExp[]): string | null {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const pattern of patterns) {
    for (const tag of metas) {
      const key = attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop");
      if (key && pattern.test(key)) {
        const content = attr(tag, "content");
        if (content) return content;
      }
    }
  }
  return null;
}

/**
 * The published date, from wherever this page happens to keep it.
 *
 * Tried in order of how often they are right: the OpenGraph/article tags that
 * CMSs emit, then JSON-LD `datePublished`, then the `<time datetime>` element.
 * `dateModified` is deliberately not used — a caller sorting by date wants
 * when it was written, and a page edited yesterday is not news from yesterday.
 */
function publishedFrom(html: string): string | null {
  const meta = metaContent(html, [
    /article:published_time/i,
    /^date$/i,
    /datePublished/i,
    /^pubdate$/i,
    /publish(ed)?[-_]?date/i,
    /^og:updated_time$/i,
  ]);
  if (meta) return meta;

  const ld = /"datePublished"\s*:\s*"([^"]+)"/i.exec(html);
  if (ld) return ld[1];

  const time = /<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/i.exec(html);
  if (time) return time[1];

  return null;
}

function titleFrom(html: string): string | null {
  const og = metaContent(html, [/^og:title$/i, /^twitter:title$/i]);
  if (og) return og;
  const tag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (tag) return decodeEntities(tag[1]).replace(/\s+/g, " ").trim() || null;
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1) return decodeEntities(h1[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() || null;
  return null;
}

/** Tags turned into a paragraph break rather than being glued to the next word. */
const BLOCK_BREAK = /<\/?(p|div|br|h[1-6]|li|tr|section|article|blockquote|pre|dd|dt|figcaption)\b[^>]*>/gi;

function toText(html: string): string {
  return decodeEntities(
    html
      .replace(BLOCK_BREAK, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, ""),
  )
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * The readable body.
 *
 * `<article>` and `<main>` are right when a page has them, which most
 * content sites now do. When it has neither, the fallback scores every `<div>`
 * by how much of it is paragraph text — the standard readability trick, and
 * enough to skip a sidebar of links in favour of the column of prose.
 */
function bodyOf(html: string): string {
  const cleaned = html.replace(STRIP_BLOCKS, " ").replace(STRIP_VOID, " ");

  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(cleaned);
  if (article && toText(article[1]).length > 400) return article[1];

  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(cleaned);
  if (main && toText(main[1]).length > 400) return main[1];

  const candidates = cleaned.match(/<div\b[^>]*>[\s\S]{600,}?<\/div>/gi) ?? [];
  let best = "";
  let bestScore = 0;
  for (const candidate of candidates) {
    const paragraphs = candidate.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) ?? [];
    if (paragraphs.length < 2) continue;
    const text = toText(paragraphs.join(" "));
    // Link-dense blocks are navigation, however long they are.
    const links = (candidate.match(/<a\b/gi) ?? []).length;
    const score = text.length - links * 60;
    if (score > bestScore) {
      bestScore = score;
      best = paragraphs.join("\n");
    }
  }
  if (bestScore > 400) return best;

  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(cleaned);
  return body ? body[1] : cleaned;
}

/** Read the response body, stopping at the byte cap rather than buffering it all. */
async function readCapped(response: Response, maxBytes: number): Promise<{ html: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { html: await response.text(), truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.byteLength;
    if (total >= maxBytes) {
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return { html: buffer.toString("utf8"), truncated };
}

/**
 * Read one page.
 *
 * Never throws: a page that cannot be read comes back as an ExtractedPage with
 * `error` set and empty text, because the caller asked for ten pages and
 * losing the other nine to one paywall would be the wrong trade.
 */
export async function extractPage(rawUrl: string): Promise<ExtractedPage> {
  const base: ExtractedPage = {
    url: rawUrl,
    finalUrl: rawUrl,
    title: null,
    text: "",
    words: 0,
    publishedAt: null,
    author: null,
    siteName: null,
    lang: null,
    truncated: false,
  };

  let url: URL;
  try {
    url = await assertPublicUrl(rawUrl);
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : "That URL can't be read." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_LIMITS.extractTimeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // A generic browser-ish UA. Nothing about the owner goes out in a
        // header, and a bare fetch UA is refused by a lot of sites.
        "User-Agent":
          "Mozilla/5.0 (compatible; jarvis-search/1.0; +reader) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "Accept-Language": "en;q=0.9",
      },
      cache: "no-store",
    });

    // A redirect chain can end somewhere private even when it started public.
    if (response.url && response.url !== url.toString()) {
      try {
        await assertPublicUrl(response.url);
      } catch {
        return { ...base, error: "That page redirected to a private network address, so it wasn't read." };
      }
    }

    if (!response.ok) {
      const viaTavily = await tavilyExtract(url.toString());
      if (viaTavily) {
        const words = viaTavily.text.split(/\s+/).filter(Boolean).length;
        return { ...base, finalUrl: response.url || rawUrl, text: viaTavily.text, words };
      }
      return {
        ...base,
        finalUrl: response.url || rawUrl,
        error:
          response.status === 403 || response.status === 401
            ? "That site refused to serve the page to a server (403). It probably needs a real browser session."
            : `That page returned ${response.status}.`,
      };
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (contentType && !/text\/html|xhtml|text\/plain|application\/xml|\+xml/.test(contentType)) {
      return {
        ...base,
        finalUrl: response.url || rawUrl,
        error: `That URL is ${contentType.split(";")[0]}, not a web page, so there was nothing to read.`,
      };
    }

    const { html, truncated } = await readCapped(response, SEARCH_LIMITS.extractMaxBytes);
    const text = toText(bodyOf(html)).slice(0, SEARCH_LIMITS.extractMaxChars);
    const words = text.split(/\s+/).filter(Boolean).length;

    // Under ~40 words means a cookie wall, a JS shell, or a consent page. The
    // renderer-backed extractor gets text out of those, so it is worth the
    // second attempt before giving up.
    if (words < 40) {
      const viaTavily = await tavilyExtract(url.toString());
      if (viaTavily && viaTavily.text.split(/\s+/).filter(Boolean).length > words) {
        return {
          ...base,
          finalUrl: response.url || rawUrl,
          title: titleFrom(html),
          text: viaTavily.text,
          words: viaTavily.text.split(/\s+/).filter(Boolean).length,
          publishedAt: publishedFrom(html),
          siteName: metaContent(html, [/^og:site_name$/i]),
          lang: attr(/<html\b[^>]*>/i.exec(html)?.[0] ?? "", "lang"),
          truncated,
        };
      }
      if (words === 0) {
        return {
          ...base,
          finalUrl: response.url || rawUrl,
          title: titleFrom(html),
          error:
            "The page loaded but had no readable text — usually it renders its content with JavaScript, or it's a consent wall.",
        };
      }
    }

    return {
      url: rawUrl,
      finalUrl: response.url || rawUrl,
      title: titleFrom(html),
      text,
      words,
      publishedAt: publishedFrom(html),
      author: metaContent(html, [/^author$/i, /^article:author$/i, /^twitter:creator$/i]),
      siteName: metaContent(html, [/^og:site_name$/i, /^application-name$/i]),
      lang: attr(/<html\b[^>]*>/i.exec(html)?.[0] ?? "", "lang"),
      truncated,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ...base,
        error: `That page took longer than ${Math.round(SEARCH_LIMITS.extractTimeoutMs / 1000)}s to load.`,
      };
    }
    return { ...base, error: error instanceof Error ? error.message : "That page couldn't be read." };
  } finally {
    clearTimeout(timer);
  }
}

/** Read several pages with a cap on how many are in flight at once. */
export async function extractPages(urls: string[]): Promise<ExtractedPage[]> {
  const limit = Math.max(1, SEARCH_LIMITS.extractConcurrency);
  const out: ExtractedPage[] = new Array(urls.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < urls.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await extractPage(urls[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, urls.length) }, worker));
  return out;
}

/** Exported for the test suite, which checks the heuristic on real-shaped HTML. */
export const __testables = { toText, bodyOf, titleFrom, publishedFrom, decodeEntities };
