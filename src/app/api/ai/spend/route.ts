import { NextResponse } from "next/server";
import { flush, spendReport } from "@/lib/ai/spend";

// GET /api/ai/spend: every AI call this hub has made recently, with what it
// cost, plus OpenRouter's own two lifetime numbers.
//
// Deliberately raw. The browser buckets the calls into ITS OWN local day and
// derives the day's total, the Opus notifications and the per-model breakdown
// from them — the same derived-never-stored rule the Updates feed runs on, and
// the only way a "today" figure lands on the owner's day rather than the
// server's UTC one.
//
// Behind the login wall like every other hub route.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Write anything counted but not yet flushed, so a panel opened seconds after
  // a call shows that call instead of appearing to have missed it.
  await flush().catch(() => {});
  return NextResponse.json(await spendReport());
}
