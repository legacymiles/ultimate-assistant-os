import { NextResponse } from "next/server";
import { memoryContext, searchMemory } from "@/lib/jarvis/server/memory";
import type { MemorySource } from "@/lib/jarvis/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    query?: string;
    limit?: number;
    sources?: MemorySource[];
    profileId?: string;
  };
  const ctx = await memoryContext(body.profileId ?? "owner");
  if (!ctx.available) return NextResponse.json({ available: false, reason: ctx.reason, hits: [] });
  try {
    const { hits, semantic } = await searchMemory(
      ctx,
      (body.query ?? "").slice(0, 2000),
      Math.min(50, Math.max(1, body.limit ?? 20)),
      body.sources,
    );
    return NextResponse.json({ available: true, semantic, hits });
  } catch (e) {
    return NextResponse.json(
      { available: false, reason: e instanceof Error ? e.message : "search failed", hits: [] },
      { status: 200 },
    );
  }
}
