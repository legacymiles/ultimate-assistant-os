// ---------------------------------------------------------------------------
// Dance Studio media: reference clips, character images, posters, results.
//
// Rides on the hub's blobStore, so it lives in a private Supabase Storage
// bucket when the service-role key is set and on local disk otherwise. The
// difference matters more here than anywhere else in the hub: the video model
// downloads the clip and the character image itself, from a signed link, so
// generation only works on the Storage backend. Local disk can hold a library
// but nothing outside this machine can fetch from it.
//
// Every key starts with the owner's id. That prefix IS the access rule — the
// media route refuses a key that isn't yours.
// ---------------------------------------------------------------------------

import "server-only";

import path from "node:path";

import { dataDir } from "@/lib/dances/dataDir";
import {
  deleteBlob,
  ensureBucket,
  getBlob,
  isRemoteConfigured,
  putBlob,
  signedBlobUrl,
  signedUploadUrl,
} from "@/lib/server/blobStore";

export const BUCKET = "dance-studio";

export type MediaFolder = "sources" | "clips" | "chars" | "posters" | "out";

const EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const TYPE_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([t, e]) => [e, t]));

/** Which content types each folder accepts from a browser upload. */
export const UPLOAD_TYPES: Record<Exclude<MediaFolder, "out">, string[]> = {
  sources: ["video/mp4", "video/quicktime", "video/webm"],
  clips: ["video/mp4"],
  chars: ["image/jpeg"],
  posters: ["image/jpeg"],
};

function localDir(): string {
  return path.join(dataDir(), ".dance-studio-media");
}

export function remoteStorage(): boolean {
  return isRemoteConfigured();
}

export function mediaKey(uid: string, folder: MediaFolder, contentType: string): string {
  const id = crypto.randomUUID().replace(/-/g, "");
  return `${uid}/${folder}/${id}.${EXT[contentType] ?? "bin"}`;
}

export function ownsKey(uid: string, key: unknown): key is string {
  if (typeof key !== "string") return false;
  const prefix = `${uid}/`;
  if (!key.startsWith(prefix)) return false;
  return /^(sources|clips|chars|posters|out)\/[A-Za-z0-9_-]{6,64}\.(mp4|mov|webm|jpg|png|webp)$/.test(key.slice(prefix.length));
}

export function contentTypeFor(key: string): string {
  return TYPE_BY_EXT[key.split(".").pop() ?? ""] ?? "application/octet-stream";
}

async function ready(): Promise<void> {
  if (!(await ensureBucket(BUCKET))) throw new Error(`Couldn't create or reach the "${BUCKET}" storage bucket.`);
}

export async function putMedia(key: string, bytes: Buffer, contentType: string): Promise<boolean> {
  await ready();
  return putBlob(BUCKET, key, localDir(), bytes, contentType);
}

export async function getMedia(key: string): Promise<Buffer | null> {
  return getBlob(BUCKET, key, localDir());
}

export async function deleteMedia(...keys: (string | undefined)[]): Promise<void> {
  await Promise.all(keys.filter(Boolean).map((k) => deleteBlob(BUCKET, k as string, localDir())));
}

/** A link the model (or the browser) can download from. Null on local disk. */
export async function signedReadUrl(key: string, ttlSeconds = 6 * 3600): Promise<string | null> {
  if (!remoteStorage()) return null;
  await ready();
  return signedBlobUrl(BUCKET, key, ttlSeconds);
}

/** Where the browser should PUT a file. Local disk goes through our own route. */
export async function uploadTarget(key: string): Promise<string> {
  if (!remoteStorage()) return `/api/dance-studio/upload?key=${encodeURIComponent(key)}`;
  await ready();
  const url = await signedUploadUrl(BUCKET, key);
  if (!url) throw new Error("Storage wouldn't issue an upload link.");
  return url;
}
