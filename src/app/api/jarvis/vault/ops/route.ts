import { NextResponse } from "next/server";
import { memoryContext, saveMemories } from "@/lib/jarvis/server/memory";
import { normalizePath } from "@/lib/jarvis/vault/parse";
import { capturePath, pendingMirror, renderAppend, renderCapture, type OpKind, type VaultOp } from "@/lib/jarvis/vault/ops";

// ---------------------------------------------------------------------------
// The vault outbox.
//
//   GET    → pending ops, oldest first. What the bridge is about to write.
//   POST   → capture something. Returns the op, and ALSO writes a pending
//            mirror row so the note is searchable immediately rather than only
//            once the owner's PC is next reachable.
//   PATCH  → mark an op applied, or applied-with-a-conflict, after the bridge
//            has written it. This is the row fact that makes a replay a no-op.
//
// There is no DELETE. An op that was applied is history worth keeping, and an
// op the owner no longer wants is a note they can delete in Obsidian — the
// queue is not a place things disappear from.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = "jarvis_vault_ops";
const MAX_BODY = 200_000;

interface Row {
  id: string;
  path: string;
  op: OpKind;
  body: string;
  base_hash: string | null;
  state: "pending" | "applied" | "conflict";
  created_at: string;
  applied_at: string | null;
}

const toOp = (r: Row): VaultOp => ({
  id: r.id,
  path: r.path,
  op: r.op,
  body: r.body,
  baseHash: r.base_hash,
  state: r.state,
  createdAt: r.created_at,
  appliedAt: r.applied_at,
});

export async function GET() {
  const ctx = await memoryContext();
  if (!ctx.available) return NextResponse.json({ available: false, reason: ctx.reason, ops: [] });
  try {
    const { data, error } = await ctx.db
      .from(TABLE)
      .select("id, path, op, body, base_hash, state, created_at, applied_at")
      .eq("user_id", ctx.userId)
      .eq("profile_id", ctx.profileId)
      .eq("state", "pending")
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return NextResponse.json({ available: true, ops: ((data ?? []) as Row[]).map(toOp) });
  } catch (e) {
    return NextResponse.json({ available: false, reason: reasonOf(e), ops: [] });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    title?: unknown;
    body?: unknown;
    op?: unknown;
    path?: unknown;
    folder?: unknown;
    origin?: unknown;
    tags?: unknown;
    baseHash?: unknown;
  };

  const text = typeof body.body === "string" ? body.body.trim().slice(0, MAX_BODY) : "";
  if (!text) return NextResponse.json({ error: "Nothing to capture." }, { status: 400 });

  const op: OpKind = body.op === "append" ? "append" : "create";
  const now = Date.now();
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 200)
      : // No title given: take the first line, which is what a dictated or
        // pasted thought actually looks like.
        text.split("\n")[0].slice(0, 80) || "Captured note";

  // An append needs a path to append TO; a create gets one assigned here, at
  // capture time, so the note is addressable before the file exists.
  const path =
    typeof body.path === "string" && body.path.trim()
      ? normalizePath(body.path)
      : capturePath(title, now, typeof body.folder === "string" && body.folder.trim() ? normalizePath(body.folder) : "inbox");

  if (op === "append" && !(typeof body.path === "string" && body.path.trim())) {
    return NextResponse.json({ error: "An append needs the note to append to." }, { status: 400 });
  }

  const origin = typeof body.origin === "string" ? body.origin.slice(0, 120) : "captured away from your PC";
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string").slice(0, 20) : [];

  const ctx = await memoryContext();
  if (!ctx.available) return NextResponse.json({ available: false, reason: ctx.reason });

  try {
    // Insert first, because the rendered body has to carry the op's own id as
    // its idempotency marker — so the id must exist before the body is written.
    const { data: inserted, error } = await ctx.db
      .from(TABLE)
      .insert({
        user_id: ctx.userId,
        profile_id: ctx.profileId,
        path,
        op,
        body: text,
        base_hash: typeof body.baseHash === "string" ? body.baseHash.slice(0, 128) : null,
      })
      .select("id, path, op, body, base_hash, state, created_at, applied_at")
      .single();
    if (error) throw new Error(error.message);

    const row = inserted as Row;
    const rendered =
      op === "create"
        ? renderCapture({ title, body: text, now, id: row.id, origin, tags })
        : renderAppend({ body: text, now, id: row.id, origin });

    const { error: bodyError } = await ctx.db.from(TABLE).update({ body: rendered }).eq("id", row.id).eq("user_id", ctx.userId);
    if (bodyError) throw new Error(bodyError.message);

    // The mirror row. Without this a thought captured away from the PC is
    // invisible until the owner gets home, which defeats capturing it at all.
    const mirror = pendingMirror(toOp({ ...row, body: rendered }), title);
    const saved = await saveMemories(ctx, [{ ...mirror, tags }]).catch(() => ({ saved: 0 }));

    return NextResponse.json({
      available: true,
      op: toOp({ ...row, body: rendered }),
      searchable: (saved as { saved: number }).saved > 0,
      note:
        op === "create"
          ? `Saved as ${path}. It is searchable now, and lands in your vault next time your PC is reachable.`
          : `Queued for ${path}. It lands next time your PC is reachable.`,
    });
  } catch (e) {
    return NextResponse.json({ available: false, reason: reasonOf(e) }, { status: 200 });
  }
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; state?: unknown; conflictPath?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  const state = body.state === "conflict" ? "conflict" : body.state === "applied" ? "applied" : "";
  if (!id || !state) return NextResponse.json({ error: "Which op, and what happened to it?" }, { status: 400 });

  const ctx = await memoryContext();
  if (!ctx.available) return NextResponse.json({ available: false, reason: ctx.reason });

  try {
    const { error } = await ctx.db
      .from(TABLE)
      .update({
        state,
        applied_at: new Date().toISOString(),
        conflict_path: typeof body.conflictPath === "string" ? normalizePath(body.conflictPath) : null,
      })
      .eq("id", id)
      .eq("user_id", ctx.userId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ available: true, state });
  } catch (e) {
    return NextResponse.json({ available: false, reason: reasonOf(e) }, { status: 200 });
  }
}

function reasonOf(e: unknown): string {
  return e instanceof Error ? e.message : "the outbox is not reachable";
}
