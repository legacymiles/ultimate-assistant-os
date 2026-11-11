import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createJobStore } from "./build-jobs.mjs";
import { createVerifier, verifyView } from "./harness-verify-loop.mjs";

const fail = (id) => ({ id, step: "build", page: "", title: `Build failed (${id})`, ran: "npm run build", evidence: `error ${id}` });
const PASS = { passed: true, aborted: false, failures: [] };
const FAIL = (...ids) => ({ passed: false, aborted: false, failures: ids.map(fail) });

/** A promise somebody else settles: a card nobody has answered, a gate still running. */
function defer() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * One verifier, one job store, any number of threads.
 *
 * `gate(args, n)` is the stand-in for the real gate; it sees the options the
 * loop passed and may return a report or a promise for one.
 */
function world(gate, extra = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "jarvis-loop-"));
  const jobs = createJobStore({ file: path.join(dir, "jobs.json") });
  const runs = [];
  let active = 0;
  let peak = 0;
  const verifier = createVerifier({
    runGate: async (args) => {
      runs.push(args);
      active += 1;
      peak = Math.max(peak, active);
      try {
        return await gate(args, runs.length);
      } finally {
        active -= 1;
      }
    },
    jobs,
    dirFor: (id, run) => path.join(dir, "verify", id, String(run)),
    ...extra,
  });
  const thread = (id, over = {}) => {
    jobs.begin({ id, title: id, brief: "Build it.", worktree: { path: dir }, verify: true });
    jobs.arm(id);
    const said = [];
    const events = [];
    const asked = [];
    const s = { id, jobId: id, trust: "trusted", strict: false, worktree: { path: dir, project: true, base: "main" }, verify: jobs.get(id).verify, ...over };
    const opts = {
      emit: (e) => events.push(e),
      say: (t) => said.push(t),
      ask: async (card) => {
        asked.push(card);
        return { allow: true, how: "owner" };
      },
      repair: true,
      text: "Live: none",
    };
    return { s, opts, said, events, asked, status: () => jobs.get(id).status };
  };
  return { verifier, jobs, runs, thread, peak: () => peak };
}

/** The common case: one thread, a gate that answers from a script. */
function rig(script, over = {}) {
  const hooks = { during: null };
  const w = world(async (args, n) => {
    await hooks.during?.(n, args);
    const next = script.shift() ?? PASS;
    return typeof next === "function" ? next(args) : next;
  });
  return { ...w, ...w.thread("t_1", over), hooks };
}

/** A thread that must be asked before its checks run. */
const ASKS = { trust: "ask", worktree: { path: "x", project: false, base: "main" } };

