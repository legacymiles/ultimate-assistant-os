import { NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { endpointFor } from "@/lib/ai/provider";
import { checkPublicUrl, htmlToText, isPrivateHost, parseDdgResults, type SearchHit } from "@/lib/new-jarvis/web";

// Jarvis's web tools, run by the website so no PC is needed (see
// src/lib/new-jarvis/web.ts). Owner/sign-in gated by middleware like the rest
// of /api/new-jarvis. Every failure comes back as one plain sentence.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 12_000;

function plain(error: string, status = 200) {
  // 200 with an error: the tool loop shows it to the model, which can try
  // another way, instead of the whole turn failing.
  return NextResponse.json({ error }, { status });
}

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
async function fetchPublic(start: URL, init: RequestInit = {}): Promise<Response> {
  let url = start;
  for (let hop = 0; hop < 5; hop++) {
    if (!(await resolvesPublic(url.hostname))) throw new Error("That address isn't on the public internet, so the website can't reach it.");
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

async function readCapped(res: Response): Promise<string> {
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

async function search(q: string) {
  const query = q.trim().slice(0, 300);
  if (!query) return plain("Say what to search for.");
  const tries = [
    { url: "https://html.duckduckgo.com/html/", body: new URLSearchParams({ q: query }).toString() },
    { url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}` },
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
      const hits = parseDdgResults(await readCapped(res));
      if (hits.length) return NextResponse.json({ query, results: hits });
    } catch {
      /* try the next one */
    }
  }
  // Search engines sometimes turn away cloud servers. The owner's OpenRouter
  // key has a web search of its own, so that is the backup.
  const viaKey = await searchViaOpenRouter(query);
  if (viaKey.length) return NextResponse.json({ query, results: viaKey });
  return plain("Web search didn't answer just now. Try again in a moment, or read a page you already know the address of.");
}

async function searchViaOpenRouter(query: string): Promise<SearchHit[]> {
  const ep = endpointFor("openrouter");
  if (!ep) return [];
  try {
    const res = await fetch(ep.url, {
      method: "POST",
      signal: AbortSignal.timeout(25_000),
      headers: {
        Authorization: `Bearer ${ep.key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://ultimate-assistant-os.vercel.app",
        "X-Title": "Jarvis web search",
      },
      body: JSON.stringify({
        model: process.env.JARVIS_SEARCH_MODEL || "openai/gpt-4o-mini",
        plugins: [{ id: "web", max_results: 6 }],
        max_tokens: 200,
        messages: [{ role: "user", content: `Search the web for: ${query}\nReply with one line.` }],
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as {
      choices?: { message?: { annotations?: { type?: string; url_citation?: { url?: string; title?: string; content?: string } }[] } }[];
    } | null;
    const notes = data?.choices?.[0]?.message?.annotations ?? [];
    const seen = new Set<string>();
    return notes.flatMap((a) => {
      const c = a.url_citation;
      if (a.type !== "url_citation" || !c?.url || seen.has(c.url)) return [];
      seen.add(c.url);
      return [{ title: c.title ?? c.url, url: c.url, snippet: (c.content ?? "").replace(/\s+/g, " ").slice(0, 300) }];
    });
  } catch {
    return [];
  }
}

async function read(raw: string) {
  const checked = checkPublicUrl(raw);
  if (!checked.ok) return plain(checked.why);
  try {
    const res = await fetchPublic(checked.url, { headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" } });
    if (res.status === 401 || res.status === 403) {
      return plain("That page needs a sign-in or blocks automated reading, so it couldn't be read from the website.");
    }
    if (res.status === 404) return plain("That page doesn't exist (404).");
    if (!res.ok) return plain(`That site answered with an error (${res.status}).`);
    const type = res.headers.get("content-type") ?? "";
    const body = await readCapped(res);
    if (/json/i.test(type)) return NextResponse.json({ url: res.url || checked.url.toString(), title: "", text: body.slice(0, 14_000) });
    if (!/html|text|xml/i.test(type) && type) return plain(`That address is a file (${type.split(";")[0]}), not a page that can be read as text.`);
    const page = htmlToText(body, checked.url.toString());
    if (!page.text) return plain("That page has no readable text — it may only work with JavaScript turned on.");
    return NextResponse.json({ url: checked.url.toString(), ...page });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/timeout|aborted/i.test(msg)) return plain("That page took too long to answer.");
    return plain(msg && !/fetch failed/i.test(msg) ? msg : "That site couldn't be reached from the website.");
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { action?: string; q?: string; url?: string } | null;
  if (!body) return plain("That request was empty.", 400);
  if (body.action === "search") return search(String(body.q ?? ""));
  if (body.action === "read") return read(String(body.url ?? ""));
  return plain("Jarvis's web tool can search or read a page.", 400);
}
