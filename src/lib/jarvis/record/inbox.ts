import "server-only";

// ---------------------------------------------------------------------------
// The capture inbox: what the browser extension and the phone push in.
//
// A web page cannot see what you type on another website — that is the origin
// boundary the whole web rests on, and no amount of cleverness in this app
// crosses it. Something running INSIDE the page has to hand the values over.
// So, exactly like the iPhone photo inbox (src/lib/dashboard/inbox.ts), this
// is an endpoint an outside client POSTs to and a short-lived buffer the
// browser later drains.
//
// It is a TRANSIT BUFFER, never the record. Captures live here only between
// the extension sending them and the Record tab claiming them, because:
//
//   · the Life Record itself lives in the owner's browser (localStorage plus
//     their own app_state row), and this server has no session with which to
//     write it, and
//   · nothing may enter the record without the owner confirming it, which is
//     a decision only the browser can present.
//
// FILL SNAPSHOT. The reverse direction has the same problem: the extension
// needs values to type in, and the server does not have them. So the Record
// tab PUBLISHES a snapshot here whenever the record changes, and the extension
// reads that. Sensitive fields are excluded from the snapshot — a Social
// Security number does not leave the owner's device for a convenience. The
// extension keeps those in its own local storage if the owner puts them there.
// ---------------------------------------------------------------------------

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import { isSensitive } from "./types";
import type { LifeRecord } from "./types";

const DOC = "jarvis-record-inbox";
const SWEEP_DAYS = 14;
const MAX_CAPTURES_PER_USER = 40;
const MAX_FIELDS_PER_CAPTURE = 80;

function dataDir(): string {
  return process.env.RECALL_DATA_DIR || path.resolve(".");
}

/** One value the extension saw, already matched where it could be. */
export interface CapturedValue {
  /** Record key, or a `group.field` key, or "" when unmatched. */
  key: string;
  value: string;
  /** The words on the page this came from, so the owner can check it. */
  label: string;
  /** Which rung of the matcher placed it; "you" when the owner mapped it. */
  by: string;
  confidence: number;
}

export interface Capture {
  id: string;
  uid: string;
  /** The page it came from — shown to the owner, and the mapping's cache key. */
  site: string;
  title: string;
  receivedAt: string;
  values: CapturedValue[];
  /** Set when the capture arrived as a screenshot rather than as form values. */
  fromImage?: boolean;
}

interface InboxDoc {
  /** uid -> sha256 of that user's extension token. */
  tokens: Record<string, string>;
  captures: Capture[];
  /** uid -> the non-sensitive snapshot the extension fills from. */
  snapshots: Record<string, { values: Record<string, string>; updatedAt: string }>;
  /** uid -> domain -> { form field name -> record key }, learned once. */
  mappings: Record<string, Record<string, Record<string, string>>>;
}

const EMPTY: InboxDoc = { tokens: {}, captures: [], snapshots: {}, mappings: {} };

async function load(): Promise<InboxDoc> {
  const doc = await readDoc<InboxDoc>(DOC, dataDir());
  if (!doc) return { ...EMPTY };
  return {
    tokens: doc.tokens ?? {},
    captures: doc.captures ?? [],
    snapshots: doc.snapshots ?? {},
    mappings: doc.mappings ?? {},
  };
}

async function save(doc: InboxDoc): Promise<boolean> {
  const cutoff = Date.now() - SWEEP_DAYS * 86400_000;
  doc.captures = doc.captures.filter((c) => Date.parse(c.receivedAt) > cutoff);
  return writeDoc(DOC, dataDir(), doc);
}

// ----- tokens --------------------------------------------------------------

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mint (or rotate) this user's extension token. Returned in the clear exactly
 * once; only its hash is kept, so a leaked document cannot be replayed.
 */
export async function mintToken(uid: string): Promise<string | null> {
  const token = randomBytes(24).toString("base64url");
  const doc = await load();
  doc.tokens[uid] = hashToken(token);
  return (await save(doc)) ? token : null;
}

export async function hasToken(uid: string): Promise<boolean> {
  return Boolean((await load()).tokens[uid]);
}

export async function revokeToken(uid: string): Promise<boolean> {
  const doc = await load();
  delete doc.tokens[uid];
  return save(doc);
}

/** The uid this token belongs to, or null. Constant-time per candidate. */
export async function uidForToken(token: string): Promise<string | null> {
  if (!token) return null;
  const want = Buffer.from(hashToken(token), "hex");
  const doc = await load();
  for (const [uid, stored] of Object.entries(doc.tokens)) {
    const got = Buffer.from(stored, "hex");
    if (got.length === want.length && timingSafeEqual(got, want)) return uid;
  }
  return null;
}

