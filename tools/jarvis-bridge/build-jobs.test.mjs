import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createJobStore, resumePrompt, retryDelay } from "./build-jobs.mjs";

function store() {
  const dir = mkdtempSync(path.join(tmpdir(), "jarvis-jobs-"));
  return { dir, file: path.join(dir, "build-jobs.json"), s: createJobStore({ file: path.join(dir, "build-jobs.json") }) };
}

const job = (id = "t_1") => ({
  id,
  title: "Image Studio v2 client edits",
  brief: "Change the background to blue.",
  worktree: { path: "C:\\work\\image-studio", branch: "jarvis-image", base: "main", repo: "C:\\repo" },
  args: { harness: "claude", repo: "C:\\repo" },
});

/** One turn's events, as the harness emits them. */
function turn(s, id, text, { error = "" } = {}) {
  s.appendEvent(id, { seq: 1, kind: "status", status: "thinking" });
  s.appendEvent(id, { seq: 2, kind: "user", text: "brief" });
  s.appendEvent(id, { seq: 3, kind: "text", text });
  s.appendEvent(id, { seq: 4, kind: "turn_end", usd: 0.2, error });
}

describe("a build written down before it starts", () => {
  it("is resumable while running, and carries the brief and the folder", () => {
    const { s } = store();
    s.begin(job());
    s.arm("t_1");
    const one = s.get("t_1");
    expect(one.status).toBe("running");
    expect(one.brief).toContain("background to blue");
    expect(one.worktree.path).toContain("image-studio");
    expect(s.resumable().map((j) => j.id)).toEqual(["t_1"]);
  });

  it("survives a new process: the file is the record", () => {
    const { file, s } = store();
    s.begin(job());
    s.arm("t_1");
    const reopened = createJobStore({ file });
    expect(reopened.get("t_1")?.status).toBe("running");
  });

  it("is not resumed before the caller has handed over the brief", () => {
    const { s } = store();
    s.begin(job());
    expect(s.get("t_1").status).toBe("starting");
    expect(s.resumable()).toHaveLength(0);
    s.arm("t_1");
    expect(s.resumable()).toHaveLength(1);
  });
});

describe("deciding a build is finished", () => {
  it("marks a turn that printed a preview as done", () => {
    const { s } = store();
    s.begin(job());
    s.arm("t_1");
    turn(s, "t_1", "Opened the PR.\n\nPR: https://github.com/x/y/pull/1\nPreview: https://y-git.vercel.app");
    expect(s.get("t_1").status).toBe("done");
    expect(s.resumable()).toHaveLength(0);
  });

  it("marks a new app's Repo/Live pair as done too", () => {
    const { s } = store();
    s.begin(job());
    s.arm("t_1");
    turn(s, "t_1", "Repo: https://github.com/x/y\nLive: https://y.vercel.app");
    expect(s.get("t_1").status).toBe("done");
  });

  it("does not mistake the brief's placeholder for a finish line", () => {
    const { s } = store();
    s.begin(job());
    s.arm("t_1");
    turn(s, "t_1", "I will finish with `Repo: <url>` and `Live: <url>`.");
    expect(s.get("t_1").status).toBe("running");
  });

  it("marks a turn that failed as failed, not done", () => {
    const { s } = store();
    s.begin(job());
    s.arm("t_1");
    s.appendEvent("t_1", { seq: 1, kind: "error", message: "npm install died" });
    s.appendEvent("t_1", { seq: 2, kind: "turn_end", error: "npm install died" });
    expect(s.get("t_1").status).toBe("failed");
    expect(s.resumable()).toHaveLength(0);
  });

  it("keeps a build that hit a limit alive, with a retry flag", () => {
    const { s } = store();
    s.begin(job());
    s.arm("t_1");
    const why = "You've hit your session limit · resets 12:20am (America/Indiana/Indianapolis)";
    s.appendEvent("t_1", { seq: 1, kind: "error", message: why });
    s.appendEvent("t_1", { seq: 2, kind: "turn_end", error: why });
    expect(s.get("t_1").status).toBe("running");
    expect(s.get("t_1").retry).toBe(true);
    expect(s.resumable()).toHaveLength(1);
  });

  it("keeps a build whose turn ended without a finish line resumable", () => {
    const { s } = store();
    s.begin(job());
    s.arm("t_1");
    turn(s, "t_1", "I changed the hero and stopped there.");
    expect(s.get("t_1").status).toBe("running");
    expect(s.get("t_1").lastTurnEnded).toBe(true);
    expect(s.resumable()).toHaveLength(1);
  });
});

