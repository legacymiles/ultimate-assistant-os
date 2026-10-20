// GET    /api/viral-studio/media?key=…   — a saved clip or poster
// DELETE /api/viral-studio/media         { keys: [] } — free the files of deleted tiles
//
// Ownership is the key prefix. On Storage, GET redirects to a short signed
// link so video seeking uses Supabase's own range support; on local disk it
// serves byte ranges itself.

import { NextResponse } from "next/server";

import { currentUid } from "@/lib/dance-studio/server/library";
import { contentTypeFor, deleteMedia, getMedia, ownsKey, remoteStorage, signedReadUrl } from "@/lib/viral-studio/server/storage";

export const dynamic = "force-dynamic";

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

export async function GET(req: Request) {
  const uid = await currentUid().catch(() => null);
  const key = new URL(req.url).searchParams.get("key");
  if (!uid || !ownsKey(uid, key)) return notFound();

  if (remoteStorage()) {
    const url = await signedReadUrl(key, 3600);
    if (!url) return notFound();
    return NextResponse.redirect(url, { status: 302, headers: { "cache-control": "private, max-age=600" } });
  }

  const bytes = await getMedia(key);
  if (!bytes) return notFound();
  const total = bytes.length;
  const base = { "content-type": contentTypeFor(key), "accept-ranges": "bytes", "cache-control": "private, max-age=600" };

  const m = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : total - 1;
    end = Math.min(end, total - 1);
    if (start >= total || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${total}` } });
    start = Math.max(0, start);
    return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
      status: 206,
      headers: { ...base, "content-range": `bytes ${start}-${end}/${total}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(new Uint8Array(bytes), { headers: { ...base, "content-length": String(total) } });
}

export async function DELETE(req: Request) {
  const uid = await currentUid().catch(() => null);
  if (!uid) return NextResponse.json({ deleted: 0 });
  let keys: unknown[] = [];
  try {
    const body = await req.json();
    keys = Array.isArray(body?.keys) ? body.keys : [];
  } catch {
    // An empty body deletes nothing.
  }
  const mine = keys.filter((k): k is string => ownsKey(uid, k)).slice(0, 200);
  await deleteMedia(mine).catch(() => undefined);
  return NextResponse.json({ deleted: mine.length });
}
