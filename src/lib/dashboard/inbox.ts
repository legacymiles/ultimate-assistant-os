import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import { deleteBlob, getBlob, putBlob } from "@/lib/server/blobStore";
import { parseShortcutDate } from "./shortcutDate";

// ---------------------------------------------------------------------------
// The iPhone photo inbox.
//
// A web page cannot read an iPhone camera roll — iOS exposes no API, iCloud has
// no public one, and Google Photos cut library-read access to picker-only in
// 2025. So the phone must PUSH. The only thing on iOS that can push on a
// schedule is the Shortcuts app, which is why this exists: an endpoint a
// Shortcut can POST to, and a short-lived buffer the browser later drains.
//
// It is also what keeps the phone and the laptop showing THE SAME photos.
// Each device's review queue is its own (the pixels live in that browser's
// IndexedDB), so when the first device to check drained a photo and the server
// deleted it, the other device never saw it — the phone and the laptop ended
// up with different photos. Now (Oct 2026) a photo stays here while it waits:
//
//   * every device copies each waiting photo in once (claim with `share`),
//   * filing or removing it on ANY device deletes it here (done), and every
//     other device drops it from its own queue on its next check,
//   * deleting it from the phone's camera roll does the same: the Shortcut
//     reports the photos still on the phone (prune), and the rest go,
//   * anything never sorted is swept after SWEEP_DAYS.
// ---------------------------------------------------------------------------

const BUCKET = "dashboard-inbox";
const DOC = "dashboard-inbox";
const SWEEP_DAYS = 60;

/** Identifiers remembered per user, so a nightly re-send is not re-imported. */
const SEEN_LIMIT = 2000;

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
  /**
   * Set while a browser is reading this photo in (claim with keep). Until it
   * passes, other devices don't see the photo, so two open dashboards can't
   * both bring in the same picture. If that browser never says done, the
   * photo comes back after the lease.
   */
  claimedUntil?: number;
}

/** How long a claimed photo stays hidden from other devices. */
const CLAIM_LEASE_MS = 3 * 60_000;

interface InboxDoc {
  /** uid -> sha256 of that user's device token. */
  tokens: Record<string, string>;
  entries: InboxEntry[];
  /** uid -> recently seen device identifiers, newest last. */
  seen: Record<string, string[]>;
  /**
   * uid -> the newest photo date the phone has sent, exactly as it sent it.
   * The Shortcut asks for this before each run and finds only photos taken
   * after it (oldest first), so a run of 20 walks forward through a backlog
   * instead of re-sending the same newest 20.
   */
  cursor: Record<string, { raw: string; t: number }>;
}

const EMPTY: InboxDoc = { tokens: {}, entries: [], seen: {}, cursor: {} };

