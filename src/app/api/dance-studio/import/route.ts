// POST /api/dance-studio/import  { url }
//
// Downloads the dance video behind a social link and keeps the original in the
// caller's storage. Returns what the browser needs to show it and, if it's too
// long for the model, let the user choose which part becomes the clip.

import { NextResponse } from "next/server";

import { errorMessage, fail, readJson, requireUid } from "@/lib/dance-studio/server/http";
import { ImportError, importDanceVideo } from "@/lib/dance-studio/server/importLink";
import { mediaKey, putMedia } from "@/lib/dance-studio/server/storage";
import type { ImportedSource } from "@/lib/dance-studio/types";

export const dynamic = "force-dynamic";
// yt-dlp may need to fetch itself (~40 MB) on a cold instance before downloading.
export const maxDuration = 300;

export async function POST(req: Request) {
  const uid = await requireUid();
  if (uid instanceof NextResponse) return uid;
  const body = await readJson<{ url?: string }>(req);
  if (!body?.url?.trim()) return fail("Paste a link to a dance video.");

  try {
    const video = await importDanceVideo(body.url);
    const sourceKey = mediaKey(uid, "sources", video.contentType);
    if (!(await putMedia(sourceKey, video.bytes, video.contentType))) return fail("Couldn't store the downloaded video.", 500);

    let posterKey: string | undefined;
    if (video.poster) {
      const key = mediaKey(uid, "posters", video.poster.contentType);
      if (await putMedia(key, video.poster.bytes, video.poster.contentType)) posterKey = key;
    }

    const out: ImportedSource = {
      sourceKey,
      posterKey,
      contentType: video.contentType,
      sizeBytes: video.bytes.length,
      durationSec: video.durationSec,
      width: video.width,
      height: video.height,
      title: video.title,
      author: video.author,
      platform: video.platform,
      url: video.url,
      trail: video.trail,
    };
    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof ImportError) {
      return NextResponse.json({ error: err.message, trail: err.trail }, { status: err.status });
    }
    return fail(`Import failed: ${errorMessage(err)}`, 502);
  }
}
