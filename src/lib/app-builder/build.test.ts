import { describe, expect, it } from "vitest";
import { buildBrief, latestWord, phaseOf, projectSlug, resultLinks, tally, threadTitle } from "./build";
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
