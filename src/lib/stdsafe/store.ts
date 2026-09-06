// ---------------------------------------------------------------------------
// STD Safe — server-side store.
//
// One JSON file, following the pattern recall/lists/store.ts established. This
// data cannot live in the browser: the whole feature is that a second person,
// on their own phone, asks you for something and you answer.
//
// EVERY mutator takes a Caller and re-checks it. The UI hides what you cannot
// do; the UI is not the enforcement point. Two rules in particular are
// load-bearing and are enforced here rather than in any route:
//
//   - You may only read a grant that YOU requested, that was approved, and
//     that has not expired.
//   - Nobody but the owner ever reaches a stored report file.
//
// This file is the Supabase seam. Types, route shapes and components above it
// are unaware of where the bytes sit.
// ---------------------------------------------------------------------------

import { randomBytes, randomInt } from "node:crypto";
import { nowIso, uid } from "../utils";
import { hashPassword, verifyPassword } from "../recall/passwords";
import { dataDir } from "./dataDir";
import { persistence as docPersistence, readDoc, writeDoc } from "@/lib/server/docStore";
import { deriveStatus, type DerivedStatus } from "./status";
import {
  GRANT_TTL_MS,
  INFECTION_IDS,
  type PublicUser,
  type Result,
  type ShareRequest,
  type TestRecord,
  type Verification,
} from "./types";

/**
 * Document name, not a path. On a deployed host this is a row key in
 * public.server_docs; locally it is still a file of this name under dataDir().
 */
const DOC = ".std-safe.json";

/** No I/1/O/0 — this code gets read aloud and typed by someone else. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

export interface StoredUser {
  id: string;
  handle: string;
  /** Lowercased handle, so sign-up collisions are case-insensitive. */
  handleLower: string;
  code: string;
  salt: string;
  hash: string;
  displayName?: string;
  createdAt: string;
}

interface StoredData {
  version: 1;
  /** HMAC key for session cookies. Never leaves the server. */
  secret: string;
  users: StoredUser[];
  records: TestRecord[];
  requests: ShareRequest[];
}

export interface Caller {
  userId: string;
  handle: string;
}

/** Thrown for anything the caller may not do. Carries an HTTP status. */
export class StdSafeError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

// ----- persistence ---------------------------------------------------------

function seed(): StoredData {
  return { version: 1, secret: randomBytes(32).toString("hex"), users: [], records: [], requests: [] };
}

let cache: StoredData | null = null;

async function readData(): Promise<StoredData> {
  if (cache) return cache;
  const parsed = await readDoc<Partial<StoredData>>(DOC, dataDir());
  cache = parsed
    ? {
        version: 1,
        secret: parsed.secret || randomBytes(32).toString("hex"),
        users: parsed.users ?? [],
        records: parsed.records ?? [],
        requests: parsed.requests ?? [],
      }
    : seed();
  return cache;
}

/**
 * Serialised writes.
 *
 * Two people acting at once is the normal case here — that is literally the
 * request/approve flow — and read-modify-write on a JSON file loses one of
 * them without this.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function writeData(data: StoredData): Promise<void> {
  cache = data;
  await writeDoc(DOC, dataDir(), data);
}

async function mutate<T>(fn: (data: StoredData) => Promise<T> | T): Promise<T> {
  return serialize(async () => {
    const data = await readData();
    const out = await fn(data);
    await writeData(data);
    return out;
  });
}

/**
 * Whether this host will actually keep what we write.
 *
 * Reported to the UI rather than assumed. On serverless the file is
 * per-instance and ephemeral, and someone should be told that before they
 * build a health record on top of it.
 */
export async function persistence(): Promise<{ persistent: boolean; reason: string }> {
  return docPersistence(dataDir());
}

// ----- users ---------------------------------------------------------------

function publicUser(u: StoredUser): PublicUser {
  return { id: u.id, handle: u.handle, displayName: u.displayName };
}

