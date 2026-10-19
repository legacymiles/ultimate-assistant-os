// ---------------------------------------------------------------------------
// The posting queue on the server: one document per hub account
// (`social-personas-queue:<uid>`) plus an index of accounts with work waiting,
// so the scheduled tick can find every due post without a database table.
//
// The tick is safe to call from anywhere, any number of times: it only ever
// sends posts that their owner already scheduled for now or earlier, it takes
// a lock before sending, and a job id is draft+account, so nothing goes out
// twice. That is what lets a free scheduler (GitHub Actions, the open page,
// Jarvis) drive it without a secret.
// ---------------------------------------------------------------------------

import "server-only";

import path from "node:path";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import { afterAttempt, dueJobs, prune, upsertJobs, cancelJobs, type Job } from "../queue";
import { loadConnection } from "./connectors";
import { publish } from "./publish";

const dir = () => process.env.SOCIAL_PERSONAS_DATA_DIR || path.resolve(".data");
const safe = (uid: string) => uid.replace(/[^a-z0-9_-]/gi, "").slice(0, 80) || "local";
const docName = (uid: string) => `social-personas-queue:${safe(uid)}`;
const INDEX = "social-personas-queue-index";

interface QueueDoc {
  jobs: Job[];
}

export async function readJobs(uid: string): Promise<Job[]> {
  return (await readDoc<QueueDoc>(docName(uid), dir()))?.jobs ?? [];
}

async function writeJobs(uid: string, jobs: Job[]): Promise<boolean> {
  const ok = await writeDoc<QueueDoc>(docName(uid), dir(), { jobs });
  // Keep the index in step: an account is listed while it has work waiting.
  const waiting = jobs.some((j) => j.status === "queued" || j.status === "publishing");
  const index = (await readDoc<{ uids: string[] }>(INDEX, dir()))?.uids ?? [];
  const has = index.includes(safe(uid));
  if (waiting && !has) await writeDoc(INDEX, dir(), { uids: [...index, safe(uid)] });
  if (!waiting && has) await writeDoc(INDEX, dir(), { uids: index.filter((u) => u !== safe(uid)) });
  return ok;
}

export async function schedule(uid: string, incoming: Job[]): Promise<{ ok: boolean; jobs: Job[] }> {
  const jobs = upsertJobs(await readJobs(uid), incoming);
  return { ok: await writeJobs(uid, jobs), jobs };
}

export async function unschedule(uid: string, draftId: string, accountIds?: string[]): Promise<Job[]> {
  const jobs = cancelJobs(await readJobs(uid), draftId, accountIds);
  await writeJobs(uid, jobs);
  return jobs;
}

/**
 * Send what's due for one account. Each job is locked (status "publishing")
 * and saved BEFORE the platform call, so a second tick arriving mid-upload
 * skips it rather than posting it again.
 */
export async function runDue(uid: string, { limit = 3, budgetMs = 45_000 } = {}): Promise<Job[]> {
  const started = Date.now();
  const done: Job[] = [];
  for (let n = 0; n < limit && Date.now() - started < budgetMs; n++) {
    let jobs = await readJobs(uid);
    const job = dueJobs(jobs)[0];
    if (!job) break;
    const locked: Job = { ...job, status: "publishing", lockedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    jobs = jobs.map((j) => (j.id === job.id ? locked : j));
    if (!(await writeJobs(uid, jobs))) break;

    let next: Job;
    try {
      const conn = await loadConnection(job.connectionId);
      if (!conn || conn.ownerUid !== job.uid) throw new Error("That account's login is gone. Connect it again, then re-schedule the post.");
      const out = await publish({ conn, caption: job.caption, title: job.title, media: job.media });
      next = afterAttempt(locked, { ok: true, ...out });
    } catch (err) {
      next = afterAttempt(locked, { ok: false, error: (err as Error).message || "Posting failed. It'll try again." });
      console.error("[personas-studio] post failed:", job.platform, next.error);
    }
    jobs = (await readJobs(uid)).map((j) => (j.id === job.id ? next : j));
    await writeJobs(uid, prune(jobs));
    done.push(next);
  }
  return done;
}

/** The scheduled tick: every account with work waiting. */
export async function runAllDue(budgetMs = 50_000): Promise<{ uid: string; sent: number }[]> {
  const started = Date.now();
  const uids = (await readDoc<{ uids: string[] }>(INDEX, dir()))?.uids ?? [];
  const out: { uid: string; sent: number }[] = [];
  for (const uid of uids) {
    const left = budgetMs - (Date.now() - started);
    if (left < 5_000) break;
    const done = await runDue(uid, { budgetMs: left });
    if (done.length) out.push({ uid, sent: done.length });
  }
  return out;
}
