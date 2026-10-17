import "server-only";

// ---------------------------------------------------------------------------
// The server half of Chat attachments.
//
//   - Issues upload targets for files too big to ride in a request: a signed
//     Storage link on a deployed hub, this hub's own PUT route on local disk.
//   - Turns the `stored` parts in a request back into what the model reads:
//     a signed link for a clip (Gemini fetches it), the bytes inline for
//     audio and PDFs (input_audio and file parts carry data, not links).
//   - Cleans every user part the page sends, so a request can only carry the
//     part types and URL schemes this hub means to pass on, and only keys
//     that belong to the caller.
// ---------------------------------------------------------------------------

import path from "node:path";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ensureBucket, getBlob, isRemoteConfigured, putBlob, signedBlobUrl, signedUploadUrl } from "@/lib/server/blobStore";
import { audioFormat, MAX_UPLOAD_BYTES, type AttachKind, type WirePart } from "../attachments";

export const CHAT_BUCKET = "jarvis-chat";
const READ_TTL = 2 * 3600;

function localDir(): string {
  return path.join(process.env.JARVIS_DATA_DIR || path.resolve(".data"), "jarvis-chat");
}

/** The signed-in owner's id; "local" on a hub with no Supabase. Null when nobody is signed in. */
export async function chatUid(): Promise<string | null> {
  const sb = await getSupabaseServerClient();
  if (!sb) return "local";
  const { data } = await sb.auth.getUser();
  const id = data.user?.id;
  return id && /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null;
}

const safeName = (name: string) =>
  (name.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "file").slice(-80);

