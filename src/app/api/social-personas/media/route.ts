import { deleteBlob, ensureBucket, isRemoteConfigured, putBlob, signedUploadUrl } from "@/lib/server/blobStore";
import { body, fail, viewerUid } from "@/lib/social-personas/server/http";
import { MEDIA_BUCKET, mediaDir } from "@/lib/social-personas/server/publish";

export const runtime = "nodejs";

const MAX = 1024 * 1024 * 1024; // 1 GB — TikTok's own cap is 4 GB, Reels' 1 GB.
const OK_TYPE = /^(video\/(mp4|quicktime|webm)|image\/(jpeg|png|webp))$/;

function folder(uid: string) {
  return uid.replace(/[^a-z0-9_-]/gi, "") || "local";
}

// POST { name, type, size } → { key, uploadUrl } (browser PUTs straight to
// storage) or { key, local: true } (no storage configured: PUT the bytes here).
export async function POST(req: Request) {
  const b = await body(req);
  const name = typeof b?.name === "string" ? b.name : "";
  const type = typeof b?.type === "string" ? b.type : "";
  const size = Number(b?.size);
  if (!name || !OK_TYPE.test(type)) return fail(400, "Upload an MP4, MOV or WebM video, or a JPG/PNG/WebP photo.");
  if (!Number.isFinite(size) || size <= 0 || size > MAX) return fail(400, "That file is too big. Keep videos under 1 GB.");
  const safeName = name.replace(/[^a-z0-9._-]/gi, "_").slice(-80);
  const key = `${folder(await viewerUid())}/${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
  if (!isRemoteConfigured()) return Response.json({ key, local: true });
  if (!(await ensureBucket(MEDIA_BUCKET))) return fail(503, "Storage isn't reachable right now. Try again in a minute.");
  const uploadUrl = await signedUploadUrl(MEDIA_BUCKET, key);
  if (!uploadUrl) return fail(503, "Storage couldn't make an upload link. Try again in a minute.");
  return Response.json({ key, uploadUrl });
}

// PUT ?key=… (local development only) — the bytes, when there's no storage.
export async function PUT(req: Request) {
  if (isRemoteConfigured()) return fail(400, "Upload with the storage link instead.");
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!key.startsWith(folder(await viewerUid()) + "/") || key.includes("..")) return fail(403, "That isn't your upload.");
  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length || bytes.length > MAX) return fail(400, "That file is empty or too big.");
  const ok = await putBlob(MEDIA_BUCKET, key, mediaDir(), bytes, req.headers.get("content-type") || "application/octet-stream");
  return ok ? Response.json({ ok: true }) : fail(500, "Couldn't save the file on this computer.");
}

// DELETE ?key=… — removes an uploaded file.
export async function DELETE(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!key.startsWith(folder(await viewerUid()) + "/") || key.includes("..")) return fail(403, "That isn't your upload.");
  await deleteBlob(MEDIA_BUCKET, key, mediaDir());
  return Response.json({ ok: true });
}
