import { NextResponse } from "next/server";
import { memoryContext } from "@/lib/jarvis/server/memory";
import { readUsage } from "@/lib/skills/server/usageStore";

// ---------------------------------------------------------------------------
// The Skills Library's call counts, for the signed-in account.
//
//   GET -> { usage: UsageData | null, reason? }
//
// Local demo mode (no Supabase, nobody signed in) answers usage: null rather
// than an error, so the library still works and just shows no counts.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await memoryContext();
  if (!ctx.available) return NextResponse.json({ usage: null, reason: ctx.reason });
  try {
    const usage = await readUsage(ctx.db, ctx.userId);
    // The dedupe ids are bookkeeping, not something the page needs.
    delete usage.seen;
    return NextResponse.json({ usage }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ usage: null, reason: e instanceof Error ? e.message : "Could not read skill usage." });
  }
}
