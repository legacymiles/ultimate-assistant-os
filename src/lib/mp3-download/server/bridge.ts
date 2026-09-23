import "server-only";

// ---------------------------------------------------------------------------
// The PC bridge: how the deployed site gets a YouTube file it cannot fetch.
//
// yt-dlp is a program on the owner's machine. Vercel has no such binary and
// never will, so on the live site that source is simply dark — which is honest
// but unhelpful when the owner is on their phone and wants the song.
//
// So the site stops trying to do the work and hands it over. It writes a job;
// a small program on the PC polls for one, runs yt-dlp, and puts the finished
// file in Storage; the browser collects it from a signed link. The site never
// touches YouTube and the PC never needs an inbound port.
//
// The shape is the hub's existing runner pattern — Game Creator, 3D Studio and
// Video Studio Arena all work this way — deliberately, so there is one idea to
// learn rather than four. Tokens are stored hashed and compared in constant
// time, exactly as those do.
// ---------------------------------------------------------------------------

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { deleteBlob, ensureBucket, putBlob, signedBlobUrl, signedUploadUrl } from "@/lib/server/blobStore";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import type { GrabMode } from "../ytdlp";

const DOC = "mp3-download-bridge";
const BUCKET = "mp3-download";

/**
 * The most this route will take in one request body.
 *
 * A deployed Vercel function caps at 4.5 MB. This said 8, which accepted a
 * request the platform then rejected with a 413 before the handler ever ran —
 * so the limit was a lie in the only place it mattered. Storage is the real
 * path; this is the fallback for a hub that has none.
 */
export const MAX_INLINE_BYTES = 4 * 1024 * 1024;

/** A job nobody collected is rubbish after this long. */
const JOB_TTL_MS = 6 * 60 * 60_000;

export type JobState = "queued" | "running" | "done" | "failed";

export interface BridgeJob {
  id: string;
  url: string;
  mode: GrabMode;
  /** What the confirmed track (or the pasted link) is called. */
  title: string;
  creator: string;
  /** The name the finished file should be saved under. */
  filename: string;
  state: JobState;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Storage key of the finished file, once there is one. */
  key?: string;
  bytes?: number;
  error?: string;
}

interface Doc {
  /** uid -> sha256 of the runner token. */
  tokens: Record<string, string>;
  /** uid -> when that runner last checked in. */
  lastSeen: Record<string, string>;
  /** uid -> jobs, oldest first. */
  jobs: Record<string, BridgeJob[]>;
}

function dataDir(): string {
  return process.env.MP3_DOWNLOAD_DATA_DIR || path.resolve(".data");
}

async function load(): Promise<Doc> {
  const doc = await readDoc<Doc>(DOC, dataDir());
  return { tokens: doc?.tokens ?? {}, lastSeen: doc?.lastSeen ?? {}, jobs: doc?.jobs ?? {} };
}

// Writes are serialised through one chain: two runners claiming at the same
// moment must not both win the same job, and read-modify-write cannot promise
// that on its own.
let chain: Promise<unknown> = Promise.resolve();

function mutate<T>(fn: (doc: Doc) => T): Promise<{ value: T; saved: boolean }> {
  const run = chain.then(async () => {
    const doc = await load();
    const value = fn(doc);
    const saved = await writeDoc(DOC, dataDir(), doc);
    return { value, saved };
  });
  chain = run.catch(() => undefined);
  return run;
}

const now = () => new Date().toISOString();

// --- tokens -----------------------------------------------------------------

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mint (and replace) this owner's runner token. Shown once, stored hashed. */
export async function mintToken(uid: string): Promise<string | null> {
  const token = randomBytes(24).toString("base64url");
  const { saved } = await mutate((doc) => {
    doc.tokens[uid] = hashToken(token);
  });
  return saved ? token : null;
}

/** The owner a runner token belongs to, or null. Constant-time comparison. */
export async function uidForToken(token: string): Promise<string | null> {
  if (!token) return null;
  const doc = await load();
  const candidate = Buffer.from(hashToken(token));
  for (const [uid, stored] of Object.entries(doc.tokens)) {
    const known = Buffer.from(stored);
    if (known.length === candidate.length && timingSafeEqual(known, candidate)) return uid;
  }
  return null;
}

export interface BridgeInfo {
  hasToken: boolean;
  lastSeen: string | null;
  online: boolean;
  /** Jobs still queued or running, so the UI can say "2 waiting". */
  pending: number;
}

export async function bridgeInfo(uid: string): Promise<BridgeInfo> {
  const doc = await load();
  const lastSeen = doc.lastSeen[uid] ?? null;
  // Two minutes: the runner polls every few seconds, so a longer gap means it
  // is not running rather than merely busy with a long download.
  const online = Boolean(lastSeen && Date.now() - Date.parse(lastSeen) < 120_000);
  const jobs = doc.jobs[uid] ?? [];
  return {
    hasToken: Boolean(doc.tokens[uid]),
    lastSeen,
    online,
    pending: jobs.filter((j) => j.state === "queued" || j.state === "running").length,
  };
}

// --- jobs --------------------------------------------------------------------

/** Drop finished jobs nobody collected, so the doc cannot grow without end. */
function sweep(doc: Doc, uid: string): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  doc.jobs[uid] = (doc.jobs[uid] ?? []).filter((j) => Date.parse(j.createdAt) > cutoff).slice(-40);
}

