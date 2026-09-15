import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import { deleteBlob, ensureBucket, getBlob, isRemoteConfigured, putBlob, signedUploadUrl } from "@/lib/server/blobStore";
import {
  addProject,
  addStill,
  applyProgress,
  cancelQueued,
  claimNext,
  failProject,
  queueRender,
  removeProject,
  setPlan,
  setVideo,
} from "./reducer";
import type { Brief, DirectorPlan, Media, ProgressUpdate, StudioCapabilities, VideoProject } from "./types";

// ---------------------------------------------------------------------------
// 3D Studio persistence — the same shape as Game Creator's.
//
// One server document holds every owner's projects, the hashed studio tokens,
// and what each owner's PC reported it has installed. It is server-owned
// because the builder writes with a token, not a browser session, and must
// never see another owner's projects.
//
// Writes are serialised in-process: the builder posts progress every couple of
// seconds while the browser may be editing a storyboard, and two overlapping
// read-modify-write cycles would silently drop one.
// ---------------------------------------------------------------------------

const DOC = "studio3d";
const BUCKET = "studio3d-media";
export const MAX_STILL_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

interface StudioDoc {
  tokens: Record<string, string>;
  lastSeen: Record<string, string>;
  capabilities: Record<string, StudioCapabilities>;
  projects: Record<string, VideoProject[]>;
}

function dataDir(): string {
  return process.env.STUDIO3D_DATA_DIR || process.env.GAME_CREATOR_DATA_DIR || path.resolve(".data");
}

async function load(): Promise<StudioDoc> {
  const doc = await readDoc<StudioDoc>(DOC, dataDir());
  return {
    tokens: doc?.tokens ?? {},
    lastSeen: doc?.lastSeen ?? {},
    capabilities: doc?.capabilities ?? {},
    projects: doc?.projects ?? {},
  };
}

let chain: Promise<unknown> = Promise.resolve();

function mutate<T>(fn: (doc: StudioDoc) => T | Promise<T>): Promise<{ value: T; saved: boolean }> {
  const run = chain.then(async () => {
    const doc = await load();
    const value = await fn(doc);
    const saved = await writeDoc(DOC, dataDir(), doc);
    return { value, saved };
  });
  chain = run.catch(() => undefined);
  return run;
}

const now = () => new Date().toISOString();
const find = (doc: StudioDoc, uid: string, id: string) => (doc.projects[uid] ?? []).find((p) => p.id === id) ?? null;

// ----- tokens --------------------------------------------------------------------

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function mintToken(uid: string): Promise<string | null> {
  const token = `s3d_${randomBytes(24).toString("base64url")}`;
  const { saved } = await mutate((doc) => {
    doc.tokens[uid] = hash(token);
  });
  return saved ? token : null;
}

export interface BuilderInfo {
  linked: boolean;
  lastSeen: string | null;
  capabilities: StudioCapabilities | null;
}

export async function builderInfo(uid: string): Promise<BuilderInfo> {
  const doc = await load();
  return { linked: Boolean(doc.tokens[uid]), lastSeen: doc.lastSeen[uid] ?? null, capabilities: doc.capabilities[uid] ?? null };
}

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

// ----- projects --------------------------------------------------------------------

export async function listProjects(uid: string): Promise<VideoProject[]> {
  return (await load()).projects[uid] ?? [];
}

export async function getProject(uid: string, id: string): Promise<VideoProject | null> {
  return find(await load(), uid, id);
}

export async function createProject(uid: string, prompt: string, brief: Brief, plan: DirectorPlan): Promise<VideoProject | null> {
  const id = randomUUID();
  const { value, saved } = await mutate((doc) => {
    doc.projects[uid] = addProject(doc.projects[uid] ?? [], { id, ownerId: uid, prompt, brief, plan, now: now() });
    return doc.projects[uid][0];
  });
  return saved ? value : null;
}

