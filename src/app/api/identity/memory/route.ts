import { NextResponse } from "next/server";
import { callerIsMember } from "@/lib/recall/lists/session";
import { deleteByKeys, listKeys, memoryContext, saveMemories, type SaveInput } from "@/lib/jarvis/server/memory";

// ---------------------------------------------------------------------------
// Jarvis Memory's copy of who people are.
//
// The browser sends the WHOLE current list of identity cards (built from
// Profiles by lib/identity/registry.ts). Each becomes one `identity` memory
// keyed `identity:<profile id>` — upserted, hash-gated so an unchanged person
// costs nothing — and any identity card no longer in the list is deleted, so a
// removed or renamed person never lingers in search, the MCP or the harness.
//
// Cards carry names, aliases, relationship and non-private facts only. No face
// data and no secret/never-send-to-AI rows ever reach this route: the client
// builds them that way, and the route re-checks the shape it is given.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

interface CardIn {
  externalId: string;
  title: string;
  content: string;
  tags?: string[];
  hash?: string;
}

function clean(raw: unknown): CardIn | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const externalId = typeof r.externalId === "string" ? r.externalId : "";
  if (!/^identity:[\w-]{1,80}$/.test(externalId)) return null;
  // No pixels in memory: any data: URL is replaced, never stored.
  const strip = (x: string) => x.replace(/data:[^\s"')]+/gi, "[image]");
  const title = typeof r.title === "string" ? strip(r.title).slice(0, 200) : "";
  const content = typeof r.content === "string" ? strip(r.content).slice(0, 6000) : "";
  if (!title || !content) return null;
  return {
    externalId,
    title,
    content,
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string").slice(0, 8) : ["identity"],
    hash: typeof r.hash === "string" ? r.hash.slice(0, 128) : undefined,
  };
}

export async function POST(req: Request) {
  if (await callerIsMember()) return NextResponse.json({ error: "Not shared." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { cards?: unknown[] };
  if (!Array.isArray(body.cards)) return NextResponse.json({ error: "cards must be a list" }, { status: 400 });
  const sent = body.cards.slice(0, 500);
  const cards = sent.map(clean).filter((c): c is CardIn => c !== null);
  // Every key the client sent is a live person, even if its card was unusable
  // this time — only keys it did NOT send are stale.
  const live = new Set(
    sent
      .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>).externalId : null))
      .filter((k): k is string => typeof k === "string"),
  );

  const ctx = await memoryContext("owner");
  if (!ctx.available) return NextResponse.json({ available: false, reason: ctx.reason });
  try {
    const inputs: SaveInput[] = cards.map((c) => ({
      source: "identity",
      title: c.title,
      content: c.content,
      origin: "profiles",
      tags: c.tags,
      externalId: c.externalId,
      meta: c.hash ? { hash: c.hash } : undefined,
    }));
    const { saved, skipped } = await saveMemories(ctx, inputs);
    const stale = (await listKeys(ctx, "identity")).map((k) => k.externalId).filter((k) => !live.has(k));
    const removed = await deleteByKeys(ctx, "identity", stale);
    return NextResponse.json({ available: true, saved, skipped, removed });
  } catch (e) {
    return NextResponse.json({ available: false, reason: e instanceof Error ? e.message : "identity sync failed" });
  }
}
