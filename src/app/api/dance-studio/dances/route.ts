// POST /api/dance-studio/dances — file a reference dance whose clip is already uploaded.

import { NextResponse } from "next/server";

import { REF_MAX_SEC, REF_MIN_SEC } from "@/lib/dance-studio/limits";
import { fail, newId, nowIso, readJson, requireUid } from "@/lib/dance-studio/server/http";
import { mutateLibrary } from "@/lib/dance-studio/server/library";
import { ownsKey } from "@/lib/dance-studio/server/storage";
import type { ReferenceDance } from "@/lib/dance-studio/types";

export const dynamic = "force-dynamic";

type Body = Partial<Omit<ReferenceDance, "id" | "createdAt">>;

export async function POST(req: Request) {
  const uid = await requireUid();
  if (uid instanceof NextResponse) return uid;
  const b = await readJson<Body>(req);
  if (!b) return fail("Bad request body.");

  const name = String(b.name ?? "").trim().slice(0, 80);
  if (!name) return fail("A dance needs a name.");
  if (!ownsKey(uid, b.videoKey) || !b.videoKey.includes("/clips/") && !b.videoKey.includes("/sources/")) {
    return fail("Upload the dance clip first.");
  }
  for (const k of [b.originalKey, b.posterKey]) if (k !== undefined && !ownsKey(uid, k)) return fail("Unknown media key.");

  const durationSec = Number(b.durationSec);
  if (!Number.isFinite(durationSec) || durationSec < REF_MIN_SEC || durationSec > REF_MAX_SEC + 0.6) {
    return fail(`The motion clip must be ${REF_MIN_SEC}–${REF_MAX_SEC} seconds; this one is ${Number.isFinite(durationSec) ? durationSec.toFixed(1) : "unknown"}s.`);
  }

  const dance: ReferenceDance = {
    id: newId("dance"),
    name,
    videoKey: b.videoKey,
    originalKey: b.originalKey,
    clipStartSec: typeof b.clipStartSec === "number" ? b.clipStartSec : undefined,
    posterKey: b.posterKey,
    durationSec,
    width: Number(b.width) || undefined,
    height: Number(b.height) || undefined,
    source: b.source?.url ? { url: String(b.source.url), platform: b.source.platform ?? "web", author: b.source.author } : { url: "", platform: "upload" },
    createdAt: nowIso(),
  };

  const { saved } = await mutateLibrary(uid, (lib) => lib.dances.unshift(dance));
  if (!saved) return fail("Couldn't save the dance library.", 500);
  return NextResponse.json({ dance });
}
