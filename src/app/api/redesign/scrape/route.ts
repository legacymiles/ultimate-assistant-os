// ---------------------------------------------------------------------------
// Just the scrape, for V2.
//
// V1's /api/redesign scrapes AND calls a model to invent three directions. V2
// does not want the directions — its lanes get their design from a skill, not
// from this server — so it needs the first half on its own.
//
// Reuses V1's `scrapeUrl` rather than writing a second parser: there is exactly
// one definition of what this hub thinks a page "does", and two would drift.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";

import { scrapeUrl } from "@/lib/redesigner/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let url = "";
  try {
    const body = (await req.json()) as { url?: string };
    url = String(body.url ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Send a JSON body with a url." }, { status: 400 });
  }
  if (!url) return NextResponse.json({ error: "No url given." }, { status: 400 });
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  try {
    const scrape = await scrapeUrl(url);
    return NextResponse.json({
      title: scrape.title,
      summary: scrape.description || scrape.headings.slice(0, 3).join(" · "),
      navItems: scrape.navItems,
      ctas: scrape.ctas,
      // The scrape's "functionality" is already the right shape for a brief:
      // a thing the site does, with a detail. A lane must keep all of it.
      features: scrape.functionality.map((f) => ({
        title: f.label,
        description: f.detail,
        group: "core" as const,
      })),
    });
  } catch (err) {
    // A site that refuses a bot is not a server error here — the lane can still
    // be briefed from the URL and whatever the owner typed.
    return NextResponse.json(
      { error: `Could not read ${url}: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
