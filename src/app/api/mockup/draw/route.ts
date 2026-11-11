import { NextResponse } from "next/server";

import { drawOnPc, localTakesRefs, localUp, photographOnPc, type PcRef } from "@/lib/images/server/draw";
import { FLUX_PROMPT_MAX } from "@/lib/mockup/flux";
import { callerIsMember } from "@/lib/recall/lists/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A cold Flux load is ~2 minutes; a warm picture ~20 s.
export const maxDuration = 300;

// GET  /api/mockup/draw          → { up, refs } — can this server reach the PC's drawer?
// POST /api/mockup/draw { prompt, width, height, refs? } → { image, ms }
// POST /api/mockup/draw { shot: { url, width, height } } → { image, ms } — the page as it is
//
// The server-side path to Flux 2 for mockup lanes. It only works where this
// server runs on the owner's PC (local dev / the PC's own hub); on a hosted
// deploy the browser talks to the drawer directly instead (useMockupPictures).
// PC only — never a paid or watermarked lane: a mockup has its coded drawing
// to fall back on, so a picture that costs money is never worth it.

export async function GET() {
  const up = await localUp();
  return NextResponse.json({ up, refs: up && (await localTakesRefs()) });
}

const side = (v: unknown, d: number) => {
  const n = Math.round(Number(v) / 16) * 16;
  return Number.isFinite(n) && n >= 256 && n <= 1536 ? n : d;
};

/** Only the shapes the drawer understands, and at most three. */
function cleanRefs(v: unknown): PcRef[] {
  if (!Array.isArray(v)) return [];
  const out: PcRef[] = [];
  for (const r of v.slice(0, 3)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const ref: PcRef = {};
    if (typeof o.image === "string" && o.image.startsWith("data:image/")) ref.image = o.image;
    if (typeof o.url === "string" && /^https?:\/\//.test(o.url)) ref.url = o.url;
    if (typeof o.html === "string") ref.html = o.html;
    if (typeof o.base === "string") ref.base = o.base;
    if (Number.isFinite(Number(o.width))) ref.width = Number(o.width);
    if (Number.isFinite(Number(o.height))) ref.height = Number(o.height);
    if (ref.image || ref.url || ref.html) out.push(ref);
  }
  return out;
}

export async function POST(req: Request) {
  if (await callerIsMember()) {
    return NextResponse.json({ error: "Mockup pictures are drawn for the owner only." }, { status: 403 });
  }
  let body: { prompt?: unknown; width?: unknown; height?: unknown; refs?: unknown; shot?: unknown; seed?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body with a prompt." }, { status: 400 });
  }
  // The page's own origin travels to the drawer, which then refuses to
  // photograph someone else's private address for it.
  const origin = req.headers.get("origin") || new URL(req.url).origin;

  if (body.shot && typeof body.shot === "object") {
    const s = body.shot as { url?: unknown; width?: unknown; height?: unknown };
    const url = typeof s.url === "string" ? s.url.trim() : "";
    if (!/^https?:\/\//.test(url)) return NextResponse.json({ error: "Say which page to photograph." }, { status: 400 });
    const shot = await photographOnPc({ url, width: Number(s.width) || 1280, height: Number(s.height) || 820 }, origin);
    if (!shot) {
      return NextResponse.json({ error: "Your PC couldn't photograph that page." }, { status: 503 });
    }
    return NextResponse.json(shot);
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, FLUX_PROMPT_MAX) : "";
  if (!prompt) return NextResponse.json({ error: "Say what to draw." }, { status: 400 });

  const drawn = await drawOnPc(
    { prompt, purpose: "placeholder", width: side(body.width, 1024), height: side(body.height, 656), steps: 4, seed: Number.isFinite(Number(body.seed)) ? Number(body.seed) : 7 },
    { refs: cleanRefs(body.refs), origin },
  );
  if (!drawn) {
    return NextResponse.json(
      { error: "Your PC's picture drawer isn't reachable. Start it with: node tools/wangp-image/server.mjs" },
      { status: 503 },
    );
  }
  return NextResponse.json({ image: drawn.image, ms: drawn.ms, note: drawn.note });
}
