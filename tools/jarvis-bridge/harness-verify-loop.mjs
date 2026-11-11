// ---------------------------------------------------------------------------
// The loop around the gate: check, then pass it, send it back, or stop.
//
// Kept apart from harness.mjs so it can be tested with a gate that answers
// from a script. harness.mjs hands it a thread and four functions — emit, say,
// ask, and the gate itself — and this file owns everything that happens to
// `s.verify` and to the job's status.
//
// It is concurrent state on an object several things write to — a turn ending,
// the owner pressing a button, a stop, a restart — so the rules are few and
// are the same at every await:
//
//   The LATEST request is the one that counts. A second check() while one is
//   running does not start a second gate; it replaces the options and makes
//   the running one go round again when it ends.
//
//   A stop or a "use it anyway" calls the check OFF. Whatever the gate then
//   returns decides nothing, marks nothing and sends the agent nothing. A
//   fresh check() calls it back on.
//
//   The permission card is asked OUTSIDE the queue, once per thread. A card
//   nobody answers must not hold up every other build on this PC.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { MAX_ROUNDS, afterRun, repairPrompt } from "./harness-verify.mjs";

const EMPTY = { state: "idle", run: 0, rounds: 0, failures: [], lastIds: [], report: "", why: "" };

/** A verdict that stands on its own, as opposed to a check in progress. */
const SETTLED = new Set(["passed", "accepted", "failed"]);

/** A build back at the start of its rounds: the owner has sent it back to work. */
const FRESH = { state: "idle", rounds: 0, failures: [], lastIds: [], why: "" };

/** Does this request want failures sent back to the agent? Yes unless it says no. */
const wantsRepair = (opts) => opts?.repair !== false;

/**
 * May this thread's checks run without a card?
 *
 * The gate runs scripts the agent wrote. Where the thread could already run
 * commands unasked that is nothing new; where it could not, the gate must not
 * become a way around the permission card.
 */
const runsUnasked = (s) =>
  !s.strict && (Boolean(s.worktree?.project) || Boolean(s.unattended) || ["trusted", "auto", "full"].includes(s.trust));

/** A gate that could not run at all. That is this PC's problem, not the build's. */
const broken = (evidence) => ({
  passed: false,
  aborted: false,
  broken: true,
  failures: [{ id: "gate", step: "gate", page: "", title: "The checks could not run", ran: "", evidence }],
});

/** What the page is told. Never the evidence: that is in the report. */
export function verifyView(v) {
  if (!v) return null;
  return {
    state: v.state,
    run: v.run,
    rounds: v.rounds,
    max: MAX_ROUNDS,
    why: v.why || "",
    failures: (v.failures || []).slice(0, 8).map((f) => ({ step: f.step, title: f.title, page: f.page || "" })),
    report: v.report || "",
  };
}

/**
 * `ceilingMs` is for one whole gate run. Every step has its own ceiling, and
 * their sum is under an hour; this exists so that a gate which never returns
 * cannot block the queue for every other build.
 */