/** The token off an Authorization header or an x-jarvis-token header. */
export function tokenFrom(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  if (bearer) return bearer[1].trim();
  return (req.headers.get("x-jarvis-token") ?? "").trim();
}

// ----- receiving -----------------------------------------------------------

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export interface IncomingCapture {
  site: string;
  title: string;
  values: CapturedValue[];
  fromImage?: boolean;
}

/**
 * Store what the extension saw.
 *
 * A capture from a site already waiting in the buffer REPLACES it rather than
 * stacking. Filling a long application means typing, tabbing, going back and
 * correcting, and an extension that pushes on every blur would otherwise leave
 * the owner eleven near-identical captures of the same form to review.
 */
export async function receive(uid: string, incoming: IncomingCapture): Promise<Capture | null> {
  const site = clean(incoming.site, 200);
  const values = (incoming.values ?? [])
    .slice(0, MAX_FIELDS_PER_CAPTURE)
    .map((v) => ({
      key: clean(v.key, 80),
      value: clean(v.value, 1000),
      label: clean(v.label, 160),
      by: clean(v.by, 20) || "name",
      confidence: Number.isFinite(v.confidence) ? Math.max(0, Math.min(1, Number(v.confidence))) : 0.5,
    }))
    .filter((v) => v.value);

  if (!values.length) return null;

  const capture: Capture = {
    id: randomBytes(8).toString("hex"),
    uid,
    site,
    title: clean(incoming.title, 200),
    receivedAt: new Date().toISOString(),
    values,
    fromImage: incoming.fromImage === true,
  };

  const doc = await load();
  doc.captures = doc.captures.filter((c) => !(c.uid === uid && c.site === site && site));
  doc.captures.push(capture);

  const mine = doc.captures.filter((c) => c.uid === uid);
  if (mine.length > MAX_CAPTURES_PER_USER) {
    const drop = new Set(mine.slice(0, mine.length - MAX_CAPTURES_PER_USER).map((c) => c.id));
    doc.captures = doc.captures.filter((c) => !drop.has(c.id));
  }

  return (await save(doc)) ? capture : null;
}

export async function pending(uid: string): Promise<Capture[]> {
  const doc = await load();
  return doc.captures.filter((c) => c.uid === uid).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

/** Drop captures the owner has dealt with. No ids given = drop them all. */
export async function claim(uid: string, ids?: string[]): Promise<number> {
  const doc = await load();
  const before = doc.captures.length;
  const wanted = ids?.length ? new Set(ids) : null;
  doc.captures = doc.captures.filter((c) => c.uid !== uid || (wanted ? !wanted.has(c.id) : false));
  await save(doc);
  return before - doc.captures.length;
}

// ----- the fill snapshot ---------------------------------------------------

/**
 * Publish what the extension may type into a form.
 *
 * Sensitive fields are stripped here rather than at the reading end, so that
 * the value never reaches this server's storage at all. That is the difference
 * between "the extension is not shown it" and "it is not there" — only the
 * second survives someone reading the document.
 */
export async function publishSnapshot(uid: string, record: LifeRecord): Promise<boolean> {
  const values: Record<string, string> = {};

  for (const [key, held] of Object.entries(record.fields ?? {})) {
    if (isSensitive(key)) continue;
    if (held?.value) values[key] = held.value;
  }

  for (const [groupId, rows] of Object.entries(record.groups ?? {})) {
    (rows ?? []).forEach((entry, i) => {
      for (const [key, value] of Object.entries(entry.values ?? {})) {
        if (isSensitive(key, groupId) || !value) continue;
        values[`${groupId}.${i + 1}.${key}`] = value;
      }
    });
  }

  const doc = await load();
  doc.snapshots[uid] = { values, updatedAt: new Date().toISOString() };
  return save(doc);
}

export async function snapshot(uid: string): Promise<{ values: Record<string, string>; updatedAt: string } | null> {
  return (await load()).snapshots[uid] ?? null;
}

// ----- learned mappings ----------------------------------------------------

/** A domain's learned field mapping, so a site is only ever solved once. */
export async function mappingFor(uid: string, domain: string): Promise<Record<string, string>> {
  return (await load()).mappings[uid]?.[domain] ?? {};
}

export async function learnMapping(
  uid: string,
  domain: string,
  pairs: Record<string, string>,
): Promise<boolean> {
  const doc = await load();
  const forUser = (doc.mappings[uid] ??= {});
  forUser[domain] = { ...(forUser[domain] ?? {}), ...pairs };
  return save(doc);
}
