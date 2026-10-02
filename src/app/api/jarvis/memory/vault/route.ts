import { NextResponse } from "next/server";
import { memoryContext } from "@/lib/jarvis/server/memory";
import { forgetNotes, ingestNotes, reapMigratedMasterFolder, vaultKeys, type UploadedNote } from "@/lib/jarvis/server/vault";
import { normalizePath } from "@/lib/jarvis/vault/parse";

// ---------------------------------------------------------------------------
// The vault's half of the memory index.
//
// A PUSH route, not a pull one. `/api/jarvis/memory/sync` reads the filesystem
// of the machine running Next, which on Vercel does not have the vault on it;
// the vault arrives the other way, through the browser, from the bridge on the
// owner's PC. So:
//
//   GET    → every vault path we hold, with its hash. The browser diffs this
//            against the bridge's scan and uploads only what changed.
//   POST   → one chunk of changed notes. The browser decides the chunk size and
//            keeps its own progress, which is what keeps this route inside its
//            limit by construction rather than by hoping the vault stays small.
//   DELETE → paths whose note is gone. The browser has already run the pure
//            delete guard; this route re-checks the cheapest half of it anyway.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Generous per note, but a hard ceiling: one request must not be able to be unbounded. */
const MAX_NOTE_CHARS = 400_000;
const MAX_NOTES_PER_CHUNK = 50;

export async function GET() {
  const ctx = await memoryContext();
  if (!ctx.available) return NextResponse.json({ available: false, reason: ctx.reason, rows: [] });
  try {
    const rows = await vaultKeys(ctx);
    return NextResponse.json({ available: true, rows });
  } catch (e) {
    return NextResponse.json({ available: false, reason: reasonOf(e), rows: [] });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    notes?: unknown;
    knownPaths?: unknown;
    reapMasterFolder?: unknown;
  };

  const notes = Array.isArray(body.notes) ? body.notes.map(cleanNote).filter((n): n is UploadedNote => n !== null) : [];
  if (!notes.length) return NextResponse.json({ error: "No notes in that chunk." }, { status: 400 });
  if (notes.length > MAX_NOTES_PER_CHUNK) {
    return NextResponse.json(
      { error: `That chunk has ${notes.length} notes; send at most ${MAX_NOTES_PER_CHUNK} at a time.` },
      { status: 413 },
    );
  }

  const knownPaths = Array.isArray(body.knownPaths)
    ? body.knownPaths.filter((p): p is string => typeof p === "string").map(normalizePath).filter(Boolean)
    : [];

  const ctx = await memoryContext();
  if (!ctx.available) return NextResponse.json({ available: false, reason: ctx.reason, saved: 0 });

  try {
    const result = await ingestNotes(ctx, notes, knownPaths);
    // Asked for once, on the first chunk of the first sweep, so the notes the
    // vault has taken over stop being indexed twice under two sources.
    const reaped = body.reapMasterFolder === true ? await reapMigratedMasterFolder(ctx) : 0;
    return NextResponse.json({ available: true, ...result, reaped });
  } catch (e) {
    return NextResponse.json({ available: false, reason: reasonOf(e), saved: 0 }, { status: 200 });
  }
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { paths?: unknown; found?: unknown };
  const paths = Array.isArray(body.paths)
    ? [...new Set(body.paths.filter((p): p is string => typeof p === "string").map(normalizePath).filter(Boolean))]
    : [];
  if (!paths.length) return NextResponse.json({ available: true, deleted: 0 });

  const ctx = await memoryContext();
  if (!ctx.available) return NextResponse.json({ available: false, reason: ctx.reason, deleted: 0 });

  try {
    // The real guard is the pure `planSweep`, which the browser ran and which is
    // tested without a database. This is the belt to that braces: a caller that
    // reaches here claiming the vault is empty gets refused regardless, because
    // the cost of being wrong once is the whole index.
    const rows = await vaultKeys(ctx);
    const found = typeof body.found === "number" ? body.found : null;
    if (found !== null && rows.length >= 8 && found < rows.length * 0.5) {
      return NextResponse.json({
        available: true,
        deleted: 0,
        refused: `The scan found ${found} notes where the index holds ${rows.length}. Nothing was deleted.`,
      });
    }
    const deleted = await forgetNotes(ctx, paths);
    return NextResponse.json({ available: true, deleted });
  } catch (e) {
    return NextResponse.json({ available: false, reason: reasonOf(e), deleted: 0 }, { status: 200 });
  }
}

function cleanNote(raw: unknown): UploadedNote | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const path = typeof r.path === "string" ? normalizePath(r.path) : "";
  const hash = typeof r.hash === "string" ? r.hash.slice(0, 128) : "";
  const rawBody = typeof r.raw === "string" ? r.raw : "";
  // A note with no hash cannot take part in the hash gate, so it would be
  // re-embedded on every sweep forever. Refuse it rather than quietly paying.
  if (!path || !hash) return null;
  return {
    path,
    hash,
    raw: rawBody.slice(0, MAX_NOTE_CHARS),
    mtime: typeof r.mtime === "number" && Number.isFinite(r.mtime) ? r.mtime : undefined,
    size: typeof r.size === "number" && Number.isFinite(r.size) ? r.size : undefined,
  };
}

function reasonOf(e: unknown): string {
  return e instanceof Error ? e.message : "the vault sweep failed";
}
