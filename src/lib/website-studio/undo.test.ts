import { describe, expect, it } from "vitest";
import type { ReviewVersion } from "@/lib/client-review/types";
import { revertBrief, sameAddress, shotFor, undoPlan } from "./undo";

const LIVE = "https://bighomieai.com/apps/baby-no-scroll";
function v(number: string, extra: Partial<ReviewVersion> = {}): ReviewVersion {
  return {
    id: number,
    number,
    siteUrl: LIVE,
    summary: "",
    status: "superseded",
    createdAt: "2026-11-15T00:00:00Z",
    ...extra,
  };
}

describe("going back to an earlier version", () => {
  it("takes every newer edit at the same address off main, newest first", () => {
    const versions = [
      v("v1"),
      v("v2", { prUrl: "https://github.com/a/b/pull/27" }),
      v("v3", { prUrl: "https://github.com/a/b/pull/29", status: "review" }),
    ];
    const plan = undoPlan(versions, "v1")!;
    expect(plan.blocked).toBeUndefined();
    expect(plan.codeChange).toBe(true);
    expect(plan.reverts.map((r) => r.number)).toEqual(["v3", "v2"]);
    expect(plan.says).toContain("about 3 minutes");
  });

  it("only moves the link when each version has its own address", () => {
    const versions = [
      v("v1", { siteUrl: "https://x-git-a.vercel.app" }),
      v("v2", { siteUrl: "https://x-git-b.vercel.app" }),
    ];
    const plan = undoPlan(versions, "v1")!;
    expect(plan.codeChange).toBe(false);
    expect(plan.reverts).toEqual([]);
    expect(plan.says).toMatch(/link shows v1/);
  });

  it("refuses rather than pretending, when a newer edit has no pull request", () => {
    const plan = undoPlan([v("v1"), v("v2")], "v1")!;
    expect(plan.blocked).toMatch(/v2 has no pull request/);
  });

  it("waits for a running build", () => {
    const plan = undoPlan(
      [v("v1"), v("v2", { status: "building", siteUrl: "" })],
      "v1",
    )!;
    expect(plan.blocked).toMatch(/build is running/);
  });

  it("treats a trailing slash or query as the same page", () => {
    expect(
      sameAddress(`${LIVE}/`, "http://bighomieai.com/apps/baby-no-scroll?x=1"),
    ).toBe(true);
    expect(sameAddress("", "")).toBe(false);
    // A hub app's v1 is stored as its route, later versions as the live address.
    expect(sameAddress("/apps/baby-no-scroll", LIVE)).toBe(true);
    expect(
      sameAddress("/apps/baby-no-scroll", "https://bighomieai.com/apps/jarvis"),
    ).toBe(false);
    expect(
      sameAddress(
        "https://x-git-a.vercel.app/apps/a",
        "https://bighomieai.com/apps/a",
      ),
    ).toBe(false);
  });
});

describe("the picture beside each version", () => {
  it("uses its own picture, else the next version's before picture", () => {
    const versions = [
      v("v1"),
      v("v2", { beforeImage: "data:before-v2", image: "data:v2" }),
      v("v3", { beforeImage: "data:before-v3" }),
    ];
    expect(shotFor(versions, versions[0])).toBe("data:before-v2");
    expect(shotFor(versions, versions[1])).toBe("data:v2");
    expect(shotFor(versions, versions[2])).toBe("");
  });
});

describe("the PC's undo brief", () => {
  it("reverts newest first and ends on the two lines the Studio reads", () => {
    const plan = undoPlan(
      [v("v1"), v("v2", { prUrl: "https://github.com/a/b/pull/7" })],
      "v1",
    )!;
    const brief = revertBrief(plan, LIVE);
    expect(brief).toContain("git revert --no-edit");
    expect(brief).toContain("https://github.com/a/b/pull/7");
    expect(brief).toContain(`Preview: ${LIVE}`);
  });
});
