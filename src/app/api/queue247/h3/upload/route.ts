// POST /api/queue247/h3/upload   { filename, type, size } → { key, uploadUrl } | { key, local: true }
// PUT  /api/queue247/h3/upload?key=…   (local development only) — the bytes
//
// The reference video for an H3 recreation task. The browser PUTs the file
// straight to a one-time Storage link (bucket queue-247), so a 500 MB video
// never passes through a function body capped at 4.5 MB. The key is always
// uploads/<uid>/<random>.<ext> — chosen here, never by the caller — and the
// executor refuses a key outside the task owner's folder.
//
// With no Supabase configured (local demo mode) the file is PUT back to this
// route and kept under <dataDir>/.queue-247/, which only a worker on the same
// computer can read.

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isRemoteConfigured, signedUploadUrl } from "@/lib/server/blobStore";
import { browserUid } from "@/lib/new-jarvis/server/requestsAuth";
import { H3_BUCKET, MAX_UPLOAD_BYTES, UPLOAD_TYPES, ownsUpload, uploadExt, uploadKey, uploadProblem } from "@/lib/queue247/h3/upload";
import { putFile, readyBucket } from "@/lib/queue247/h3/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const uid = await browserUid();
  if (!uid) return fail(401, "Sign in to upload a video.");
  const body = (await req.json().catch(() => null)) as { filename?: unknown; type?: unknown; size?: unknown } | null;
  if (!body) return fail(400, "Send the file's name, type and size.");
  const file = { filename: String(body.filename ?? ""), type: String(body.type ?? ""), size: Number(body.size) };
  const problem = uploadProblem(file);
  if (problem) return fail(400, problem);
  const ext = uploadExt(file)!;
  const key = uploadKey(uid, ext, randomUUID());
  if (!isRemoteConfigured()) return NextResponse.json({ key, type: UPLOAD_TYPES[ext], local: true });
  if (!(await readyBucket())) return fail(503, "Storage isn't reachable right now. Try again in a minute.");
  const uploadUrl = await signedUploadUrl(H3_BUCKET, key);
  if (!uploadUrl) return fail(503, "Storage couldn't make an upload link. Try again in a minute.");
  return NextResponse.json({ key, type: UPLOAD_TYPES[ext], uploadUrl });
}

export async function PUT(req: Request) {
  if (isRemoteConfigured()) return fail(400, "Upload with the storage link instead.");
  const uid = await browserUid();
  if (!uid) return fail(401, "Sign in to upload a video.");
  const key = new URL(req.url).searchParams.get("key");
  if (!ownsUpload(uid, key)) return fail(403, "That isn't your upload.");
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES) return fail(413, "That video is over the 500 MB limit.");
  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) return fail(400, "That file is empty or over the 500 MB limit.");
  const ok = await putFile(key!, bytes, req.headers.get("content-type") || "video/mp4");
  return ok ? NextResponse.json({ ok: true, key }) : fail(500, "Couldn't save the video on this computer.");
}