export async function savePlan(uid: string, id: string, plan: DirectorPlan, brief?: Brief): Promise<VideoProject | null> {
  const { value } = await mutate((doc) => {
    doc.projects[uid] = setPlan(doc.projects[uid] ?? [], id, plan, now(), brief);
    return find(doc, uid, id);
  });
  return value;
}

export async function queue(uid: string, id: string): Promise<VideoProject | null> {
  const { value } = await mutate((doc) => {
    doc.projects[uid] = queueRender(doc.projects[uid] ?? [], id, now());
    return find(doc, uid, id);
  });
  return value;
}

export async function cancel(uid: string, id: string): Promise<VideoProject | null> {
  const { value } = await mutate((doc) => {
    doc.projects[uid] = cancelQueued(doc.projects[uid] ?? [], id, now());
    return find(doc, uid, id);
  });
  return value;
}

/** The builder asks for work: records that it is alive and what it has, and claims the oldest queued project. */
export async function claim(uid: string, capabilities?: StudioCapabilities): Promise<VideoProject | null> {
  const { value } = await mutate((doc) => {
    doc.lastSeen[uid] = now();
    if (capabilities) doc.capabilities[uid] = capabilities;
    const { list, project } = claimNext(doc.projects[uid] ?? [], now());
    doc.projects[uid] = list;
    return project;
  });
  return value;
}

export async function progress(uid: string, id: string, update: ProgressUpdate): Promise<VideoProject | null> {
  const { value } = await mutate((doc) => {
    doc.lastSeen[uid] = now();
    doc.projects[uid] = applyProgress(doc.projects[uid] ?? [], id, update, now());
    return find(doc, uid, id);
  });
  return value;
}

export async function fail(uid: string, id: string, error: string): Promise<VideoProject | null> {
  const { value } = await mutate((doc) => {
    doc.projects[uid] = failProject(doc.projects[uid] ?? [], id, error.slice(0, 4000), now());
    return find(doc, uid, id);
  });
  return value;
}

export async function remove(uid: string, id: string): Promise<boolean> {
  const project = await getProject(uid, id);
  if (!project) return false;
  for (const m of [...project.stills, ...(project.video ? [project.video] : [])]) await deleteBlob(BUCKET, m.key, dataDir());
  const { saved } = await mutate((doc) => {
    doc.projects[uid] = removeProject(doc.projects[uid] ?? [], id);
  });
  return saved;
}

// ----- media ------------------------------------------------------------------------

export type MediaKind = "still" | "video";

interface MediaMeta {
  file?: string;
  caption?: string;
  sceneId?: string;
  contentType: string;
}

function mediaKey(uid: string, id: string, kind: MediaKind, contentType: string): string {
  const ext = contentType === "video/webm" ? "webm" : kind === "video" ? "mp4" : contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
  return `${uid}/${id}/${kind}-${randomBytes(8).toString("hex")}.${ext}`;
}

async function attach(uid: string, id: string, kind: MediaKind, media: Omit<Media, "at">): Promise<VideoProject | null> {
  const { value, replaced } = await mutate((doc) => {
    let replaced: Media | null = null;
    if (kind === "video") {
      const r = setVideo(doc.projects[uid] ?? [], id, media, now());
      doc.projects[uid] = r.list;
      replaced = r.replaced;
    } else {
      doc.projects[uid] = addStill(doc.projects[uid] ?? [], id, media, now());
    }
    return { project: find(doc, uid, id), replaced };
  }).then((r) => ({ value: r.value.project, replaced: r.value.replaced }));
  if (replaced) await deleteBlob(BUCKET, replaced.key, dataDir());
  return value;
}

/** Store bytes the builder posted directly (local dev, or small files). */
export async function putMedia(uid: string, id: string, kind: MediaKind, body: Buffer, meta: MediaMeta): Promise<VideoProject | null> {
  const project = await getProject(uid, id);
  if (!project) return null;
  if (kind === "still" && meta.file && project.stills.some((s) => s.file === meta.file)) return project;
  await ensureBucket(BUCKET);
  const key = mediaKey(uid, id, kind, meta.contentType);
  if (!(await putBlob(BUCKET, key, dataDir(), body, meta.contentType))) return null;
  return attach(uid, id, kind, { key, bytes: body.length, ...meta });
}

