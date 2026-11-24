import { NextResponse } from "next/server";
import type { UploadRequest, UploadResponse } from "@/lib/h3-lab/api";
import { ensureBucket, isRemoteConfigured, signedUploadUrl } from "@/lib/server/blobStore";
import { CLIP_BUCKET } from "@/lib/h3-lab/server/store";
import { bad, readJson, unauthorized, workerUid } from "@/lib/h3-lab/server/http";

// POST /api/h3-lab/worker/upload — a signed Storage PUT for one rendered clip.
// No storage configured → { url: null } and the clip stays on the PC.

export const runtime = "nodejs";

export async function POST(req: Request) {
  const uid = await workerUid(req);
  if (!uid) return unauthorized();
  const body = await readJson<UploadRequest>(req);
  if (!body?.generationId || !/^[\w-]+$/.test(body.generationId)) return bad("generationId is required.");
  if (!isRemoteConfigured() || !(await ensureBucket(CLIP_BUCKET))) {
    return NextResponse.json({ url: null, key: null } satisfies UploadResponse);
  }
  const key = `${uid}/${body.generationId}.mp4`;
  const url = await signedUploadUrl(CLIP_BUCKET, key);
  return NextResponse.json({ url, key: url ? key : null } satisfies UploadResponse);
}
