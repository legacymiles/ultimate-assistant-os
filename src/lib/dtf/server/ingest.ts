// ---------------------------------------------------------------------------
// Getting files in and out without hitting the 4.5 MB function body limit.
//
// A 300 DPI full-front print file is routinely 5–20 MB, and so is a good
// customer upload. On Vercel a function can neither receive nor return a body
// that large. So with cloud storage on, bytes travel browser ⇄ Storage
// directly through short-lived signed URLs, and the function only signs,
// then inspects what arrived. Locally (no cloud storage) the bytes simply go
// through the route.
//
// Whichever way they arrive, every file is judged by its BYTES here.
// ---------------------------------------------------------------------------

import "server-only";

import { signedBlobUrl, signedUploadUrl } from "@/lib/server/blobStore";
import { sanitizeSvg } from "../ai/svg";
import type { AssetKind, StoredAsset } from "../types";
import { HttpError, newId } from "./access";
import { sniffImage } from "./imageInfo";
import { BUCKET, assetBytesByKey, deleteAssetByKey, putAsset, remoteConfigured } from "./store";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_PIXELS = 12_000 * 12_000;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" };

export function keyFor(kind: AssetKind, userId: string, id: string, ext: string): string {
  return `${kind}/${userId}/${id}.${ext}`;
}

/** Validate bytes and store them as an asset of this user. */
export async function ingestBytes(
  userId: string,
  raw: Uint8Array,
  kind: AssetKind,
  name: string,
  opts: { id?: string; sourceAssetId?: string } = {},
): Promise<StoredAsset> {
  if (raw.byteLength > MAX_UPLOAD_BYTES) throw new HttpError(413, "That file is over 25 MB. Export a smaller PNG.");
  const info = sniffImage(raw);
  if (!info) throw new HttpError(415, "That file isn't a PNG, JPG, WebP or SVG image. Other formats can't be printed.");
  if (info.width * info.height > MAX_PIXELS) throw new HttpError(413, "That image is larger than 12,000 × 12,000 px. Scale it down first.");
  let bytes = raw;
  if (info.mime === "image/svg+xml") {
    const clean = sanitizeSvg(new TextDecoder().decode(raw));
    if (!clean) throw new HttpError(415, "That SVG couldn't be read safely. Export it again as plain SVG or PNG.");
    bytes = new TextEncoder().encode(clean.svg);
  }
  const id = opts.id ?? newId("ast");
  const asset: StoredAsset = {
    id,
    kind,
    mime: info.mime,
    bytes: bytes.byteLength,
    width: info.width,
    height: info.height,
    url: `/api/dtf/assets/${id}`,
    name: name.slice(0, 120),
    sourceAssetId: opts.sourceAssetId && /^[A-Za-z0-9_-]{4,80}$/.test(opts.sourceAssetId) ? opts.sourceAssetId : undefined,
    userId,
    // Each class has its own prefix: originals, AI art, processed copies,
    // references, mockups and production files never share a folder.
    key: keyFor(kind, userId, id, EXT[info.mime]),
    createdAt: new Date().toISOString(),
  };
  await putAsset(asset, Buffer.from(bytes));
  return asset;
}

/** Step 1 of a large upload: a one-time URL the browser PUTs the bytes to. */
export async function signCustomerUpload(userId: string, kind: AssetKind, mime: string): Promise<{ assetId: string; uploadUrl: string; staging: string } | null> {
  if (!remoteConfigured()) return null;
  const ext = EXT[mime];
  if (!ext) throw new HttpError(415, "That file isn't a PNG, JPG, WebP or SVG image.");
  const assetId = newId("ast");
  // Uploads land in a staging folder first; confirm re-checks the bytes and
  // writes the real asset, so a mislabelled file never reaches a real prefix.
  const staging = `staging/${userId}/${assetId}.${ext}`;
  const uploadUrl = await signedUploadUrl(BUCKET, staging);
  if (!uploadUrl) throw new HttpError(503, "File storage isn't reachable right now. Try again in a minute.");
  return { assetId, uploadUrl, staging };
}

/** Step 2: read what arrived, judge it, store it as a real asset, drop the staging copy. */
export async function confirmCustomerUpload(userId: string, staging: string, assetId: string, kind: AssetKind, name: string, sourceAssetId?: string): Promise<StoredAsset> {
  if (!staging.startsWith(`staging/${userId}/${assetId}.`)) throw new HttpError(403, "That upload isn't yours.");
  const bytes = await assetBytesByKey(staging);
  if (!bytes) throw new HttpError(404, "The upload didn't arrive. Try again.");
  try {
    return await ingestBytes(userId, new Uint8Array(bytes), kind, name, { id: assetId, sourceAssetId });
  } finally {
    await deleteAssetByKey(staging);
  }
}

/** A short-lived link to download stored bytes directly, or null on the local backend. */
export async function signedDownload(key: string, downloadAs?: string, ttl = 600): Promise<string | null> {
  if (!remoteConfigured()) return null;
  return signedBlobUrl(BUCKET, key, ttl, downloadAs);
}

/** A one-time upload URL for an exact key (production files). */
export async function signedUploadFor(key: string): Promise<string | null> {
  if (!remoteConfigured()) return null;
  return signedUploadUrl(BUCKET, key);
}
