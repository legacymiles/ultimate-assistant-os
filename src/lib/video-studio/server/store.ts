import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { readDoc, writeDoc } from "@/lib/server/docStore";
import { ensureBucket, getBlob, putBlob, deleteBlob, isRemoteConfigured, signedUploadUrl } from "@/lib/server/blobStore";
import { DIRECTOR_ID, methodById, versionLetter } from "../registry";
import { titleFromBrief } from "../brief";
import type {
  HistoryEntry,
  Project,
  ProjectStatus,
  RunState,
  RunStep,
  SceneRun,
  VideoBrief,
  ProductionPlan,
} from "../types";

// ---------------------------------------------------------------------------
// Video Studio Arena persistence.
//
// One server-owned document holds every owner's projects, the render queue and
// the hashed runner tokens. Server-owned rather than app_state because the
// runner on the owner's PC writes to it with a token, not a browser session,
// and must never see another owner's projects. Same shape as Game Creator and
// 3D Studio, for the same reasons.
//
// Writes are serialised within a process: the runner posts progress every few
// seconds while a browser may be creating or deleting a project, and two
// overlapping read-modify-write cycles would silently drop one of them.
// ---------------------------------------------------------------------------

const DOC = "video-studio";
const BUCKET = "video-studio";

export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
export const CHUNK_BYTES = 8 * 1024 * 1024;

/** A unit of work the runner on the owner's PC claims. */
export interface Job {
  id: string;
  projectId: string;
  /** 1-based scene to re-render, or null for the whole project. */
  sceneIndex: number | null;
  methodId: string;
  state: "queued" | "claimed" | "done" | "failed";
  createdAt: string;
  claimedAt?: string;
}

interface Doc {
  /** uid -> sha256 of that owner's runner token. */
  tokens: Record<string, string>;
  /** uid -> when that owner's runner last asked for work. */
  lastSeen: Record<string, string>;
  /** uid -> projects, newest first. */
  projects: Record<string, Project[]>;
  /** uid -> jobs, oldest first. */
  jobs: Record<string, Job[]>;
}

function dataDir(): string {
  return process.env.VIDEO_STUDIO_DATA_DIR || process.env.GAME_CREATOR_DATA_DIR || path.resolve(".data");
}

async function load(): Promise<Doc> {
  const doc = await readDoc<Doc>(DOC, dataDir());
  return { tokens: doc?.tokens ?? {}, lastSeen: doc?.lastSeen ?? {}, projects: doc?.projects ?? {}, jobs: doc?.jobs ?? {} };
}

let chain: Promise<unknown> = Promise.resolve();

