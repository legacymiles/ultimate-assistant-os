import { describe, expect, it } from "vitest";
import { queueRequestText } from "./queueText";

describe("queueRequestText", () => {
  it("names the PC skill for a code-rendered workflow, then the brief", () => {
    const text = queueRequestText({ folder: "flow:animate-my-character", title: "Milo and the Lost Kite", brief: "BEATS: …" });
    expect(text.split("\n")[0]).toBe("Milo and the Lost Kite");
    expect(text).toContain("animate-character-story skill");
    expect(text.endsWith("BEATS: …")).toBe(true);
  });
  it("falls back to a plain title for other folders", () => {
    expect(queueRequestText({ folder: "flow:other" })).toBe("Studio job");
  });
});