function makeCode(taken: Set<string>): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!taken.has(code)) return code;
  }
  throw new StdSafeError("Could not allocate a code. Try again.", 500);
}

export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, "");
}

export async function signUp(
  handleRaw: string,
  password: string,
  displayName?: string,
): Promise<{ user: StoredUser }> {
  const handle = normalizeHandle(handleRaw);
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(handle)) {
    throw new StdSafeError("Handles are 3-24 characters: letters, numbers, dot, dash or underscore.", 400);
  }
  if (password.length < 8) throw new StdSafeError("Use a passphrase of at least 8 characters.", 400);

  const { salt, hash } = await hashPassword(password);
  return mutate((data) => {
    const lower = handle.toLowerCase();
    if (data.users.some((u) => u.handleLower === lower)) {
      throw new StdSafeError("That handle is taken.", 409);
    }
    const user: StoredUser = {
      id: uid("usr"),
      handle,
      handleLower: lower,
      code: makeCode(new Set(data.users.map((u) => u.code))),
      salt,
      hash,
      displayName: displayName?.trim() || undefined,
      createdAt: nowIso(),
    };
    data.users.push(user);
    return { user };
  });
}

export async function signIn(handleRaw: string, password: string): Promise<StoredUser> {
  const lower = normalizeHandle(handleRaw).toLowerCase();
  const data = await readData();
  const user = data.users.find((u) => u.handleLower === lower);
  // Same message either way: a distinct "no such handle" turns this into a
  // directory of who has an account here, which is not a neutral fact.
  const bad = new StdSafeError("That handle and passphrase do not match.", 401);
  if (!user) {
    await verifyPassword(password, null);
    throw bad;
  }
  if (!(await verifyPassword(password, { salt: user.salt, hash: user.hash }))) throw bad;
  return user;
}

export async function callerFor(userId: string): Promise<Caller | null> {
  const data = await readData();
  const user = data.users.find((u) => u.id === userId);
  return user ? { userId: user.id, handle: user.handle } : null;
}

export async function signingSecret(): Promise<string> {
  return (await readData()).secret;
}

/** Rotating the code revokes every outstanding grant — that is the point of it. */
export async function rotateCode(caller: Caller): Promise<string> {
  return mutate((data) => {
    const user = data.users.find((u) => u.id === caller.userId);
    if (!user) throw new StdSafeError("No such account.", 404);
    user.code = makeCode(new Set(data.users.map((u) => u.code)));
    for (const req of data.requests) {
      if (req.toUserId === caller.userId && req.status === "approved") req.status = "expired";
    }
    return user.code;
  });
}

export async function setDisplayName(caller: Caller, name: string): Promise<PublicUser> {
  return mutate((data) => {
    const user = data.users.find((u) => u.id === caller.userId);
    if (!user) throw new StdSafeError("No such account.", 404);
    user.displayName = name.trim() || undefined;
    return publicUser(user);
  });
}

// ----- records -------------------------------------------------------------

export interface RecordInput {
  collectedAt: string;
  reportedAt?: string;
  lab: string;
  panelName: string;
  verification: Verification;
  fileId?: string;
  fileName?: string;
  results: Result[];
  note?: string;
}

function validateRecord(input: RecordInput): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.collectedAt)) {
    throw new StdSafeError("A collection date (YYYY-MM-DD) is required.", 400);
  }
  if (Date.parse(`${input.collectedAt}T12:00:00Z`) > Date.now() + 86_400_000) {
    throw new StdSafeError("That collection date is in the future.", 400);
  }
  if (!input.results.length) throw new StdSafeError("A record needs at least one result.", 400);
  for (const r of input.results) {
    if (!INFECTION_IDS.includes(r.infection)) throw new StdSafeError(`Unknown test: ${r.infection}`, 400);
  }
}

