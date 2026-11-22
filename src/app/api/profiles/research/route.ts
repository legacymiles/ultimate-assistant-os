import { NextResponse } from "next/server";
import { searchWeb, readPage } from "@/lib/web/fetchPublic";

// ---------------------------------------------------------------------------
// The Profiles chat looking something up.
//
// Searching is FREE and keyless (DuckDuckGo, via lib/web/fetchPublic.ts), so
// this works for every user with nothing bought and nothing configured — the
// point being that "how do I set up my printer" stops being a question the
// Profiles chat has to refuse.
//
// It returns the search hits AND the readable text of the best couple of
// pages, because a snippet is enough to name a page but not to answer from
// it: the settings, temperatures and menu paths the owner actually needs are
// three paragraphs into the manual.
//
// It reads nothing of the owner's and writes nothing: the page passes a query
// in, gets public text back, and puts it in the prompt itself. Owner-only like
// every /api route (middleware).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How many of the top results to open and read in full. */
const READ_TOP = 2;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { query?: string; read?: number } | null;
  const query = String(body?.query ?? "").trim().slice(0, 300);
  if (!query) return NextResponse.json({ error: "Say what to look up." }, { status: 400 });

  const results = await searchWeb(query);
  if (!results.length) {
    // 200, not an error status: the chat still answers, it just says it
    // couldn't check rather than the whole turn failing.
    return NextResponse.json({ query, results: [], pages: [], note: "Web search didn't answer just now." });
  }

  const howMany = Math.max(0, Math.min(Number(body?.read ?? READ_TOP) || 0, 3));
  const pages = (
    await Promise.all(
      results.slice(0, howMany).map(async (r) => {
        const page = await readPage(r.url, 6_000);
        return page.ok && page.text ? { url: page.url, title: page.title, text: page.text } : null;
      }),
    )
  ).filter((p): p is { url: string; title: string; text: string } => p !== null);

  return NextResponse.json({ query, results, pages });
}