async function load(): Promise<InboxDoc> {
  const doc = await readDoc<InboxDoc>(DOC, dataDir());
  if (!doc) return { ...EMPTY };
  return { tokens: doc.tokens ?? {}, entries: doc.entries ?? [], seen: doc.seen ?? {}, cursor: doc.cursor ?? {} };
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

  // The bookmark moves for every photo the phone sends — accepted or skipped
  // as already seen — because either way the phone is done with it.
  const advance = (raw?: string) => {
    const t = parseShortcutDate(raw);
    if (!raw || !Number.isFinite(t)) return;
    const cur = doc.cursor[uid];
    if (!cur || t > cur.t) doc.cursor[uid] = { raw: raw.trim(), t };
  };

  for (const p of photos.slice(0, MAX_PER_REQUEST)) {
    if (p.body.length > MAX_PHOTO_BYTES) {
      out.rejected.push({ name: p.name, reason: "over 25 MB" });
      continue;
    }
    // The exact same bytes are the same photo, whatever name or id a second
    // Shortcut or automation gave them.
    const sha = `sha:${createHash("sha256").update(p.body).digest("hex").slice(0, 32)}`;
    if ((p.deviceId && seen.has(p.deviceId)) || seen.has(sha)) {
      out.skipped++;
      advance(p.takenAt);
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
    seen.add(sha);
    added.push(sha);
    out.accepted++;
    advance(p.takenAt);
  }

  // Ring buffer: keep the most recent SEEN_LIMIT, so the document cannot grow
  // without bound on a phone that syncs every night for a year.
  const ring = [...(doc.seen[uid] ?? []), ...added];
  doc.seen[uid] = ring.slice(-SEEN_LIMIT);

  await save(doc);
  return out;
}

/**
 * Where the next run should start: the newest photo date already sent, as the
 * phone wrote it. Null before the phone has ever sent a date.
 */
export async function cursorFor(uid: string): Promise<string | null> {
  return (await load()).cursor[uid]?.raw ?? null;
}

// ----- draining ------------------------------------------------------------

export async function pending(uid: string): Promise<InboxEntry[]> {
  const doc = await sweep(await load());
  const now = Date.now();
  return doc.entries.filter((e) => e.uid === uid && !(e.claimedUntil && e.claimedUntil > now));
}

/**
 * Hand over the bytes. By default they are deleted in the same call; with
 * `keep` they stay until the browser calls done() — which is how the
 * dashboard drains: a photo is only deleted here once it is safely read in,
 * so a failed read retries on the next check instead of losing the photo.
 */
export async function claim(
  uid: string,
  ids: string[],
  opts: { keep?: boolean; share?: boolean } = {},
): Promise<{ id: string; name: string; contentType: string; takenAt?: string; dataUrl: string }[]> {
  const doc = await load();
  const wanted = new Set(ids);
  const now = Date.now();
  // A photo another device is reading in right now is not handed out twice.
  const mine = doc.entries.filter(
    (e) => e.uid === uid && wanted.has(e.id) && !(opts.keep && e.claimedUntil && e.claimedUntil > now),
  );
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
    if (!opts.keep && !opts.share) await deleteBlob(BUCKET, `${uid}/${e.id}`, dataDir());
  }

  // Shared: every device takes its own copy, and the photo stays until it is
  // filed or removed somewhere (done) or deleted from the phone (prune).
  if (opts.share) return out;

  if (opts.keep) {
    if (out.length) {
      const leased = new Set(out.map((o) => o.id));
      for (const e of doc.entries) if (leased.has(e.id)) e.claimedUntil = now + CLAIM_LEASE_MS;
      await save(doc);
    }
    return out;
  }
  const claimed = new Set(out.map((o) => o.id));
  doc.entries = doc.entries.filter((e) => !(e.uid === uid && claimed.has(e.id)));
  await save(doc);
  return out;
}

/** The browser has read these in; delete them from the inbox. */
export async function done(uid: string, ids: string[]): Promise<number> {
  const doc = await load();
  const wanted = new Set(ids);
  const mine = doc.entries.filter((e) => e.uid === uid && wanted.has(e.id));
  if (!mine.length) return 0;
  for (const e of mine) await deleteBlob(BUCKET, `${uid}/${e.id}`, dataDir());
  const gone = new Set(mine.map((e) => e.id));
  doc.entries = doc.entries.filter((e) => !(e.uid === uid && gone.has(e.id)));
  await save(doc);
  return mine.length;
}

/** "IMG_1234.jpeg" → "img_1234": how a photo is matched to the phone's own list. */
export function nameStem(name: string): string {
  return name.trim().toLowerCase().replace(/\.[a-z0-9]{2,5}$/, "");
}

/** Names that say nothing about which photo it is ("image.jpeg"); never pruned on name alone. */
const GENERIC = /^(image|photo|file|picture|img|untitled)(\s*\d{0,2})?$/i;

/**
 * The phone reports the photos still in its camera roll from the last `days`
 * days (by name). Waiting photos from that window that are no longer there
 * were deleted on the phone, so they go here too — and every device drops
 * them on its next check. Returns how many went.
 */
export async function prune(uid: string, names: string[], days = 30): Promise<number> {
  const present = new Set(names.map(nameStem).filter(Boolean));
  if (!present.size) return 0;
  const doc = await load();
  const since = Date.now() - days * 86_400_000;
  const gone = doc.entries.filter((e) => {
    if (e.uid !== uid) return false;
    const stem = nameStem(e.name);
    if (!stem || GENERIC.test(stem)) return false;
    const taken = parseShortcutDate(e.takenAt);
    const when = Number.isFinite(taken) ? taken : Date.parse(e.receivedAt);
    return when >= since && !present.has(stem);
  });
  if (!gone.length) return 0;
  for (const e of gone) await deleteBlob(BUCKET, `${uid}/${e.id}`, dataDir());
  const ids = new Set(gone.map((e) => e.id));
  doc.entries = doc.entries.filter((e) => !ids.has(e.id));
  await save(doc);
  return gone.length;
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
