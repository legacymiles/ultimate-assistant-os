import "server-only";

// ---------------------------------------------------------------------------
// Where a kept document's bytes live.
//
// Same posture as every other private bucket in the hub (dance-studio,
// std-safe-reports, dashboard-inbox): private, NO storage policy, so the
// publishable key cannot see it. Only the server holds the service-role key,
// and every key starts with the owner's id — that prefix IS the access rule.
// Local disk when there is no service-role key, so a laptop with no Supabase
// still keeps the owner's insurance card rather than failing.
//
// One difference from the rest of the hub, and it is deliberate.
//
//   THESE ARE NEVER SERVED FROM A SIGNED URL. Everywhere else a signed link is
//   right: it expires, and the thing behind it is a dance clip. A signed link
//   to a photograph of a Social Security card is a bearer token for that card
//   — anybody holding the string has it until it expires, with no session and
//   no second check. So the bytes are streamed back through a route that
//   re-checks the caller every single time. One small JPEG; the cost is
//   nothing and the property is worth having.
// ---------------------------------------------------------------------------

import path from "node:path";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { deleteBlob, ensureBucket, getBlob, putBlob } from "@/lib/server/blobStore";

export const BUCKET = "jarvis-record-files";

/** Bigger than a 1800px JPEG of a card has any business being. */
export const MAX_UPLOAD_BYTES = 6_000_000;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const ACCEPTED = Object.keys(EXT);

function localDir(): string {
  return path.join(process.env.RECALL_DATA_DIR || path.resolve("."), ".jarvis-record-files");
}

/** The caller, or null. "local" when there is no Supabase at all. */
export async function currentUid(): Promise<string | null> {
  const sb = await getSupabaseServerClient();
  if (!sb) return "local";
  const { data } = await sb.auth.getUser();
  const id = data.user?.id;
  return id && /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null;
}

/** A file id the owner may have made. Anything else is refused unread. */
export function validId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(id);
}

export function keyFor(uid: string, id: string, mime: string): string {
  return `${uid}/${id}.${EXT[mime] ?? "jpg"}`;
}

/** The three keys one id could be under, so a read need not know the type. */
export function candidateKeys(uid: string, id: string): string[] {
  return Object.values(EXT).map((ext) => `${uid}/${id}.${ext}`);
}

export async function putRecordFile(
  uid: string,
  id: string,
  mime: string,
  body: Buffer,
): Promise<boolean> {
  await ensureBucket(BUCKET);
  return putBlob(BUCKET, keyFor(uid, id, mime), localDir(), body, mime);
}

export async function getRecordFile(uid: string, id: string): Promise<{ body: Buffer; mime: string } | null> {
  for (const key of candidateKeys(uid, id)) {
    const body = await getBlob(BUCKET, key, localDir());
    if (!body) continue;
    const ext = key.slice(key.lastIndexOf(".") + 1);
    const mime = Object.entries(EXT).find(([, e]) => e === ext)?.[0] ?? "image/jpeg";
    return { body, mime };
  }
  return null;
}

export async function deleteRecordFile(uid: string, id: string): Promise<void> {
  for (const key of candidateKeys(uid, id)) await deleteBlob(BUCKET, key, localDir());
}

/**
 * The bytes of a `data:` URL, or null.
 *
 * Strict about the prefix rather than forgiving, because this is the only
 * place a caller's string becomes a file: an `image/svg+xml` would be a script
 * that runs on this origin the moment it is viewed, which is why the accepted
 * list is three raster types and not "anything starting with image/".
 */
export function decodeDataUrl(input: unknown): { body: Buffer; mime: string } | null {
  if (typeof input !== "string") return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input);
  if (!m) return null;
  const body = Buffer.from(m[2], "base64");
  if (!body.length || body.length > MAX_UPLOAD_BYTES) return null;
  return { body, mime: m[1] };
}
