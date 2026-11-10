import { NextResponse } from "next/server";

import { drawOnPc, localUp } from "@/lib/images/server/draw";
import { FLUX_PROMPT_MAX } from "@/lib/mockup/flux";
import { callerIsMember } from "@/lib/recall/lists/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A cold Flux load is ~2 minutes; a warm picture ~20 s.
export const maxDuration = 300;

// GET  /api/mockup/draw          → { up } — can this server reach the PC's drawer?
// POST /api/mockup/draw { prompt, width, height } → { image, ms }
//
// The server-side path to Flux 2 for mockup lanes. It only works where this
// server runs on the owner's PC (local dev / the PC's own hub); on a hosted
// deploy the browser talks to the drawer directly instead (useMockupPictures).
// PC only — never a paid or watermarked lane: a mockup has its coded drawing
// to fall back on, so a picture that costs money is never worth it.

export async function GET() {
  return NextResponse.json({ up: await localUp() });
}

const side = (v: unknown, d: number) => {
  const n = Math.round(Number(v) / 16) * 16;
  return Number.isFinite(n) && n >= 256 && n <= 1536 ? n : d;
};

export async function POST(req: Request) {
  if (await callerIsMember()) {
    return NextResponse.json({ error: "Mockup pictures are drawn for the owner only." }, { status: 403 });
  }
  let body: { prompt?: unknown; width?: unknown; height?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body with a prompt." }, { status: 400 });
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, FLUX_PROMPT_MAX) : "";
  if (!prompt) return NextResponse.json({ error: "Say what to draw." }, { status: 400 });

  const drawn = await drawOnPc({ prompt, purpose: "placeholder", width: side(body.width, 1024), height: side(body.height, 656), steps: 4 });
  if (!drawn) {
    return NextResponse.json(
      { error: "Your PC's picture drawer isn't reachable. Start it with: node tools/wangp-image/server.mjs" },
      { status: 503 },
    );
  }
  return NextResponse.json({ image: drawn.image, ms: drawn.ms, note: drawn.note });
}
