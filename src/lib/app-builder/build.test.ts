import { describe, expect, it } from "vitest";
import { buildBrief, isNewBuild, latestWord, phaseOf, PHASE_LABEL, projectSlug, resultLinks, stalled, tally, threadTitle } from "./build";
import { applyOps, bestGuesses, intakeQuestions, newProject, offlineFeatures, understand } from "./engine";
import type { BuilderProject } from "./types";
import type { ThreadSummary, ThreadView, Turn } from "@/lib/new-jarvis/harness/types";
import { emptyThread } from "@/lib/new-jarvis/harness/model";

const IDEA = "an app called WalkBook where dog owners book a trusted local walker";

function project(): BuilderProject {
  const p = newProject(IDEA, new Date("2026-11-02T10:00:00Z"), "ab_build");
  p.questions = intakeQuestions(IDEA);
  p.answers = bestGuesses(p.questions, { audience: "The public" });
  p.understanding = understand(IDEA, p.answers);
  p.features = applyOps(offlineFeatures(IDEA, p.answers, p.understanding), [{ op: "acceptAll" }]).features;
  p.stage = "features";
  return p;
}

function turn(text: string, extra: Partial<Turn> = {}): Turn {
  return { id: "t", at: 0, prompt: "", text, thinking: "", tools: [], gates: [], plan: [], notes: [], status: "done", ms: 0, usd: 0, error: "", ...extra };
}

function view(turns: Turn[], liveGate: ThreadView["liveGate"] = null): ThreadView {
  return { ...emptyThread(), turns, liveGate };
}

function summary(status: ThreadSummary["status"]): ThreadSummary {
  return { status } as ThreadSummary;
}

describe("where the app is built", () => {
  it("slugs the folder from the app's name, not the raw idea", () => {
    expect(projectSlug(project())).toBe("walkbook");
  });
  it("names the thread so the bridge's list is readable", () => {
    expect(threadTitle(project())).toBe("WalkBook");
  });
});

describe("the brief the PC receives", () => {
  const brief = buildBrief(project());

  it("says it is standing in an empty repository of its own", () => {
    expect(brief).toContain("<where_you_are>");
    expect(brief).toContain("already a git repository");
  });

  it("forbids taking files from the other repositories on the machine", () => {
    expect(brief).toMatch(/not reach into any other repository/i);
  });

  it("makes the repository itself when the app is the owner's own", () => {
    expect(brief).toContain("create a GitHub repository for it and push");
    expect(brief).toContain("`Repo: <url>`");
  });

  it("leaves the repository to Ship when the app is being built for a client", () => {
    const forClient = project();
    forClient.handoff = { ...(forClient.handoff ?? {}), review: { ...(forClient.handoff?.review ?? {}), clientName: "Dana Reyes" } } as typeof forClient.handoff;
    const theirs = buildBrief(forClient);
    expect(theirs).toContain("Do NOT create a GitHub repository");
    expect(theirs).not.toContain("`Repo: <url>`");
    expect(theirs).toContain("`Live: <url>`");
  });

  it("still carries the whole master prompt", () => {
    expect(brief).toContain("<goal>");
    expect(brief).toContain("<features>");
    expect(brief).toContain("<skills_pipeline>");
  });

  it("asks for the two links back in a shape that can be parsed", () => {
    expect(brief).toContain("`Repo: <url>`");
    expect(brief).toContain("`Live: <url>`");
  });
});

