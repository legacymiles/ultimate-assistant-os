import { describe, expect, it } from "vitest";
import { buildingRows, READY_WINDOW_MS, waitedFor } from "./building";
import { addRequest, approveBatch, createProject, markVersionReady, noteBuild, noteBuildFailure, sendToJarvis } from "./logic";
import type { ClientProject } from "./types";

const T = "2026-10-20T04:00:00.000Z";
const NOW = Date.parse("2026-10-20T04:10:00.000Z");

/** A project whose v2 is being built. */
function building(name = "Glow Spa"): { p: ClientProject; batchId: string; v2: string } {
  let p = createProject({ name, siteUrl: `${name.toLowerCase().replace(/\W+/g, "")}.vercel.app`, repo: "o/r" }, T);
  p = addRequest(p, { versionId: p.versions[0].id, text: "make the logo bigger" }, T).project;
  const sent = sendToJarvis(p, p.versions[0].id, T);
  const out = approveBatch(sent.project, { batchId: sent.batch.id }, T);
  return { p: out.project, batchId: sent.batch.id, v2: out.version.id };
}

describe("what is being built", () => {
  it("lists a project whose next version is still being made", () => {
    const { p } = building();
    const rows = buildingRows([p], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ token: p.token, name: "Glow Spa", version: "v2", state: "building" });
    expect(rows[0].summary).toContain("logo bigger");
    expect(rows[0].siteUrl).toBeUndefined();
  });

  it("says nothing about a project that is just sitting there", () => {
    const quiet = createProject({ name: "Quiet", siteUrl: "quiet.example" }, T);
    expect(buildingRows([quiet], NOW)).toEqual([]);
  });

  it("keeps a finished build on screen for a while, with the address to open", () => {
    const { p, v2 } = building();
    const done = markVersionReady(p, { versionId: v2, siteUrl: "https://v2.example" }, new Date(NOW).toISOString()).project;
    const rows = buildingRows([done], NOW + 1_000);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "ready", version: "v2", siteUrl: "https://v2.example/" });
  });

  it("lets it go once the window has passed, so the screen does not keep old news", () => {
    const { p, v2 } = building();
    const done = markVersionReady(p, { versionId: v2, siteUrl: "https://v2.example" }, new Date(NOW).toISOString()).project;
    expect(buildingRows([done], NOW + READY_WINDOW_MS + 1)).toEqual([]);
  });

  it("puts the one that just finished above the ones still going", () => {
    const a = building("Alpha");
    const b = building("Beta");
    const doneB = markVersionReady(b.p, { versionId: b.v2, siteUrl: "https://b.example" }, new Date(NOW).toISOString()).project;
    const rows = buildingRows([a.p, doneB], NOW + 500);
    expect(rows.map((r) => r.state)).toEqual(["ready", "building"]);
    expect(rows[0].name).toBe("Beta");
  });

  it("leaves archived projects out", () => {
    const { p } = building();
    expect(buildingRows([{ ...p, archived: true }], NOW)).toEqual([]);
  });

  it("carries the app route, so an app row can say where it lands", () => {
    const { p } = building();
    const asApp = { ...p, appSlug: "money-agent-studio", appPath: "/apps/money-agent-studio" };
    expect(buildingRows([asApp], NOW)[0]).toMatchObject({
      appSlug: "money-agent-studio",
      appPath: "/apps/money-agent-studio",
    });
  });
});

describe("how long it has been", () => {
  it("talks in minutes and hours, never in milliseconds", () => {
    const now = Date.parse(T);
    expect(waitedFor(T, now)).toBe("just started");
    expect(waitedFor(T, now + 4 * 60_000)).toBe("4 min");
    expect(waitedFor(T, now + 90 * 60_000)).toBe("1h 30m");
    expect(waitedFor(T, now + 120 * 60_000)).toBe("2h");
  });

  it("does not say a negative number when the clocks disagree", () => {
    expect(waitedFor(T, Date.parse(T) - 5_000)).toBe("just now");
    expect(waitedFor("not a date")).toBe("just now");
  });
});

describe("a build that is stuck rather than slow", () => {
  it("carries the reason, so the screen can say nothing is running", () => {
    const { p, batchId } = building();
    const failed = noteBuildFailure(p, { batchId, message: "Jarvis's PC helper isn't running." }, T);
    const row = buildingRows([failed], NOW)[0];
    expect(row.threadId).toBeUndefined();
    expect(row.error?.message).toContain("PC helper isn't running");
  });

  it("drops the reason once a thread is really running", () => {
    const { p, batchId } = building();
    const failed = noteBuildFailure(p, { batchId, message: "no PC" }, T);
    const started = noteBuild(failed, { batchId, builderId: "ab_1", threadId: "th_7" }, T);
    const row = buildingRows([started], NOW)[0];
    expect(row.threadId).toBe("th_7");
    expect(row.error).toBeUndefined();
  });
});
