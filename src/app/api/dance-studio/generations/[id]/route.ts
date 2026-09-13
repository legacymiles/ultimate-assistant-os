// GET    /api/dance-studio/generations/:id — check on a render; files the video when done.
// DELETE /api/dance-studio/generations/:id — remove a take and its file.
//
// Progress is advanced by whoever looks: the studio polls this while a render
// is running. One check is one short provider request, never a long wait.

import { NextResponse } from "next/server";

import { errorMessage, fail, nowIso, requireUid } from "@/lib/dance-studio/server/http";
import { loadLibrary, mutateLibrary } from "@/lib/dance-studio/server/library";
import { providerById } from "@/lib/dance-studio/server/providers";
import { deleteMedia, mediaKey, putMedia } from "@/lib/dance-studio/server/storage";
import type { Generation } from "@/lib/dance-studio/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

const GIVE_UP_SEC = 45 * 60;
/** A "saving" older than this was a request that died mid-download; try again. */
const SAVING_STALE_SEC = 150;

function ageSec(iso?: string): number {
  return iso ? (Date.now() - Date.parse(iso)) / 1000 : Infinity;
}

async function settle(uid: string, id: string, patch: Partial<Generation>): Promise<Generation | null> {
  const { result } = await mutateLibrary(uid, (lib) => {
    const g = lib.generations.find((x) => x.id === id);
    if (g) Object.assign(g, patch, { updatedAt: nowIso() });
    return g ? { ...g } : null;
  });
  return result;
}

export async function GET(_req: Request, ctx: Ctx) {
  const uid = await requireUid();
  if (uid instanceof NextResponse) return uid;
  const { id } = await ctx.params;

  const gen = (await loadLibrary(uid)).generations.find((g) => g.id === id);
  if (!gen) return fail("Not found.", 404);
  const checkable = gen.status === "generating" || (gen.status === "saving" && ageSec(gen.updatedAt) > SAVING_STALE_SEC);
  if (!checkable) return NextResponse.json({ generation: gen });

  const provider = providerById(gen.providerId);
  if (!provider) {
    return NextResponse.json({ generation: await settle(uid, id, { status: "error", error: `The provider that started this render (${gen.providerId}) is no longer configured.` }) });
  }
  if (ageSec(gen.startedAt ?? gen.createdAt) > GIVE_UP_SEC) {
    return NextResponse.json({ generation: await settle(uid, id, { status: "error", error: "Gave up after 45 minutes without a result." }) });
  }

  let status;
  try {
    status = await provider.status(gen.operation);
  } catch (err) {
    // A failed check is not a failed render. Report it and keep waiting.
    return NextResponse.json({ generation: gen, note: `Couldn't check progress: ${errorMessage(err)}` });
  }

  if (status.state === "pending") return NextResponse.json({ generation: gen });
  if (status.state === "error") return NextResponse.json({ generation: await settle(uid, id, { status: "error", error: status.message }) });

  await settle(uid, id, { status: "saving" });
  try {
    const bytes = await status.fetchVideo();
    const key = mediaKey(uid, "out", "video/mp4");
    if (!(await putMedia(key, bytes, "video/mp4"))) throw new Error("Storage refused the finished video.");
    return NextResponse.json({ generation: await settle(uid, id, { status: "done", videoKey: key, completedAt: nowIso(), error: undefined }) });
  } catch (err) {
    // The render exists; only filing it failed. Go back to generating so the next check retries.
    return NextResponse.json({ generation: await settle(uid, id, { status: "generating" }), note: errorMessage(err) });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const uid = await requireUid();
  if (uid instanceof NextResponse) return uid;
  const { id } = await ctx.params;
  const { result, saved } = await mutateLibrary(uid, (lib) => {
    const g = lib.generations.find((x) => x.id === id);
    lib.generations = lib.generations.filter((x) => x.id !== id);
    return g ?? null;
  });
  if (!result) return fail("Not found.", 404);
  if (!saved) return fail("Couldn't save.", 500);
  await deleteMedia(result.videoKey);
  return NextResponse.json({ ok: true });
}