export async function queueJob(
  uid: string,
  input: { url: string; mode: GrabMode; title: string; creator: string; filename: string },
): Promise<BridgeJob | null> {
  const job: BridgeJob = {
    id: randomUUID(),
    url: input.url,
    mode: input.mode,
    title: input.title,
    creator: input.creator,
    filename: input.filename,
    state: "queued",
    createdAt: now(),
  };
  const { saved } = await mutate((doc) => {
    sweep(doc, uid);
    doc.jobs[uid] = [...(doc.jobs[uid] ?? []), job];
  });
  return saved ? job : null;
}

/**
 * Hand the oldest queued job to the runner, and record that it is alive.
 *
 * The check-in happens even when there is nothing to do, because "the runner
 * is online" is a fact the UI needs on every poll, not only on a busy one.
 */
export async function claimJob(uid: string): Promise<BridgeJob | null> {
  const { value } = await mutate((doc) => {
    doc.lastSeen[uid] = now();
    sweep(doc, uid);
    const job = (doc.jobs[uid] ?? []).find((j) => j.state === "queued");
    if (!job) return null;
    job.state = "running";
    job.startedAt = now();
    return job;
  });
  return value;
}

export async function getJob(uid: string, jobId: string): Promise<BridgeJob | null> {
  return (await load()).jobs[uid]?.find((j) => j.id === jobId) ?? null;
}

export async function failJob(uid: string, jobId: string, error: string): Promise<void> {
  await mutate((doc) => {
    const job = doc.jobs[uid]?.find((j) => j.id === jobId);
    if (!job) return;
    job.state = "failed";
    job.finishedAt = now();
    job.error = error.slice(0, 400);
  });
}

// --- the finished file -------------------------------------------------------

function keyFor(uid: string, jobId: string, filename: string): string {
  const ext = (filename.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${uid}/${jobId}.${ext || "bin"}`;
}

/** Record a finished file and mark the job done. */
async function complete(uid: string, jobId: string, key: string, bytes: number): Promise<boolean> {
  const { value } = await mutate((doc) => {
    const job = doc.jobs[uid]?.find((j) => j.id === jobId);
    if (!job) return false;
    job.state = "done";
    job.finishedAt = now();
    job.key = key;
    job.bytes = bytes;
    return true;
  });
  return value;
}

/** Small file: bytes came straight up in the request body. */
export async function putJobFile(
  uid: string,
  jobId: string,
  body: Buffer,
  contentType: string,
): Promise<boolean> {
  const job = await getJob(uid, jobId);
  if (!job) return false;
  const key = keyFor(uid, jobId, job.filename);
  await ensureBucket(BUCKET);
  if (!(await putBlob(BUCKET, key, dataDir(), body, contentType))) return false;
  return complete(uid, jobId, key, body.length);
}

/**
 * Large file: a one-time link straight to Storage.
 *
 * A finished MP4 is tens of megabytes and a deployed function body caps at
 * 4.5 MB, so the runner must not send it through this site at all. Returns
 * null on a hub with no Storage configured, where the runner falls back to
 * sending the bytes inline.
 */
export async function jobUploadTarget(
  uid: string,
  jobId: string,
): Promise<{ key: string; url: string } | null> {
  const job = await getJob(uid, jobId);
  if (!job) return null;
  const key = keyFor(uid, jobId, job.filename);
  await ensureBucket(BUCKET);
  const url = await signedUploadUrl(BUCKET, key);
  return url ? { key, url } : null;
}

/** Record a file the runner uploaded through that link. */
export async function registerJobFile(
  uid: string,
  jobId: string,
  key: string,
  bytes: number,
): Promise<boolean> {
  const job = await getJob(uid, jobId);
  // The key is rebuilt here rather than trusted: a runner token must not be
  // able to point a job at some other object in the bucket.
  if (!job || key !== keyFor(uid, jobId, job.filename)) return false;
  return complete(uid, jobId, key, bytes);
}

/** Where the browser collects a finished job from. */
export async function jobDownloadUrl(uid: string, jobId: string): Promise<string | null> {
  const job = await getJob(uid, jobId);
  if (!job?.key || job.state !== "done") return null;
  // Remote: a signed Storage link, straight from Supabase to the browser.
  // The filename matters twice — it names the saved file, and it is what makes
  // Storage send Content-Disposition: attachment at all. Without it the link
  // is just a media URL and the browser plays it instead of saving it.
  const signed = await signedBlobUrl(BUCKET, job.key, 3600, job.filename);
  if (signed) return signed;
  // Local hub: no Storage, so the file route streams it from disk instead.
  return `/api/mp3-download/bridge/file?job=${encodeURIComponent(jobId)}`;
}

export async function jobBlobKey(uid: string, jobId: string): Promise<string | null> {
  const job = await getJob(uid, jobId);
  return job?.state === "done" ? (job.key ?? null) : null;
}

export const BRIDGE_BUCKET = BUCKET;
export const bridgeDataDir = dataDir;

/** Forget a collected file. Best effort: an orphan is not worth an error. */
export async function discardJobFile(uid: string, jobId: string): Promise<void> {
  const job = await getJob(uid, jobId);
  if (!job?.key) return;
  await deleteBlob(BUCKET, job.key, dataDir()).catch(() => undefined);
}
