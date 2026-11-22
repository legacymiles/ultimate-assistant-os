import { NextResponse } from "next/server";
import { readPage, searchWeb } from "@/lib/search/client";

// Jarvis's web tools, run by the website so no PC is needed.
//
// Both actions go to the centralized search service (lib/search), which owns
// the provider chain: SearXNG on this machine, SearXNG on the VPS, DuckDuckGo,
// then Tavily. This route used to carry its own fallback — an OpenRouter web
// search, paid per call — and that is gone: a second provider hardcoded into
// one app is exactly what the central service exists to remove, and the chain
// already covers the case it was there for (a search engine turning the cloud
// server away). Tavily is the paid floor now, chosen in one place for every
// app rather than here for this one.
//
// Owner/sign-in gated by middleware like the rest of /api/new-jarvis. Every
// failure comes back as one plain sentence.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function plain(error: string, status = 200) {
  // 200 with an error: the tool loop shows it to the model, which can try
  // another way, instead of the whole turn failing.
  return NextResponse.json({ error }, { status });
}

async function search(raw: string) {
  const query = raw.trim().slice(0, 300);
  if (!query) return plain("Say what to search for.");
  try {
    const response = await searchWeb(query, { app: "jarvis-web-tools" });
    if (response.results.length === 0) {
      return plain("Web search came back empty. Try different words, or read a page you already know the address of.");
    }
    return NextResponse.json({
      query,
      results: response.results.map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.description,
        source: result.source,
        published: result.publishedAt,
      })),
      // Worth handing the model: a stale answer and a live one are different
      // facts, and it can say which it had.
      servedBy: response.cached ? "cache" : response.provider,
    });
  } catch (error) {
    // The service's errors are already plain English — a missing provider, a
    // rate limit, a SearXNG that needs its JSON format enabled.
    return plain(error instanceof Error ? error.message : "Web search didn't answer just now.");
  }
}

async function read(raw: string) {
  const page = await readPage(String(raw ?? "").trim());
  if (page.error) return plain(page.error);
  if (!page.text) return plain("That page has no readable text — it may only work with JavaScript turned on.");
  return NextResponse.json({
    url: page.finalUrl,
    title: page.title ?? "",
    text: page.text,
    words: page.words,
    published: page.publishedAt,
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { action?: string; q?: string; url?: string } | null;
  if (!body) return plain("That request was empty.", 400);
  if (body.action === "search") return search(String(body.q ?? ""));
  if (body.action === "read") return read(String(body.url ?? ""));
  return plain("Jarvis's web tool can search or read a page.", 400);
}