/**
 * A direct-to-Storage upload link for a large file (a deployed hub caps function
 * bodies at 4.5 MB). Null on the file backend, where the builder posts bytes instead.
 */
export async function mediaUploadTarget(uid: string, id: string, kind: MediaKind, contentType: string): Promise<{ key: string; url: string } | null> {
  if (!isRemoteConfigured()) return null;
  if (!(await getProject(uid, id))) return null;
  await ensureBucket(BUCKET);
  const key = mediaKey(uid, id, kind, contentType);
  const url = await signedUploadUrl(BUCKET, key);
  return url ? { key, url } : null;
}

/** Record a file the builder uploaded through a signed link. The key must belong to this project. */
export async function registerUploaded(uid: string, id: string, kind: MediaKind, key: string, bytes: number, meta: MediaMeta): Promise<VideoProject | null> {
  if (!key.startsWith(`${uid}/${id}/${kind}-`) || key.includes("..")) return null;
  return attach(uid, id, kind, { key, bytes, ...meta });
}

// ----- chunked uploads (local hub) ----------------------------------------------------
//
// A rendered video is usually far over 10 MB, and Next.js keeps only the first
// 10 MB of any request body that passes through middleware — which every API
// route does, on purpose (see src/middleware.ts). So without a signed Storage
// link, the builder sends the file in chunks under that cap and they are
// appended here, then assembled. Local disk only: on a deployed hub the signed
// link is used instead, because serverless instances do not share a disk.

export const CHUNK_BYTES = 8 * 1024 * 1024;

function uploadFile(uid: string, projectId: string, uploadId: string): string | null {
  if (!/^[a-f0-9]{16,64}$/.test(uploadId) || !/^[\w-]{1,100}$/.test(projectId)) return null;
  return path.join(dataDir(), "studio3d-uploads", uid.replace(/[^\w-]/g, "_"), `${projectId}-${uploadId}.part`);
}

/** Append chunk `index` (0 starts the file). Returns bytes so far, or null when refused. */
export async function appendChunk(uid: string, projectId: string, uploadId: string, index: number, body: Buffer): Promise<number | null> {
  const file = uploadFile(uid, projectId, uploadId);
  if (!file || !Number.isInteger(index) || index < 0 || body.length > CHUNK_BYTES) return null;
  if (!(await getProject(uid, projectId))) return null;
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (index === 0) {
    await fs.writeFile(file, body);
  } else {
    const size = (await fs.stat(file).catch(() => null))?.size;
    // Chunks arrive in order and full-sized except the last; anything else is a broken upload.
    if (size !== index * CHUNK_BYTES || size + body.length > MAX_VIDEO_BYTES) return null;
    await fs.appendFile(file, body);
  }
  return (await fs.stat(file)).size;
}

/** Turn a finished chunked upload into the project's still or video. */
export async function assembleUpload(uid: string, projectId: string, kind: MediaKind, uploadId: string, bytes: number, meta: MediaMeta): Promise<VideoProject | null> {
  const file = uploadFile(uid, projectId, uploadId);
  if (!file) return null;
  try {
    const body = await fs.readFile(file);
    if (body.length !== bytes || body.length > (kind === "video" ? MAX_VIDEO_BYTES : MAX_STILL_BYTES)) return null;
    return await putMedia(uid, projectId, kind, body, meta);
  } catch {
    return null;
  } finally {
    await fs.unlink(file).catch(() => undefined);
  }
}

/** Bytes of one still or the video, only for the owner. */
export async function getMedia(uid: string, id: string, which: "video" | number): Promise<{ bytes: Buffer; media: Media } | null> {
  const project = await getProject(uid, id);
  const media = which === "video" ? project?.video : project?.stills[which];
  if (!media) return null;
  const bytes = await getBlob(BUCKET, media.key, dataDir());
  return bytes ? { bytes, media } : null;
}
