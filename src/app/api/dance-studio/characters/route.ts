// POST /api/dance-studio/characters  { name, imageKey, extraImageKeys?, description?, active? }

import { NextResponse } from "next/server";

import { CHARACTER_MAX_EXTRA } from "@/lib/dance-studio/limits";
import { fail, newId, nowIso, readJson, requireUid } from "@/lib/dance-studio/server/http";
import { mutateLibrary } from "@/lib/dance-studio/server/library";
import { ownsKey } from "@/lib/dance-studio/server/storage";
import type { Character } from "@/lib/dance-studio/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const uid = await requireUid();
  if (uid instanceof NextResponse) return uid;
  const b = await readJson<Partial<Character>>(req);
  const name = String(b?.name ?? "").trim().slice(0, 60);
  if (!name) return fail("A character needs a name.");
  if (!ownsKey(uid, b?.imageKey)) return fail("Add a reference image for the character.");
  const extras = (Array.isArray(b?.extraImageKeys) ? b.extraImageKeys : []).filter((k) => ownsKey(uid, k)).slice(0, CHARACTER_MAX_EXTRA);

  const at = nowIso();
  const character: Character = {
    id: newId("char"),
    name,
    imageKey: b!.imageKey!,
    extraImageKeys: extras,
    description: b?.description?.trim().slice(0, 300) || undefined,
    active: b?.active !== false,
    createdAt: at,
    updatedAt: at,
  };
  const { saved } = await mutateLibrary(uid, (lib) => lib.characters.unshift(character));
  return saved ? NextResponse.json({ character }) : fail("Couldn't save the character.", 500);
}
