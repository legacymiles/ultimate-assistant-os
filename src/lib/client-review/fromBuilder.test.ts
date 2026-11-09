import { describe, expect, it } from "vitest";
import { addVersion, builderProject, portalView, ReviewError, shipPreview } from "./logic";

const T = "2026-11-01T10:00:00.000Z";
const LATER = "2026-11-01T13:00:00.000Z";

/** The other direction of the App Builder hand-off: a new app on its way here. */
describe("a review link opened by App Builder", () => {
  it("opens v1 as building, with no address yet", () => {
    const { project, version } = builderProject({ name: "WalkBook", clientName: "Sam", summary: "WalkBook — book a trusted dog walker\n\n• Booking\n• Payouts" }, T);
    expect(version.number).toBe("v1");
    expect(version.status).toBe("building");
    expect(version.siteUrl).toBe("");
    expect(version.readyAt).toBeUndefined();
    expect(version.summary).toContain("Booking");
    expect(project.token).toMatch(/^[a-z0-9]{16,40}$/);
  });

  it("accepts the finished build from the connector and puts it on the link", () => {
    const { project, version } = builderProject({ name: "WalkBook", clientName: "Sam" }, T);
    const out = shipPreview(
      project,
      { versionId: version.id, siteUrl: "walkbook.vercel.app", prUrl: "https://github.com/me/walkbook/pull/1", branch: "main", summary: "• Booking" },
      LATER,
    );
    expect(out.already).toBe(false);
    expect(out.version.siteUrl).toBe("https://walkbook.vercel.app/");
    expect(out.version.status).toBe("review");
    expect(out.version.shippedBy).toBe("claude-code");
    expect(out.version.readyAt).toBe(LATER);
    // And the reviewer is told, so nobody pastes a link by hand.
    expect(out.project.notices.at(-1)?.title).toBeTruthy();
  });

  it("lets the reviewer frame it and ask for edits once it has shipped", () => {
    const { project, version } = builderProject({ name: "WalkBook" }, T);
    const shipped = shipPreview(project, { versionId: version.id, siteUrl: "walkbook.vercel.app" }, LATER).project;
    const view = portalView(shipped, null);
    expect(view.versions[0].siteUrl).toContain("walkbook");
    expect(view.versions[0].status).toBe("review");
  });

  it("refuses a second build's preview once a newer version is being built", () => {
    const { project, version } = builderProject({ name: "WalkBook" }, T);
    // Build it again: a v2 opens and v1 is superseded.
    const next = addVersion(project, { summary: "second go", ready: false }, LATER);
    expect(next.version.number).toBe("v2");
    expect(next.version.status).toBe("building");
    expect(() => shipPreview(next.project, { versionId: version.id, siteUrl: "old.vercel.app" }, LATER)).toThrow(ReviewError);
  });

  it("takes the same preview twice without making a second version", () => {
    const { project, version } = builderProject({ name: "WalkBook" }, T);
    const first = shipPreview(project, { versionId: version.id, siteUrl: "walkbook.vercel.app" }, LATER);
    const again = shipPreview(first.project, { versionId: version.id, siteUrl: "https://walkbook.vercel.app/" }, LATER);
    expect(again.already).toBe(true);
    expect(again.project.versions).toHaveLength(1);
  });
});
