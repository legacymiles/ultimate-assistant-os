import { NextResponse } from "next/server";
import { localAvailable, localFiles, localSkills, repoFiles } from "@/lib/jarvis/server/masterFolder";
import { saveSkill } from "@/lib/jarvis/server/skills";
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

  // Skills are NOT written from these summaries any more: they go through the
  // skill store below as full records (body + references + hash), the same row
  // the connector's save_skill and scripts/skill-sync.mjs write. Writing the
  // 1200-char summary here would overwrite a full skill saved from the phone.
  const inputs: SaveInput[] = files
    .filter((f) => !f.externalId.includes("/skills/"))
    .map((f) => ({
      source: "master-folder",
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

  // This machine's skills, as full records. Unchanged ones are skipped by the
  // hash gate, so this costs nothing on a re-sync.
  let skills = 0;
  for (const sk of await localSkills()) {
    try {
      const r = await saveSkill(ctx, { ...sk, origin: "master-folder" });
      if (r.changed) {
        saved++;
        skills++;
      }
    } catch {
      /* one malformed skill (no frontmatter) must not stop the rest */
    }
  }

  return NextResponse.json({
    available: true,
    saved,
    files: files.length,
    embedded,
    local: local.length,
    repo: repo.length,
    skills,
  });
}