describe("pass, repair, stop", () => {
  it("a pass makes the job done and says nothing to the agent", async () => {
    const r = rig([PASS]);
    await r.verifier.check(r.s, r.opts);
    expect(r.s.verify.state).toBe("passed");
    expect(r.status()).toBe("done");
    expect(r.said).toEqual([]);
    expect(r.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["verify_start", "verify_end", "note"]));
    expect(r.s.verifying).toBe(false);
  });

  it("a failure goes back to the agent, and the next pass finishes it", async () => {
    const r = rig([FAIL("a"), PASS]);
    await r.verifier.check(r.s, r.opts);
    expect(r.s.verify).toMatchObject({ state: "repairing", rounds: 1 });
    expect(r.said).toHaveLength(1);
    expect(r.said[0]).toContain("round 1 of 3");
    expect(r.status()).toBe("running");
    await r.verifier.check(r.s, r.opts);
    expect(r.s.verify).toMatchObject({ state: "passed", rounds: 0, lastIds: [] });
    expect(r.status()).toBe("done");
  });

  it("stops at the second check when nothing changed", async () => {
    const r = rig([FAIL("a"), FAIL("a"), FAIL("a")]);
    await r.verifier.check(r.s, r.opts);
    await r.verifier.check(r.s, r.opts);
    expect(r.s.verify.state).toBe("failed");
    expect(r.s.verify.why).toMatch(/twice in a row/);
    expect(r.said).toHaveLength(1);
    expect(r.status()).toBe("unverified");
    expect(r.runs).toHaveLength(2);
  });

  it("gives up after three rounds of new failures", async () => {
    const r = rig([FAIL("a"), FAIL("b"), FAIL("c"), FAIL("d")]);
    for (let i = 0; i < 4; i++) await r.verifier.check(r.s, r.opts);
    expect(r.said).toHaveLength(3);
    expect(r.s.verify.state).toBe("failed");
    expect(r.s.verify.why).toContain("3 repair rounds");
  });

  it("a build that passed gets a fresh three rounds when it breaks later", async () => {
    const r = rig([FAIL("a"), FAIL("b"), FAIL("c"), PASS, FAIL("d")]);
    for (let i = 0; i < 5; i++) await r.verifier.check(r.s, r.opts);
    expect(r.s.verify).toMatchObject({ state: "repairing", rounds: 1 });
    expect(r.said).toHaveLength(4);
  });

  it("a look at a build mid-repair keeps the rounds it has used", async () => {
    const r = rig([FAIL("a"), FAIL("b")]);
    await r.verifier.check(r.s, r.opts);
    expect(r.s.verify).toMatchObject({ state: "repairing", rounds: 1, lastIds: ["a"] });
    await r.verifier.check(r.s, { ...r.opts, repair: false });
    expect(r.s.verify).toMatchObject({ state: "failed", rounds: 1, lastIds: ["a"] });
    expect(r.said).toHaveLength(1);
  });

  it("picks up where the job record left off after a restart", async () => {
    // Only what build-jobs.json holds: no in-memory flags at all.
    const persisted = { state: "checking", run: 2, rounds: 1, failures: [], lastIds: ["a"], report: "", why: "" };
    const same = rig([FAIL("a")]);
    same.s.verify = { ...persisted };
    await same.verifier.check(same.s, same.opts);
    expect(same.s.verify).toMatchObject({ state: "failed", run: 3 });
    expect(same.s.verify.why).toMatch(/twice in a row/);
    const moved = rig([FAIL("b")]);
    moved.s.verify = { ...persisted };
    await moved.verifier.check(moved.s, moved.opts);
    expect(moved.s.verify).toMatchObject({ state: "repairing", rounds: 2, run: 3 });
    expect(moved.said[0]).toContain("round 2 of 3");
  });

  it("only looks when asked only to look, and a look is not something the agent was sent", async () => {
    const r = rig([FAIL("a"), FAIL("a")]);
    await r.verifier.check(r.s, { ...r.opts, repair: false });
    expect(r.said).toEqual([]);
    expect(r.s.verify.state).toBe("failed");
    expect(r.status()).toBe("unverified");
    // The look did not count as "what the agent was last sent": the first real
    // repair for the same failure is still sent.
    await r.verifier.check(r.s, r.opts);
    expect(r.s.verify).toMatchObject({ state: "repairing", rounds: 1 });
    expect(r.said).toHaveLength(1);
  });

  it("a repair turn that ends without finishing leaves it unverified", async () => {
    const r = rig([FAIL("a")]);
    await r.verifier.check(r.s, r.opts);
    r.verifier.stalledRepair(r.s, r.opts.emit);
    expect(r.s.verify.state).toBe("failed");
    expect(r.status()).toBe("unverified");
  });

  it("a build the owner sends back to work starts its rounds again", async () => {
    const r = rig([FAIL("a"), FAIL("a"), FAIL("a")]);
    await r.verifier.check(r.s, r.opts);
    await r.verifier.check(r.s, r.opts);
    expect(r.s.verify.state).toBe("failed");
    r.verifier.reopen(r.s);
    expect(r.s.verify).toMatchObject({ state: "idle", rounds: 0, lastIds: [] });
    await r.verifier.check(r.s, r.opts);
    expect(r.s.verify).toMatchObject({ state: "repairing", rounds: 1 });
  });

  it("tells the page only what it needs", async () => {
    const r = rig([FAIL("a")]);
    await r.verifier.check(r.s, r.opts);
    expect(verifyView(r.s.verify)).toMatchObject({ state: "repairing", run: 1, rounds: 1, max: 3, failures: [{ step: "build", title: "Build failed (a)", page: "" }] });
    expect(JSON.stringify(verifyView(r.s.verify))).not.toContain("error a");
    expect(verifyView(null)).toBeNull();
  });
});

