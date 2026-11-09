"use client";

// ---------------------------------------------------------------------------
// App Builder → In Queue, and back again.
//
// Three jobs:
//   1. post the build (used by App Builder's Build it AND by Client Review's
//      "Approve & build", so both hand off identically);
//   2. READ where that build has got to, so the panel after Build it can show
//      the truth instead of a spinner — queued, picked up by whom, the agent's
//      own notes, finished with its result line;
//   3. take it back out of the queue, for when the owner changes their mind.
//
// Every call here has a timeout and retries once, because the one thing the
// owner must never see again is a button that spins with nothing behind it
// (checklist R5), and every failure comes back as a sentence, not a code (R3).
// ---------------------------------------------------------------------------

import { queueText } from "./engine";
import type { BuildState } from "./plan";
import type { BuilderProject } from "./types";

export const QUEUE_FOLDER = "app:app-builder";

/** Where In Queue lives, for the links out of the build panel. */
export const QUEUE_HREF = "/apps/jarvis#queue";

interface QueueRequestRow {
  id: string;
  folder: string;
  status: "open" | "working";
  createdAt: string;
  startedAt?: string;
  startedBy?: string;
  notes?: { at: string; text: string; by: string }[];
}

interface FinishedRow {
  id: string;
  folder: string;
  doneAt: string;
  by: string;
  result?: string;
}

/**
 * One fetch with a deadline, so a dead connection costs seconds rather than
 * hanging the UI. `post` below gives every call exactly one retry.
 */
async function once(body: unknown, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch("/api/new-jarvis/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** `what` finishes the sentence the owner reads when it fails. */
async function post(body: unknown, what: string, timeoutMs = 20_000): Promise<Record<string, unknown>> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await once(body, timeoutMs);
      break;
    } catch (e) {
      if (attempt === 0) continue; // a timeout or dropped connection earns one more go
      throw new Error(
        e instanceof DOMException && e.name === "AbortError"
          ? `In Queue didn't answer in time, twice, so ${what}. Your work is saved — try again in a moment.`
          : `Couldn't reach In Queue, so ${what}. Check your connection — your work is saved.`,
      );
    }
  }
  const data = (await res!.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res!.ok) {
    const said = typeof data.error === "string" ? data.error : "";
    throw new Error(said || (res!.status === 401 ? "Sign in to Jarvis and try again." : `In Queue didn't take it, so ${what}.`));
  }
  return data;
}

/** Queue the build. Returns the request id, or undefined when that exact build is already queued. */
export async function postToQueue(p: BuilderProject): Promise<string | undefined> {
  const data = await post(
    {
      action: "add",
      folder: QUEUE_FOLDER,
      text: queueText(p),
      images: (p.keyframes ?? []).slice(0, 4),
      from: "app-builder",
    },
    "the build wasn't filed",
    30_000,
  );
  const added = data.added as { id: string }[] | undefined;
  return added?.[0]?.id;
}

/** Take the build back out of the queue. */
export async function dropFromQueue(queueId: string): Promise<void> {
  await post({ action: "remove", id: queueId }, "it wasn't taken out of the queue");
}

/**
 * Where the build is now. Reads the whole queue document (the only read the API
 * offers) and finds this one request, so the panel can show the real phase, who
 * picked it up, and every note the agent wrote.
 *
 * Never throws: a failed read becomes `error` on the state we already had, so a
 * flaky minute of network doesn't blank a panel the owner is reading.
 */
export async function readBuildState(queueId: string, had: BuildState, timeoutMs = 15_000): Promise<BuildState> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("/api/new-jarvis/requests", { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) {
      return {
        ...had,
        error: res.status === 401 ? "Sign in to Jarvis to follow the build." : "Couldn't read the queue just now — trying again shortly.",
      };
    }
    const data = (await res.json()) as { doc?: { requests?: QueueRequestRow[]; finished?: FinishedRow[] } };
    const readAt = new Date().toISOString();
    const open = data.doc?.requests?.find((r) => r.id === queueId);
    if (open) {
      return {
        phase: open.status === "working" ? "working" : "queued",
        queueId,
        at: open.createdAt,
        startedBy: open.startedBy,
        startedAt: open.startedAt,
        notes: Array.isArray(open.notes) ? open.notes : [],
        readAt,
      };
    }
    const fin = data.doc?.finished?.find((r) => r.id === queueId);
    if (fin) {
      return { phase: "done", queueId, at: had.at, doneAt: fin.doneAt, doneBy: fin.by, result: fin.result, notes: had.notes, readAt };
    }
    // Neither open nor finished: removed, or the finished log aged it out after
    // FINISHED_DAYS. Either way nothing is waiting on anyone any more.
    return { phase: "gone", queueId, at: had.at, notes: had.notes, readAt };
  } catch (e) {
    return {
      ...had,
      error:
        e instanceof DOMException && e.name === "AbortError"
          ? "The queue is slow to answer — still trying."
          : "Couldn't reach the queue just now — trying again shortly.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Tell Client Review the batch is on its way. Best-effort: the build is queued either way. */
export async function noteBuildInReview(p: BuilderProject, queueId: string | undefined): Promise<boolean> {
  if (!p.edit) return false;
  const res = await fetch("/api/client-review/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "buildQueued", id: p.edit.reviewId, batchId: p.edit.batchId, builderId: p.id, queueId }),
  }).catch(() => null);
  return Boolean(res?.ok);
}
