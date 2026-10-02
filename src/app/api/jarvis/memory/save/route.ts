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
    meta: cleanMeta(r.meta),
  };
}

/**
 * The only three derived fields a POST may set, whitelisted by name.
 *
 * `meta` used to be dropped here entirely, which meant there was no way to get
 * a hash or an edge list into the index at all — the graph could not be keyed
 * and every sweep re-embedded every file. It has to come through, but it is
 * jsonb on a row this request does not otherwise control, so taking arbitrary
 * JSON from a body would be handing a caller a scratch column to write
 * anything into. Three keys, each type-checked.
 */
function cleanMeta(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof r.hash === "string" && r.hash.length <= 128) out.hash = r.hash;
  if (Array.isArray(r.links)) {
    out.links = r.links.filter((l): l is string => typeof l === "string" && l.length <= 1024).slice(0, 500);
  }
  if (r.pending === true) out.pending = true;
  if (typeof r.opId === "string" && r.opId.length <= 64) out.opId = r.opId;
  return Object.keys(out).length ? out : undefined;
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