export async function addRecord(caller: Caller, input: RecordInput): Promise<TestRecord> {
  validateRecord(input);
  return mutate((data) => {
    const record: TestRecord = {
      id: uid("rec"),
      userId: caller.userId,
      collectedAt: input.collectedAt,
      reportedAt: input.reportedAt,
      lab: input.lab.trim() || "Unnamed lab",
      panelName: input.panelName.trim() || "Panel",
      verification: input.verification,
      fileId: input.fileId,
      fileName: input.fileName,
      // De-duplicate: a parser that emitted the same infection twice would
      // otherwise make latestFor() depend on array order.
      results: input.results.filter((r, i, all) => all.findIndex((o) => o.infection === r.infection) === i),
      note: input.note?.trim() || undefined,
      createdAt: nowIso(),
    };
    data.records.push(record);
    return record;
  });
}

export async function deleteRecord(caller: Caller, id: string): Promise<{ fileId?: string }> {
  return mutate((data) => {
    const idx = data.records.findIndex((r) => r.id === id);
    if (idx === -1) throw new StdSafeError("No such record.", 404);
    // Ownership re-checked here, not in the route.
    if (data.records[idx].userId !== caller.userId) throw new StdSafeError("That is not your record.", 403);
    const [removed] = data.records.splice(idx, 1);
    return { fileId: removed.fileId };
  });
}

export async function recordsFor(userId: string): Promise<TestRecord[]> {
  const data = await readData();
  return data.records
    .filter((r) => r.userId === userId)
    .sort((a, b) => (a.collectedAt < b.collectedAt ? 1 : a.collectedAt > b.collectedAt ? -1 : 0));
}

export async function recordById(caller: Caller, id: string): Promise<TestRecord | null> {
  const data = await readData();
  const record = data.records.find((r) => r.id === id);
  if (!record || record.userId !== caller.userId) return null;
  return record;
}

// ----- requests ------------------------------------------------------------

function expireStale(data: StoredData): void {
  const now = Date.now();
  for (const req of data.requests) {
    if (req.status === "approved" && req.grantExpiresAt && Date.parse(req.grantExpiresAt) < now) {
      req.status = "expired";
    }
  }
}

export async function requestByCode(caller: Caller, codeRaw: string): Promise<ShareRequest> {
  const code = codeRaw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return mutate((data) => {
    expireStale(data);
    const target = data.users.find((u) => u.code === code);
    if (!target) throw new StdSafeError("No account has that code. Check the characters and try again.", 404);
    if (target.id === caller.userId) throw new StdSafeError("That is your own code.", 400);

    // A live request or grant is reused rather than duplicated: asking twice
    // should not stack two prompts on the other person's screen.
    const live = data.requests.find(
      (r) =>
        r.fromUserId === caller.userId &&
        r.toUserId === target.id &&
        (r.status === "pending" || r.status === "approved"),
    );
    if (live) return live;

    const req: ShareRequest = {
      id: uid("req"),
      fromUserId: caller.userId,
      toUserId: target.id,
      status: "pending",
      createdAt: nowIso(),
    };
    data.requests.push(req);
    return req;
  });
}

export async function respondToRequest(caller: Caller, id: string, approve: boolean): Promise<ShareRequest> {
  return mutate((data) => {
    const req = data.requests.find((r) => r.id === id);
    if (!req) throw new StdSafeError("No such request.", 404);
    // Only the person being asked can answer.
    if (req.toUserId !== caller.userId) throw new StdSafeError("That request is not yours to answer.", 403);
    if (req.status !== "pending") throw new StdSafeError("That request has already been answered.", 409);
    req.status = approve ? "approved" : "denied";
    req.respondedAt = nowIso();
    req.grantExpiresAt = approve ? new Date(Date.now() + GRANT_TTL_MS).toISOString() : undefined;
    return req;
  });
}

export async function revokeGrant(caller: Caller, id: string): Promise<void> {
  await mutate((data) => {
    const req = data.requests.find((r) => r.id === id);
    if (!req) throw new StdSafeError("No such request.", 404);
    if (req.toUserId !== caller.userId) throw new StdSafeError("That grant is not yours to revoke.", 403);
    req.status = "expired";
  });
}

