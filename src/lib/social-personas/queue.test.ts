import { describe, expect, it } from "vitest";
import { afterAttempt, cancelJobs, dueJobs, jobId, LOCK_MS, MAX_ATTEMPTS, upsertJobs, type Job } from "./queue";

const T = Date.parse("2026-10-18T18:00:00Z");
const job = (o: Partial<Job> = {}): Job => ({
  id: jobId("d1", "a1"),
  uid: "u",
  personaId: "p",
  draftId: "d1",
  accountId: "a1",
  connectionId: "c",
  platform: "instagram",
  title: "t",
  caption: "c",
  media: null,
  runAt: new Date(T - 60_000).toISOString(),
  status: "queued",
  attempts: 0,
  updatedAt: new Date(T - 60_000).toISOString(),
  ...o,
});

describe("posting queue", () => {
  it("only runs what is due, and retakes abandoned locks", () => {
    const later = job({ id: "x", runAt: new Date(T + 60_000).toISOString() });
    const stuck = job({ id: "y", status: "publishing", lockedAt: new Date(T - LOCK_MS - 1).toISOString() });
    const busy = job({ id: "z", status: "publishing", lockedAt: new Date(T - 1000).toISOString() });
    expect(dueJobs([job(), later, stuck, busy], T).map((j) => j.id).sort()).toEqual([jobId("d1", "a1"), "y"]);
  });

  it("re-scheduling replaces the job instead of adding a second (D5)", () => {
    const a = upsertJobs([], [job()]);
    const b = upsertJobs(a, [job({ runAt: new Date(T + 3_600_000).toISOString() })]);
    expect(b).toHaveLength(1);
    expect(b[0].runAt).toBe(new Date(T + 3_600_000).toISOString());
  });

  it("never re-queues a post that already went out", () => {
    const posted = upsertJobs([], [job({ status: "posted", updatedAt: new Date().toISOString() })]);
    const again = upsertJobs(posted, [job()]);
    expect(again[0].status).toBe("posted");
  });

  it("retries temporary problems with backoff, fails permission problems at once", () => {
    const retry = afterAttempt(job(), { ok: false, error: "Instagram: the platform is rate-limiting right now. It'll try again in a few minutes." }, T);
    expect(retry.status).toBe("queued");
    expect(Date.parse(retry.runAt)).toBe(T + 5 * 60_000);
    const perm = afterAttempt(job(), { ok: false, error: "Instagram: this account hasn't given Personas Studio permission to post." }, T);
    expect(perm.status).toBe("failed");
    const last = afterAttempt(job({ attempts: MAX_ATTEMPTS - 1 }), { ok: false, error: "try again" }, T);
    expect(last.status).toBe("failed");
  });

  it("records the posted link", () => {
    const ok = afterAttempt(job({ status: "publishing" }), { ok: true, status: "posted", url: "https://x" }, T);
    expect(ok).toMatchObject({ status: "posted", url: "https://x", error: undefined });
  });

  it("cancels only waiting jobs of that draft", () => {
    const jobs = [job(), job({ id: "other", draftId: "d2" }), job({ id: "done", status: "posted" })];
    const out = cancelJobs(jobs, "d1", undefined, T);
    expect(out.map((j) => j.status)).toEqual(["cancelled", "queued", "posted"]);
  });
});
