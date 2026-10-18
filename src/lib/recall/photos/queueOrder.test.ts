import { describe, expect, it } from "vitest";
import { newestFirst } from "./queueOrder";

const p = (id: string, addedAt: string, takenAt?: string) => ({ id, addedAt, takenAt });

describe("newestFirst", () => {
  it("puts a just-arrived batch above photos already waiting", () => {
    const q = [
      p("old1", "2026-10-18T10:00:00Z", "2026-10-17T09:00:00Z"),
      p("old2", "2026-10-18T10:00:01Z", "2026-10-17T12:00:00Z"),
      p("new1", "2026-10-18T20:40:00Z", "2026-10-18T20:38:00Z"),
      p("new2", "2026-10-18T20:40:01Z", "2026-10-18T20:39:00Z"),
    ];
    expect(newestFirst(q).map((x) => x.id)).toEqual(["new2", "new1", "old2", "old1"]);
  });

  it("falls back to arrival time when the phone sent no date", () => {
    const q = [p("a", "2026-10-18T10:00:00Z"), p("b", "2026-10-18T11:00:00Z"), p("c", "2026-10-18T10:30:00Z", "2026-10-18T12:00:00Z")];
    expect(newestFirst(q).map((x) => x.id)).toEqual(["c", "b", "a"]);
  });

  it("breaks ties by arrival, newest on top, and leaves the input alone", () => {
    const q = [p("first", "2026-10-18T10:00:00Z", "2026-10-18T09:00:00Z"), p("second", "2026-10-18T10:00:05Z", "2026-10-18T09:00:00Z")];
    expect(newestFirst(q).map((x) => x.id)).toEqual(["second", "first"]);
    expect(q[0].id).toBe("first");
  });
});
