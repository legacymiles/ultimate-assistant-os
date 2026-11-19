import { NextResponse } from "next/server";

import { trimMarkup } from "@/lib/mockup/coded";
import { callerIsMember } from "@/lib/recall/lists/session";
import { fetchText } from "@/lib/social-import/safeFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/mockup/page { url } → { markup } — the live page's markup, trimmed
// for the model that recreates it (coded.ts trimMarkup). safeFetch refuses
// private addresses on every hop; the bake-off reads a page on the hub's own
// origin straight from the browser instead. `markup: ""` when the page won't
// load — the writer then works from the screenshot and the site facts.

export async function POST(req: Request) {
  if (await callerIsMember()) {
    return NextResponse.json({ error: "Mockups are made for the owner only." }, { status: 403 });
  }
  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!/^https?:\/\//.test(url)) return NextResponse.json({ error: "Say which page to read." }, { status: 400 });
  try {
    const html = await fetchText(url, 2_500_000);
    return NextResponse.json({ markup: html ? trimMarkup(html, url) : "" });
  } catch {
    return NextResponse.json({ markup: "" });
  }
}
