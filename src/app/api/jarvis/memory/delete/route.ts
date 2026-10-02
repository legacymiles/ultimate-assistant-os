import { NextResponse } from "next/server";
import { deleteMemory, memoryContext, sourceOf } from "@/lib/jarvis/server/memory";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: string; profileId?: string };
  if (!body.id) return NextResponse.json({ error: "Which memory?" }, { status: 400 });
  const ctx = await memoryContext(body.profileId ?? "owner");
  if (!ctx.available) return NextResponse.json({ available: false, reason: ctx.reason });
  try {
    // A `vault` row is a MIRROR of a file on disk, and the file is the source
    // of truth. Deleting the row would not delete the note, so the next sweep
    // would simply recreate it — the button would appear to do nothing, which
    // is worse than refusing. The web UI never deletes the real copy.
    const source = await sourceOf(ctx, body.id);
    if (source === "vault") {
      return NextResponse.json({
        available: true,
        deleted: false,
        reason:
          "That is a note in your vault, not a memory Jarvis made. Delete it in Obsidian and the next sweep " +
          "will drop it from here — deleting it from this side would only put it back.",
      });
    }
    await deleteMemory(ctx, body.id);
    return NextResponse.json({ available: true, deleted: true });
  } catch (e) {
    return NextResponse.json({ available: false, reason: e instanceof Error ? e.message : "delete failed" });
  }
}
