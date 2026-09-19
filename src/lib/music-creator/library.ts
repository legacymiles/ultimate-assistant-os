// ---------------------------------------------------------------------------
// Music Creator — the account's song library (server side).
//
// A render is produced on the GPU pod, and the pod is asleep most of the time
// (it stops itself after 20 idle minutes to stop billing). A take that only
// lives there therefore goes silent the moment the pod sleeps, which is exactly
// the "I made a song and now it won't play" failure. So every finished take is
// copied off the pod into a private Storage bucket under the account's id, and
// playback reads that copy — no GPU, no re-render, ever again.
//
// Keys are `<uid>/<renderId>.<ext>`. The uid prefix IS the access rule: the
// read route only ever looks under the caller's own folder.
// ---------------------------------------------------------------------------

import "server-only";

import { spawn } from "node:child_process";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ensureBucket, getBlob, isRemoteConfigured, putBlob, signedBlobUrl } from "@/lib/server/blobStore";
import { podServerUrl } from "./pod";

export const BUCKET = "music-creator";

/** What a saved file may be called: a render id plus an audio extension. */
export const SAVED_FILE_RE = /^[A-Za-z0-9_-]{1,80}\.(flac|wav|mp3)$/;

const TYPE_BY_EXT: Record<string, string> = { flac: "audio/flac", wav: "audio/wav", mp3: "audio/mpeg" };

export function contentTypeFor(file: string): string {
  return TYPE_BY_EXT[file.split(".").pop() ?? ""] ?? "application/octet-stream";
}

function extFor(type: string, bytes: Buffer): "flac" | "wav" | "mp3" {
  if (type.includes("flac") || bytes.subarray(0, 4).toString("latin1") === "fLaC") return "flac";
  if (type.includes("wav") || bytes.subarray(0, 4).toString("latin1") === "RIFF") return "wav";
  return "mp3";
}

function localDir(): string {
  return path.resolve(process.env.MUSIC_LIBRARY_DIR || ".data/music-creator");
}

/**
 * The signed-in account, resolved from the Supabase session rather than the
 * readable hub_uid cookie (which a browser could edit). "local" when Supabase
 * is not configured at all, so local demo mode still keeps a library.
 */
export async function libraryUid(): Promise<string | null> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return "local";
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** The GPU server's base URL, the same one the proxy route forwards to. */
export async function musicServerBase(): Promise<string> {
  return (process.env.MUSIC_SERVER_URL || (await podServerUrl())).replace(/\/+$/, "");
}

/** MP3 bitrate for saved songs: transparent for listening, ~6× smaller than FLAC. */
const MP3_KBPS = 256;

/**
 * Re-encode a song to MP3. The GPU hands back lossless FLAC/WAV at ~28 MB a
 * song, which would fill the free Storage tier in a few dozen songs and eat
 * the monthly download allowance in a few hundred plays. Null when ffmpeg is
 * missing or fails — the caller then keeps the original rather than nothing.
 */
export function toMp3(input: Buffer): Promise<Buffer | null> {
  const bin = ffmpegPath as unknown as string | null;
  if (!bin) return Promise.resolve(null);
  return new Promise((resolve) => {
    const proc = spawn(bin, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-codec:a", "libmp3lame", "-b:a", `${MP3_KBPS}k`, "-f", "mp3", "pipe:1"]);
    const out: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => out.push(c));
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => resolve(code === 0 && out.length ? Buffer.concat(out) : null));
    proc.stdin.on("error", () => {});
    proc.stdin.end(input);
  });
}

/**
 * Copy one produced file from the GPU server into the account's library.
 * Returns the saved file name (`<renderId>.<ext>`), or throws with the reason.
 */
export async function archiveFromServer(uid: string, renderId: string, fileId: string): Promise<string> {
  const base = await musicServerBase();
  if (!base) throw new Error("No music GPU server is configured, so there is nothing to copy from.");

  const headers: Record<string, string> = {};
  if (process.env.MUSIC_TOKEN) headers.authorization = `Bearer ${process.env.MUSIC_TOKEN}`;
  let res: Response;
  try {
    res = await fetch(`${base}/files/${encodeURIComponent(fileId)}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(95_000),
    });
  } catch {
    throw new Error("The GPU is asleep, so this take can't be copied yet. Wake it once and it saves for good.");
  }
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("json") || type.includes("html")) {
    throw new Error(
      // Only the music server's own JSON 404 means the file is gone; RunPod's
      // proxy answers a sleeping pod with a bare 404 of its own.
      res.status === 404 && type.includes("json")
        ? "The GPU server no longer has this file."
        : "The GPU is asleep, so this take can't be copied yet. Wake it once and it saves for good.",
    );
  }

  const original = Buffer.from(await res.arrayBuffer());
  const mp3 = await toMp3(original);
  const bytes = mp3 ?? original;
  const ext = mp3 ? "mp3" : extFor(type, original);
  const file = `${renderId}.${ext}`;
  if (!SAVED_FILE_RE.test(file)) throw new Error("Bad render id.");

  await ensureBucket(BUCKET);
  const ok = await putBlob(BUCKET, `${uid}/${file}`, localDir(), bytes, TYPE_BY_EXT[ext]);
  if (!ok) {
    throw new Error(
      isRemoteConfigured()
        ? `Storage refused the file (${Math.round(bytes.length / 1e6)} MB).`
        : "Could not write the song to local disk.",
    );
  }
  return file;
}

/** Where the browser should fetch a saved song: a signed Storage link, or null on local disk. */
export async function savedSongUrl(uid: string, file: string, download: boolean): Promise<string | null> {
  if (!isRemoteConfigured()) return null;
  const url = await signedBlobUrl(BUCKET, `${uid}/${file}`, 60 * 60 * 6);
  if (!url || !download) return url;
  return `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(file)}`;
}

/** The bytes of a saved song, for the local-disk backend. */
export function savedSongBytes(uid: string, file: string): Promise<Buffer | null> {
  return getBlob(BUCKET, `${uid}/${file}`, localDir());
}