describe("the permission card", () => {
  it("is never shown on a thread that may already run things", async () => {
    const r = rig([PASS]);
    await r.verifier.check(r.s, r.opts);
    expect(r.asked).toEqual([]);
    expect(r.runs).toHaveLength(1);
  });

  it("is shown on a strict thread even when it is trusted", async () => {
    const r = rig([PASS], { strict: true });
    await r.verifier.check(r.s, r.opts);
    expect(r.asked).toHaveLength(1);
  });

  it("is shown once per thread, not once per repair round", async () => {
    const r = rig([FAIL("a"), PASS], ASKS);
    await r.verifier.check(r.s, r.opts);
    await r.verifier.check(r.s, r.opts);
    expect(r.asked).toHaveLength(1);
    expect(r.runs).toHaveLength(2);
  });

  it("a no leaves the build unverified and runs nothing", async () => {
    const r = rig([PASS], ASKS);
    await r.verifier.check(r.s, { ...r.opts, ask: async () => ({ allow: false, how: "owner" }) });
    expect(r.runs).toHaveLength(0);
    expect(r.s.verify.state).toBe("failed");
    expect(r.status()).toBe("unverified");
    expect(r.s.verifying).toBe(false);
  });

  it("a no to a second look does not undo a pass", async () => {
    const r = rig([], ASKS);
    r.s.verify = { ...r.s.verify, state: "passed", run: 1 };
    r.jobs.mark("t_1", "done", "The checks passed.");
    await r.verifier.check(r.s, { ...r.opts, repair: false, ask: async () => ({ allow: false, how: "timeout" }) });
    expect(r.s.verify.state).toBe("passed");
    expect(r.status()).toBe("done");
  });

  it("an unanswered card does not hold up another build", async () => {
    const w = world(async () => PASS);
    const card = defer();
    const a = w.thread("a", ASKS);
    const b = w.thread("b");
    const waiting = w.verifier.check(a.s, { ...a.opts, ask: () => card.promise });
    await w.verifier.check(b.s, b.opts);
    expect(b.s.verify.state).toBe("passed");
    expect(a.s.verify.state).toBe("checking");
    card.resolve({ allow: true, how: "owner" });
    await waiting;
    expect(a.s.verify.state).toBe("passed");
  });
});

describe("one gate at a time", () => {
  it("never runs two builds' checks together", async () => {
    const gates = [defer(), defer()];
    const w = world(async (_args, n) => gates[n - 1].promise);
    const a = w.thread("a");
    const b = w.thread("b");
    const first = w.verifier.check(a.s, a.opts);
    const second = w.verifier.check(b.s, b.opts);
    await new Promise((r) => setTimeout(r, 20));
    expect(w.runs).toHaveLength(1);
    gates[0].resolve(PASS);
    await first;
    await new Promise((r) => setTimeout(r, 20));
    expect(w.runs).toHaveLength(2);
    gates[1].resolve(PASS);
    await second;
    expect(w.peak()).toBe(1);
  });

  it("a gate that never returns is stopped, and the next build still gets its turn", async () => {
    let signal = null;
    const w = world(
      async (args, n) => {
        if (n > 1) return PASS;
        signal = args.signal;
        return new Promise(() => {});
      },
      { ceilingMs: 30 },
    );
    const hung = w.thread("a");
    const next = w.thread("b");
    const first = w.verifier.check(hung.s, hung.opts);
    const second = w.verifier.check(next.s, next.opts);
    await first;
    await second;
    expect(hung.s.verify.state).toBe("failed");
    expect(hung.s.verify.why).toMatch(/did not finish/);
    expect(signal.aborted).toBe(true);
    expect(hung.said).toEqual([]);
    expect(next.s.verify.state).toBe("passed");
  });

  it("a gate that breaks is not the agent's to repair", async () => {
    const r = rig([]);
    r.hooks.during = () => {
      throw new Error("spawn EPERM");
    };
    await r.verifier.check(r.s, r.opts);
    expect(r.s.verify.state).toBe("failed");
    expect(r.s.verify.why).toMatch(/could not run.*spawn EPERM/);
    expect(r.said).toEqual([]);
    expect(r.status()).toBe("unverified");
  });

  it("a gate that could not open a browser says so, and does not pass the build", async () => {
    const r = rig([{ passed: false, aborted: false, broken: true, brokenWhy: "The hidden browser could not start.", failures: [] }]);
    await r.verifier.check(r.s, r.opts);
    expect(r.s.verify.state).toBe("failed");
    expect(r.s.verify.why).toBe("The checks could not run. The hidden browser could not start.");
    expect(r.said).toEqual([]);
    expect(r.status()).toBe("unverified");
  });

  it("an agent that cannot be reached does not leave the build on 'fixing'", async () => {
    const r = rig([FAIL("a")]);
    await r.verifier.check(r.s, {
      ...r.opts,
      say: () => {
        throw new Error("That thread has ended.");
      },
    });
    expect(r.s.verify.state).toBe("failed");
    expect(r.s.verify.why).toMatch(/could not be reached/);
    expect(r.status()).toBe("unverified");
    expect(r.s.verifying).toBe(false);
  });
});

