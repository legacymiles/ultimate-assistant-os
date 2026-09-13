// ---------------------------------------------------------------------------
// A pasted link → the actual dance video file.
//
// A motion reference needs a real video FILE — a caption or an embed is not
// motion. Getting one is the social-import lib's per-site download workflow
// (videoDownload.ts): TikTok's mirror, FxTwitter for X, yt-dlp for YouTube,
// Instagram, Facebook and ~1,800 other sites, optionally a self-hosted cobalt,
// and finally the page's own og:video. Direct .mp4/.mov links skip all that.
//
// The downloaded original is kept whole; cutting to the model's 15 s happens
// in the browser, where the user can choose which 15 s.
// ---------------------------------------------------------------------------

import "server-only";

import { parseLink, type Platform } from "@/lib/social-import/platform";
import { BlockedUrlError, assertPublic, fetchBytes } from "@/lib/social-import/safeFetch";
import { VideoUnavailableError, downloadVideo } from "@/lib/social-import/videoDownload";

import { SOURCE_MAX_BYTES } from "../limits";
import { readMp4Info } from "../mp4";

export class ImportError extends Error {
  constructor(
    message: string,
    public status = 422,
    public trail: string[] = [],
  ) {
    super(message);
  }
}

export interface ImportedVideo {
  bytes: Buffer;
  contentType: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  poster: { bytes: Buffer; contentType: string } | null;
  title: string;
  author: string;
  platform: Platform;
  url: string;
  trail: string[];
}

const UPLOAD_INSTEAD = "You can also save the video to your device and use Upload Video.";

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((l) => l.replace(/https?:\/\/\S+/g, "").replace(/#[\p{L}\p{N}_]+/gu, "").trim())
      .find(Boolean) ?? ""
  ).slice(0, 80);
}

export async function importDanceVideo(input: string): Promise<ImportedVideo> {
  const link = parseLink(input);
  if (!link) throw new ImportError("That doesn't look like a link.", 400);
  try {
    await assertPublic(link.url);
  } catch (err) {
    throw new ImportError(err instanceof BlockedUrlError ? err.message : "That link can't be reached.", 400);
  }

  let bytes: Buffer;
  let contentType = "video/mp4";
  let title = "";
  let author = "";
  let thumbnail: string | null = null;
  let hint = { durationSec: null as number | null, width: null as number | null, height: null as number | null };
  let trail: string[] = [];

  if (link.platform === "web" && /\.(mp4|mov|m4v)$/i.test(link.url.pathname)) {
    const got = await fetchBytes(link.url.href, { maxBytes: SOURCE_MAX_BYTES, timeoutMs: 90_000, accept: "video/*" });
    if (!got) throw new ImportError(`Couldn't download that video — it may be over ${SOURCE_MAX_BYTES / 1e6} MB or the host refused. ${UPLOAD_INSTEAD}`);
    bytes = got.bytes;
    title = decodeURIComponent(link.url.pathname.split("/").pop() ?? "").replace(/\.\w+$/, "");
    trail = ["Direct video link.", "Downloaded the video file."];
  } else {
    try {
      const video = await downloadVideo(link.url, link.platform, { maxBytes: SOURCE_MAX_BYTES });
      bytes = video.bytes;
      contentType = video.contentType;
      title = firstLine(video.title);
      author = video.author;
      thumbnail = video.thumbnailUrl;
      hint = { durationSec: video.durationSec, width: video.width, height: video.height };
      trail = video.trail;
    } catch (err) {
      if (err instanceof VideoUnavailableError) throw new ImportError(`${err.message} ${err.needsLogin ? "" : UPLOAD_INSTEAD}`.trim(), 422, err.trail);
      throw err;
    }
  }

  const info = readMp4Info(bytes);
  if (contentType !== "video/webm" && !info.isMp4) throw new ImportError(`That link's video isn't a format the model can read. ${UPLOAD_INSTEAD}`);
  if (info.isMp4 && bytes.subarray(8, 12).toString("latin1") === "qt  ") contentType = "video/quicktime";

  const posterBytes = thumbnail ? await fetchBytes(thumbnail, { maxBytes: 5_000_000, accept: "image/jpeg,image/*" }) : null;
  const poster = posterBytes && /^image\/jpe?g$/.test(posterBytes.type) ? { bytes: posterBytes.bytes, contentType: "image/jpeg" } : null;

  return {
    bytes,
    contentType,
    durationSec: info.durationSec ?? hint.durationSec,
    width: info.width ?? hint.width,
    height: info.height ?? hint.height,
    poster,
    title,
    author,
    platform: link.platform,
    url: link.url.href,
    trail,
  };
}
