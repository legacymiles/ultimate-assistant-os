// POST /api/viral-studio/upload   { type, size, name } → { key, uploadUrl } | { key, local: true }
// PUT  /api/viral-studio/upload?key=…   (local development only) — the bytes
//
// For a clip the network wouldn't hand over (a Facebook video only signed-in
// people can see, say): the owner picks the saved video from their phone or
// computer and it goes straight into their storage. The browser PUTs the file
// to a one-time Storage link, so a phone video isn't squeezed through a
// function body capped at 4.5 MB. The key starts with the owner's id, which is
// the same access rule the media route already enforces.

import { NextResponse } from "next/server";

import { signedUploadUrl } from "@/lib/server/blobStore";
import { currentUid } from "@/lib/dance-studio/server/library";
import { BUCKET, newKey, ownsKey, putMedia, remoteStorage } from "@/lib/viral-studio/server/storage";
import { UPLOAD_MAX_BYTES, uploadProblem, uploadType } from "@/lib/viral-studio/stuck";
import { ensureBucket } from "@/lib/server/blobStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const uid = await currentUid().catch(() => null);
  if (!uid) return fail(401, "Sign in to upload videos.");
  const body = (await req.json().catch(() => ({}))) as { type?: unknown; size?: unknown; name?: unknown };
  const file = { type: String(body.type ?? ""), size: Number(body.size), name: String(body.name ?? "") };
  const problem = uploadProblem(file);
  if (problem) return fail(400, problem);
  const type = uploadType(file)!;
  const key = newKey(uid, "clips", type);
  if (!remoteStorage()) return NextResponse.json({ key, type, local: true });
  if (!(await ensureBucket(BUCKET))) return fail(503, "Storage isn't reachable right now. Try again in a minute.");
  const uploadUrl = await signedUploadUrl(BUCKET, key);
  if (!uploadUrl) return fail(503, "Storage couldn't make an upload link. Try again in a minute.");
  return NextResponse.json({ key, type, uploadUrl });
}

export async function PUT(req: Request) {
  if (remoteStorage()) return fail(400, "Upload with the storage link instead.");
  const uid = await currentUid().catch(() => null);
  const key = new URL(req.url).searchParams.get("key");
  if (!uid || !ownsKey(uid, key)) return fail(403, "That isn't your upload.");
  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length || bytes.length > UPLOAD_MAX_BYTES) return fail(400, "That file is empty or too big.");
  const ok = await putMedia(key, bytes, req.headers.get("content-type") || "video/mp4");
  return ok ? NextResponse.json({ ok: true }) : fail(500, "Couldn't save the file on this computer.");
}
