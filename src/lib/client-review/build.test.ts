import { describe, expect, it } from "vitest";
import {
  addRequest,
  approveBatch,
  baseBranchFor,
  branchFor,
  cleanRepo,
  cleanVercelProject,
  createProject,
  currentVersion,
  noteBuild,
  portalView,
  reviewRequest,
  sendToJarvis,
  shipPreview,
  updateProjectMeta,
  ReviewError,
} from "./logic";

const T = "2026-10-20T04:00:00.000Z";

/** A client project with one approved batch of two edits (one reworded, one pinned). */
function approved() {
  let p = createProject(
    { name: "Glow Spa", clientName: "Dana", siteUrl: "glowspa.vercel.app", repo: "legacymiles/glow-spa-site", vercelProject: "glow-spa-site" },
    T,
  );
  const v1 = p.versions[0].id;
  p = addRequest(p, { versionId: v1, text: "make the logo bigger", pin: { x: 0.12, y: 0.06, viewport: 390 } }, T).project;
  p = addRequest(p, { versionId: v1, text: "pink buttons pls" }, T).project;
  const sent = sendToJarvis(p, v1, T);
  p = reviewRequest(sent.project, { id: p.requests[1].id, adminText: "Make the primary buttons blush pink (#F4C2C2)" }, T);
  const out = approveBatch(p, { batchId: sent.batch.id }, T);
  return { ...out, batchId: sent.batch.id };
}

describe("where the site lives", () => {
  it("reads every way people paste a repo", () => {
    expect(cleanRepo("legacymiles/glow-spa-site")).toBe("legacymiles/glow-spa-site");
    expect(cleanRepo("https://github.com/legacymiles/glow-spa-site")).toBe("legacymiles/glow-spa-site");
    expect(cleanRepo("https://github.com/legacymiles/glow-spa-site.git")).toBe("legacymiles/glow-spa-site");
    expect(cleanRepo("github.com/legacymiles/glow-spa-site/")).toBe("legacymiles/glow-spa-site");
    expect(cleanRepo("git@github.com:legacymiles/glow-spa-site.git")).toBe("legacymiles/glow-spa-site");
    expect(cleanRepo("  ")).toBeUndefined();
    expect(() => cleanRepo("glow spa")).toThrow(ReviewError);
    expect(() => cleanRepo("https://gitlab.com/a/b")).toThrow(/owner\/name/);
  });

  it("reads a Vercel project name or its dashboard link", () => {
    expect(cleanVercelProject("Glow-Spa-Site")).toBe("glow-spa-site");
    expect(cleanVercelProject("https://vercel.com/legacymiles/glow-spa-site")).toBe("glow-spa-site");
    expect(cleanVercelProject("")).toBeUndefined();
    expect(() => cleanVercelProject("not a name!")).toThrow(ReviewError);
  });

  it("saves and clears them on an existing project", () => {
    let p = createProject({ name: "Glow Spa" }, T);
    p = updateProjectMeta(p, { repo: "https://github.com/a/b", vercelProject: "b" }, T);
    expect(p).toMatchObject({ repo: "a/b", vercelProject: "b" });
    p = updateProjectMeta(p, { repo: "" }, T);
    expect(p.repo).toBeUndefined();
  });

  it("names a branch per version", () => {
    expect(branchFor({ name: "Glow Spa — Website!" }, "v3")).toBe("jarvis/glow-spa-website-v3");
    expect(branchFor({ name: "!!!" }, "v2")).toBe("jarvis/site-v2");
  });
});

describe("built by App Builder, posted back by Claude Code", () => {
  it("records which App Builder project and queue request carry the batch", () => {
    const { project, batchId } = approved();
    const p = noteBuild(project, { batchId, builderId: "ab_123", queueId: "rq_9" }, T);
    expect(p.batches[0].build).toEqual({ builderId: "ab_123", queueId: "rq_9", at: T });
  });

  it("won't record a build for a batch that isn't approved", () => {
    let p = createProject({ name: "Glow Spa", siteUrl: "glowspa.vercel.app" }, T);
    p = addRequest(p, { versionId: p.versions[0].id, text: "x" }, T).project;
    const sent = sendToJarvis(p, p.versions[0].id, T);
    expect(() => noteBuild(sent.project, { batchId: sent.batch.id, builderId: "ab_1" })).toThrow(/Approve/);
  });

  it("posts the preview as the version on the client's screen, and tells them", () => {
    const { project, version } = approved();
    const out = shipPreview(
      project,
      {
        versionId: version.id,
        siteUrl: "https://glow-spa-site-git-jarvis-glow-spa-v2-legacymiles.vercel.app",
        prUrl: "https://github.com/legacymiles/glow-spa-site/pull/4",
        branch: "jarvis/glow-spa-v2",
        summary: "• Bigger logo\n• Blush pink buttons",
      },
      T,
    );
    expect(out.already).toBe(false);
    expect(currentVersion(out.project)?.id).toBe(version.id);
    expect(out.version).toMatchObject({
      status: "review",
      prUrl: "https://github.com/legacymiles/glow-spa-site/pull/4",
      branch: "jarvis/glow-spa-v2",
      shippedBy: "claude-code",
      summary: "• Bigger logo\n• Blush pink buttons",
    });
    expect(out.project.requests.every((r) => r.status === "done")).toBe(true);
    expect(out.project.notices.at(-1)?.title).toBe("v2 is ready");
    // The next build starts from the branch the client is looking at.
    expect(baseBranchFor(out.project)).toBe("jarvis/glow-spa-v2");
  });

  it("is safe to call twice, and never lets an old build replace a newer one", () => {
    const { project, version } = approved();
    const url = "https://glow-spa-preview.vercel.app";
    const first = shipPreview(project, { versionId: version.id, siteUrl: url }, T);
    const again = shipPreview(first.project, { versionId: version.id, siteUrl: url }, T);
    expect(again.already).toBe(true);
    expect(again.project).toBe(first.project);
    expect(() => shipPreview(first.project, { versionId: version.id, siteUrl: "https://other.vercel.app" }, T)).toThrow(
      /isn't being built/,
    );
    expect(() => shipPreview(project, { versionId: "ver_nope", siteUrl: url })).toThrow(ReviewError);
    expect(() => shipPreview(project, { versionId: version.id, siteUrl: "" })).toThrow(/preview/);
  });

  it("starts from main when nothing has been built on a branch yet", () => {
    expect(baseBranchFor(approved().project)).toBe("main");
  });

  it("never shows the client the branch or the pull request", () => {
    const { project, version } = approved();
    const out = shipPreview(project, { versionId: version.id, siteUrl: "https://p.vercel.app", prUrl: "https://github.com/a/b/pull/1", branch: "jarvis/x" }, T);
    const view = JSON.stringify(portalView(out.project, null));
    expect(view).not.toContain("pull/1");
    expect(view).not.toContain("jarvis/x");
    expect(view).not.toContain("glow-spa-site");
  });
});