export interface InboxRequest {
  id: string;
  status: ShareRequest["status"];
  createdAt: string;
  respondedAt?: string;
  grantExpiresAt?: string;
  who: PublicUser;
}

export interface Inbox {
  /** People asking to see yours. */
  incoming: InboxRequest[];
  /** People you have asked. */
  outgoing: InboxRequest[];
}

export async function inboxFor(caller: Caller): Promise<Inbox> {
  const data = await mutate((d) => {
    expireStale(d);
    return d;
  });
  const byId = new Map(data.users.map((u) => [u.id, publicUser(u)]));
  const unknown: PublicUser = { id: "gone", handle: "deleted account" };

  const shape = (r: ShareRequest, whoId: string): InboxRequest => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt,
    respondedAt: r.respondedAt,
    grantExpiresAt: r.grantExpiresAt,
    who: byId.get(whoId) ?? unknown,
  });

  const newestFirst = (a: InboxRequest, b: InboxRequest) => (a.createdAt < b.createdAt ? 1 : -1);

  return {
    incoming: data.requests
      .filter((r) => r.toUserId === caller.userId && r.status !== "denied")
      .map((r) => shape(r, r.fromUserId))
      .sort(newestFirst),
    // A denial the asker can see would announce itself, so their own view of a
    // denied request stays indistinguishable from one never answered.
    outgoing: data.requests
      .filter((r) => r.fromUserId === caller.userId && r.status !== "denied")
      .map((r) => shape(r, r.toUserId))
      .sort(newestFirst),
  };
}

// ----- the shared view -----------------------------------------------------

export interface SharedView {
  who: PublicUser;
  status: DerivedStatus;
  grantExpiresAt: string;
  /** Enough to show provenance without exposing the report itself. */
  records: Array<{ collectedAt: string; lab: string; panelName: string; verification: Verification }>;
}

/**
 * What the other person sees.
 *
 * The three conditions are checked together and answered with one message: a
 * distinct "expired" versus "denied" would leak the answer to a denial.
 */
export async function sharedView(caller: Caller, requestId: string): Promise<SharedView> {
  const data = await mutate((d) => {
    expireStale(d);
    return d;
  });
  const req = data.requests.find((r) => r.id === requestId);
  if (!req || req.fromUserId !== caller.userId || req.status !== "approved") {
    throw new StdSafeError("That view is not available.", 404);
  }
  const owner = data.users.find((u) => u.id === req.toUserId);
  if (!owner) throw new StdSafeError("That view is not available.", 404);

  const records = data.records.filter((r) => r.userId === owner.id);
  return {
    who: publicUser(owner),
    status: deriveStatus(records),
    grantExpiresAt: req.grantExpiresAt!,
    records: records
      .map((r) => ({
        collectedAt: r.collectedAt,
        lab: r.lab,
        panelName: r.panelName,
        verification: r.verification,
      }))
      .sort((a, b) => (a.collectedAt < b.collectedAt ? 1 : -1)),
  };
}

/** The owner's own dashboard payload. */
export interface MePayload {
  me: PublicUser & { code: string };
  records: TestRecord[];
  status: DerivedStatus;
  inbox: Inbox;
  storage: { persistent: boolean; reason: string };
}

export async function mePayload(caller: Caller): Promise<MePayload> {
  const data = await readData();
  const user = data.users.find((u) => u.id === caller.userId);
  if (!user) throw new StdSafeError("No such account.", 404);
  const records = await recordsFor(caller.userId);
  return {
    me: { id: user.id, handle: user.handle, displayName: user.displayName, code: user.code },
    records,
    status: deriveStatus(records),
    inbox: await inboxFor(caller),
    storage: await persistence(),
  };
}

/** Test seam — the file is cached in-process. */
export function resetCache(): void {
  cache = null;
}
