// ---------------------------------------------------------------------------
// Where downloaded clips live: a private Supabase Storage bucket when the
// service-role key is set, local disk otherwise (the hub's blobStore decides).
//
// Every key starts with the owner's id. That prefix IS the access rule — the
// media and delete routes refuse a key that isn't yours.
// ---------------------------------------------------------------------------

import "server-only";

import path from "node:path";

import { dataDir } from "@/lib/dances/dataDir";
import { deleteBlob, ensureBucket, getBlob, isRemoteConfigured, putBlob, signedBlobUrl } from "@/lib/server/blobStore";

export const BUCKET = "viral-studio";

type Folder = "clips" | "posters";

const EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const TYPE_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([t, e]) => [e, t]));

function localDir(): string {
  return path.join(dataDir(), ".viral-studio-media");
}

export function remoteStorage(): boolean {
  return isRemoteConfigured();
}

export function newKey(uid: string, folder: Folder, contentType: string): string {
  return `${uid}/${folder}/${crypto.randomUUID().replace(/-/g, "")}.${EXT[contentType] ?? "bin"}`;
}

export function ownsKey(uid: string, key: unknown): key is string {
  if (typeof key !== "string" || !key.startsWith(`${uid}/`)) return false;
  return /^(clips|posters)\/[A-Za-z0-9_-]{6,64}\.(mp4|mov|webm|jpg|png|webp)$/.test(key.slice(uid.length + 1));
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

export function getMedia(key: string): Promise<Buffer | null> {
  return getBlob(BUCKET, key, localDir());
}

export async function deleteMedia(keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => deleteBlob(BUCKET, k, localDir())));
}

export async function signedReadUrl(key: string, ttlSeconds = 3600): Promise<string | null> {
  if (!remoteStorage()) return null;
  await ready();
  return signedBlobUrl(BUCKET, key, ttlSeconds);
}
