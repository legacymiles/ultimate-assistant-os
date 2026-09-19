import { NextResponse } from "next/server";
import { SAVED_FILE_RE, contentTypeFor, libraryUid, savedSongBytes, savedSongUrl } from "@/lib/music-creator/library";

// GET /api/music-creator/library/<renderId>.<ext>[?download=1]
//
// Plays a song from the account's library. On Supabase this redirects to a
// short-lived signed Storage link (the audio element follows it and seeks with
// Range requests straight against Storage — a 30 MB song never passes through
// a function body). On local disk it serves the bytes itself.

export const runtime = "nodejs";

type Ctx = { params: Promise<{ file: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { file } = await ctx.params;
  if (!SAVED_FILE_RE.test(file)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const uid = await libraryUid();
  if (!uid) return NextResponse.json({ error: "Sign in to play your songs." }, { status: 401 });
  const download = !!new URL(req.url).searchParams.get("download");

  const signed = await savedSongUrl(uid, file, download);
  if (signed) return NextResponse.redirect(signed, { status: 302, headers: { "cache-control": "private, no-store" } });

  const bytes = await savedSongBytes(uid, file);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const headers: Record<string, string> = {
    "content-type": contentTypeFor(file),
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
  };
  if (download) headers["content-disposition"] = `attachment; filename="${file}"`;

  const m = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    const size = bytes.length;
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = Math.min(m[1] && m[2] ? Number(m[2]) : size - 1, size - 1);
    if (start > end || start >= size) {
      return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    }
    return new NextResponse(new Uint8Array(bytes.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  }
  return new NextResponse(new Uint8Array(bytes), { headers: { ...headers, "content-length": String(bytes.length) } });
}
