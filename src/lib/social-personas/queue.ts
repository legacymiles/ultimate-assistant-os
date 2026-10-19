// ---------------------------------------------------------------------------
// The posting queue's rules, pure so they can be tested.
//
// One job = one draft going to one account at one time. Jobs live on the
// server (so they go out with the browser closed); the draft in the persona
// blob only mirrors their status. These functions decide what is due, how a
// job moves after an attempt, and how a re-schedule replaces the old job
// instead of adding a second one (rule D5: a post never goes out twice).
// ---------------------------------------------------------------------------

import type { ConnectablePlatform } from "./types";

export type JobStatus = "queued" | "publishing" | "posted" | "inbox" | "failed" | "cancelled";

export interface Job {
  /** `${draftId}:${accountId}` — one job per draft per account, ever. */
  id: string;
  uid: string;
  personaId: string;
  draftId: string;
  accountId: string;
  connectionId: string;
  platform: ConnectablePlatform;
  title: string;
  caption: string;
  media: { key: string; type: string; size: number } | null;
  runAt: string;
  status: JobStatus;
  attempts: number;
  /** When the current attempt started (stale "publishing" locks are retaken). */
  lockedAt?: string;
  url?: string;
  externalId?: string;
  note?: string;
  error?: string;
  updatedAt: string;
}

export const MAX_ATTEMPTS = 4;
/** A "publishing" job untouched this long was abandoned by a dead function. */
export const LOCK_MS = 5 * 60_000;

export const jobId = (draftId: string, accountId: string) => `${draftId}:${accountId}`;

/** Jobs ready to run now: queued and due, or stuck "publishing" past the lock. */
export function dueJobs(jobs: Job[], now = Date.now()): Job[] {
  return jobs
    .filter(
      (j) =>
        (j.status === "queued" && Date.parse(j.runAt) <= now) ||
        (j.status === "publishing" && (!j.lockedAt || now - Date.parse(j.lockedAt) > LOCK_MS)),
    )
    .sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt));
}

/** Retry after 5, 15, then 45 minutes. */
export function retryDelayMs(attempts: number): number {
  return 5 * 60_000 * Math.pow(3, Math.max(0, attempts - 1));
}

/**
 * The job after an attempt. Messages that say "try again" are retried with
 * backoff; anything else (no permission, no video) fails at once so the owner
 * hears about it now rather than after four pointless tries.
 */
export function afterAttempt(
  j: Job,
  outcome: { ok: true; status: "posted" | "inbox"; url?: string; externalId?: string; note?: string } | { ok: false; error: string },
  now = Date.now(),
): Job {
  const at = new Date(now).toISOString();
  if (outcome.ok) {
    return { ...j, status: outcome.status, url: outcome.url, externalId: outcome.externalId, note: outcome.note, error: undefined, lockedAt: undefined, updatedAt: at };
  }
  const attempts = j.attempts + 1;
  const retryable = /try again|rate-limit|still processing|daily posting limit/i.test(outcome.error);
  if (retryable && attempts < MAX_ATTEMPTS) {
    return { ...j, status: "queued", attempts, error: outcome.error, lockedAt: undefined, runAt: new Date(now + retryDelayMs(attempts)).toISOString(), updatedAt: at };
  }
  return { ...j, status: "failed", attempts, error: outcome.error, lockedAt: undefined, updatedAt: at };
}

/**
 * Put jobs in (schedule / reschedule). A job already posted is never touched;
 * any other job with the same id is replaced, so moving a post on the calendar
 * moves its job rather than adding one.
 */
export function upsertJobs(existing: Job[], incoming: Job[]): Job[] {
  const out = [...existing];
  for (const j of incoming) {
    const i = out.findIndex((x) => x.id === j.id);
    if (i < 0) out.push(j);
    else if (out[i].status !== "posted" && out[i].status !== "inbox" && out[i].status !== "publishing") out[i] = { ...j, attempts: 0 };
  }
  return prune(out);
}

/** Cancel every not-yet-sent job of a draft (or only the listed accounts). */
export function cancelJobs(jobs: Job[], draftId: string, accountIds?: string[], now = Date.now()): Job[] {
  const at = new Date(now).toISOString();
  return jobs.map((j) =>
    j.draftId === draftId && (!accountIds || accountIds.includes(j.accountId)) && (j.status === "queued" || j.status === "failed")
      ? { ...j, status: "cancelled" as const, updatedAt: at }
      : j,
  );
}

/** Keep finished jobs for 30 days so the drafts can read their outcome, then drop them. */
export function prune(jobs: Job[], now = Date.now()): Job[] {
  const keep = 30 * 24 * 3_600_000;
  return jobs.filter((j) => j.status === "queued" || j.status === "publishing" || now - Date.parse(j.updatedAt) < keep);
}
