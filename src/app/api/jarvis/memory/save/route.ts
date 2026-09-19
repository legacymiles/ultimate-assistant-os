import { NextResponse } from "next/server";
import { memoryContext, saveMemories, type SaveInput } from "@/lib/jarvis/server/memory";
import { MEMORY_SOURCES, type MemorySource } from "@/lib/jarvis/types";

export const runtime = "nodejs";

function clean(raw: unknown): SaveInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const source = String(r.source ?? "note") as MemorySource;
  const content = typeof r.content === "string" ? r.content.trim() : "";
  const title = typeof r.title === "string" && r.title.trim() ? r.title.trim() : content.split("\n")[0] ?? "";
  if (!content || !title || !MEMORY_SOURCES.includes(source)) return null;
  return {
    source,
    title: title.slice(0, 300),
    content,
    origin: typeof r.origin === "string" ? r.origin : "you",
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [],
    capturedAt: typeof r.capturedAt === "string" ? r.capturedAt : undefined,
    externalId: typeof r.externalId === "string" ? r.externalId : undefined,
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { memories?: unknown[]; profileId?: string };
  const inputs = (body.memories ?? []).map(clean).filter((m): m is SaveInput => m !== null);
  if (!inputs.length) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });

  const ctx = await memoryContext(body.profileId ?? "owner");
  if (!ctx.available) return NextResponse.json({ available: false, reason: ctx.reason, saved: 0 });
  try {
    const { saved, embedded } = await saveMemories(ctx, inputs);
    return NextResponse.json({ available: true, saved, embedded });
  } catch (e) {
    return NextResponse.json(
      { available: false, reason: e instanceof Error ? e.message : "save failed", saved: 0 },
      { status: 200 },
    );
  }
}
