import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { signedBlobUrl } from "@/lib/server/blobStore";
import { CLIP_BUCKET, loadLab } from "@/lib/h3-lab/server/store";
import { bad, sessionUid } from "@/lib/h3-lab/server/http";

// GET /api/h3-lab/clip?gen=<id> — play one rendered clip. Owner-only.
//
// Uploaded clips redirect to a short-lived signed Storage URL. A clip that
// only exists on the PC (no storage configured, or the upload failed) is
// streamed from disk — but only when the hub itself runs on that PC, and only
// from inside WanGP's outputs folder, so this can never become a file reader.

export const runtime = "nodejs";

function outputsRoot(): string {
  return path.resolve(process.env.WANGP_DIR || "C:\\pinokio\\api\\wan", "app", "outputs");
}

export async function GET(req: Request) {
  const gen = new URL(req.url).searchParams.get("gen") ?? "";
  if (!/^[\w-]+$/.test(gen)) return bad("gen is required.");
  const state = await loadLab(await sessionUid());
  const g = state.generations.find((x) => x.id === gen);
  if (!g?.clip) return bad("That render has no clip yet.", 404);

  if (g.clip.key) {
    const url = await signedBlobUrl(CLIP_BUCKET, g.clip.key, 3600);
    if (url) return NextResponse.redirect(url, 307);
  }

  if (process.env.VERCEL || !g.clip.localPath) return bad("This clip is stored on the PC only — open the lab on that PC to play it.", 404);
  const full = path.resolve(g.clip.localPath);
  const root = outputsRoot();
  if (!full.toLowerCase().startsWith(root.toLowerCase() + path.sep)) return bad("Clip path is outside WanGP's outputs folder.", 403);
  let size: number;
  try {
    size = (await stat(full)).size;
  } catch {
    return bad("The clip file is no longer on this PC.", 404);
  }

  const range = req.headers.get("range");
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: { "Content-Type": "video/mp4", "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" },
    });
  }
  const stream = Readable.toWeb(createReadStream(full)) as ReadableStream;
  return new NextResponse(stream, { headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Accept-Ranges": "bytes" } });
}
