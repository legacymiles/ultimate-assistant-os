import { NextResponse } from "next/server";
import { endpointFor } from "@/lib/ai/provider";
import { searchWeb, readPage, type SearchHit } from "@/lib/web/fetchPublic";

// Jarvis's web tools, run by the website so no PC is needed. The searching and
// reading themselves live in src/lib/web/fetchPublic.ts, shared with the
// Profiles chat so there is only ever one implementation to keep safe; the
// pure parsing is in src/lib/new-jarvis/web.ts. Owner/sign-in gated by
// middleware like the rest of /api/new-jarvis. Every failure comes back as one
// plain sentence.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function plain(error: string, status = 200) {
  // 200 with an error: the tool loop shows it to the model, which can try
  // another way, instead of the whole turn failing.
  return NextResponse.json({ error }, { status });
}

async function search(q: string) {
  const query = q.trim().slice(0, 300);
  if (!query) return plain("Say what to search for.");
  const hits = await searchWeb(query);
  if (hits.length) return NextResponse.json({ query, results: hits });
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
  const page = await readPage(raw);
  if (!page.ok) return plain(page.why);
  return NextResponse.json({ url: page.url, title: page.title, text: page.text });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { action?: string; q?: string; url?: string } | null;
  if (!body) return plain("That request was empty.", 400);
  if (body.action === "search") return search(String(body.q ?? ""));
  if (body.action === "read") return read(String(body.url ?? ""));
  return plain("Jarvis's web tool can search or read a page.", 400);
}
