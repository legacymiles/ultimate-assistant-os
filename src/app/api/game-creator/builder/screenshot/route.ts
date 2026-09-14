import { NextResponse } from "next/server";
import { MAX_SHOT_BYTES, putShot } from "@/lib/game-creator/store";
import { builderUid, notFound, unauthorized } from "@/lib/game-creator/http";

// POST /api/game-creator/builder/screenshot   (multipart form-data)
//   gameId, file (png), name (the file name on the PC), caption?
//
// A PNG the skill captured in the editor. The PC file name makes a re-sent
// screenshot a no-op, so the builder can retry freely.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const uid = await builderUid(req);
  if (!uid) return unauthorized();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form-data" }, { status: 400 });
  }
  const gameId = String(form.get("gameId") ?? "");
  const file = form.get("file");
  if (!gameId || !(file instanceof File)) {
    return NextResponse.json({ error: "gameId and file are required" }, { status: 400 });
  }
  if (file.size > MAX_SHOT_BYTES) {
    return NextResponse.json({ error: "Screenshot is over 8 MB" }, { status: 413 });
  }
  const type = file.type || "image/png";
  if (!/^image\/(png|jpeg|webp)$/.test(type)) {
    return NextResponse.json({ error: "Screenshots must be PNG, JPEG or WebP" }, { status: 415 });
  }

  const game = await putShot(uid, gameId, Buffer.from(await file.arrayBuffer()), {
    file: String(form.get("name") ?? file.name ?? "").slice(0, 120) || undefined,
    caption: String(form.get("caption") ?? "").slice(0, 200) || undefined,
    contentType: type,
  });
  if (!game) return notFound();
  return NextResponse.json({ ok: true, screenshots: game.screenshots.length });
}
