import { describe, expect, it } from "vitest";
import { parseAsk } from "./askEvent";

describe("parseAsk", () => {
  it("a string only fills the chat box", () => {
    expect(parseAsk("  plan my week ")).toEqual({ text: "plan my week", files: [], send: false });
  });

  it("a request keeps its files, send and mode", () => {
    const f = new File(["x"], "repo.jpg", { type: "image/jpeg" });
    const r = parseAsk({ text: "add this skill", files: [f, "nope"], send: true, mode: "do" });
    expect(r?.send).toBe(true);
    expect(r?.mode).toBe("do");
    expect(r?.files).toHaveLength(1);
  });

  it("rejects empty or junk", () => {
    expect(parseAsk("")).toBeNull();
    expect(parseAsk({ text: " " })).toBeNull();
    expect(parseAsk(42)).toBeNull();
    expect(parseAsk({ text: "x", mode: "sudo" })?.mode).toBeUndefined();
  });
});
