import "server-only";

// ---------------------------------------------------------------------------
// The finished video a PC agent sends back for a queue request.
//
// Kids Animation Flow renders on the owner's PC; the MP4 has to come back to
// the website so the Watch stage can play it on any device. A video is far
// bigger than a function body (4.5 MB deployed), so on a deployed hub the
// agent PUTs it straight to Storage through a one-time signed link; locally,
// where no Storage exists, it posts the file to the route instead.
//
// The key is ALWAYS videoKey(uid, id) — derived, never taken from the agent —
// so one request can never overwrite another's file.
// ---------------------------------------------------------------------------

import { ensureBucket, getBlob, isRemoteConfigured, putBlob, signedBlobUrl, signedUploadUrl } from "@/lib/server/blobStore";
import { dataDir } from "@/lib/recall/dataDir";
import { inputKey, videoKey } from "../requests";

export const VIDEO_BUCKET = "queue-videos";
/** Local uploads go through a request body, so cap them. Signed uploads are capped by Storage. */
export const MAX_LOCAL_VIDEO = 200 * 1024 * 1024;

/** A one-time upload link, or null on a local hub (post the file to the route instead). */
export async function videoUploadLink(uid: string, id: string): Promise<{ key: string; url: string } | null> {
  if (!isRemoteConfigured()) return null;
  await ensureBucket(VIDEO_BUCKET);
  const key = videoKey(uid, id);
  const url = await signedUploadUrl(VIDEO_BUCKET, key);
  return url ? { key, url } : null;
}

export async function putVideo(uid: string, id: string, bytes: Buffer): Promise<string | null> {
  if (bytes.length > MAX_LOCAL_VIDEO) return null;
  await ensureBucket(VIDEO_BUCKET);
  const key = videoKey(uid, id);
  return (await putBlob(VIDEO_BUCKET, key, dataDir(), bytes, "video/mp4")) ? key : null;
}

/** A link the browser can play for an hour (deployed), or null — then stream the bytes. */
export async function videoWatchLink(key: string, downloadAs?: string): Promise<string | null> {
  return signedBlobUrl(VIDEO_BUCKET, key, 3600, downloadAs);
}

export async function readVideo(key: string): Promise<Buffer | null> {
  return getBlob(VIDEO_BUCKET, key, dataDir());
}

// ----- The owner's input clip (Custom Video Swap's driving video) ---------------
// Same bucket, its own key, derived the same way — never a path a caller chose.

/** A one-time upload link for the owner's clip, or null on a local hub (post the file instead). */
export async function inputUploadLink(uid: string, id: string): Promise<{ key: string; url: string } | null> {
  if (!isRemoteConfigured()) return null;
  await ensureBucket(VIDEO_BUCKET);
  const key = inputKey(uid, id);
  const url = await signedUploadUrl(VIDEO_BUCKET, key);
  return url ? { key, url } : null;
}

export async function putInput(uid: string, id: string, bytes: Buffer, type = "video/mp4"): Promise<string | null> {
  if (bytes.length > MAX_LOCAL_VIDEO) return null;
  await ensureBucket(VIDEO_BUCKET);
  const key = inputKey(uid, id);
  return (await putBlob(VIDEO_BUCKET, key, dataDir(), bytes, type)) ? key : null;
}

/** Does the clip exist yet? (A signed upload can't tell the hub it finished.) */
export async function hasBlob(key: string): Promise<boolean> {
  if (isRemoteConfigured()) return Boolean(await signedBlobUrl(VIDEO_BUCKET, key, 60));
  return Boolean(await getBlob(VIDEO_BUCKET, key, dataDir()));
}
