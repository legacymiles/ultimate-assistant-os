// GET /api/dance-studio/media?key=…
//
// The one way media reaches a browser. Ownership is the key prefix. On
// Storage it redirects to a short signed link, so video seeking hits
// Supabase's range support directly; on local disk it serves ranges itself.

import { NextResponse } from "next/server";

import { fail, requireUid } from "@/lib/dance-studio/server/http";
import { contentTypeFor, getMedia, ownsKey, remoteStorage, signedReadUrl } from "@/lib/dance-studio/server/storage";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const uid = await requireUid();
  if (uid instanceof NextResponse) return uid;
  const key = new URL(req.url).searchParams.get("key");
  if (!ownsKey(uid, key)) return fail("Not found.", 404);

  if (remoteStorage()) {
    const url = await signedReadUrl(key, 3600);
    if (!url) return fail("Not found.", 404);
    return NextResponse.redirect(url, { status: 302, headers: { "cache-control": "private, max-age=600" } });
  }

  const bytes = await getMedia(key);
  if (!bytes) return fail("Not found.", 404);
  const total = bytes.length;
  const base = { "content-type": contentTypeFor(key), "accept-ranges": "bytes", "cache-control": "private, max-age=600" };

  const m = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : total - 1;
    end = Math.min(end, total - 1);
    if (start >= total || start > end) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${total}` } });
    }
    start = Math.max(0, start);
    return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
      status: 206,
      headers: { ...base, "content-range": `bytes ${start}-${end}/${total}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(new Uint8Array(bytes), { headers: { ...base, "content-length": String(total) } });
}
