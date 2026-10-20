import { describe, expect, it } from "vitest";
import { addRequest, approveBatch, createProject, reviewRequest, sendToJarvis } from "../client-review/logic";
import type { ClientProject } from "../client-review/types";
import { clientEditProject, editQueueText, pinText } from "./clientEdit";
import { applyOps, checklistLines, masterPrompt, pipeline, queueText, QUEUE_LIMIT } from "./engine";

const T = "2026-10-20T04:00:00.000Z";

function approvedReview(extra: Partial<Parameters<typeof createProject>[0]> = {}, texts = ["make the logo bigger", "pink buttons pls"]) {
  let p: ClientProject = createProject(
    { name: "Glow Spa", clientName: "Dana", siteUrl: "glowspa.vercel.app", repo: "legacymiles/glow-spa-site", ...extra },
    T,
  );
  const v1 = p.versions[0].id;
  texts.forEach((text, i) => {
    p = addRequest(p, { versionId: v1, text, pin: i === 0 ? { x: 0.12, y: 0.06, viewport: 390 } : undefined }, T).project;
  });
  const sent = sendToJarvis(p, v1, T);
  p = reviewRequest(sent.project, { id: p.requests[1]?.id, adminText: texts.length > 1 ? "Make the primary buttons blush pink (#F4C2C2)" : undefined }, T);
  const out = approveBatch(p, { batchId: sent.batch.id, brief: "Two small visual edits on the home page." }, T);
  return { review: out.project, batchId: sent.batch.id, version: out.version };
}

describe("Client Review → App Builder edit mode", () => {
  it("turns an approved batch into a ready-to-build project, every edit accepted", () => {
    const { review, batchId, version } = approvedReview();
    const p = clientEditProject(review, batchId, new Date(T), "ab_test");
    expect(p.stage).toBe("features");
    expect(p.origin).toBe("client-review");
    expect(p.features.map((f) => f.status)).toEqual(["accepted", "accepted"]);
    expect(p.features.every((f) => f.source === "you")).toBe(true);
    // The owner's rewording is what gets built; the client's words are kept beside it.
    expect(p.features[1].detail).toContain("blush pink");
    expect(p.features[1].why).toContain("pink buttons pls");
    expect(p.features[0].detail).toContain("12% across, 6% down");
    expect(p.edit).toMatchObject({
      reviewId: review.id,
      batchId,
      versionId: version.id,
      version: "v2",
      fromVersion: "v1",
      fromUrl: "https://glowspa.vercel.app/",
      repo: "legacymiles/glow-spa-site",
      baseBranch: "main",
      branch: "jarvis/glow-spa-v2",
    });
    expect(p.understanding?.appType).toBe("website");
  });

  it("refuses batches that can't be built", () => {
    const { review, batchId } = approvedReview();
    expect(() => clientEditProject(review, "bat_nope")).toThrow(/no longer exists/);
    let pending = createProject({ name: "X", siteUrl: "x.com" }, T);
    pending = addRequest(pending, { versionId: pending.versions[0].id, text: "a" }, T).project;
    const sent = sendToJarvis(pending, pending.versions[0].id, T);
    expect(() => clientEditProject(sent.project, sent.batch.id)).toThrow(/Approve/);
    const shipped = { ...review, versions: review.versions.map((v) => ({ ...v, status: "review" as const })) };
    expect(() => clientEditProject(shipped, batchId)).toThrow(/isn't being built/);
  });

  it("hands Claude Code everything it needs to build and post back, under the queue limit", () => {
    const { review, batchId, version } = approvedReview();
    const p = clientEditProject(review, batchId, new Date(T));
    const text = queueText(p);
    expect(text.length).toBeLessThanOrEqual(QUEUE_LIMIT);
    expect(text).toMatch(/^Client edit/);
    expect(text).toContain("Repo: legacymiles/glow-spa-site");
    expect(text).toContain("Branch: jarvis/glow-spa-v2 off main");
    expect(text).toContain(`review_id=${review.id}`);
    expect(text).toContain(`version_id=${version.id}`);
    expect(text).toContain("client_review_preview");
    expect(text).toContain("Never merge");
    expect(text).toContain("felix → prompt-enhancer");
    expect(text).toContain("blush pink");
    expect(text).toContain("on a 390px-wide screen");
  });

  it("stays under the limit with a huge batch, keeping the ids and the finish steps", () => {
    const many = Array.from({ length: 40 }, (_, i) => `Edit number ${i + 1}: ${"change the hero copy to something warmer and more local ".repeat(6)}`);
    const { review, batchId } = approvedReview({}, many);
    const text = editQueueText(clientEditProject(review, batchId));
    expect(text.length).toBeLessThanOrEqual(QUEUE_LIMIT);
    expect(text).toContain(`review_id=${review.id}`);
    expect(text).toContain("queue_complete");
  });

  it("tells Claude Code to stop and ask when the repo isn't set", () => {
    const { review, batchId } = approvedReview({ repo: undefined });
    const text = queueText(clientEditProject(review, batchId));
    expect(text).toContain("Repo: NOT SET");
  });

  it("follows the owner's changes in App Builder", () => {
    const { review, batchId } = approvedReview();
    const p = clientEditProject(review, batchId);
    const changed = {
      ...p,
      features: applyOps(p.features, [{ op: "deny", id: "f1" }, { op: "add", feature: { title: "Fix the footer year", detail: "Footer says 2025; make it the current year" } }]).features,
    };
    const text = queueText(changed);
    expect(text).not.toMatch(/^\d+\. make the logo bigger/im);
    expect(text).toMatch(/^1\. Make the primary buttons blush pink/m);
    expect(text).toContain("Left out by the owner");
    expect(text).toContain("Footer says 2025");
  });

  it("writes an edit-shaped master prompt, pipeline and checklist", () => {
    const { review, batchId } = approvedReview();
    const p = clientEditProject(review, batchId);
    const prompt = masterPrompt(p);
    expect(prompt).toContain("<edits>");
    expect(prompt).toContain("The client wrote: “pink buttons pls”");
    expect(prompt).toContain("Never merge or push to main");
    expect(pipeline(p.understanding!, null, false, true).map((s) => s.skill)).toEqual([
      "felix",
      "prompt-enhancer",
      "interactive-web-studio",
      "software-factory",
      "claude-security",
      "website-build-checklist",
    ]);
    expect(checklistLines(p).map((c) => c.id)).toEqual(expect.arrayContaining(["R1", "U1", "P1", "C4"]));
  });

  it("describes a pin in words", () => {
    expect(pinText({ x: 0.5, y: 0.25, viewport: 1280 })).toBe("pinned 50% across, 25% down the visible screen on a 1280px-wide screen");
    expect(pinText(undefined)).toBe("");
  });
});
