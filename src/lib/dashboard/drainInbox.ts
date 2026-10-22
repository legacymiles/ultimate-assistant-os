import { shortcutDateLocal } from "./shortcutDate";

// ---------------------------------------------------------------------------
// Bringing the iPhone inbox into the browser, a few photos at a time.
//
// The server hands photos over as base64, which is a third bigger than the
// photo, and Vercel refuses any response over ~4.5 MB. Claiming the whole
// inbox in one call worked for one or two photos and failed for a backlog —
// so the dashboard's automatic pull fell over exactly when there was the most
// to bring in. This claims in batches that stay under the limit, reads each
// batch in, and only then tells the server to delete it, so a failed read is
// retried on the next check instead of losing the photo.
// ---------------------------------------------------------------------------

export interface DrainEntry {
  id: string;
  bytes?: number;
}

/** Raw bytes per claim. Base64 makes this ~3.3 MB on the wire, under Vercel's 4.5 MB. */
export const CLAIM_BATCH_BYTES = 2_500_000;
/** Most photos per claim, whatever their size. */
export const CLAIM_BATCH_MAX = 6;
/** A photo with no size recorded is budgeted as a typical resized iPhone JPEG. */
const UNKNOWN_BYTES = 700_000;

/**
 * Split inbox entries into claim batches. Every batch holds at least one
 * photo, so a single oversized photo still gets its own attempt.
 */
export function claimBatches<T extends DrainEntry>(entries: T[]): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const e of entries) {
    const b = e.bytes && e.bytes > 0 ? e.bytes : UNKNOWN_BYTES;
    if (cur.length && (size + b > CLAIM_BATCH_BYTES || cur.length >= CLAIM_BATCH_MAX)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(e);
    size += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

interface Claimed {
  id: string;
  name: string;
  contentType: string;
  takenAt?: string;
  dataUrl: string;
}

/**
 * The phone's photo date, carried on the File so the queue can sort by it.
 * Read by hand in this browser's timezone: Safari can't parse the Shortcut's
 * "Oct 21, 2026 at 11:34 PM", and every photo got the time it arrived instead.
 */
function lastModified(takenAt?: string): number | undefined {
  const t = shortcutDateLocal(takenAt);
  return Number.isNaN(t) ? undefined : t;
}

/**
 * Claim every entry in batches, hand each batch's files to `read`, then mark
 * them done. Returns how many photos came in. Throws on the first batch that
 * fails; batches already read in stay read in.
 */
export async function drainInbox(
  entries: DrainEntry[],
  read: (files: File[], inboxIdOf: (f: File) => string | undefined) => void | Promise<void>,
  onProgress?: (done: number, total: number) => void,
  /**
   * Copy the photos in and leave them in the inbox, so every device gets
   * them (Jarvis does this). Without it the inbox deletes them once read.
   */
  opts: { share?: boolean } = {},
): Promise<number> {
  let brought = 0;
  for (const batch of claimBatches(entries)) {
    onProgress?.(brought, entries.length);
    const r = await fetch("/api/dashboard/inbox/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts.share ? { ids: batch.map((e) => e.id), share: true } : { ids: batch.map((e) => e.id), keep: true }),
    });
    if (!r.ok) {
      throw new Error(
        r.status === 413 || r.status === 500
          ? "A photo from your iPhone was too big to bring in. Jarvis will try again on the next check."
          : `Couldn't bring photos in from your iPhone (the server said ${r.status}). Jarvis will try again on the next check.`,
      );
    }
    const got = (await r.json()) as { photos?: Claimed[] };
    const photos = got.photos ?? [];
    const idOf = new Map<File, string>();
    const files = await Promise.all(
      photos.map(async (p) => {
        const f = new File([await (await fetch(p.dataUrl)).blob()], p.name, {
          type: p.contentType,
          lastModified: lastModified(p.takenAt),
        });
        idOf.set(f, p.id);
        return f;
      }),
    );
    if (files.length) await read(files, (f) => idOf.get(f));
    // Only now is it safe to let the server delete them — unless they're
    // shared, when they stay until filed somewhere.
    if (!opts.share) {
      await fetch("/api/dashboard/inbox/done", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: batch.map((e) => e.id) }),
      }).catch(() => undefined);
    }
    brought += files.length;
  }
  onProgress?.(brought, entries.length);
  return brought;
}
