// PATCH  /api/dance-studio/characters/:id  { name?, description?, active?, imageKey?, extraImageKeys? }
// DELETE /api/dance-studio/characters/:id
//   Generations made with it stay in the library — they snapshot the name.

import { NextResponse } from "next/server";

import { CHARACTER_MAX_EXTRA } from "@/lib/dance-studio/limits";
import { fail, nowIso, readJson, requireUid } from "@/lib/dance-studio/server/http";
import { mutateLibrary } from "@/lib/dance-studio/server/library";
import { deleteMedia, ownsKey } from "@/lib/dance-studio/server/storage";
import type { Character } from "@/lib/dance-studio/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const uid = await requireUid();
  if (uid instanceof NextResponse) return uid;
  const { id } = await ctx.params;
  const b = await readJson<Partial<Character>>(req);
  if (!b) return fail("Bad request body.");
  if (b.imageKey !== undefined && !ownsKey(uid, b.imageKey)) return fail("Unknown image.");

  const { result, saved } = await mutateLibrary(uid, (lib) => {
    const c = lib.characters.find((x) => x.id === id);
    if (!c) return null;
    const removed: string[] = [];
    if (typeof b.name === "string" && b.name.trim()) c.name = b.name.trim().slice(0, 60);
    if (typeof b.description === "string") c.description = b.description.trim().slice(0, 300) || undefined;
    if (typeof b.active === "boolean") c.active = b.active;
    if (b.imageKey && b.imageKey !== c.imageKey) {
      removed.push(c.imageKey);
      c.imageKey = b.imageKey;
    }
    if (Array.isArray(b.extraImageKeys)) {
      const next = b.extraImageKeys.filter((k) => ownsKey(uid, k)).slice(0, CHARACTER_MAX_EXTRA);
      removed.push(...c.extraImageKeys.filter((k) => !next.includes(k)));
      c.extraImageKeys = next;
    }
    c.updatedAt = nowIso();
    return { character: { ...c }, removed };
  });
  if (!result) return fail("Not found.", 404);
  if (!saved) return fail("Couldn't save.", 500);
  await deleteMedia(...result.removed);
  return NextResponse.json({ character: result.character });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const uid = await requireUid();
  if (uid instanceof NextResponse) return uid;
  const { id } = await ctx.params;
  const { result, saved } = await mutateLibrary(uid, (lib) => {
    const c = lib.characters.find((x) => x.id === id);
    lib.characters = lib.characters.filter((x) => x.id !== id);
    return c ?? null;
  });
  if (!result) return fail("Not found.", 404);
  if (!saved) return fail("Couldn't save.", 500);
  await deleteMedia(result.imageKey, ...result.extraImageKeys);
  return NextResponse.json({ ok: true });
}
