// DELETE /api/search/cache[?kind=web] — empty the cache.
//
// For when a provider was misconfigured and the service dutifully cached its
// bad answers, or when you want to prove a change took effect. Owner session
// only: an agent should use `noCache` on its own request rather than throwing
// away everyone else's hits.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/search/auth";
import { errorResponse } from "@/lib/search/route";
import { cacheClear, cacheSweep } from "@/lib/search/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  try {
    await requireAdmin(request);
    const kind = new URL(request.url).searchParams.get("kind") ?? undefined;
    const dropped = await cacheClear(kind);
    return NextResponse.json(
      { dropped, kind: kind ?? "all" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST sweeps expired rows only — safe to run from a cron. */
export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    await cacheSweep();
    return NextResponse.json({ swept: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
