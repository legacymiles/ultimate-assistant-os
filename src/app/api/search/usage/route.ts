// GET /api/search/usage?hours=24 — what the service has been doing.
//
// Totals, cache hit rate, latency percentiles, a per-hour series, and the
// breakdowns by provider, kind, caller and app. The dashboard renders this;
// anything else can poll it.
import { NextResponse } from "next/server";
import { resolveCaller } from "@/lib/search/auth";
import { errorResponse } from "@/lib/search/route";
import { usageSummary } from "@/lib/search/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await resolveCaller(request);
    const raw = Number(new URL(request.url).searchParams.get("hours"));
    // 1 hour to a week. A week of rows is already near the 5000-row read cap,
    // so anything longer would silently return a partial picture.
    const hours = Number.isFinite(raw) && raw > 0 ? Math.min(168, Math.round(raw)) : 24;
    return NextResponse.json(await usageSummary(hours), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