function mutate<T>(fn: (doc: Doc) => T | Promise<T>): Promise<{ value: T; saved: boolean }> {
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

// ----- tokens ---------------------------------------------------------------

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mint (and replace) this owner's runner token. Returned once, stored hashed. */
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

/** Whether this owner has a runner, and when it last checked in. */
export async function runnerInfo(uid: string): Promise<{ hasToken: boolean; lastSeen: string | null; online: boolean }> {
  const doc = await load();
  const lastSeen = doc.lastSeen[uid] ?? null;
  // Two minutes: the runner polls every few seconds, so a longer gap means it
  // is not running rather than merely busy.
  const online = Boolean(lastSeen && Date.now() - Date.parse(lastSeen) < 120_000);
  return { hasToken: Boolean(doc.tokens[uid]), lastSeen, online };
}

// ----- projects -------------------------------------------------------------

export async function listProjects(uid: string): Promise<Project[]> {
  return (await load()).projects[uid] ?? [];
}

export async function getProject(uid: string, id: string): Promise<Project | null> {
  return (await listProjects(uid)).find((p) => p.id === id) ?? null;
}

function step(id: string, label: string, state: RunState = "pending", detail?: string): RunStep {
  return { id, label, state, detail, at: now() };
}

/** The status list a run starts with. Every line is a real thing that happens. */
export function initialSteps(sceneCount: number, transport: "server" | "agent"): RunStep[] {
  const steps: RunStep[] = [
    step("prepare", "Preparing production"),
    step("optimise", "Optimising prompts for the engine"),
  ];
  if (transport === "agent") steps.push(step("claim", "Waiting for the runner on your PC"));
  for (let i = 1; i <= sceneCount; i += 1) steps.push(step(`scene-${i}`, `Scene ${i}`));
  steps.push(step("assemble", "Final assembly"));
  return steps;
}

export async function createProject(
  uid: string,
  brief: VideoBrief,
  methodId: string,
  mode: "manual" | "director",
): Promise<Project | null> {
  const project: Project = {
    id: randomUUID(),
    title: titleFromBrief(brief),
    brief,
    plan: null,
    methodId,
    mode,
    status: "draft",
    steps: [],
    scenes: [],
    history: [{ at: now(), kind: "created", summary: `Brief captured · ${mode === "director" ? "AI Director" : methodId}` }],
    createdAt: now(),
    updatedAt: now(),
  };
  const { saved } = await mutate((doc) => {
    const list = doc.projects[uid] ?? [];
    list.unshift(project);
    doc.projects[uid] = list.slice(0, 200);
  });
  return saved ? project : null;
}

/** Apply a patch to one project. Returns the updated project, or null. */
export async function patchProject(
  uid: string,
  id: string,
  patch: (project: Project) => void,
): Promise<Project | null> {
  const { value, saved } = await mutate((doc) => {
    const project = (doc.projects[uid] ?? []).find((p) => p.id === id);
    if (!project) return null;
    patch(project);
    project.updatedAt = now();
    return project;
  });
  return saved ? value : null;
}

export function note(project: Project, kind: string, summary: string): void {
  const entry: HistoryEntry = { at: now(), kind, summary };
  project.history = [entry, ...project.history].slice(0, 100);
}

export function setStep(project: Project, id: string, state: RunState, detail?: string): void {
  const existing = project.steps.find((s) => s.id === id);
  if (existing) {
    existing.state = state;
    existing.detail = detail ?? existing.detail;
    existing.at = now();
    return;
  }
  project.steps.push({ id, label: id, state, detail, at: now() });
}

export function setStatus(project: Project, status: ProjectStatus, error?: string): void {
  project.status = status;
  project.error = status === "failed" ? (error ?? project.error ?? "Unknown error") : undefined;
}

/** Seed the per-scene run records from the plan. */
export function seedScenes(project: Project, plan: ProductionPlan): void {
  project.scenes = plan.scenes.map((scene) => ({
    sceneId: scene.id,
    index: scene.index,
    methodId: scene.methodId,
    state: "pending" as RunState,
    attempts: 0,
    at: now(),
  }));
}

export function sceneRun(project: Project, index: number): SceneRun | undefined {
  return project.scenes.find((s) => s.index === index);
}

export async function removeProject(uid: string, id: string): Promise<boolean> {
  const project = await getProject(uid, id);
  const { value, saved } = await mutate((doc) => {
    const list = doc.projects[uid] ?? [];
    const before = list.length;
    doc.projects[uid] = list.filter((p) => p.id !== id);
    doc.jobs[uid] = (doc.jobs[uid] ?? []).filter((j) => j.projectId !== id);
    return before !== doc.projects[uid].length;
  });
  if (saved && value && project) {
    for (const key of blobKeys(project)) await deleteBlob(BUCKET, key, dataDir()).catch(() => undefined);
  }
  return saved && value;
}

function blobKeys(project: Project): string[] {
  const keys = project.scenes.map((s) => s.clipKey).filter((k): k is string => Boolean(k));
  if (project.videoKey) keys.push(project.videoKey);
  return keys;
}

/**
 * Copy a project so the same brief can be run through a second engine.
 *
 * The plan travels with it — comparing engines is only meaningful when they
 * were asked for the same thing — but every rendered artefact is dropped, and
 * the per-scene method is rewritten to the new engine.
 */
export async function duplicateProject(uid: string, id: string, methodId: string): Promise<Project | null> {
  const source = await getProject(uid, id);
  if (!source) return null;
  const rootId = source.parentId ?? source.id;
  const family = (await listProjects(uid)).filter((p) => p.id === rootId || p.parentId === rootId);
  const mode = methodId === DIRECTOR_ID ? "director" : "manual";

  const copy: Project = {
    ...source,
    id: randomUUID(),
    parentId: rootId,
    methodId,
    mode,
    plan: source.plan
      ? {
          ...source.plan,
          methodId,
          skill: mode === "director" ? "AI Director" : (methodById(methodId)?.meta.skill ?? methodId),
          scenes: source.plan.scenes.map((s) => ({
            ...s,
            // A directive written for one engine is meaningless to another.
            directive: undefined,
            methodId: mode === "director" ? s.methodId : methodId,
          })),
        }
      : null,
    status: source.plan ? "planned" : "draft",
    steps: [],
    scenes: [],
    videoKey: undefined,
    renderedBy: undefined,
    error: undefined,
    versionLabel: `Version ${versionLetter(family.length)}`,
    history: [{ at: now(), kind: "duplicated", summary: `Duplicated from ${source.versionLabel ?? "the original"} to try ${methodId}` }],
    createdAt: now(),
    updatedAt: now(),
  };

  // The original earns its letter the moment a second version exists.
  const { saved } = await mutate((doc) => {
    const list = doc.projects[uid] ?? [];
    const root = list.find((p) => p.id === rootId);
    if (root && !root.versionLabel) root.versionLabel = "Version A";
    list.unshift(copy);
    doc.projects[uid] = list.slice(0, 200);
  });
  return saved ? copy : null;
}

/** Every version of one project, oldest first — what the comparison strip shows. */
export async function versionsOf(uid: string, id: string): Promise<Project[]> {
  const all = await listProjects(uid);
  const project = all.find((p) => p.id === id);
  if (!project) return [];
  const rootId = project.parentId ?? project.id;
  return all
    .filter((p) => p.id === rootId || p.parentId === rootId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// ----- the queue ------------------------------------------------------------

export async function enqueue(uid: string, projectId: string, sceneIndex: number | null, methodId: string): Promise<Job | null> {
  const job: Job = {
    id: randomUUID(),
    projectId,
    sceneIndex,
    methodId,
    state: "queued",
    createdAt: now(),
  };
  const { saved } = await mutate((doc) => {
    const list = doc.jobs[uid] ?? [];
    // One pending job per (project, scene): a second Render click must not
    // queue the same work twice.
    doc.jobs[uid] = list
      .filter((j) => !(j.projectId === projectId && j.sceneIndex === sceneIndex && j.state === "queued"))
      .concat(job)
      .slice(-200);
  });
  return saved ? job : null;
}

/** Hand the oldest queued job to the runner, and record that it is alive. */
export async function claimJob(uid: string): Promise<{ job: Job; project: Project } | null> {
  const { value } = await mutate((doc) => {
    doc.lastSeen[uid] = now();
    const job = (doc.jobs[uid] ?? []).find((j) => j.state === "queued");
    if (!job) return null;
    const project = (doc.projects[uid] ?? []).find((p) => p.id === job.projectId);
    if (!project) {
      job.state = "failed";
      return null;
    }
    job.state = "claimed";
    job.claimedAt = now();
    project.status = "rendering";
    project.updatedAt = now();
    const claimStep = project.steps.find((s) => s.id === "claim");
    if (claimStep) {
      claimStep.state = "done";
      claimStep.detail = "Runner picked up the job";
      claimStep.at = now();
    }
    return { job, project };
  });
  return value;
}

export async function getJob(uid: string, jobId: string): Promise<Job | null> {
  return ((await load()).jobs[uid] ?? []).find((j) => j.id === jobId) ?? null;
}

export async function finishJob(uid: string, jobId: string, state: "done" | "failed"): Promise<void> {
  await mutate((doc) => {
    const job = (doc.jobs[uid] ?? []).find((j) => j.id === jobId);
    if (job) job.state = state;
    // Keep the queue from growing without bound.
    doc.jobs[uid] = (doc.jobs[uid] ?? []).filter((j) => j.state === "queued" || j.state === "claimed").concat(
      (doc.jobs[uid] ?? []).filter((j) => j.state !== "queued" && j.state !== "claimed").slice(-40),
    );
  });
}

// ----- artefacts ------------------------------------------------------------

function clipKey(uid: string, projectId: string, which: "final" | number): string {
  return `${uid}/${projectId}/${which === "final" ? "final" : `scene-${which}`}.mp4`;
}

/** Store a finished clip and attach it to the project. */
export async function putClip(
  uid: string,
  projectId: string,
  which: "final" | number,
  body: Buffer,
  renderedBy: string,
): Promise<Project | null> {
  if (body.length > MAX_VIDEO_BYTES) return null;
  await ensureBucket(BUCKET);
  const key = clipKey(uid, projectId, which);
  if (!(await putBlob(BUCKET, key, dataDir(), body, "video/mp4"))) return null;
  return attachClip(uid, projectId, which, key, renderedBy);
}

/** A signed Storage link the runner can PUT a large file to, on a deployed hub. */
export async function clipUploadTarget(
  uid: string,
  projectId: string,
  which: "final" | number,
): Promise<{ key: string; url: string } | null> {
  if (!isRemoteConfigured()) return null;
  if (!(await getProject(uid, projectId))) return null;
  await ensureBucket(BUCKET);
  const key = clipKey(uid, projectId, which);
  const url = await signedUploadUrl(BUCKET, key);
  return url ? { key, url } : null;
}

/** Record a clip uploaded through a signed link. The key must belong here. */
export async function registerClip(
  uid: string,
  projectId: string,
  which: "final" | number,
  key: string,
  renderedBy: string,
): Promise<Project | null> {
  if (key !== clipKey(uid, projectId, which)) return null;
  return attachClip(uid, projectId, which, key, renderedBy);
}

async function attachClip(
  uid: string,
  projectId: string,
  which: "final" | number,
  key: string,
  renderedBy: string,
): Promise<Project | null> {
  return patchProject(uid, projectId, (project) => {
    project.renderedBy = renderedBy;
    if (which === "final") {
      project.videoKey = key;
      setStep(project, "assemble", "done");
      setStatus(project, "ready");
      note(project, "ready", `Video assembled by ${renderedBy}`);
      return;
    }
    const scene = sceneRun(project, which);
    if (scene) {
      scene.clipKey = key;
      scene.state = "done";
      scene.attempts += 1;
      scene.error = undefined;
      scene.at = now();
    }
    setStep(project, `scene-${which}`, "done");
    note(project, "scene-render", `Scene ${which} rendered by ${renderedBy}`);
  });
}

export async function getClip(uid: string, projectId: string, which: "final" | number): Promise<Buffer | null> {
  const project = await getProject(uid, projectId);
  if (!project) return null;
  const key = which === "final" ? project.videoKey : sceneRun(project, which)?.clipKey;
  if (!key) return null;
  return getBlob(BUCKET, key, dataDir());
}

// ----- chunked uploads (local hub) ------------------------------------------
//
// A rendered video is usually far over the 10 MB Next.js keeps of any body
// that passes through middleware. On a deployed hub the runner uses the signed
// Storage link above; on a local one it sends the file in chunks under that
// cap and they are appended here. Local disk only — serverless instances do
// not share a disk.

function uploadFile(uid: string, projectId: string, uploadId: string): string | null {
  if (!/^[a-f0-9]{16,64}$/.test(uploadId) || !/^[\w-]{1,100}$/.test(projectId)) return null;
  return path.join(dataDir(), "video-studio-uploads", uid.replace(/[^\w-]/g, "_"), `${projectId}-${uploadId}.part`);
}

/** Append chunk `index` (0 starts the file). Returns bytes so far, or null when refused. */
export async function appendChunk(
  uid: string,
  projectId: string,
  uploadId: string,
  index: number,
  body: Buffer,
): Promise<number | null> {
  const file = uploadFile(uid, projectId, uploadId);
  if (!file || !Number.isInteger(index) || index < 0 || body.length > CHUNK_BYTES) return null;
  if (!(await getProject(uid, projectId))) return null;
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (index === 0) {
    await fs.writeFile(file, body);
  } else {
    const size = (await fs.stat(file).catch(() => null))?.size;
    // Chunks arrive in order and full-sized except the last; anything else is broken.
    if (size !== index * CHUNK_BYTES || size + body.length > MAX_VIDEO_BYTES) return null;
    await fs.appendFile(file, body);
  }
  return (await fs.stat(file)).size;
}

/** Turn a finished chunked upload into the project's clip. */
export async function assembleUpload(
  uid: string,
  projectId: string,
  which: "final" | number,
  uploadId: string,
  bytes: number,
  renderedBy: string,
): Promise<Project | null> {
  const file = uploadFile(uid, projectId, uploadId);
  if (!file) return null;
  try {
    const body = await fs.readFile(file);
    if (body.length !== bytes) return null;
    return await putClip(uid, projectId, which, body, renderedBy);
  } catch {
    return null;
  } finally {
    await fs.unlink(file).catch(() => undefined);
  }
}
