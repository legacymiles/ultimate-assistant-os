import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import { deleteBlob, getBlob, putBlob } from "@/lib/server/blobStore";

// ---------------------------------------------------------------------------
// The iPhone photo inbox.
//
// A web page cannot read an iPhone camera roll — iOS exposes no API, iCloud has
// no public one, and Google Photos cut library-read access to picker-only in
// 2025. So the phone must PUSH. The only thing on iOS that can push on a
// schedule is the Shortcuts app, which is why this exists: an endpoint a
// Shortcut can POST to, and a short-lived buffer the browser later drains.
//
// This is a TRANSIT BUFFER, never a library. Photos live here only between the
// phone sending them and a browser claiming them. Two consequences:
//
//   * claimed blobs are deleted immediately, and
//   * unclaimed ones are swept after SWEEP_DAYS.
//
// It is deliberately separate from `recall-photo-queue:v1`, which is NOT synced
// because each pending photo points at an IndexedDB blob that exists on one
// device only. Syncing that queue would show a laptop entries whose pixels are
// not there. The inbox does not change that — it is the thing a device drains
// FROM, not the queue itself.
// ---------------------------------------------------------------------------

const BUCKET = "dashboard-inbox";
const DOC = "dashboard-inbox";
const SWEEP_DAYS = 7;

/** Identifiers remembered per user, so a nightly re-send is not re-imported. */
const SEEN_LIMIT = 500;

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_PER_REQUEST = 100;

function dataDir(): string {
  return process.env.RECALL_DATA_DIR || path.resolve(".");
}

export interface InboxEntry {
  id: string;
  uid: string;
  /** The photo's local identifier on the phone, used for deduplication. */
  deviceId: string;
  name: string;
  contentType: string;
  bytes: number;
  /** When the photo was taken, if the Shortcut sent it. */
  takenAt?: string;
  receivedAt: string;
}

interface InboxDoc {
  /** uid -> sha256 of that user's device token. */
  tokens: Record<string, string>;
  entries: InboxEntry[];
  /** uid -> recently seen device identifiers, newest last. */
  seen: Record<string, string[]>;
}

const EMPTY: InboxDoc = { tokens: {}, entries: [], seen: {} };

async function load(): Promise<InboxDoc> {
  const doc = await readDoc<InboxDoc>(DOC, dataDir());
  if (!doc) return { ...EMPTY };
  return { tokens: doc.tokens ?? {}, entries: doc.entries ?? [], seen: doc.seen ?? {} };
}

async function save(doc: InboxDoc): Promise<boolean> {
  return writeDoc(DOC, dataDir(), doc);
}

// ----- tokens --------------------------------------------------------------

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mint (or rotate) the device token for one user.
 *
 * Returned in the clear exactly once — only the hash is stored, so a leaked
 * document cannot be replayed against the endpoint. Per user, so every person
 * on the hub sets up their own phone rather than sharing the owner's.
 */
export async function mintToken(uid: string): Promise<string | null> {
  const token = randomBytes(24).toString("base64url");
  const doc = await load();
  doc.tokens[uid] = hash(token);
  return (await save(doc)) ? token : null;
}

export async function hasToken(uid: string): Promise<boolean> {
  return Boolean((await load()).tokens[uid]);
}

/** The uid this token belongs to, or null. Constant-time per candidate. */
export async function uidForToken(token: string): Promise<string | null> {
  if (!token) return null;
  const want = Buffer.from(hash(token), "hex");
  const doc = await load();
  for (const [uid, stored] of Object.entries(doc.tokens)) {
    const got = Buffer.from(stored, "hex");
    if (got.length === want.length && timingSafeEqual(got, want)) return uid;
  }
  return null;
}

// ----- receiving -----------------------------------------------------------

export interface ReceiveResult {
  accepted: number;
  skipped: number;
  rejected: { name: string; reason: string }[];
}

