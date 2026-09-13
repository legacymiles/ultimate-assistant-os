// PATCH  /api/dance-studio/dances/:id  { name }
// DELETE /api/dance-studio/dances/:id  — the dance, its generations, and their files.

import { NextResponse } from "next/server";

import { fail, readJson, requireUid } from "@/lib/dance-studio/server/http";
import { mutateLibrary } from "@/lib/dance-studio/server/library";
import { deleteMedia } from "@/lib/dance-studio/server/storage";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const uid = await requireUid();
  if (uid instanceof NextResponse) return uid;
  const { id } = await ctx.params;
  const name = String((await readJson<{ name?: string }>(req))?.name ?? "").trim().slice(0, 80);
  if (!name) return fail("A dance needs a name.");

  const { result, saved } = await mutateLibrary(uid, (lib) => {
    const d = lib.dances.find((x) => x.id === id);
    if (d) d.name = name;
    return d;
  });
  if (!result) return fail("Not found.", 404);
  return saved ? NextResponse.json({ dance: result }) : fail("Couldn't save.", 500);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const uid = await requireUid();
  if (uid instanceof NextResponse) return uid;
  const { id } = await ctx.params;

  const { result, saved } = await mutateLibrary(uid, (lib) => {
    const dance = lib.dances.find((x) => x.id === id);
    const gens = lib.generations.filter((g) => g.danceId === id);
    lib.dances = lib.dances.filter((x) => x.id !== id);
    lib.generations = lib.generations.filter((g) => g.danceId !== id);
    return dance ? { dance, gens } : null;
  });
  if (!result) return fail("Not found.", 404);
  if (!saved) return fail("Couldn't save.", 500);

  const { dance, gens } = result;
  await deleteMedia(dance.videoKey, dance.originalKey, dance.posterKey, ...gens.map((g) => g.videoKey));
  return NextResponse.json({ ok: true });
}
