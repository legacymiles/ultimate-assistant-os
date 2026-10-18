// ---------------------------------------------------------------------------
// Client Review — where it is kept.
//
// One server document per client project, plus one index that maps each
// private link to its project and carries the owner's notification feed. The
// documents go through lib/server/docStore: public.server_docs on a deployed
// host (service role, RLS with no policy, so no browser can read a row), a
// file under .data/ locally.
//
// The client's browser never sees a document. Their route looks the link up
// in the index, loads that one project, and hands back portalView() of it.
// ---------------------------------------------------------------------------

import "server-only";

import path from "node:path";
import { readDoc, writeDoc, persistence } from "@/lib/server/docStore";
import { ReviewError } from "./logic";
import type { ClientProject, ReviewIndex } from "./types";

const INDEX_DOC = ".client-review-index.json";
const projectDoc = (id: string) => `.client-review-${id}.json`;

function dir(): string {
  return path.join(process.cwd(), ".data", "client-review");
}

/**
 * One write at a time per document within an instance. Serverless instances
 * do not share this, but a client double-tapping "Send" and the owner's tab
 * polling the same project land on one instance far more often than not.
 */
const queues = new Map<string, Promise<unknown>>();
async function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  queues.set(
    key,
    run.finally(() => {
      if (queues.get(key) === run) queues.delete(key);
    }),
  );
  return run;
}

export async function readIndex(): Promise<ReviewIndex> {
  const raw = await readDoc<Partial<ReviewIndex>>(INDEX_DOC, dir());
  return {
    projects: Array.isArray(raw?.projects) ? raw.projects : [],
    events: Array.isArray(raw?.events) ? raw.events : [],
  };
}

async function writeIndex(index: ReviewIndex): Promise<void> {
  if (!(await writeDoc(INDEX_DOC, dir(), index))) {
    throw new ReviewError("The project list couldn't be saved on this host. Set SUPABASE_SERVICE_ROLE_KEY.", 503);
  }
}

export function updateIndex(fn: (index: ReviewIndex) => ReviewIndex): Promise<ReviewIndex> {
  return serial(INDEX_DOC, async () => {
    const next = fn(await readIndex());
    await writeIndex(next);
    return next;
  });
}

export async function readProject(id: string): Promise<ClientProject | null> {
  if (!/^crp_[a-f0-9]{18}$/.test(id)) return null;
  return readDoc<ClientProject>(projectDoc(id), dir());
}

export async function writeProject(p: ClientProject): Promise<void> {
  if (!(await writeDoc(projectDoc(p.id), dir(), p))) {
    throw new ReviewError("That change couldn't be saved on this host. Set SUPABASE_SERVICE_ROLE_KEY.", 503);
  }
}

/**
 * Load, change, save — one project, serialised. `fn` returns the new project
 * (or the same one for "no change") plus anything the caller wants back.
 */
export function updateProject<R>(
  id: string,
  fn: (p: ClientProject) => { project: ClientProject; result: R } | Promise<{ project: ClientProject; result: R }>,
): Promise<{ project: ClientProject; result: R }> {
  return serial(projectDoc(id), async () => {
    const current = await readProject(id);
    if (!current) throw new ReviewError("That project no longer exists.", 404);
    const out = await fn(current);
    if (out.project !== current) await writeProject(out.project);
    return out;
  });
}

/** The project a private link opens, or null. Archived projects stay shut. */
export async function projectForToken(token: string): Promise<ClientProject | null> {
  const index = await readIndex();
  const hit = index.projects.find((p) => p.token === token && !p.archived);
  if (!hit) return null;
  const project = await readProject(hit.id);
  // The index is a cache of the project; the project's own token is the truth.
  return project && project.token === token && !project.archived ? project : null;
}

export async function deleteProjectDoc(id: string): Promise<void> {
  // docStore has no delete; an emptied, archived stub is never served.
  const p = await readProject(id);
  if (!p) return;
  await writeProject({ ...p, archived: true, token: `deleted${Date.now()}`, requests: [], batches: [], pushSubs: [], notices: [] });
}

export function storage() {
  return persistence(dir());
}
