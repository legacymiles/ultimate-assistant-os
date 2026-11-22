// ---------------------------------------------------------------------------
// Searching and reading the public web, from the server.
//
// This is the ONE implementation. It started inside
// src/app/api/new-jarvis/web/route.ts, and moved here the moment a second app
// (the Profiles chat) needed the same two things, so there is no second copy
// to keep in step. The pure parsing helpers stay in lib/new-jarvis/web.ts,
// which is unit-tested and imported by both; this module is the part that
// touches the network, so it is server-only.
//
// Free by design: DuckDuckGo's HTML endpoint needs no key, so every user of
// the hub gets search without the owner buying anything. The paid fallback
// (OpenRouter's web plugin) is only reached when DuckDuckGo turns the cloud
// server away, and only if a key happens to be set.
//
// Every address is checked as public on EVERY redirect hop, not just the
// first — a shortener or an open redirect on a public host is otherwise a
// route straight to the owner's router or a cloud metadata endpoint.
// ---------------------------------------------------------------------------

import { lookup } from "node:dns/promises";
import { checkPublicUrl, htmlToText, isPrivateHost, parseDdgResults, type SearchHit } from "@/lib/new-jarvis/web";

export type { SearchHit };

/** A desktop browser's UA. Search pages serve a stripped layout to unknown clients. */
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
 * Search the web. Free, keyless, and never throws — an empty array means
 * "no answer just now", which every caller already has a path for.
 */
export async function searchWeb(query: string, max = 8): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 300);
  if (!q) return [];
  const tries = [
    { url: "https://html.duckduckgo.com/html/", body: new URLSearchParams({ q }).toString() },
    { url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}` },
  ];
  for (const t of tries) {
    try {
      const res = await fetch(t.url, {
        method: t.body ? "POST" : "GET",
        body: t.body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "User-Agent": UA,
          "Accept-Language": "en-US,en;q=0.9",
          ...(t.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
      });
      if (!res.ok) continue;
      const hits = parseDdgResults(await readCapped(res), max);
      if (hits.length) return hits;
    } catch {
      /* try the next one */
    }
  }
  return [];
}

/** A page's readable text, or a plain sentence saying why not. */
export type PageRead = { ok: true; url: string; title: string; text: string } | { ok: false; why: string };

export async function readPage(raw: string, max = 14_000): Promise<PageRead> {
  const checked = checkPublicUrl(raw);
  if (!checked.ok) return { ok: false, why: checked.why };
  try {
    const res = await fetchPublic(checked.url, {
      headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, why: "That page needs a sign-in or blocks automated reading, so it couldn't be read from the website." };
    }
    if (res.status === 404) return { ok: false, why: "That page doesn't exist (404)." };
    if (!res.ok) return { ok: false, why: `That site answered with an error (${res.status}).` };
    const type = res.headers.get("content-type") ?? "";
    const body = await readCapped(res);
    const url = checked.url.toString();
    if (/json/i.test(type)) return { ok: true, url, title: "", text: body.slice(0, max) };
    if (!/html|text|xml/i.test(type) && type) {
      return { ok: false, why: `That address is a file (${type.split(";")[0]}), not a page that can be read as text.` };
    }
    const page = htmlToText(body, url, max);
    if (!page.text) return { ok: false, why: "That page has no readable text — it may only work with JavaScript turned on." };
    return { ok: true, url, ...page };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/timeout|aborted/i.test(msg)) return { ok: false, why: "That page took too long to answer." };
    return { ok: false, why: msg && !/fetch failed/i.test(msg) ? msg : "That site couldn't be reached from the website." };
  }
}