describe("reading the links back out", () => {
  it("takes Repo and Live from Claude's last words", () => {
    const v = view([turn("All done.\n\nRepo: https://github.com/me/walkbook\nLive: https://walkbook.vercel.app\n")]);
    expect(resultLinks(v)).toEqual({ repo: "https://github.com/me/walkbook", url: "https://walkbook.vercel.app" });
  });

  it("ignores a line that is not a real address, rather than offering a broken link", () => {
    const v = view([turn("Repo: (not created yet)\nLive: TBC")]);
    expect(resultLinks(v)).toEqual({ repo: undefined, url: undefined });
  });

  it("takes the LAST answer when it corrected itself", () => {
    const v = view([turn("Live: https://old.example.com"), turn("Sorry — redeployed.\nLive: https://new.example.com")]);
    expect(resultLinks(v).url).toBe("https://new.example.com");
  });

  it("strips trailing punctuation that is not part of the address", () => {
    expect(resultLinks(view([turn("Live: https://walkbook.vercel.app.")])).url).toBe("https://walkbook.vercel.app");
  });

  it("finds nothing in a build that never finished", () => {
    expect(resultLinks(view([turn("Installing dependencies…")]))).toEqual({ repo: undefined, url: undefined });
  });
});

describe("what phase the build is in", () => {
  it("is asking whenever a gate is up, whatever the thread says", () => {
    const gate = { gateId: "g1" } as NonNullable<ThreadView["liveGate"]>;
    expect(phaseOf(summary("thinking"), view([turn("…")], gate))).toBe("asking");
  });

  it("is starting before the bridge has answered at all", () => {
    expect(phaseOf(null, emptyThread())).toBe("starting");
  });

  it("is working while Claude is thinking", () => {
    expect(phaseOf(summary("thinking"), view([turn("…")]))).toBe("working");
  });

  it("is done once the thread has ended cleanly", () => {
    expect(phaseOf(summary("ended"), view([turn("Built it.")]))).toBe("done");
  });

  it("is failed when the thread ended on a failed turn", () => {
    expect(phaseOf(summary("ended"), view([turn("", { status: "failed", error: "npm install died" })]))).toBe("failed");
  });

  it("does not call an idle thread with no work behind it 'done'", () => {
    expect(phaseOf(summary("idle"), emptyThread())).toBe("starting");
  });
});

describe("what it is doing now", () => {
  it("is Claude's own last paragraph", () => {
    expect(latestWord(view([turn("Set up Next.\n\nNow wiring the booking flow.")]))).toBe("Now wiring the booking flow.");
  });

  it("falls back to the last tool when it has not spoken yet", () => {
    const t = turn("", { tools: [{ callId: "c1", name: "Write", title: "Writing src/app/page.tsx", kindOf: "write", path: "", command: "", status: "ok", output: "", at: 0 }] });
    expect(latestWord(view([t]))).toBe("Writing src/app/page.tsx");
  });

  it("says nothing rather than guessing when there is nothing", () => {
    expect(latestWord(emptyThread())).toBe("");
  });

  it("counts what it read, changed and ran", () => {
    const t = turn("", {
      tools: [
        { callId: "1", name: "Read", title: "", kindOf: "read", path: "", command: "", status: "ok", output: "", at: 0 },
        { callId: "2", name: "Write", title: "", kindOf: "write", path: "", command: "", status: "ok", output: "", at: 0 },
        { callId: "3", name: "Bash", title: "", kindOf: "run", path: "", command: "", status: "ok", output: "", at: 0 },
      ],
    });
    expect(tally(view([t]))).toEqual({ reads: 1, changes: 1, runs: 1, asked: 0 });
  });
});

describe("an agent that answered without working", () => {
  // The real failure on this machine: Claude Code was not signed in, so every
  // turn came back instantly having said nothing and cost nothing. It looks
  // exactly like a finished build unless it is checked for.
  const empty = view([turn("")]);

  it("is spotted as a stall, not a build", () => {
    expect(stalled(empty)).toBe(true);
  });

  it("is reported as failed rather than built, whether ended or idle", () => {
    expect(phaseOf(summary("ended"), empty)).toBe("failed");
    expect(phaseOf(summary("idle"), empty)).toBe("failed");
  });

  it("is not a stall once it has actually said something", () => {
    expect(stalled(view([turn("Setting up Next.")]))).toBe(false);
    expect(phaseOf(summary("ended"), view([turn("Done.")]))).toBe("done");
  });

  it("is not a stall when it used a tool but has not spoken yet", () => {
    const t = turn("", { tools: [{ callId: "c1", name: "Write", title: "page.tsx", kindOf: "write", path: "", command: "", status: "ok", output: "", at: 0 }] });
    expect(stalled(view([t]))).toBe(false);
  });

  it("is not a stall when the turn carried a real error", () => {
    expect(stalled(view([turn("", { status: "failed", error: "npm install died" })]))).toBe(false);
  });

  it("says nothing about a thread that has not run a turn at all", () => {
    expect(stalled(emptyThread())).toBe(false);
  });
});

