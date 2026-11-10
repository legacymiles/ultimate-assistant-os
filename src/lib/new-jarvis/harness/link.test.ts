import { describe, expect, it } from "vitest";
import { harnessFromHash, harnessHref } from "./link";

describe("harness links", () => {
  it("addresses the thread viewer", () => {
    expect(harnessHref()).toBe("/apps/jarvis#harness");
    expect(harnessHref("th_123")).toBe("/apps/jarvis#harness/th_123");
    expect(harnessHref(" th_123 ")).toBe("/apps/jarvis#harness/th_123");
  });

  it("reads its own links", () => {
    expect(harnessFromHash("#harness")).toEqual({ harness: true, threadId: "" });
    expect(harnessFromHash("#harness/th_123")).toEqual({ harness: true, threadId: "th_123" });
    expect(harnessFromHash("#console/harness/th_123")).toEqual({ harness: true, threadId: "th_123" });
    expect(harnessFromHash("#console")).toEqual({ harness: false, threadId: "" });
  });

  it("survives an id that needed escaping", () => {
    expect(harnessFromHash(harnessHref("th/1 2"))).toEqual({ harness: true, threadId: "th/1 2" });
  });
});
