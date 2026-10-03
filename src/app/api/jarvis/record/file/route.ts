// POST   /api/jarvis/record/file   { id, dataUrl }  — keep a document's picture
// DELETE /api/jarvis/record/file?id=…               — and forget it again
//
// The metadata lives in the owner's record, in their browser. This holds only
// the bytes, under their own id, and never reads them back without a session.

import { NextResponse } from "next/server";
import {
  currentUid,
  decodeDataUrl,
  deleteRecordFile,
  putRecordFile,
  validId,
} from "@/lib/jarvis/record/server/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: "Sign in to keep a document." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { id?: unknown; dataUrl?: unknown };
  if (!validId(body.id)) return NextResponse.json({ error: "Bad file id." }, { status: 400 });

  const decoded = decodeDataUrl(body.dataUrl);
  if (!decoded) {
    return NextResponse.json(
      { error: "That is not a picture this can keep — JPEG, PNG or WebP, under 6 MB." },
      { status: 400 },
    );
  }

  const ok = await putRecordFile(uid, body.id, decoded.mime, decoded.body);
  if (!ok) return NextResponse.json({ error: "The picture could not be stored." }, { status: 502 });

  return NextResponse.json({ id: body.id, bytes: decoded.body.length, mime: decoded.mime });
}

export async function DELETE(req: Request) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!validId(id)) return NextResponse.json({ error: "Bad file id." }, { status: 400 });

  await deleteRecordFile(uid, id);
  return NextResponse.json({ ok: true });
}