describe("an owner stopping a build", () => {
  it("is the one thing that never comes back", () => {
    const { file, s } = store();
    s.begin(job());
    s.arm("t_1");
    s.mark("t_1", "stopped", "Stopped by the owner.");
    expect(createJobStore({ file }).resumable()).toHaveLength(0);
  });

  it("is written at once, not on the next lazy save", () => {
    const { file, s } = store();
    s.begin(job());
    s.arm("t_1");
    s.mark("t_1", "stopped");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    expect(raw.jobs[0].status).toBe("stopped");
  });
});

describe("the transcript kept for a resumed page", () => {
  it("keeps the recent events and the session id", () => {
    const { s } = store();
    s.begin(job());
    s.arm("t_1");
    s.appendEvent("t_1", { seq: 1, kind: "status", status: "ready", sessionId: "sess_1" });
    s.appendEvent("t_1", { seq: 2, kind: "text", text: "Working." });
    const one = s.get("t_1");
    expect(one.sessionId).toBe("sess_1");
    expect(one.events.map((e) => e.kind)).toEqual(["status", "text"]);
    expect(one.seq).toBe(2);
  });

  it("does not keep thinking deltas, which nothing draws", () => {
    const { s } = store();
    s.begin(job());
    s.arm("t_1");
    s.appendEvent("t_1", { seq: 1, kind: "thinking", text: "hmm" });
    expect(s.get("t_1").events).toHaveLength(0);
  });
});

describe("waiting for a limit to reset", () => {
  it("reads the reset time and waits past it", () => {
    const now = new Date(2026, 10, 9, 23, 0, 0).getTime();
    const delay = retryDelay("You've hit your session limit · resets 12:20am", now);
    expect(delay).toBeGreaterThan(60 * 60_000);
    expect(delay).toBeLessThan(6 * 60 * 60_000);
  });

  it("waits half an hour when the message gives no time", () => {
    expect(retryDelay("rate limited", new Date(2026, 10, 9, 23, 0, 0).getTime())).toBe(30 * 60_000);
  });

  it("does not wait past tomorrow when the clock has already passed the hour", () => {
    const now = new Date(2026, 10, 9, 23, 0, 0).getTime();
    const delay = retryDelay("resets 12:20am", now);
    // 12:20am is an hour and twenty minutes away, not twenty minutes in the
    // past; a naive same-day parse would resume immediately and fail again.
    expect(delay).toBeGreaterThan(70 * 60_000);
  });
});

describe("what a resumed build is told", () => {
  it("says it is the same job, not a new one, and repeats the brief", () => {
    const text = resumePrompt({ ...job(), lastTurnEnded: false });
    expect(text).toContain("not a new one");
    expect(text).toContain("git status");
    expect(text).toContain("Change the background to blue.");
  });

  it("says the turn had ended when that is what happened", () => {
    const text = resumePrompt({ ...job(), lastTurnEnded: true });
    expect(text).toContain("last turn ended");
  });
});


describe("a build that is checked before it is called built", () => {
  const FINISH = "All done.\nRepo: https://github.com/a/b\nLive: https://a.vercel.app";

  it("is only CLAIMED when it prints its finish lines", () => {
    const { s } = store();
    s.begin({ ...job(), verify: true });
    s.arm("t_1");
    turn(s, "t_1", FINISH);
    const one = s.get("t_1");
    expect(one.status).toBe("running");
    expect(one.claimed).toBe(true);
    expect(one.claimedText).toContain("Live: https://a.vercel.app");
    expect(one.verify.state).toBe("idle");
  });

  it("is still done on its own word when verify is off", () => {
    const { s } = store();
    s.begin(job());
    s.arm("t_1");
    turn(s, "t_1", FINISH);
    expect(s.get("t_1").status).toBe("done");
  });

  it("forgets the claim when the next turn starts", () => {
    const { s } = store();
    s.begin({ ...job(), verify: true });
    s.arm("t_1");
    turn(s, "t_1", FINISH);
    s.appendEvent("t_1", { seq: 9, kind: "user", text: "fix it" });
    expect(s.get("t_1").claimed).toBe(false);
  });

  it("does not claim a turn that ended on an error", () => {
    const { s } = store();
    s.begin({ ...job(), verify: true });
    s.arm("t_1");
    turn(s, "t_1", FINISH, { error: "boom" });
    expect(s.get("t_1").claimed).toBe(false);
    expect(s.get("t_1").status).toBe("failed");
  });

  it("is never resumed once it is unverified, and keeps a check that was running", () => {
    const { file, s } = store();
    s.begin({ ...job(), verify: true });
    s.arm("t_1");
    s.update("t_1", { verify: { ...s.get("t_1").verify, state: "checking", run: 2 } });
    expect(createJobStore({ file }).resumable()[0].verify).toMatchObject({ state: "checking", run: 2 });
    s.mark("t_1", "unverified", "Still failing after 3 repair rounds.");
    expect(createJobStore({ file }).resumable()).toEqual([]);
  });
});
