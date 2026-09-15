import { NextResponse } from "next/server";
import { sessionUid } from "@/lib/studio3d/http";
import { getMedia } from "@/lib/studio3d/store";

// GET /api/studio3d/media/:projectId/video      — the rendered video (supports Range for seeking)
// GET /api/studio3d/media/:projectId/:index    — one look-dev still
//
// Private: served through the session-gated API, never a public bucket URL.
// ?download=1 asks the browser to save the file instead of playing it.

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; which: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id, which } = await ctx.params;
  const index = which === "video" ? "video" : Number.parseInt(which, 10);
  if (index !== "video" && (!Number.isInteger(index) || index < 0)) {
    return NextResponse.json({ error: "Bad media id" }, { status: 400 });
  }
  const found = await getMedia(await sessionUid(), id, index);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { bytes, media } = found;
  const headers: Record<string, string> = {
    "Content-Type": media.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  if (new URL(req.url).searchParams.get("download")) {
    const ext = media.contentType.split("/")[1]?.replace("quicktime", "mov") ?? "bin";
    headers["Content-Disposition"] = `attachment; filename="${(media.file ?? `${which}.${ext}`).replace(/["\\]/g, "")}"`;
  }

  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    const size = bytes.length;
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    start = Math.max(0, start);
    return new NextResponse(new Uint8Array(bytes.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new NextResponse(new Uint8Array(bytes), { headers: { ...headers, "Content-Length": String(bytes.length) } });
}