describe("asked again while a check is running", () => {
  it("throws the stale result away and checks again with the latest request", async () => {
    const r = rig([FAIL("stale"), FAIL("x")]);
    r.hooks.during = (n) => {
      if (n === 1) void r.verifier.check(r.s, { ...r.opts, repair: true, text: "Live: https://new.app" });
    };
    await r.verifier.check(r.s, { ...r.opts, repair: false, text: "Live: https://old.app" });
    expect(r.runs).toHaveLength(2);
    expect(r.runs[1].text).toBe("Live: https://new.app");
    // The second request asked for repairs, so the failure went back.
    expect(r.said).toHaveLength(1);
    expect(r.said[0]).toContain("Build failed (x)");
    expect(r.s.verify).toMatchObject({ state: "repairing", rounds: 1 });
  });

  it("a Check again during a repair check does not cost the agent its repair", async () => {
    const r = rig([FAIL("stale"), FAIL("x")]);
    r.hooks.during = (n) => {
      if (n === 1) void r.verifier.check(r.s, { ...r.opts, repair: false });
    };
    await r.verifier.check(r.s, r.opts);
    expect(r.runs).toHaveLength(2);
    expect(r.said).toHaveLength(1);
    expect(r.s.verify).toMatchObject({ state: "repairing", rounds: 1 });
  });

  it("the owner typing to the agent calls a running check off and starts the rounds again", async () => {
    const r = rig([FAIL("a"), FAIL("a"), FAIL("a")]);
    await r.verifier.check(r.s, r.opts);
    await r.verifier.check(r.s, r.opts);
    expect(r.status()).toBe("unverified");
    // A second look is running when the owner tells the agent what to fix.
    r.hooks.during = () => {
      r.verifier.reopen(r.s);
      r.jobs.update("t_1", { status: "running" });
    };
    await r.verifier.check(r.s, { ...r.opts, repair: false });
    expect(r.s.verify).toMatchObject({ state: "idle", rounds: 0, lastIds: [] });
    // The look's own verdict was thrown away, so the job is still the owner's "running".
    expect(r.status()).toBe("running");
    expect(r.s.verifying).toBe(false);
  });

  it("three requests before the first has started are one check", async () => {
    const r = rig([PASS]);
    const a = r.verifier.check(r.s, r.opts);
    void r.verifier.check(r.s, r.opts);
    void r.verifier.check(r.s, r.opts);
    await a;
    expect(r.runs).toHaveLength(1);
  });
});

describe("stopped", () => {
  /** A gate that runs until it is told to stop, like the real one. */
  const untilAborted = (args) =>
    new Promise((resolve) => {
      args.signal.addEventListener("abort", () => resolve({ passed: false, aborted: true, failures: [] }), { once: true });
    });

  it("a running check stops, decides nothing and marks nothing", async () => {
    const r = rig([untilAborted]);
    r.hooks.during = () => {
      setTimeout(() => r.verifier.abort(r.s), 5);
    };
    await r.verifier.check(r.s, r.opts);
    expect(r.s.verify.state).toBe("idle");
    expect(r.status()).toBe("running");
    expect(r.said).toEqual([]);
    expect(r.s.verifying).toBe(false);
  });

  it("a check still waiting its turn never runs", async () => {
    const gate = defer();
    const w = world(async (_args, n) => (n === 1 ? gate.promise : FAIL("b")));
    const a = w.thread("a");
    const b = w.thread("b");
    const first = w.verifier.check(a.s, a.opts);
    const second = w.verifier.check(b.s, b.opts);
    // Long enough for b to be past the card and really waiting in the queue.
    await new Promise((r) => setTimeout(r, 20));
    w.verifier.abort(b.s);
    gate.resolve(PASS);
    await first;
    await second;
    expect(w.runs).toHaveLength(1);
    expect(b.s.verify.state).toBe("idle");
    expect(b.said).toEqual([]);
    expect(b.status()).toBe("running");
  });

  it("stopping a second look leaves the verdict it was looking at", async () => {
    const r = rig([PASS, untilAborted]);
    await r.verifier.check(r.s, r.opts);
    r.hooks.during = (n) => {
      if (n === 2) setTimeout(() => r.verifier.abort(r.s), 5);
    };
    await r.verifier.check(r.s, { ...r.opts, repair: false });
    expect(r.s.verify.state).toBe("passed");
    expect(r.status()).toBe("done");
  });

  it("a gate that ignores the stop does not keep the next build waiting", async () => {
    const w = world(async (_args, n) => (n === 1 ? new Promise(() => {}) : PASS), { graceMs: 20 });
    const deaf = w.thread("a");
    const next = w.thread("b");
    const first = w.verifier.check(deaf.s, deaf.opts);
    const second = w.verifier.check(next.s, next.opts);
    await new Promise((r) => setTimeout(r, 10));
    w.verifier.abort(deaf.s);
    await first;
    await second;
    expect(deaf.s.verify.state).toBe("idle");
    expect(deaf.s.verifying).toBe(false);
    expect(next.s.verify.state).toBe("passed");
  });

  it("stopping while the card is up does not mark the build unverified", async () => {
    const r = rig([PASS], ASKS);
    const card = defer();
    const pending = r.verifier.check(r.s, { ...r.opts, ask: () => card.promise });
    r.verifier.abort(r.s);
    // What stopThread does next: refuse every parked card.
    card.resolve({ allow: false, how: "stopped" });
    await pending;
    expect(r.runs).toHaveLength(0);
    expect(r.s.verify.state).toBe("idle");
    expect(r.status()).toBe("running");
  });

  it("a fresh request after a stop is a request", async () => {
    const r = rig([untilAborted, PASS]);
    r.hooks.during = (n) => {
      if (n !== 1) return;
      setTimeout(() => {
        r.verifier.abort(r.s);
        void r.verifier.check(r.s, r.opts);
      }, 5);
    };
    await r.verifier.check(r.s, r.opts);
    expect(r.runs).toHaveLength(2);
    expect(r.s.verify.state).toBe("passed");
  });
});

