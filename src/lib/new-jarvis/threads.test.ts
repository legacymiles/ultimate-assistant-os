import { describe, expect, it } from "vitest";
import { adoptLegacy, EARLIER_THREAD, groupThreads, reviveThreads, titleFrom } from "./threads";
import { newBlock } from "./types";

describe("titleFrom", () => {
  it("keeps a short first line, minus trailing punctuation", () => {
    expect(titleFrom("what's on my calendar today?")).toBe("what's on my calendar today");
  });
  it("cuts a long one at a word", () => {
    const t = titleFrom("open my Vercel dashboard and tell me if the last deploy failed and why it failed");
    expect(t.endsWith("…")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(47);
    expect(t).not.toMatch(/\s…$/);
  });
  it("falls back for empty input", () => {
    expect(titleFrom("   ")).toBe("New chat");
  });
});

describe("adoptLegacy", () => {
  it("files loose blocks under Earlier chats", () => {
    const a = { ...newBlock({ command: "one", mode: "ask" }), createdAt: 100 };
    const b = { ...newBlock({ command: "two", mode: "ask" }), createdAt: 200, thread: "t_x" };
    const out = adoptLegacy([a, b], [{ id: "t_x", title: "x", createdAt: 150, updatedAt: 200 }]);
    expect(out.blocks[0].thread).toBe(EARLIER_THREAD);
    expect(out.blocks[1].thread).toBe("t_x");
    expect(out.threads.find((t) => t.id === EARLIER_THREAD)?.updatedAt).toBe(100);
  });
  it("changes nothing when every block has a thread", () => {
    const b = { ...newBlock({ command: "two", mode: "ask" }), thread: "t_x" };
    const threads = [{ id: "t_x", title: "x", createdAt: 1, updatedAt: 1 }];
    expect(adoptLegacy([b], threads).threads).toBe(threads);
  });
});

describe("groupThreads", () => {
  it("buckets by last activity, newest first", () => {
    const now = new Date(2026, 9, 17, 12).getTime();
    const g = groupThreads(
      [
        { id: "a", title: "a", createdAt: 0, updatedAt: now - 60_000 },
        { id: "b", title: "b", createdAt: 0, updatedAt: now - 26 * 3_600_000 },
        { id: "c", title: "c", createdAt: 0, updatedAt: now - 3 * 86_400_000 },
        { id: "d", title: "d", createdAt: 0, updatedAt: now - 30 * 86_400_000 },
        { id: "e", title: "e", createdAt: 0, updatedAt: now - 1_000 },
      ],
      now,
    );
    expect(g.map((x) => x.label)).toEqual(["Today", "Yesterday", "Previous 7 days", "Older"]);
    expect(g[0].items.map((t) => t.id)).toEqual(["e", "a"]);
  });
});

describe("reviveThreads", () => {
  it("drops junk and fills gaps", () => {
    expect(reviveThreads([null, { id: "t1" }, { title: "no id" }])).toEqual([
      expect.objectContaining({ id: "t1", title: "New chat" }),
    ]);
    expect(reviveThreads("nope")).toEqual([]);
  });
});
