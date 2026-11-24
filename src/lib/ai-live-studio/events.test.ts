import { describe, expect, it } from "vitest";
import { parseEvent } from "./events";

describe("parseEvent", () => {
  it("reads a comment", () => {
    expect(parseEvent({ type: "comment", handle: "ana", user: "Ana", text: "hi there" }, 1000)).toMatchObject({
      kind: "comment",
      handle: "ana",
      user: "Ana",
      text: "hi there",
      ts: 1000,
    });
  });

  it("keeps the event's own timestamp when it has one", () => {
    expect(parseEvent({ type: "comment", handle: "a", user: "A", text: "x", ts: 42 }, 1000)?.ts).toBe(42);
  });

  it("falls back to the handle when there is no display name", () => {
    expect(parseEvent({ type: "comment", handle: "ana", text: "hi" }, 0)?.user).toBe("ana");
  });

  it("rejects an unknown kind", () => {
    expect(parseEvent({ type: "battle", handle: "a", text: "x" }, 0)).toBeNull();
  });

  it("rejects a comment with no text", () => {
    expect(parseEvent({ type: "comment", handle: "a", text: "   " }, 0)).toBeNull();
  });

  it("rejects anything that is not an object", () => {
    expect(parseEvent("nope", 0)).toBeNull();
    expect(parseEvent(null, 0)).toBeNull();
  });

  it("allows a gift and a follow with no text", () => {
    expect(parseEvent({ type: "gift", handle: "a", user: "A" }, 5)).toMatchObject({ kind: "gift", text: "", ts: 5 });
    expect(parseEvent({ type: "follow", handle: "b" }, 5)).toMatchObject({ kind: "follow", user: "b" });
  });

  it("trims and caps very long text", () => {
    expect(parseEvent({ type: "comment", handle: "a", text: "  " + "x".repeat(400) }, 0)?.text.length).toBe(280);
  });

  it("gives the same comment the same id, so a duplicate is detectable", () => {
    const raw = { type: "comment", handle: "a", text: "same", ts: 7 };
    expect(parseEvent(raw, 0)?.id).toBe(parseEvent(raw, 99)?.id);
  });

  it("prefers the platform's own id", () => {
    expect(parseEvent({ type: "comment", handle: "a", text: "x", id: "msg-9" }, 0)?.id).toBe("msg-9");
  });

  it("keeps only https avatars", () => {
    expect(parseEvent({ type: "comment", handle: "a", text: "x", avatar: "https://p.tiktok/x.jpg" }, 0)?.avatar).toBe(
      "https://p.tiktok/x.jpg",
    );
    expect(parseEvent({ type: "comment", handle: "a", text: "x", avatar: "javascript:alert(1)" }, 0)?.avatar).toBeUndefined();
  });
});
