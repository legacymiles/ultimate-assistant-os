// ---------------------------------------------------------------------------
// The recreation's files in Storage — server side (route + VPS worker).
//
// Thin wrappers over lib/server/blobStore.ts for the `queue-247` bucket. Big
// videos are streamed to disk through a signed link rather than read into
// memory. On a hub with no Supabase (local demo mode) the bucket is a folder,
// `<dataDir>/.queue-247/`, which only works when the worker runs on the same
// machine as the site — the executor says so when it cannot find a file.
//
// No Next request context is needed (no cookies, no headers), so the VPS
// worker's esbuild bundle can import this.
// ---------------------------------------------------------------------------

import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { ensureBucket, getBlob, isRemoteConfigured, putBlob, signedBlobUrl } from "@/lib/server/blobStore";
import { dataDir } from "@/lib/recall/dataDir";
import { H3_BUCKET } from "./upload";

export function localBlobDir(): string {
  return path.join(dataDir(), ".queue-247");
}

export async function readyBucket(): Promise<boolean> {
  return ensureBucket(H3_BUCKET);
}

export async function putFile(key: string, body: Buffer, contentType: string): Promise<boolean> {
  await ensureBucket(H3_BUCKET);
  return putBlob(H3_BUCKET, key, localBlobDir(), body, contentType);
}

export async function getFile(key: string): Promise<Buffer | null> {
  return getBlob(H3_BUCKET, key, localBlobDir());
}

/** Size in bytes when the object exists, else null. */
export async function fileSize(key: string, signal?: AbortSignal): Promise<number | null> {
  if (isRemoteConfigured()) {
    const url = await signedBlobUrl(H3_BUCKET, key, 120);
    if (!url) return null;
    try {
      const res = await fetch(url, { headers: { Range: "bytes=0-0" }, signal });
      if (!res.ok) return null;
      const range = res.headers.get("content-range");
      await res.body?.cancel().catch(() => undefined);
      const total = range ? Number(range.split("/")[1]) : Number(res.headers.get("content-length"));
      return Number.isFinite(total) ? total : 0;
    } catch {
      return null;
    }
  }
  try {
    return (await fs.stat(path.join(localBlobDir(), key))).size;
  } catch {
    return null;
  }
}

/** Stream an object to a local file. Throws a plain-English Error when it cannot. */
export async function downloadToFile(key: string, dest: string, signal?: AbortSignal): Promise<number> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (isRemoteConfigured()) {
    const url = await signedBlobUrl(H3_BUCKET, key, 900);
    if (!url) throw new Error(`Storage would not hand over ${key} — the file may be gone.`);
    const res = await fetch(url, { signal });
    if (!res.ok || !res.body) throw new Error(`Downloading the video from Storage failed (HTTP ${res.status}).`);
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(dest), { signal });
  } else {
    try {
      await fs.copyFile(path.join(localBlobDir(), key), dest);
    } catch {
      throw new Error(`The video ${key} is not on this machine. Without Supabase Storage the worker must run on the same computer as the site.`);
    }
  }
  return (await fs.stat(dest)).size;
}