describe("use it anyway", () => {
  it("makes a failing build done", async () => {
    const r = rig([FAIL("a"), FAIL("a")]);
    await r.verifier.check(r.s, r.opts);
    await r.verifier.check(r.s, r.opts);
    r.verifier.accept(r.s, r.opts.emit);
    expect(r.s.verify).toMatchObject({ state: "accepted", rounds: 0 });
    expect(r.status()).toBe("done");
  });

  it("during a check wins, and the agent is sent nothing", async () => {
    const r = rig([FAIL("a")]);
    r.hooks.during = () => r.verifier.accept(r.s, r.opts.emit);
    await r.verifier.check(r.s, r.opts);
    expect(r.s.verify.state).toBe("accepted");
    expect(r.status()).toBe("done");
    expect(r.said).toEqual([]);
    expect(r.s.verifying).toBe(false);
  });

  it("while the card is up wins, whatever the card is then answered", async () => {
    for (const allow of [true, false]) {
      const r = rig([FAIL("a")], ASKS);
      const card = defer();
      const pending = r.verifier.check(r.s, { ...r.opts, ask: () => card.promise });
      r.verifier.accept(r.s, r.opts.emit);
      card.resolve({ allow, how: "owner" });
      await pending;
      expect(r.runs).toHaveLength(0);
      expect(r.s.verify.state).toBe("accepted");
      expect(r.status()).toBe("done");
      expect(r.s.verifying).toBe(false);
    }
  });

  it("is not offered a build that passed, or a thread that is not checked", async () => {
    const r = rig([PASS]);
    await r.verifier.check(r.s, r.opts);
    r.verifier.accept(r.s, r.opts.emit);
    expect(r.s.verify.state).toBe("passed");
    const unchecked = { id: "x", jobId: "", verify: null };
    expect(r.verifier.accept(unchecked, r.opts.emit)).toBeNull();
    expect(unchecked.verify).toBeNull();
  });

  it("stands when a later second look is refused", async () => {
    const r = rig([FAIL("a")], ASKS);
    await r.verifier.check(r.s, { ...r.opts, repair: false });
    expect(r.s.verify.state).toBe("failed");
    r.verifier.accept(r.s, r.opts.emit);
    // The card was answered yes once already, so make this a thread that is asked afresh.
    r.s.verifyAllowed = false;
    await r.verifier.check(r.s, { ...r.opts, repair: false, ask: async () => ({ allow: false, how: "owner" }) });
    expect(r.s.verify.state).toBe("accepted");
    expect(r.status()).toBe("done");
  });

  it("does not stop a later Check again from running", async () => {
    const r = rig([FAIL("a"), PASS]);
    r.hooks.during = (n) => {
      if (n === 1) r.verifier.accept(r.s, r.opts.emit);
    };
    await r.verifier.check(r.s, r.opts);
    await r.verifier.check(r.s, { ...r.opts, repair: false });
    expect(r.runs).toHaveLength(2);
    expect(r.s.verify.state).toBe("passed");
  });
});