export interface IncomingPhoto {
  deviceId: string;
  name: string;
  contentType: string;
  takenAt?: string;
  body: Buffer;
}

/**
 * Store photos pushed by a phone.
 *
 * Deduplication is not a nicety. A Shortcut automation set to send "the last
 * 50" every night re-sends 45 photos it already sent on its second run; without
 * this the review queue floods and the feature becomes unusable on day two.
 */
export async function receive(uid: string, photos: IncomingPhoto[]): Promise<ReceiveResult> {
  const doc = await load();
  const seen = new Set(doc.seen[uid] ?? []);
  const out: ReceiveResult = { accepted: 0, skipped: 0, rejected: [] };
  const added: string[] = [];

  for (const p of photos.slice(0, MAX_PER_REQUEST)) {
    if (p.body.length > MAX_PHOTO_BYTES) {
      out.rejected.push({ name: p.name, reason: "over 25 MB" });
      continue;
    }
    if (p.deviceId && seen.has(p.deviceId)) {
      out.skipped++;
      continue;
    }

    const id = randomBytes(12).toString("hex");
    const ok = await putBlob(BUCKET, `${uid}/${id}`, dataDir(), p.body, p.contentType);
    if (!ok) {
      out.rejected.push({ name: p.name, reason: "storage unavailable" });
      continue;
    }

    doc.entries.push({
      id,
      uid,
      deviceId: p.deviceId,
      name: p.name,
      contentType: p.contentType,
      bytes: p.body.length,
      takenAt: p.takenAt,
      receivedAt: new Date().toISOString(),
    });
    if (p.deviceId) {
      seen.add(p.deviceId);
      added.push(p.deviceId);
    }
    out.accepted++;
  }

  // Ring buffer: keep the most recent SEEN_LIMIT, so the document cannot grow
  // without bound on a phone that syncs every night for a year.
  const ring = [...(doc.seen[uid] ?? []), ...added];
  doc.seen[uid] = ring.slice(-SEEN_LIMIT);

  await save(doc);
  return out;
}

// ----- draining ------------------------------------------------------------

export async function pending(uid: string): Promise<InboxEntry[]> {
  const doc = await sweep(await load());
  return doc.entries.filter((e) => e.uid === uid);
}

/** Hand over the bytes and delete them; the browser now owns these photos. */
export async function claim(
  uid: string,
  ids: string[],
): Promise<{ id: string; name: string; contentType: string; takenAt?: string; dataUrl: string }[]> {
  const doc = await load();
  const wanted = new Set(ids);
  const mine = doc.entries.filter((e) => e.uid === uid && wanted.has(e.id));
  const out = [];

  for (const e of mine) {
    const buf = await getBlob(BUCKET, `${uid}/${e.id}`, dataDir());
    if (!buf) continue;
    out.push({
      id: e.id,
      name: e.name,
      contentType: e.contentType,
      takenAt: e.takenAt,
      dataUrl: `data:${e.contentType};base64,${buf.toString("base64")}`,
    });
    await deleteBlob(BUCKET, `${uid}/${e.id}`, dataDir());
  }

  const claimed = new Set(out.map((o) => o.id));
  doc.entries = doc.entries.filter((e) => !(e.uid === uid && claimed.has(e.id)));
  await save(doc);
  return out;
}

/** Drop anything older than SWEEP_DAYS. Lazy — runs when the inbox is read. */
async function sweep(doc: InboxDoc): Promise<InboxDoc> {
  const cutoff = Date.now() - SWEEP_DAYS * 86_400_000;
  const stale = doc.entries.filter((e) => Date.parse(e.receivedAt) < cutoff);
  if (!stale.length) return doc;

  for (const e of stale) await deleteBlob(BUCKET, `${e.uid}/${e.id}`, dataDir());
  doc.entries = doc.entries.filter((e) => Date.parse(e.receivedAt) >= cutoff);
  await save(doc);
  return doc;
}
