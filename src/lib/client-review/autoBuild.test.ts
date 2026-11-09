import { describe, expect, it } from "vitest";
import { clientEditProject } from "@/lib/app-builder/clientEdit";
import { buildLinks, CannotBuildHere, harnessBrief } from "./autoBuild";
import { addRequest, approveBatch, createProject, sendToJarvis } from "./logic";
import type { ClientProject } from "./types";

describe("reading the build's last words", () => {
  it("finds the pull request and the preview", () => {
    const text = [
      "Pushed jarvis-money-agent-studio-v2 and opened the pull request.",
      "",
      "PR: https://github.com/legacymiles/ultimate-assistant-os/pull/412",
      "Preview: https://ultimate-assistant-os-git-jarvis-money-agent-studio-v2.vercel.app/apps/money-agent-studio",
    ].join("\n");
    expect(buildLinks(text)).toEqual({
      pr: "https://github.com/legacymiles/ultimate-assistant-os/pull/412",
      preview: "https://ultimate-assistant-os-git-jarvis-money-agent-studio-v2.vercel.app/apps/money-agent-studio",
    });
  });

  it("takes the last pair when the thread said it twice", () => {
    const text = "PR: https://github.com/a/b/pull/1\nPreview: https://old.example/x\n\nPR: https://github.com/a/b/pull/2\nPreview: https://new.example/x";
    expect(buildLinks(text)).toEqual({ pr: "https://github.com/a/b/pull/2", preview: "https://new.example/x" });
  });

  it("does not turn a half-written sentence into a link", () => {
    expect(buildLinks("Preview: none — the preview requires a Vercel login.")).toEqual({ pr: undefined, preview: undefined });
    expect(buildLinks("Preview: https://preview.example/x.")).toEqual({ pr: undefined, preview: "https://preview.example/x" });
    expect(buildLinks("nothing here")).toEqual({ pr: undefined, preview: undefined });
  });

  it("says why the PC can't build it as a value, not a message to parse", () => {
    const e = new CannotBuildHere("pc-off", "no PC");
    expect(e.reason).toBe("pc-off");
    expect(e).toBeInstanceOf(Error);
  });
});

const T = "2026-10-20T04:00:00.000Z";

/** An approved batch, the way the console hands one over. */
function approved() {
  let p: ClientProject = createProject(
    { name: "Glow Spa", clientName: "Dana", siteUrl: "glowspa.vercel.app", repo: "legacymiles/ultimate-assistant-os" },
    T,
  );
  const v1 = p.versions[0].id;
  p = addRequest(p, { versionId: v1, text: "make the logo bigger" }, T).project;
  const sent = sendToJarvis(p, v1, T);
  const out = approveBatch(sent.project, { batchId: sent.batch.id, brief: "One small visual edit." }, T);
  return clientEditProject(out.project, sent.batch.id, new Date(T), "ab_test");
}

describe("what the build is told", () => {
  it("says the worktree is already on main, and never asks it to rebase", () => {
    const brief = harnessBrief(approved());
    expect(brief).toContain("ALREADY reset to `origin/main`");
    // The old brief told the agent to rebase onto main and stop if that was not
    // trivial, which is exactly what it did every time the bridge's checkout
    // sat on a long-running branch. Nothing may ask for that again.
    expect(brief).not.toMatch(/git rebase/);
    expect(brief).toContain("Do not rebase, reset, merge or fetch anything before you start");
  });

  it("cancels the shared prompt's queue and connector steps", () => {
    const brief = harnessBrief(approved());
    // editMasterPrompt is shared with App Builder and still mentions both, so
    // the override has to name them or the build reports into thin air.
    expect(brief).toContain("queue_note");
    expect(brief).toContain("no Jarvis connector and no queue");
    expect(brief).toContain("say so in your final message");
  });

  it("asks for the two lines buildLinks reads, and nothing else", () => {
    const brief = harnessBrief(approved());
    expect(brief).toContain("PR: <the pull request url>");
    expect(brief).toContain("Never invent a URL.");
    expect(brief).toContain("Never merge it");
  });

  it("warns off npm install, because node_modules is another checkout's", () => {
    expect(harnessBrief(approved())).toContain("never run `npm install` in this folder");
  });
});
