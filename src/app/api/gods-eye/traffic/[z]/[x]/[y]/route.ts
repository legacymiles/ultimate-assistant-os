export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// GET /api/gods-eye/traffic/:z/:x/:y — TomTom traffic-flow tiles for the
// "Street Traffic" layer, proxied so TOMTOM_API_KEY stays on the server.
// ---------------------------------------------------------------------------

export async function GET(_req: Request, ctx: { params: Promise<{ z: string; x: string; y: string }> }) {
  const key = process.env.TOMTOM_API_KEY?.trim();
  if (!key) return new Response("TOMTOM_API_KEY is not set", { status: 503 });
  const { z, x, y } = await ctx.params;
  if (![z, x, y].every((v) => /^\d{1,7}$/.test(v)) || Number(z) > 22) {
    return new Response("Bad tile", { status: 400 });
  }
  const res = await fetch(`https://api.tomtom.com/traffic/map/4/tile/flow/relative0/${z}/${x}/${y}.png?key=${key}&tileSize=256`, {
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) return new Response(`TomTom answered ${res.status}`, { status: res.status === 403 ? 403 : 502 });
  return new Response(res.body, {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=120" },
  });
}
