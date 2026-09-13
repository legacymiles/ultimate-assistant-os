// POST /api/dance-studio/upload  { folder, contentType } → { key, url, headers }
//   Issues a key in the caller's space and where to PUT the bytes: a signed
//   Supabase Storage link (so big files skip the 4.5 MB function body cap), or
//   this route on local disk.
// PUT  /api/dance-studio/upload?key=…   raw body — the local-disk path.

import { NextResponse } from "next/server";

import { fail, readJson, requireUid } from "@/lib/dance-studio/server/http";
import { UPLOAD_TYPES, mediaKey, ownsKey, putMedia, remoteStorage, uploadTarget } from "@/lib/dance-studio/server/storage";
import type { MediaFolder } from "@/lib/dance-studio/server/storage";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const uid = await requireUid();
  if (uid instanceof NextResponse) return uid;
  const body = await readJson<{ folder?: string; contentType?: string }>(req);
  const folder = body?.folder as Exclude<MediaFolder, "out">;
  const type = String(body?.contentType ?? "");
  if (!UPLOAD_TYPES[folder]) return fail("Unknown upload folder.");
  if (!UPLOAD_TYPES[folder].includes(type)) return fail(`${type || "That file type"} can't go in ${folder}.`);

  const key = mediaKey(uid, folder, type);
  try {
    return NextResponse.json({ key, url: await uploadTarget(key), method: "PUT", headers: { "content-type": type } });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Couldn't prepare the upload.", 502);
  }
}

export async function PUT(req: Request) {
  const uid = await requireUid();
  if (uid instanceof NextResponse) return uid;
  if (remoteStorage()) return fail("Upload to the signed storage link instead.", 409);
  const key = new URL(req.url).searchParams.get("key");
  if (!ownsKey(uid, key)) return fail("Not your upload key.", 403);

  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length) return fail("Empty upload.");
  const ok = await putMedia(key, bytes, req.headers.get("content-type") ?? "application/octet-stream");
  return ok ? NextResponse.json({ ok: true, key }) : fail("Couldn't save the file.", 500);
}
