import { NextResponse } from "next/server";
import { archiveFromServer, libraryUid } from "@/lib/music-creator/library";

// POST /api/music-creator/library  { renderId, fileId }
//
// Copies a finished take off the GPU pod into the account's own library, so it
// plays forever without the pod. Called right after every render, and again
// for any older take that was made before this existed.

export const runtime = "nodejs";
export const maxDuration = 120;

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export async function POST(req: Request) {
  const uid = await libraryUid();
  if (!uid) return NextResponse.json({ error: "Sign in to save songs to your account." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { renderId?: unknown; fileId?: unknown };
  const renderId = typeof body.renderId === "string" ? body.renderId : "";
  const fileId = typeof body.fileId === "string" ? body.fileId : "";
  if (!ID_RE.test(renderId) || !ID_RE.test(fileId)) {
    return NextResponse.json({ error: "renderId and fileId are required." }, { status: 400 });
  }

  try {
    return NextResponse.json({ saved: await archiveFromServer(uid, renderId, fileId) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
