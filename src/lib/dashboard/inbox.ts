import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import { deleteBlob, getBlob, putBlob, signedBlobUrl } from "@/lib/server/blobStore";
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
  /** Short hash of the bytes, so a re-send can be pointed at the photo already here. */
  sha?: string;
  /**
   * Sent up by a browser (a photo added on one device), not by the phone —
   * so the phone's "still on my phone" list never removes it.
   */
  fromBrowser?: boolean;
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
  /**
   * uid -> when the phone last sent a photo (ISO), accepted or skipped. Shown
   * in Camera Autopilot so "nothing new" can be told apart from "the phone
   * stopped sending" without anyone digging.
   */
  lastPush: Record<string, string>;
  /** uid -> when the Shortcut last asked for its bookmark or reported its photos (ISO). */
  checkIn?: Record<string, string>;
  /** uid -> the last send from that phone that was turned away, and why. */
  problem?: Record<string, { at: string; message: string }>;
  /** uid -> hashes of that user's replaced tokens, so an old link can be named as theirs. */
  retired?: Record<string, string[]>;
  /** Sends with a key nobody has — newest last. `uid` when it was someone's old key. */
  refused?: { at: string; uid?: string }[];
}

const EMPTY: InboxDoc = { tokens: {}, entries: [], seen: {}, cursor: {}, lastPush: {}, checkIn: {}, problem: {}, retired: {}, refused: [] };