export function attachmentKey(uid: string, name: string): string {
  const day = new Date().toISOString().slice(0, 10);
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${uid}/${day}/${rand}-${safeName(name)}`;
}

/** A key this caller may read: theirs, and shaped exactly like one we issued. */
export function ownsKey(uid: string, key: unknown): key is string {
  return (
    typeof key === "string" &&
    key.startsWith(`${uid}/`) &&
    /^[A-Za-z0-9-]{1,64}\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{12}-[\w.-]{1,80}$/.test(key)
  );
}

export async function uploadTarget(uid: string, name: string, size: number): Promise<{ key: string; url: string }> {
  if (!Number.isFinite(size) || size <= 0) throw new Error("That file is empty.");
  if (size > MAX_UPLOAD_BYTES) throw new Error("That file is over the 50 MB limit.");
  const key = attachmentKey(uid, name);
  if (!isRemoteConfigured()) return { key, url: `/api/new-jarvis/attachments?key=${encodeURIComponent(key)}` };
  await ensureBucket(CHAT_BUCKET);
  const url = await signedUploadUrl(CHAT_BUCKET, key);
  if (!url) throw new Error("Storage would not issue an upload link.");
  return { key, url };
}

/** The local-disk upload, for a hub with no Storage. */
export async function putLocal(key: string, bytes: Buffer, mime: string): Promise<boolean> {
  if (isRemoteConfigured()) return false;
  return putBlob(CHAT_BUCKET, key, localDir(), bytes, mime);
}

async function bytesOf(key: string): Promise<Buffer | null> {
  return getBlob(CHAT_BUCKET, key, localDir());
}

const DATA_OR_HTTPS = /^(data:[\w.+-]+\/[\w.+-]+;base64,|https:\/\/)/;
const KINDS: AttachKind[] = ["image", "video", "audio", "pdf", "text"];
/** Inline bytes per part, after base64. A request over this was never sent by our page. */
const INLINE_PART_CHARS = 6_000_000;

/** One part off the wire, kept only if it is a shape we send. */
export function cleanPart(raw: unknown): WirePart | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, Record<string, unknown> | string | undefined>;
  const o = (k: string) => (p[k] && typeof p[k] === "object" ? (p[k] as Record<string, unknown>) : {});
  switch (p.type) {
    case "text":
      return typeof p.text === "string" ? { type: "text", text: p.text.slice(0, 200_000) } : null;
    case "image_url": {
      const url = String(o("image_url").url ?? "");
      return DATA_OR_HTTPS.test(url) && url.length <= INLINE_PART_CHARS ? { type: "image_url", image_url: { url } } : null;
    }
    case "video_url": {
      const url = String(o("video_url").url ?? "");
      return DATA_OR_HTTPS.test(url) && url.length <= INLINE_PART_CHARS ? { type: "video_url", video_url: { url } } : null;
    }
    case "input_audio": {
      const a = o("input_audio");
      const data = String(a.data ?? "");
      const format = String(a.format ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 8);
      return /^[A-Za-z0-9+/=]+$/.test(data.slice(0, 200)) && data.length <= INLINE_PART_CHARS && format
        ? { type: "input_audio", input_audio: { data, format } }
        : null;
    }
    case "file": {
      const f = o("file");
      const file_data = String(f.file_data ?? "");
      return file_data.startsWith("data:application/pdf;base64,") && file_data.length <= INLINE_PART_CHARS
        ? { type: "file", file: { filename: String(f.filename ?? "document.pdf").slice(0, 120), file_data } }
        : null;
    }
    case "stored": {
      const s = o("stored");
      const kind = KINDS.includes(s.kind as AttachKind) ? (s.kind as AttachKind) : null;
      if (!kind || typeof s.key !== "string") return null;
      return {
        type: "stored",
        stored: { key: s.key, name: String(s.name ?? "file").slice(0, 120), mime: String(s.mime ?? "").slice(0, 80), kind },
      };
    }
    default:
      return null;
  }
}

/** Resolved parts survive a few rounds of the same run without downloading again. */
const cache = new Map<string, { at: number; part: WirePart }>();
const CACHE_MS = 10 * 60_000;
const CACHE_MAX_CHARS = 12_000_000;

function remember(key: string, part: WirePart): WirePart {
  const size = JSON.stringify(part).length;
  if (size <= CACHE_MAX_CHARS) {
    cache.set(key, { at: Date.now(), part });
    // Small and recent only: a warm instance must not end up holding a film.
    while (cache.size > 6) cache.delete(cache.keys().next().value as string);
  }
  return part;
}

/** A `stored` part, as the part the model actually reads. */
export async function resolveStored(uid: string, s: Extract<WirePart, { type: "stored" }>["stored"]): Promise<WirePart> {
  const missing: WirePart = { type: "text", text: `[${s.name} could not be loaded — it may have been removed. Say so rather than guessing at it.]` };
  if (!ownsKey(uid, s.key)) return missing;
  const hit = cache.get(s.key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.part;

  // A clip or a picture can go as a link the model's provider fetches itself,
  // which keeps the request small. Only Storage can issue one.
  if ((s.kind === "video" || s.kind === "image") && isRemoteConfigured()) {
    const url = await signedBlobUrl(CHAT_BUCKET, s.key, READ_TTL);
    if (url) return remember(s.key, s.kind === "video" ? { type: "video_url", video_url: { url } } : { type: "image_url", image_url: { url } });
  }

  const bytes = await bytesOf(s.key);
  if (!bytes) return missing;
  const b64 = bytes.toString("base64");
  const mime = s.mime || (s.kind === "pdf" ? "application/pdf" : "application/octet-stream");
  switch (s.kind) {
    case "audio":
      return remember(s.key, { type: "input_audio", input_audio: { data: b64, format: audioFormat(mime, s.name) } });
    case "pdf":
      return remember(s.key, { type: "file", file: { filename: s.name, file_data: `data:application/pdf;base64,${b64}` } });
    case "video":
      return remember(s.key, { type: "video_url", video_url: { url: `data:${mime};base64,${b64}` } });
    case "image":
      return remember(s.key, { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } });
    default:
      return { type: "text", text: `--- ${s.name} ---\n${bytes.toString("utf8").slice(0, 60_000)}` };
  }
}

/**
 * A user message's content, cleaned and with every `stored` part resolved.
 * A plain string passes through; an array comes back as an array.
 */
export async function resolveContent(content: unknown, uid: string | null): Promise<string | WirePart[]> {
  if (typeof content === "string") return content.slice(0, 24_000);
  if (!Array.isArray(content)) return "";
  const parts = content.slice(0, 24).map(cleanPart).filter((p): p is WirePart => p !== null);
  const out: WirePart[] = [];
  for (const p of parts) {
    if (p.type !== "stored") out.push(p);
    else if (!uid) out.push({ type: "text", text: `[${p.stored.name} was attached, but nobody is signed in, so it could not be opened.]` });
    else out.push(await resolveStored(uid, p.stored));
  }
  return out.length ? out : "";
}
