import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { readDoc, readDocStrict, writeDoc, isRemoteConfigured } from "@/lib/server/docStore";
import type { Blueprint, LabState, WorkerStatus } from "../model";
import { initialState, normalize, rollCounters, syncExperimentStatus } from "../state";

// ---------------------------------------------------------------------------
// H3 Prompt Lab persistence — server_docs (Supabase, service role) when
// configured, a local file otherwise.
//
//   h3-lab.<uid>                the lab (LabState, minus the worker heartbeat)
//   h3-lab-worker.<uid>         the PC worker's heartbeat/status (written every few seconds,
//                               so it does not rewrite the whole lab each time)
//   h3-lab-frames.<uid>.<gen>   one generation's judging frames (JPEG data URLs)
//   h3-lab-bp.<uid>.<id>        one full blueprint with keyframes
//   h3-lab-tokens               sha256(worker token) → uid
//
// Writes are serialised within a process: the worker reports while a page
// acts and a tick runs, and two overlapping read-modify-writes would silently
// drop one of them.
// ---------------------------------------------------------------------------

const DIR = () => process.env.H3LAB_DATA_DIR || path.resolve(".data");

const labDoc = (uid: string) => `h3-lab.${uid}`;
const workerDoc = (uid: string) => `h3-lab-worker.${uid}`;
const framesDoc = (uid: string, gen: string) => `h3-lab-frames.${uid}.${gen}`;
const bpDoc = (uid: string, id: string) => `h3-lab-bp.${uid}.${id}`;
const TOKENS = "h3-lab-tokens";

export const storageKind = (): "remote" | "local" => (isRemoteConfigured() ? "remote" : "local");

const now = () => new Date().toISOString();

const EMPTY_WORKER: WorkerStatus = { lastSeen: null, machine: "", version: "", wangp: "unknown", wangpDetail: "", ffmpeg: false, claude: false, current: null, models: [], queueDepth: 0 };

export async function loadLab(uid: string): Promise<LabState> {
  const raw = await readDocStrict<LabState>(labDoc(uid), DIR());
  const state = normalize(raw, now());
  state.worker = await loadWorker(uid);
  return state;
}

export async function loadWorker(uid: string): Promise<WorkerStatus> {
  return { ...EMPTY_WORKER, ...((await readDoc<WorkerStatus>(workerDoc(uid), DIR())) ?? {}) };
}

export async function saveWorker(uid: string, patch: Partial<WorkerStatus>): Promise<WorkerStatus> {
  const prev = await loadWorker(uid);
  const next = { ...prev, ...patch, lastSeen: now() };
  await writeDoc(workerDoc(uid), DIR(), next);
  return next;
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Read-modify-write the lab. A failed READ throws (never treat a hiccup as an
 * empty lab and then save over the real one).
 */
export function mutateLab<T>(uid: string, fn: (state: LabState) => T | Promise<T>): Promise<{ value: T; state: LabState; saved: boolean }> {
  const run = chain.then(async () => {
    const raw = await readDocStrict<LabState>(labDoc(uid), DIR());
    const state = raw ? normalize(raw, now()) : initialState(now());
    // Every write starts on today's counters, so an increment never lands on yesterday's.
    rollCounters(state, now());
    const value = await fn(state);
    syncExperimentStatus(state, now());
    const { worker: _worker, ...persist } = state;
    void _worker;
    const saved = await writeDoc(labDoc(uid), DIR(), { ...persist, worker: EMPTY_WORKER });
    state.worker = await loadWorker(uid);
    return { value, state, saved };
  });
  chain = run.catch(() => undefined);
  return run;
}

export async function saveFrames(uid: string, gen: string, frames: string[]): Promise<boolean> {
  return writeDoc(framesDoc(uid, gen), DIR(), { frames });
}

export async function loadFrames(uid: string, gen: string): Promise<string[]> {
  return (await readDoc<{ frames: string[] }>(framesDoc(uid, gen), DIR()))?.frames ?? [];
}

export async function saveBlueprint(uid: string, b: Blueprint): Promise<boolean> {
  return writeDoc(bpDoc(uid, b.id), DIR(), b);
}

export async function loadBlueprint(uid: string, id: string): Promise<Blueprint | null> {
  return readDoc<Blueprint>(bpDoc(uid, id), DIR());
}

// ----- worker tokens -------------------------------------------------------------

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function mintWorkerToken(uid: string): Promise<string | null> {
  const token = `h3l_${randomBytes(24).toString("base64url")}`;
  const doc = (await readDoc<Record<string, string>>(TOKENS, DIR())) ?? {};
  // One token per owner: minting replaces the old one.
  for (const [h, u] of Object.entries(doc)) if (u === uid) delete doc[h];
  doc[hash(token)] = uid;
  return (await writeDoc(TOKENS, DIR(), doc)) ? token : null;
}

export async function uidForWorkerToken(token: string): Promise<string | null> {
  if (!token || !token.startsWith("h3l_")) return null;
  const doc = (await readDoc<Record<string, string>>(TOKENS, DIR())) ?? {};
  const candidate = Buffer.from(hash(token));
  for (const [h, uid] of Object.entries(doc)) {
    const known = Buffer.from(h);
    if (known.length === candidate.length && timingSafeEqual(known, candidate)) return uid;
  }
  return null;
}

export async function workerPaired(uid: string): Promise<boolean> {
  const doc = (await readDoc<Record<string, string>>(TOKENS, DIR())) ?? {};
  return Object.values(doc).includes(uid);
}

/** Every owner with a paired worker — who the scheduled tick advances. */
export async function pairedUids(): Promise<string[]> {
  const doc = (await readDoc<Record<string, string>>(TOKENS, DIR())) ?? {};
  return [...new Set(Object.values(doc))];
}

/** Storage bucket for rendered clips. */
export const CLIP_BUCKET = "h3-lab";
