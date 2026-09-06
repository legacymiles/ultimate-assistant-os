// ---------------------------------------------------------------------------
// STD Safe — the uploaded report files.
//
// These are the most sensitive bytes in the app: a real lab report carries a
// full legal name, a date of birth and a medical record number alongside the
// results. So they are stored per-user, they are never included in a shared
// view, and the only route that serves one re-derives the owner from the
// session rather than trusting anything in the URL.
//
// Node runtime only.
// ---------------------------------------------------------------------------

import path from "node:path";
import { uid } from "../utils";
import { deleteBlob, getBlob, putBlob } from "@/lib/server/blobStore";
import { dataDir } from "./dataDir";

/** Private bucket; RLS-denied to every client role. See its migration. */
const BUCKET = "std-safe-reports";

/**
 * Where one report sits, in the bucket and on local disk alike.
 *
 * Keeping the same `std-safe-reports/<user>/<file>` shape in both backends
 * means a directory left over from local development still lines up with the
 * object paths, and there is one layout to reason about rather than two.
 */
function objectKey(userId: string, fileId: string): string {
  return `std-safe-reports/${userId}/${fileId}`;
}

/** Big enough for a scanned multi-page report, small enough not to fill a disk. */
export const MAX_REPORT_BYTES = 20 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".heic"]);

export function extensionFor(name: string, type = ""): string {
  const ext = path.extname(name).toLowerCase();
  if (ALLOWED_EXTENSIONS.has(ext)) return ext;
  if (type === "application/pdf") return ".pdf";
  if (type.startsWith("image/")) return `.${type.slice(6).replace("jpeg", "jpg")}`;
  return "";
}

export function isPdf(name: string, type = ""): boolean {
  return type === "application/pdf" || path.extname(name).toLowerCase() === ".pdf";
}

export function isImage(name: string, type = ""): boolean {
  if (type.startsWith("image/")) return true;
  const ext = path.extname(name).toLowerCase();
  return ext !== ".pdf" && ALLOWED_EXTENSIONS.has(ext);
}

/**
 * A file id is a bare filename and must stay one.
 *
 * It arrives from the client on every read, so anything with a separator or a
 * dot-segment is refused outright rather than normalised — the safe version of
 * `../../.std-safe.json` is no file at all.
 */
function safeId(fileId: string): string | null {
  if (!fileId || fileId.includes("/") || fileId.includes("\\") || fileId.includes("..")) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(fileId)) return null;
  return fileId;
}

export async function saveReport(userId: string, file: File): Promise<string | null> {
  const ext = extensionFor(file.name, file.type);
  if (!ext) return null;
  const fileId = `${uid("rep")}${ext}`;
  const ok = await putBlob(
    BUCKET,
    objectKey(userId, fileId),
    dataDir(),
    Buffer.from(await file.arrayBuffer()),
    contentTypeFor(fileId),
  );
  // Returning null on a failed write matters more here than anywhere: the
  // caller records a document-verified result, and a result whose document
  // silently never saved is exactly the claim this app exists to prevent.
  return ok ? fileId : null;
}

export async function readReport(userId: string, fileId: string): Promise<Buffer | null> {
  const id = safeId(fileId);
  if (!id) return null;
  return getBlob(BUCKET, objectKey(userId, id), dataDir());
}

export async function deleteReport(userId: string, fileId: string): Promise<void> {
  const id = safeId(fileId);
  if (!id) return;
  await deleteBlob(BUCKET, objectKey(userId, id), dataDir());
}

export function contentTypeFor(fileId: string): string {
  const ext = path.extname(fileId).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".heic") return "image/heic";
  return "image/jpeg";
}
