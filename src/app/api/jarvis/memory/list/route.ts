import { NextResponse } from "next/server";
import { listMemories, memoryContext } from "@/lib/jarvis/server/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const profileId = new URL(req.url).searchParams.get("profileId") ?? "owner";
  const ctx = await memoryContext(profileId);
  if (!ctx.available) return NextResponse.json({ available: false, reason: ctx.reason, memories: [] });
  try {
    return NextResponse.json({ available: true, memories: await listMemories(ctx) });
  } catch (e) {
    return NextResponse.json({
      available: false,
      reason: e instanceof Error ? e.message : "read failed",
      memories: [],
    });
  }
}