async function load(): Promise<InboxDoc> {
  const doc = await readDoc<InboxDoc>(DOC, dataDir());
  if (!doc) return { ...EMPTY };
  return {
    tokens: doc.tokens ?? {},
    entries: doc.entries ?? [],
    seen: doc.seen ?? {},
    cursor: doc.cursor ?? {},
    lastPush: doc.lastPush ?? {},
    checkIn: doc.checkIn ?? {},
    problem: doc.problem ?? {},
    retired: doc.retired ?? {},
    refused: doc.refused ?? [],
  };
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
  // Remember the key this replaces, so a phone still using it can be told
  // "your link is out of date" instead of failing with no sign anywhere.
  const old = doc.tokens[uid];
  if (old) doc.retired![uid] = [...(doc.retired![uid] ?? []).filter((h) => h !== old), old].slice(-RETIRED_LIMIT);
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

// ----- what the phone has been doing -------------------------------------
//
// Every way the Shortcut can fail used to look the same in Jarvis ("iPhone
// hasn't sent a photo yet"). These record each kind of contact, so Camera
// Autopilot can say which one it is — see phoneStatus.ts.

const RETIRED_LIMIT = 5;
const REFUSED_LIMIT = 10;
/** A refused send is only written down this often, so junk traffic can't hammer the document. */
const REFUSED_EVERY_MS = 30_000;

/** The Shortcut asked for its bookmark or reported its photos: it is running. */
export async function noteCheckIn(uid: string): Promise<void> {
  const doc = await load();
  doc.checkIn![uid] = new Date().toISOString();
  await save(doc);
}

/** This user's phone sent something that was turned away; the message says why. */
export async function noteProblem(uid: string, message: string): Promise<void> {
  const doc = await load();
  doc.problem![uid] = { at: new Date().toISOString(), message: message.slice(0, 240) };
  await save(doc);
}

/** A send with a key that isn't anyone's now — named as theirs when it is a user's old key. */
export async function noteRefused(token: string): Promise<void> {
  const doc = await load();
  const list = doc.refused!;
  const last = list.length ? Date.parse(list[list.length - 1].at) : 0;
  if (Date.now() - last < REFUSED_EVERY_MS) return;
  const h = token ? hash(token) : "";
  const uid = h ? Object.entries(doc.retired!).find(([, hs]) => hs.includes(h))?.[0] : undefined;
  doc.refused = [...list, { at: new Date().toISOString(), ...(uid ? { uid } : {}) }].slice(-REFUSED_LIMIT);
  await save(doc);
}

export interface PhoneStatus {
  linked: boolean;
  lastPush: string | null;
  lastCheckIn: string | null;
  problem: { at: string; message: string } | null;
  /** The newest refused send that is this user's — their old key, or (for the owner) a key nobody has. */
  refusedAt: string | null;
  /** The bookmark the Shortcut starts from. */
  cursor: string | null;
}

export async function phoneStatus(uid: string, opts: { owner?: boolean } = {}): Promise<PhoneStatus> {
  const doc = await load();
  const refused = [...(doc.refused ?? [])].reverse().find((r) => r.uid === uid || (!r.uid && opts.owner));
  return {
    linked: Boolean(doc.tokens[uid]),
    lastPush: doc.lastPush[uid] ?? null,
    lastCheckIn: doc.checkIn?.[uid] ?? null,
    problem: doc.problem?.[uid] ?? null,
    refusedAt: refused?.at ?? null,
    cursor: doc.cursor[uid]?.raw ?? null,
  };
}

// ----- receiving -----------------------------------------------------------

export interface ReceiveResult {
  accepted: number;
  skipped: number;
  rejected: { name: string; reason: string }[];
  /**
   * Per photo sent, in order: the inbox id it now has — a new one, or the
   * waiting photo it is a copy of — or null when it was refused or is a copy
   * of one already filed.
   */
  ids: (string | null)[];
}

export interface ReceiveOptions {
  /**
   * From a browser rather than the phone: it must not move the phone's
   * bookmark (that would make the Shortcut skip photos) or count as the
   * phone having sent something.
   */
  fromBrowser?: boolean;
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
export async function receive(uid: string, photos: IncomingPhoto[], opts: ReceiveOptions = {}): Promise<ReceiveResult> {
  // The bytes go to Storage FIRST, with no copy of the inbox document held.
  // Uploading takes seconds; loading the document, uploading, then saving
  // meant anything another device saved meanwhile (filing a photo, the
  // phone's clean-up list) was overwritten — and a save from the other side
  // could wipe the photo that had just arrived, so it never showed up.
  const before = await load();
  const seenBefore = new Set(before.seen[uid] ?? []);
  const list = photos.slice(0, MAX_PER_REQUEST);
  const out: ReceiveResult = { accepted: 0, skipped: 0, rejected: [], ids: list.map(() => null) };
  const staged: { entry: InboxEntry; keys: string[]; at: number }[] = [];
  const skippedAt: { at: number; keys: string[] }[] = [];
  const skippedDates: (string | undefined)[] = [];
  const batchSeen = new Set<string>();

  for (const [at, p] of list.entries()) {
    if (p.body.length > MAX_PHOTO_BYTES) {
      out.rejected.push({ name: p.name, reason: "over 25 MB" });
      continue;
    }
    // The exact same bytes are the same photo, whatever name or id a second
    // Shortcut or automation gave them.
    const sha = `sha:${createHash("sha256").update(p.body).digest("hex").slice(0, 32)}`;
    const known = (k: string) => seenBefore.has(k) || batchSeen.has(k);
    if ((p.deviceId && known(p.deviceId)) || known(sha)) {
      out.skipped++;
      skippedDates.push(p.takenAt);
      skippedAt.push({ at, keys: p.deviceId ? [p.deviceId, sha] : [sha] });
      continue;
    }

    const id = randomBytes(12).toString("hex");
    const ok = await putBlob(BUCKET, `${uid}/${id}`, dataDir(), p.body, p.contentType);
    if (!ok) {
      out.rejected.push({ name: p.name, reason: "storage unavailable" });
      continue;
    }
    const keys = p.deviceId ? [p.deviceId, sha] : [sha];
    for (const k of keys) batchSeen.add(k);
    staged.push({
      at,
      keys,
      entry: {
        id,
        uid,
        deviceId: p.deviceId,
        name: p.name,
        contentType: p.contentType,
        bytes: p.body.length,
        takenAt: p.takenAt,
        receivedAt: new Date().toISOString(),
        sha,
        ...(opts.fromBrowser ? { fromBrowser: true } : {}),
      },
    });
  }

  // Now the short part: a fresh copy of the document, changed and saved at once.
  const doc = await load();
  const seen = new Set(doc.seen[uid] ?? []);
  const added: string[] = [];

  // The bookmark moves for every photo the phone sends — accepted or skipped
  // as already seen — because either way the phone is done with it.
  const advance = (raw?: string) => {
    if (opts.fromBrowser) return;
    const t = parseShortcutDate(raw);
    if (!raw || !Number.isFinite(t)) return;
    const cur = doc.cursor[uid];
    if (!cur || t > cur.t) doc.cursor[uid] = { raw: raw.trim(), t };
  };
  for (const d of skippedDates) advance(d);

  // The waiting photo a copy points at, if it is still waiting.
  const waitingFor = (keys: string[]) =>
    doc.entries.find((e) => e.uid === uid && ((e.sha && keys.includes(e.sha)) || (e.deviceId && keys.includes(e.deviceId))))?.id ??
    null;
  for (const { at, keys } of skippedAt) out.ids[at] = waitingFor(keys);

  for (const { entry, keys, at } of staged) {
    // Another send of the same photo landed while this one was uploading.
    if (keys.some((k) => seen.has(k))) {
      await deleteBlob(BUCKET, `${uid}/${entry.id}`, dataDir());
      out.skipped++;
      out.ids[at] = waitingFor(keys);
      advance(entry.takenAt);
      continue;
    }
    doc.entries.push(entry);
    out.ids[at] = entry.id;
    for (const k of keys) {
      seen.add(k);
      added.push(k);
    }
    out.accepted++;
    advance(entry.takenAt);
  }

  // Ring buffer: keep the most recent SEEN_LIMIT, so the document cannot grow
  // without bound on a phone that syncs every night for a year.
  doc.seen[uid] = [...(doc.seen[uid] ?? []), ...added].slice(-SEEN_LIMIT);
  if (photos.length && !opts.fromBrowser) doc.lastPush[uid] = new Date().toISOString();

  await save(doc);
  return out;
}

/** When the phone last sent anything, or null if it never has. */
export async function lastPushFor(uid: string): Promise<string | null> {
  return (await load()).lastPush[uid] ?? null;
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
export interface ClaimedPhoto {
  id: string;
  name: string;
  contentType: string;
  takenAt?: string;
  /** When it reached the inbox — the same on every device, for ordering. */
  receivedAt?: string;
  /**
   * A short-lived link straight to the photo in Storage. Used when sharing:
   * the browser downloads the bytes itself, so no photo is ever too big to
   * hand over (a base64 answer over ~4.5 MB is refused by Vercel, and one
   * photo that big used to block every photo after it).
   */
  url?: string;
  /** The bytes inline — only when there is no Storage to link to. */
  dataUrl?: string;
}

/** How long a share link lives; the browser uses it within seconds. */
const SHARE_LINK_SECONDS = 10 * 60;

export async function claim(
  uid: string,
  ids: string[],
  opts: { keep?: boolean; share?: boolean } = {},
): Promise<ClaimedPhoto[]> {
  const doc = await load();
  const wanted = new Set(ids);
  const now = Date.now();
  // A photo another device is reading in right now is not handed out twice.
  const mine = doc.entries.filter(
    (e) => e.uid === uid && wanted.has(e.id) && !(opts.keep && e.claimedUntil && e.claimedUntil > now),
  );
  const out: ClaimedPhoto[] = [];

  for (const e of mine) {
    if (opts.share) {
      const url = await signedBlobUrl(BUCKET, `${uid}/${e.id}`, SHARE_LINK_SECONDS);
      if (url) {
        out.push({ id: e.id, name: e.name, contentType: e.contentType, takenAt: e.takenAt, receivedAt: e.receivedAt, url });
        continue;
      }
    }
    const buf = await getBlob(BUCKET, `${uid}/${e.id}`, dataDir());
    if (!buf) continue;
    out.push({
      id: e.id,
      name: e.name,
      contentType: e.contentType,
      takenAt: e.takenAt,
      receivedAt: e.receivedAt,
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
  // Save first, delete bytes after: the document is held for one quick write,
  // so a photo the phone sends meanwhile isn't overwritten by a stale copy.
  const gone = new Set(mine.map((e) => e.id));
  doc.entries = doc.entries.filter((e) => !(e.uid === uid && gone.has(e.id)));
  await save(doc);
  for (const e of mine) await deleteBlob(BUCKET, `${uid}/${e.id}`, dataDir());
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
    if (e.uid !== uid || e.fromBrowser) return false;
    const stem = nameStem(e.name);
    if (!stem || GENERIC.test(stem)) return false;
    const taken = parseShortcutDate(e.takenAt);
    const when = Number.isFinite(taken) ? taken : Date.parse(e.receivedAt);
    return when >= since && !present.has(stem);
  });
  if (!gone.length) return 0;
  const ids = new Set(gone.map((e) => e.id));
  doc.entries = doc.entries.filter((e) => !ids.has(e.id));
  await save(doc);
  for (const e of gone) await deleteBlob(BUCKET, `${uid}/${e.id}`, dataDir());
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
