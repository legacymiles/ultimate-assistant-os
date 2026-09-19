import { NextResponse } from "next/server";
import { deleteMemory, memoryContext } from "@/lib/jarvis/server/memory";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: string; profileId?: string };
  if (!body.id) return NextResponse.json({ error: "Which memory?" }, { status: 400 });
  const ctx = await memoryContext(body.profileId ?? "owner");
  if (!ctx.available) return NextResponse.json({ available: false, reason: ctx.reason });
  try {
    await deleteMemory(ctx, body.id);
    return NextResponse.json({ available: true, deleted: true });
  } catch (e) {
    return NextResponse.json({ available: false, reason: e instanceof Error ? e.message : "delete failed" });
  }
}
