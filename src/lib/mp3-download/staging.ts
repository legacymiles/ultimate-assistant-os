// ---------------------------------------------------------------------------
// Finished files waiting to be collected.
//
// Why this exists: a yt-dlp grab has to be a POST — it takes a URL and a mode,
// it runs for a minute, and its failures are messages the UI must show. But a
// POST's response can only reach disk through a blob, and a blob is the whole
// file in the tab's memory. That works for a 6 MB song and silently dropped a
// 23 MB video on the way to the downloads folder — the browser reported
// nothing, the page said "Saved", and no file existed. Measured, not assumed.
//
// So the two halves are split. The POST does the work and answers with a
// ticket; a plain GET with that ticket streams the file out under a
// Content-Disposition name, which is the one download path every browser
// handles at any size, straight to disk and never through memory.
//
// Tickets are one-shot, short-lived, and hold an absolute path the client
// never sees — the client cannot name a file, only redeem a ticket for one
// this server made.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";

export interface StagedFile {
  path: string;
  /** The temp directory to delete once the file has gone. */
  dir: string;
  filename: string;
  bytes: number;
  contentType: string;
  expires: number;
}

/** Ten minutes is far longer than a click and far shorter than a session. */
const TTL_MS = 10 * 60_000;

/**
 * Module-scope, so it lives as long as the server process.
 *
 * That is correct here and would not be on a serverless deployment — but the
 * only producer is yt-dlp, which is a binary on this machine, so this whole
 * path is local-only by construction. See ytdlp.ts.
 */
const staged = new Map<string, StagedFile>();

function sweep(): void {
  const now = Date.now();
  for (const [token, file] of staged) {
    if (file.expires <= now) {
      staged.delete(token);
      void rm(file.dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export function stage(file: Omit<StagedFile, "expires">): string {
  sweep();
  const token = randomUUID();
  staged.set(token, { ...file, expires: Date.now() + TTL_MS });
  return token;
}

/** Redeem a ticket. One shot: the entry is gone whether or not the read works. */
export function claim(token: string): StagedFile | null {
  sweep();
  const file = staged.get(token);
  if (!file) return null;
  staged.delete(token);
  return file;
}

export function discard(file: StagedFile): void {
  void rm(file.dir, { recursive: true, force: true }).catch(() => undefined);
}
