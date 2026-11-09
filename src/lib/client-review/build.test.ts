import { describe, expect, it } from "vitest";
import {
  addRequest,
  approveBatch,
  baseBranchFor,
  buildingVersion,
  branchFor,
  cleanRepo,
  cancelBuild,
  cleanVercelProject,
  createProject,
  currentVersion,
  markVersionReady,
  noteBuild,
  noteBuildFailure,
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

describe("stopping a build that went nowhere", () => {
  /** A project with v1 live, two sent requests approved into a building v2. */
  function building() {
    let p = createProject({ name: "Glow Spa", siteUrl: "glowspa.vercel.app", repo: "o/r" }, T);
    const v1 = p.versions[0].id;
    p = addRequest(p, { versionId: v1, text: "make the logo bigger" }, T).project;
    p = addRequest(p, { versionId: v1, text: "pink buttons" }, T).project;
    const sent = sendToJarvis(p, v1, T);
    const out = approveBatch(sent.project, { batchId: sent.batch.id, brief: "Two edits." }, T);
    const noted = noteBuild(out.project, { batchId: sent.batch.id, builderId: "ab_1", threadId: "th_1" });
    return { p: noted, v1, v2: out.version.id, batchId: sent.batch.id };
  }

  it("removes the stuck version and gives the client v1 back", () => {
    const { p, v1, v2 } = building();
    expect(p.versions.find((v) => v.id === v1)!.status).toBe("superseded");
    const out = cancelBuild(p, { versionId: v2 }, T);
    expect(out.project.versions.map((v) => v.id)).toContain(v1);
    expect(out.project.versions.some((v) => v.id === v2)).toBe(false);
    expect(out.project.versions.find((v) => v.id === v1)!.status).toBe("review");
    expect(currentVersion(out.project)!.id).toBe(v1);
    expect(buildingVersion(out.project)).toBeNull();
  });

  it("hands the edits back as a pending batch, so Approve & build is there again", () => {
    const { p, batchId, v2 } = building();
    const out = cancelBuild(p, { versionId: v2 }, T);
    expect(out.batches).toBe(1);
    const b = out.project.batches.find((x) => x.id === batchId)!;
    expect(b.status).toBe("pending");
    expect(b.nextVersionId).toBeUndefined();
    expect(b.decidedAt).toBeUndefined();
    // The dead thread must not survive, or the console reattaches to nothing.
    expect(b.build).toBeUndefined();
    expect(b.brief).toBe("Two edits.");
    expect(out.project.requests.every((r) => r.status === "sent")).toBe(true);
  });

  it("can be approved and built again straight after", () => {
    const { p, batchId, v2 } = building();
    const back = cancelBuild(p, { versionId: v2 }, T).project;
    const again = approveBatch(back, { batchId }, T);
    expect(again.version.status).toBe("building");
    expect(again.approved).toHaveLength(2);
  });

  it("tells the client, rather than letting the screen just change", () => {
    const { p, v2 } = building();
    const out = cancelBuild(p, { versionId: v2 }, T);
    expect(out.project.notices.at(-1)!.title).toContain("was stopped");
  });

  it("refuses a version that is not being built, or one that never existed", () => {
    const { p, v1, v2 } = building();
    expect(() => cancelBuild(p, { versionId: v1 }, T)).toThrow(/not being built/);
    expect(() => cancelBuild(p, { versionId: "ver_nope" }, T)).toThrow(/no longer exists/);
    // Once it has shipped it is "review", so the same guard catches it.
    const shipped = markVersionReady(p, { versionId: v2, siteUrl: "https://v2.example" }, T).project;
    expect(() => cancelBuild(shipped, { versionId: v2 }, T)).toThrow(/not being built/);
  });

  it("will not delete a building version that somehow has an address", () => {
    // Defence in depth: no current path makes one, and if a later one does,
    // deleting somebody's reviewable work on a button press is unforgivable.
    const { p, v2 } = building();
    const odd = { ...p, versions: p.versions.map((v) => (v.id === v2 ? { ...v, siteUrl: "https://v2.example" } : v)) };
    expect(() => cancelBuild(odd, { versionId: v2 }, T)).toThrow(/already has an address/);
  });
});

describe("remembering why a build did not start", () => {
  function approved() {
    let p = createProject({ name: "Glow Spa", siteUrl: "glowspa.vercel.app", repo: "o/r" }, T);
    p = addRequest(p, { versionId: p.versions[0].id, text: "bigger logo" }, T).project;
    const sent = sendToJarvis(p, p.versions[0].id, T);
    const out = approveBatch(sent.project, { batchId: sent.batch.id }, T);
    return { p: out.project, batchId: sent.batch.id };
  }

  it("keeps the reason on the batch, where a toast could not", () => {
    const { p, batchId } = approved();
    const out = noteBuildFailure(p, { batchId, message: "Jarvis's PC helper isn't running." }, T);
    expect(out.batches.find((b) => b.id === batchId)!.buildError).toEqual({
      at: T,
      message: "Jarvis's PC helper isn't running.",
    });
  });

  it("never leaves an empty reason, because that is the one thing nobody can act on", () => {
    const { p, batchId } = approved();
    expect(noteBuildFailure(p, { batchId, message: "   " }, T).batches[0].buildError!.message).toMatch(/said nothing/);
    expect(noteBuildFailure(p, { batchId, message: 42 }, T).batches[0].buildError!.message).toMatch(/said nothing/);
  });

  it("does not throw on a batch that is gone — the caller is already failing", () => {
    const { p } = approved();
    expect(() => noteBuildFailure(p, { batchId: "bat_nope", message: "x" }, T)).not.toThrow();
  });

  it("clears itself the moment a build really starts", () => {
    const { p, batchId } = approved();
    const failed = noteBuildFailure(p, { batchId, message: "no PC" }, T);
    const started = noteBuild(failed, { batchId, builderId: "ab_1", threadId: "th_1" }, T);
    const b = started.batches.find((x) => x.id === batchId)!;
    expect(b.buildError).toBeUndefined();
    expect(b.build?.threadId).toBe("th_1");
  });

  it("is dropped with the version when the build is cancelled", () => {
    const { p, batchId } = approved();
    const failed = noteBuildFailure(p, { batchId, message: "no PC" }, T);
    const v2 = failed.versions.find((v) => v.status === "building")!.id;
    const back = cancelBuild(failed, { versionId: v2 }, T).project;
    expect(back.batches.find((x) => x.id === batchId)!.status).toBe("pending");
  });
});