describe("a build the agent has forgotten", () => {
  // The bridge restarts and every thread dies with it. The project still
  // points at one, so the panel must say nothing is running — not sit on
  // "Starting the build" with the button to fix it greyed out.
  it("is resuming, not lost, while a restarted bridge puts the job back", () => {
    expect(phaseOf(null, emptyThread(), true)).toBe("resuming");
  });

  it("is resuming whatever the stale view held", () => {
    expect(phaseOf(summary("thinking"), view([turn("half a build")]), true)).toBe("resuming");
  });

  it("is lost only after the resume grace has run out", () => {
    expect(phaseOf(null, emptyThread(), true, { lost: true })).toBe("lost");
  });

  it("is reconnecting, not stopped, when this tab has lost the PC", () => {
    expect(phaseOf(null, emptyThread(), false, { offline: true })).toBe("reconnecting");
    expect(phaseOf(summary("thinking"), view([turn("half a build")]), false, { offline: true })).toBe("reconnecting");
  });

  it("does not call an offline PC a stopped build once the turn is over", () => {
    expect(phaseOf(summary("idle"), view([turn("Done.")]), false, { offline: true })).toBe("done");
  });

  it("is only starting when the agent simply has not answered yet", () => {
    expect(phaseOf(null, emptyThread(), false)).toBe("starting");
    expect(phaseOf(null, emptyThread())).toBe("starting");
  });

  it("has a label that says nothing is happening", () => {
    expect(PHASE_LABEL.lost.toLowerCase()).toContain("no longer running");
  });
});

describe("deciding a build has just started", () => {
  const P = "ab_1";

  it("is the whole point: a page open with no build, that gains one", () => {
    const had = { project: P, thread: null };
    expect(isNewBuild(had, { project: P, thread: "t1" })).toBe(true);
  });

  it("is NOT a build that was already running when the page opened", () => {
    expect(isNewBuild(null, { project: P, thread: "t1" })).toBe(false);
  });

  it("is NOT just opening a different project that happens to be building", () => {
    const had = { project: "ab_other", thread: null };
    expect(isNewBuild(had, { project: P, thread: "t1" })).toBe(false);
  });

  it("is a rebuild, when the same project swaps one thread for another", () => {
    expect(isNewBuild({ project: P, thread: "t1" }, { project: P, thread: "t2" })).toBe(true);
  });

  it("is not the same thread seen again on a re-render", () => {
    expect(isNewBuild({ project: P, thread: "t1" }, { project: P, thread: "t1" })).toBe(false);
  });

  it("is not a build ending", () => {
    expect(isNewBuild({ project: P, thread: "t1" }, { project: P, thread: null })).toBe(false);
  });

  it("survives the mount sequence that broke it before", () => {
    // Mount with no build, then the owner presses Build it. Previously a
    // second effect reset the record between these two, and the screen never
    // appeared. One call per render, fed by the previous one:
    let seen: { project: string | null; thread: string | null } | null = null;
    const step = (now: { project: string | null; thread: string | null }) => {
      const out = isNewBuild(seen, now);
      seen = now;
      return out;
    };
    expect(step({ project: P, thread: null })).toBe(false); // first render
    expect(step({ project: P, thread: null })).toBe(false); // a re-render
    expect(step({ project: P, thread: "t1" })).toBe(true); // Build it pressed
    expect(step({ project: P, thread: "t1" })).toBe(false); // and not again
  });
});
