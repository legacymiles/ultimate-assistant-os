import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { downloadName, fileNameFrom } from "@/lib/mp3-download/match";
import { claim, discard, stage } from "@/lib/mp3-download/staging";
import type { Track } from "@/lib/mp3-download/types";
import {
  extractMedia,
  isSupportedMediaUrl,
  ytdlpStatus,
  type GrabMode,
} from "@/lib/mp3-download/ytdlp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A long video on a slow connection; yt-dlp itself is capped below this. */
export const maxDuration = 300;

/**
 * GET — the engine's status, or, with `?token=`, the finished file itself.
 *
 * The token half is the collection step: the POST below did the work and
 * staged the file, and this streams it out under a Content-Disposition name.
 * A plain GET is the only download path browsers handle at any size — the
 * blob a POST would have to use holds the whole file in the tab's memory and
 * silently loses large ones.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = params.get("token");

  if (!token) {
    return NextResponse.json(await ytdlpStatus(params.get("refresh") === "1"));
  }

  const file = claim(token);
  if (!file) {
    return NextResponse.json(
      { error: "That download has already been collected, or it expired." },
      { status: 404 },
    );
  }

  const handle = createReadStream(file.path);
  const done = () => discard(file);
  handle.on("close", done);
  handle.on("error", done);

  const ascii = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return new Response(Readable.toWeb(handle) as ReadableStream, {
    headers: {
      "content-type": file.contentType,
      "content-length": String(file.bytes),
      "content-disposition":
        `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "cache-control": "no-store",
    },
  });
}

interface GrabBody {
  url?: string;
  /** Present when the grab came from a confirmed catalogue track. */
  track?: Track;
  /** Present when it came from the paste box: what the site called it. */
  title?: string;
  creator?: string;
  mode?: GrabMode;
}

/**
 * POST — pull one URL's media and answer with a ticket to collect it.
 *
 * Answering with JSON rather than bytes is what lets a failure be a sentence
 * the owner can read instead of a truncated file, and lets the page show the
 * real size before the save begins.
 */
export async function POST(request: Request) {
  let body: GrabBody;
  try {
    body = (await request.json()) as GrabBody;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const url = (body.url ?? "").trim();
  const mode: GrabMode = body.mode === "video" ? "video" : "audio";

  if (!isSupportedMediaUrl(url)) {
    return NextResponse.json(
      { error: "That host is not one of the sites this app downloads from." },
      { status: 400 },
    );
  }

  const status = await ytdlpStatus();
  if (!status.ok) return NextResponse.json({ error: status.message }, { status: 503 });

  const ext = mode === "video" ? "mp4" : status.ffmpeg ? "mp3" : "m4a";
  // A confirmed track names the file from the catalogue; a pasted link names
  // it from whatever the site called it. Either beats "grab.mp3".
  const basename = body.track
    ? downloadName(body.track, ext)
    : fileNameFrom(body.creator ?? "", body.title ?? "download", ext);

  try {
    const file = await extractMedia(url, basename, mode);
    const token = stage(file);
    return NextResponse.json({
      token,
      filename: file.filename,
      bytes: file.bytes,
      href: "/api/mp3-download/ytdlp?token=" + token,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "yt-dlp failed." },
      { status: 502 },
    );
  }
}
