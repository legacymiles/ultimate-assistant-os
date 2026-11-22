// ---------------------------------------------------------------------------
// Searching and reading the public web, from the server.
//
// This used to BE the implementation: it scraped DuckDuckGo for results and
// reduced pages to text itself. It is now a thin adapter onto the centralized
// search service in lib/search, which is the one place a provider is named.
// DuckDuckGo did not go away — it is registered there as a provider
// (lib/search/providers/duckduckgo.ts), behind the owner's self-hosted SearXNG
// instances and ahead of Tavily — so the keyless path still works and the
// callers here got SearXNG, caching, rate limits and usage tracking for free.
//
// The two exported shapes are deliberately unchanged, because two apps depend
// on them and neither should have had to care that the engine underneath moved:
//
//   searchWeb(query, max) -> SearchHit[]       Jarvis's web_search tool, Profiles research
//   readPage(url, max)    -> PageRead          Jarvis's web_read tool, Profiles research
//
// Anything NEW should import from lib/search/client instead, which exposes the
// kinds (web / news / research), extraction and the usage label. The fetching
// primitives below (fetchPublic, readCapped) stay exported because they are
// used for things that are not searching.
//
// Every address is still checked as public on EVERY redirect hop — a shortener
// or an open redirect on a public host is otherwise a route straight to the
// owner's router or a cloud metadata endpoint. That check now lives in
// lib/search/extract.ts for the reading path and here for direct fetches.
// ---------------------------------------------------------------------------

import "server-only";

import { lookup } from "node:dns/promises";
import { checkPublicUrl, isPrivateHost, type SearchHit } from "@/lib/new-jarvis/web";
import { readPage as readPageCentral, searchWeb as searchCentral } from "@/lib/search/client";

export type { SearchHit };

/** A desktop browser's UA. Many sites serve a stripped layout to unknown clients. */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 12_000;

/** Does this host resolve to a public address — every A/AAAA record, not just the first? */
async function resolvesPublic(host: string): Promise<boolean> {
  if (isPrivateHost(host)) return false;
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateHost(a.address));
  } catch {
    return false;
  }
}

/** Fetch with redirects followed by hand, so each hop is checked as public. */
export async function fetchPublic(start: URL, init: RequestInit = {}): Promise<Response> {
  let url = start;
  for (let hop = 0; hop < 5; hop++) {
    if (!(await resolvesPublic(url.hostname))) {
      throw new Error("That address isn't on the public internet, so the website can't reach it.");
    }
    const res = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...(init.headers ?? {}) },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = checkPublicUrl(new URL(res.headers.get("location")!, url).toString());
      if (!next.ok) throw new Error(next.why);
      url = next.url;
      continue;
    }
    return res;
  }
  throw new Error("That page kept redirecting, so it couldn't be read.");
}

/** Read a body, giving up at MAX_BYTES so one huge page can't exhaust the server. */
export async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.length;
    if (size >= MAX_BYTES) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Search the web, through the central service.
 *
 * Never throws, and an empty array still means "no answer just now" — which
 * every caller already has a path for. That contract is why the central
 * service's errors are swallowed here rather than surfaced: these two callers
 * are AI tool loops, and a thrown error would fail a whole turn where an empty
 * result lets the model try another way.
 */
export async function searchWeb(query: string, max = 8): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 300);
  if (!q) return [];
  try {
    const response = await searchCentral(q, { limit: max, app: "jarvis-web-tools" });
    return response.results.slice(0, max).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.description,
    }));
  } catch {
    return [];
  }
}

/** A page's readable text, or a plain sentence saying why not. */
export type PageRead = { ok: true; url: string; title: string; text: string } | { ok: false; why: string };

/**
 * Read a page, through the central service.
 *
 * The central extractor also falls back to a rendering extractor for pages
 * that only work with JavaScript, which the old hand-rolled reader could not
 * do — so this call now succeeds on pages that used to come back as "no
 * readable text".
 */
export async function readPage(raw: string, max = 14_000): Promise<PageRead> {
  const checked = checkPublicUrl(raw);
  if (!checked.ok) return { ok: false, why: checked.why };
  const page = await readPageCentral(checked.url.toString());
  if (page.error) return { ok: false, why: page.error };
  if (!page.text) {
    return { ok: false, why: "That page has no readable text — it may only work with JavaScript turned on." };
  }
  return {
    ok: true,
    url: page.finalUrl,
    title: page.title ?? "",
    text: page.text.length > max ? `${page.text.slice(0, max)}\n…(page continues)` : page.text,
  };
}
