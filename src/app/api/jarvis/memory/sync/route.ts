import { NextResponse } from "next/server";
import { localAvailable, localFiles, repoFiles } from "@/lib/jarvis/server/masterFolder";
import { memoryContext, saveMemories, type SaveInput } from "@/lib/jarvis/server/memory";

// Reads files from the machine the server runs on, so it must stay dynamic and
// on the Node runtime. On the deployed site there is no ~/.claude, so the local
// half simply returns nothing and only the repo files are synced.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** What the Memory tab needs to decide whether to offer the button. */
export async function GET() {
  const ctx = await memoryContext();
  return NextResponse.json({
    local: await localAvailable(),
    memory: ctx.available,
    reason: ctx.available ? "" : ctx.reason,
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { profileId?: string };
  const ctx = await memoryContext(body.profileId ?? "owner");
  if (!ctx.available) {
    return NextResponse.json({ available: false, reason: ctx.reason, saved: 0, files: 0 });
  }

  const [repo, local] = await Promise.all([repoFiles(), localFiles()]);
  const files = [...repo, ...local];
  if (!files.length) {
    return NextResponse.json({
      available: true,
      saved: 0,
      files: 0,
      note: "No master-folder files were readable from this machine.",
    });
  }

  const inputs: SaveInput[] = files.map((f) => ({
    // Skills are their own source so they can be filtered separately in the ball.
    source: f.externalId.includes("/skills/") ? "skill" : "master-folder",
    title: f.title,
    content: f.content,
    origin: f.externalId,
    externalId: f.externalId,
    capturedAt: f.modified || undefined,
  }));

  // Embedding happens per batch inside saveMemories; keep batches small enough
  // that one failure costs little and the request stays under its limit.
  let saved = 0;
  let embedded = true;
  try {
    for (let i = 0; i < inputs.length; i += 20) {
      const res = await saveMemories(ctx, inputs.slice(i, i + 20));
      saved += res.saved;
      embedded = embedded && res.embedded;
    }
  } catch (e) {
    return NextResponse.json({
      available: true,
      saved,
      files: files.length,
      error: e instanceof Error ? e.message : "sync failed",
    });
  }

  return NextResponse.json({
    available: true,
    saved,
    files: files.length,
    embedded,
    local: local.length,
    repo: repo.length,
  });
}
