import { NextResponse } from "next/server";

import { photographOnPc } from "@/lib/images/server/draw";
import { callerIsMember } from "@/lib/recall/lists/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/mockup/shot { url, width, height } → { image, ms } — the page as it
// is now, photographed by headless Chrome on the owner's PC (the screenshot
// helper in tools/wangp-image; no image model is involved). Only works where
// this server runs on the PC; on the hosted hub the browser calls the helper
// directly (useCodedMockups photographPage).

export async function POST(req: Request) {
  if (await callerIsMember()) {
    return NextResponse.json({ error: "Mockups are made for the owner only." }, { status: 403 });
  }
  let body: { url?: unknown; width?: unknown; height?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!/^https?:\/\//.test(url)) return NextResponse.json({ error: "Say which page to photograph." }, { status: 400 });
  // The page's own origin travels to the helper, which then refuses to
  // photograph someone else's private address for it.
  const origin = req.headers.get("origin") || new URL(req.url).origin;
  const shot = await photographOnPc({ url, width: Number(body.width) || 1280, height: Number(body.height) || 820 }, origin);
  if (!shot) return NextResponse.json({ error: "Your PC couldn't photograph that page." }, { status: 503 });
  return NextResponse.json(shot);
}
