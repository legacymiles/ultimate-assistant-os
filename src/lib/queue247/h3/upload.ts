// ---------------------------------------------------------------------------
// Where a recreation's files live, and what an upload may be. Pure — the
// upload route, the executor and the H3 Lab panel share these rules.
//
// Bucket `queue-247` (private; created on first use by blobStore.ensureBucket):
//   uploads/<uid>/<random>.<ext>          the owner's uploaded reference video
//   <uid>/<taskId>/source.<ext>            a video imported from a link
//   <uid>/<taskId>/f<shot>-<k>.jpg         keyframes (640 px JPEG)
//   <uid>/<taskId>/blueprint.json          the analysis, too big for task state
// ---------------------------------------------------------------------------

export const H3_BUCKET = "queue-247";
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export const UPLOAD_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

const TYPE_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/x-m4v": "m4v",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/matroska": "mkv",
};

/** The file's extension, from its name first, then its type. Null when it is not a video we take. */
export function uploadExt(file: { filename?: string; type?: string }): string | null {
  const fromName = /\.([a-z0-9]{2,4})$/i.exec(file.filename ?? "")?.[1]?.toLowerCase();
  if (fromName && UPLOAD_TYPES[fromName]) return fromName;
  return TYPE_EXT[(file.type ?? "").toLowerCase()] ?? null;
}

/** A plain-English reason the file cannot be uploaded, or null when it is fine. */
export function uploadProblem(file: { filename?: string; type?: string; size?: number }): string | null {
  if (!uploadExt(file)) return "That isn't a video we can read — use an MP4, MOV, WebM, M4V or MKV file.";
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) return "That file looks empty.";
  if (size > MAX_UPLOAD_BYTES) return `That video is ${(size / 1024 / 1024).toFixed(0)} MB — the limit is 500 MB. Trim it or export a smaller copy.`;
  return null;
}

export function uploadKey(uid: string, ext: string, random: string): string {
  return `uploads/${safeSeg(uid)}/${random.replace(/[^a-z0-9]/gi, "").slice(0, 40) || "video"}.${ext}`;
}

/** Is this an upload key that belongs to `uid`? (No traversal, right folder, known extension.) */
export function ownsUpload(uid: string, key: string | null | undefined): boolean {
  if (!key || key.includes("..") || key.includes("\\")) return false;
  const m = /^uploads\/([^/]+)\/[A-Za-z0-9_-]+\.([a-z0-9]{2,4})$/.exec(key);
  return Boolean(m && m[1] === safeSeg(uid) && UPLOAD_TYPES[m[2]]);
}

export function taskPrefix(uid: string, taskId: string): string {
  return `${safeSeg(uid)}/${safeSeg(taskId)}`;
}

export function frameKey(uid: string, taskId: string, shot: number, k: number): string {
  return `${taskPrefix(uid, taskId)}/f${shot}-${k}.jpg`;
}

function safeSeg(s: string): string {
  return String(s).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "x";
}