export function createVerifier({ runGate, jobs, dirFor, ceilingMs = 60 * 60_000, graceMs = 10_000 }) {
  /** One gate at a time on this PC: a build and a browser are heavy. */
  let queue = Promise.resolve();

  const set = (s, patch) => {
    s.verify = { ...EMPTY, ...(s.verify || {}), ...patch };
    if (s.jobId) jobs.update(s.jobId, { verify: s.verify });
    return s.verify;
  };
  const note = (emit, text) => emit({ kind: "note", text });
  const unverified = (s, emit, why, patch = {}) => {
    set(s, { state: "failed", why, ...patch });
    if (s.jobId) jobs.mark(s.jobId, "unverified", why);
    note(emit, `Built, but the checks are failing. ${why}`);
  };

  /**
   * Has this check been called off since it was asked for?
   *
   * "accept" already wrote its own verdict. A stop decides nothing: a second
   * look that was stopped leaves the verdict it was looking at, anything else
   * goes back to idle, and the job is left exactly as the stop marked it. A
   * reopen is the owner sending the build back to work: its rounds start over.
   */
  const calledOff = (s) => {
    if (!s.verifyOff) return false;
    if (s.verifyOff === "stop") {
      const before = s.verifyPrev;
      set(s, before && SETTLED.has(before.state) ? before : { state: "idle" });
    } else if (s.verifyOff === "reopen") {
      set(s, FRESH);
    }
    return true;
  };

  /** Call off whatever check is queued, asking or running, and tell its gate to stop. */
  const callOff = (s, how) => {
    s.verifyOff = how;
    s.verifyAgain = false;
    s.verifyAbort?.abort();
  };

  /**
   * The one card, for a thread that may not run things unasked.
   *
   * Asked once per thread: a yes covers the repair rounds that follow, or the
   * owner would be answering the same question after every fix.
   */
  async function allowed(s) {
    if (runsUnasked(s) || s.verifyAllowed) return true;
    const { emit, ask } = s.verifyOpts;
    const answer = await Promise.resolve()
      .then(() =>
        ask({
          name: "VerifyGate",
          title: "Run the checks on this build",
          why: "Typecheck, its own tests, a build, then every page opened in a hidden browser. These run scripts the agent wrote.",
          risk: "act",
          command: "typecheck · test · build · start · open every page",
        }),
      )
      .catch(() => ({ allow: false, how: "error" }));
    // Stopped or accepted while the card was up: that outranks the card.
    if (s.verifyOff) return false;
    if (answer?.allow) {
      s.verifyAllowed = true;
      return true;
    }
    // A check that was only a second look must not undo the verdict it was
    // looking at. Anything else is a build nobody was allowed to verify.
    const before = s.verifyPrev;
    if (before && SETTLED.has(before.state)) {
      set(s, before);
      note(emit, "The checks were not allowed to run, so the last result stands.");
    } else {
      unverified(s, emit, "The checks were not allowed to run, so nothing was verified.", { failures: [] });
    }
    return false;
  }

  /** One turn in the queue: run the gate, with the latest options, until its result is current. */
  async function run(s) {
    for (;;) {
      if (calledOff(s)) return;
      const { emit, say, repair = true, text = "", paths = [] } = s.verifyOpts;
      const n = (s.verify?.run || 0) + 1;
      const dir = dirFor(s.id, n);
      s.verifyAgain = false;
      s.verifyAbort = new AbortController();
      set(s, { state: "checking", run: n, why: "" });
      emit({ kind: "verify_start", run: n });
      note(emit, `Checking it works (check ${n}).`);

      let report;
      let watchdog = null;
      let grace = null;
      try {
        report = await Promise.race([
          Promise.resolve().then(() =>
            runGate({
              cwd: s.worktree.path,
              project: Boolean(s.worktree.project),
              base: s.worktree.base || "",
              text,
              paths,
              dir,
              signal: s.verifyAbort.signal,
              onStep: (row) => emit({ kind: "verify_step", id: row.id, ok: row.ok, skipped: row.skipped, ms: row.ms }),
            }),
          ),
          new Promise((resolve) => {
            watchdog = setTimeout(() => {
              s.verifyAbort.abort();
              resolve(broken(`They did not finish within ${Math.round(ceilingMs / 60_000)} minutes and were stopped.`));
            }, ceilingMs);
            watchdog.unref?.();
          }),
          // A gate told to stop gets a moment to kill what it started. One
          // that never answers must not keep every other build waiting.
          new Promise((resolve) => {
            s.verifyAbort.signal.addEventListener(
              "abort",
              () => {
                grace = setTimeout(() => resolve({ passed: false, aborted: true, failures: [] }), graceMs);
                grace.unref?.();
              },
              { once: true },
            );
          }),
        ]);
      } catch (e) {
        report = broken(String(e?.message ?? e));
      } finally {
        clearTimeout(watchdog);
        clearTimeout(grace);
      }

      if (calledOff(s)) return;
      // Asked for again while this ran — the agent finished a second time, or
      // the owner pressed Check again. This result is about files that have
      // since changed, so it is thrown away. Tested BEFORE `aborted`: a stop
      // followed by a fresh request is a request.
      if (s.verifyAgain) continue;
      if (report.aborted) {
        set(s, { state: "idle" });
        return;
      }
      emit({ kind: "verify_end", run: n, passed: Boolean(report.passed), failures: report.failures.length });
      // The gate itself broke. The agent cannot repair that, so nothing is
      // sent back; the build is simply not verified, and says why.
      if (report.broken) {
        const why = report.brokenWhy || report.failures[0]?.evidence || "";
        unverified(s, emit, `The checks could not run. ${why}`.trim(), { failures: report.failures });
        return;
      }

      const ids = report.failures.map((f) => f.id);
      const next = afterRun({ passed: report.passed, ids, lastIds: s.verify.lastIds, rounds: s.verify.rounds, repair });
      const file = path.join(dir, "report.json");

      if (next.state === "passed") {
        // A pass ends this round of repairs. A later change that fails starts
        // again from nought, not from "still failing after three".
        set(s, { state: "passed", rounds: 0, failures: [], lastIds: [], report: file, why: "" });
        if (s.jobId) jobs.mark(s.jobId, "done", "The checks passed.");
        note(emit, "The checks passed.");
        return;
      }
      if (next.state === "repairing") {
        const rounds = s.verify.rounds + 1;
        set(s, { state: "repairing", rounds, failures: report.failures, report: file });
        const count = report.failures.length;
        note(emit, `${count} check${count === 1 ? "" : "s"} failed. Sent back to be fixed (round ${rounds} of ${MAX_ROUNDS}).`);
        try {
          await say(repairPrompt(report, { round: rounds, max: MAX_ROUNDS }));
          // `lastIds` is what the agent was last SENT, so it is written only
          // once the message has gone: a look-only check never writes it, and
          // a crash before the send must not read later as "nothing changed".
          if (!s.verifyOff) set(s, { lastIds: ids });
        } catch (e) {
          // Nobody is working on it, so it must not sit on "fixing" for ever.
          if (!s.verifyOff) unverified(s, emit, `The agent could not be reached to fix it. ${String(e?.message ?? e)}`);
        }
        if (calledOff(s)) return;
        if (s.verifyAgain) continue;
        return;
      }
      unverified(s, emit, next.why, { failures: report.failures, report: file });
      return;
    }
  }

  return {
    /**
     * Check this thread. Returns a promise for `s.verify` once it has settled.
     *
     * Called again while a check is queued or running, it starts nothing new:
     * the options are replaced and the running check goes round again.
     */
    check(s, opts) {
      if (s.verifying) {
        // Two requests for one check. If either wanted failures sent back, the
        // check sends them: a turn ending must not lose its repair because the
        // owner also pressed Check again. An earlier request that was called
        // off (stopped, accepted) has no say in it.
        const earlier = s.verifyOff ? null : s.verifyOpts;
        s.verifyOpts = { ...opts, repair: wantsRepair(opts) || (Boolean(earlier) && wantsRepair(earlier)) };
        // A fresh request outranks an earlier stop or "use it anyway".
        s.verifyOff = "";
        s.verifyAgain = true;
        return s.verifyDone;
      }
      s.verifyOpts = opts;
      s.verifyOff = "";
      s.verifyPrev = s.verify ? { ...s.verify } : null;
      set(s, { state: "checking" });
      s.verifying = true;
      s.verifyDone = (async () => {
        try {
          const go = await allowed(s);
          if (calledOff(s)) return s.verify;
          if (go) {
            const turn = queue.then(() => run(s));
            // The queue outlives any one thread's failure.
            queue = turn.catch(() => {});
            await turn;
          }
        } catch (e) {
          // Nothing above is meant to throw. If it does, the build must not be
          // left reading "checking" with nothing checking it.
          unverified(s, s.verifyOpts.emit, `The checks could not run. ${String(e?.message ?? e)}`);
        } finally {
          s.verifying = false;
        }
        return s.verify;
      })();
      return s.verifyDone;
    },

    /** The owner's "Use it anyway". */
    accept(s, emit) {
      // Nothing to accept on a thread that is not checked, or one that passed.
      if (!s.verify || s.verify.state === "passed") return s.verify ?? null;
      // A check still queued or running must not overwrite this when it ends,
      // and must not send the agent a repair for a build the owner has taken.
      if (s.verifying) callOff(s, "accept");
      set(s, { state: "accepted", rounds: 0, lastIds: [], why: "Accepted by the owner without a passing check." });
      // What a later second look falls back to if it is refused or stopped.
      s.verifyPrev = { ...s.verify };
      if (s.jobId) jobs.mark(s.jobId, "done", s.verify.why);
      note(emit, "You chose to use it anyway. The failing checks are still in the report.");
      return s.verify;
    },

    /**
     * The owner has typed to the agent, so the build is being worked on again.
     *
     * Whatever was checked is about to be out of date: a check in flight is
     * called off, the verdict is cleared and the rounds start over. The caller
     * puts the job back to running, so the next finish line is checked.
     */
    reopen(s) {
      if (!s.verify) return;
      if (s.verifying) callOff(s, "reopen");
      set(s, FRESH);
    },

    /** A repair turn ended without the agent saying it had finished. */
    stalledRepair(s, emit) {
      if (s.verify?.state !== "repairing") return;
      unverified(s, emit, "It stopped without finishing the repair.");
    },

    /** The thread is being stopped or thrown away. Works on a check that is queued, asking or running. */
    abort(s) {
      if (s.verifying) callOff(s, "stop");
    },

    /** The latest report, with its two pictures as data URLs, for the page. */
    report(s) {
      const file = s.verify?.report || "";
      if (!file || !existsSync(file)) return { report: null, shots: {} };
      const dir = path.dirname(file);
      const shot = (name) => {
        const at = path.join(dir, name);
        return existsSync(at) ? `data:image/jpeg;base64,${readFileSync(at).toString("base64")}` : "";
      };
      let report = null;
      try {
        report = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        /* a report cut off mid-write reads as no report */
      }
      return { report, shots: { desktop: shot("home-1280.jpg"), phone: shot("home-390.jpg") } };
    },
  };
}
