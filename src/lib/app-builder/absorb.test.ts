import { describe, expect, it } from "vitest";
import { absorbBranch, absorbBrief, absorbPr, absorbTitle, hubSlug, moveDied, moveEnded } from "./absorb";
import { applyOps, bestGuesses, intakeQuestions, newProject, offlineFeatures, understand } from "./engine";
import type { BuilderProject } from "./types";

const IDEA = "an app called WalkBook where dog owners book a trusted local walker";
const FROM = "C:\\Users\\honey\\Projects\\walkbook";

function project(): BuilderProject {
  const p = newProject(IDEA, new Date("2026-11-02T10:00:00Z"), "ab_absorb");
  p.questions = intakeQuestions(IDEA);
  p.answers = bestGuesses(p.questions, { audience: "The public" });
  p.understanding = understand(IDEA, p.answers);
  p.features = applyOps(offlineFeatures(IDEA, p.answers, p.understanding), [{ op: "acceptAll" }]).features;
  p.stage = "features";
  return p;
}

describe("where it lands in the hub", () => {
  it("takes its route from the app's name", () => {
    expect(hubSlug(project())).toBe("walkbook");
  });
  it("names the branch for the app, not the thread", () => {
    expect(absorbBranch(project())).toBe("absorb/walkbook");
    expect(absorbTitle(project())).toContain("WalkBook");
  });
});

describe("the brief for moving an app in", () => {
  const brief = absorbBrief(project(), FROM);

  it("says to read the hub's own operating manual first", () => {
    expect(brief).toContain("CLAUDE.md");
  });

  it("treats the standalone app as read-only, and says why", () => {
    expect(brief).toContain("<read_only_source>");
    expect(brief).toContain(FROM);
    expect(brief).toMatch(/READ-ONLY/);
    expect(brief).toMatch(/only intact copy/i);
  });

  it("names the hub's conventions rather than leaving them to be guessed", () => {
    for (const bit of ["src/app/apps/walkbook/page.tsx", "src/components/walkbook/", "src/lib/walkbook/", "catalog.ts", "provider.ts", "appState.ts", "UNPREVIEWABLE"]) {
      expect(brief).toContain(bit);
    }
  });

  it("asks for the dependencies to be merged, not duplicated", () => {
    expect(brief).toMatch(/package\.json/);
    expect(brief).toMatch(/already provides/i);
  });

  it("carries the accepted features, so nothing is quietly dropped in the move", () => {
    const p = project();
    expect(absorbBrief(p, FROM)).toContain(p.features[0].title);
  });

  it("leaves the features block out when there is nothing accepted", () => {
    const p = project();
    p.features = p.features.map((f) => ({ ...f, status: "proposed" as const }));
    expect(absorbBrief(p, FROM)).not.toContain("<keep_working>");
  });

  it("forbids merging it, because the owner merges", () => {
    expect(brief).toMatch(/Do NOT merge/);
    expect(brief).toContain("`PR: <url>`");
  });

  it("forbids drive-by changes to the rest of the repo", () => {
    expect(brief).toContain("<leave_alone>");
    expect(brief).toMatch(/No refactors/);
  });
});

describe("reading the pull request back", () => {
  it("takes it from Claude's own last line", () => {
    expect(absorbPr("All done.\n\nPR: https://github.com/me/hub/pull/12\n")).toBe("https://github.com/me/hub/pull/12");
  });
  it("takes the last one when it corrected itself", () => {
    expect(absorbPr("PR: https://github.com/me/hub/pull/11\nReopened.\nPR: https://github.com/me/hub/pull/12")).toBe("https://github.com/me/hub/pull/12");
  });
  it("refuses anything that is not a real address", () => {
    expect(absorbPr("PR: not opened yet")).toBeUndefined();
    expect(absorbPr("nothing here")).toBeUndefined();
  });
  it("strips trailing punctuation", () => {
    expect(absorbPr("PR: https://github.com/me/hub/pull/12.")).toBe("https://github.com/me/hub/pull/12");
  });
});

describe("both doors into the hub say the same thing", () => {
  // App Builder's Move into Jarvis and Client Review's Ship are two briefs for
  // one job. Ship grew the PLUGIN_SLUGS line after a move landed an app on the
  // hub grid with no card on App plugins; this door had not.
  const brief = () => absorbBrief(project(), "C:/dev/standalone");

  it("puts the app on App plugins, not only in the catalog", () => {
    expect(brief()).toContain("PLUGIN_SLUGS");
    expect(brief()).toContain("src/lib/studio/plugins.ts");
    expect(brief()).toContain("PROJECTS");
  });

  it("asks for the gate CI runs, by its one command", () => {
    expect(brief()).toContain("npm run verify");
    expect(brief()).toContain("npm run apps:index");
    expect(brief()).toContain("npm run build");
  });
});

describe("when a move needs the owner", () => {
  it("counts every way a thread stops as ended", () => {
    for (const p of ["done", "failed", "stopped", "lost", "unfinished"] as const) expect(moveEnded(p), p).toBe(true);
    for (const p of ["starting", "working", "asking", "checking"] as const) expect(moveEnded(p), p).toBe(false);
  });

  it("separates finished from died, because only one of them has a pull request", () => {
    expect(moveDied("done")).toBe(false);
    for (const p of ["failed", "stopped", "lost", "unfinished"] as const) expect(moveDied(p), p).toBe(true);
  });
});
