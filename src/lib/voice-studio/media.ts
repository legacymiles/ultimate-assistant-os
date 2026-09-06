"use client";

// ---------------------------------------------------------------------------
// Voice Studio — where the audio actually lives.
//
// Every other app in the hub syncs by putting its whole state blob in an
// app_state row. Voice Studio cannot: its clips are base64 data: URLs, tens or
// hundreds of kilobytes each, and a row full of them would be slow to move and
// eventually too large to store at all.
//
// So the bytes go to the voice-clips storage bucket and only a short path
// travels in the synced blob. The device that recorded a clip keeps its data:
// URL locally and never re-downloads it; another device resolves the path to a
// signed URL on demand.
//
// Every function degrades to null rather than throwing. Voice Studio has always
// worked with no key and no account, and it still must.
// ---------------------------------------------------------------------------

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const BUCKET = "voice-clips";

/** How long a resolved playback URL stays valid. Re-resolved on next load. */
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 8;

async function currentUserId(): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/** Split a `data:<mime>;base64,<payload>` URL. Null when it is not one. */
export function parseDataUrl(
  dataUrl: string,
): { mime: string; base64: string } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m || !m[2]) return null;
  return { mime: m[1] || "application/octet-stream", base64: m[3] };
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Upload a data: URL and return its storage path, or null when storage is
 * unavailable (not signed in, not configured, upload rejected).
 *
 * The path is deliberately `<uid>/<id>.<ext>`: the bucket's policies require
 * the first segment to be the owner's id, which is what stops one user reading
 * another's recordings.
 */
export async function uploadClip(
  id: string,
  dataUrl: string,
): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  const userId = await currentUserId();
  if (!supabase || !userId) return null;

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;

  const ext = parsed.mime.includes("wav") ? "wav" : "mp3";
  const path = `${userId}/${id}.${ext}`;
  try {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, base64ToBlob(parsed.base64, parsed.mime), {
        contentType: parsed.mime,
        upsert: true,
      });
    return error ? null : path;
  } catch {
    return null;
  }
}

/** A time-limited playback URL for a stored clip, or null if unavailable. */
export async function clipUrl(path: string): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    return error ? null : (data?.signedUrl ?? null);
  } catch {
    return null;
  }
}

/** Remove a stored clip. Best effort — a failure just leaves an orphan. */
export async function removeClip(path: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    /* orphaned object; not worth surfacing to the user */
  }
}

/**
 * base64 payload for a clip, whatever form its URL takes.
 *
 * Cloning re-sends the reference audio inline, which used to be a plain string
 * slice because the URL was always a data: URL. Once a clip can arrive from
 * another device as a signed https URL, that assumption breaks — hence the
 * fetch fallback here.
 */
export async function toBase64(url: string): Promise<string | null> {
  const parsed = parseDataUrl(url);
  if (parsed) return parsed.base64;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    let bin = "";
    const bytes = new Uint8Array(buf);
    // Chunked to avoid blowing the argument limit on a multi-megabyte clip.
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  } catch {
    return null;
  }
}
