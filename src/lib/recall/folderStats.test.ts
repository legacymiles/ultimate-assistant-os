import { describe, expect, it } from "vitest";
import type { Folder, Item } from "./types";
import { folderSummary, libraryStats, relTime, subtreeIds } from "./folderStats";

const folders = [
  { id: "tr", name: "Trading FX", parentId: null, createdAt: "2026-10-01T00:00:00Z" },
  { id: "gold", name: "Gold Strategies", parentId: "tr", createdAt: "2026-10-02T00:00:00Z" },
  { id: "lon", name: "London Open", parentId: "gold", createdAt: "2026-10-03T00:00:00Z" },
  { id: "cx", name: "Coinexx Broker Logins", parentId: "tr", createdAt: "2026-10-02T00:00:00Z" },
  { id: "empty", name: "Empty", parentId: null, createdAt: "2026-09-01T00:00:00Z" },
] as unknown as Folder[];

const mk = (id: string, kind: string, folderId: string | null, updatedAt: string) =>
  ({ id, kind, folderId, title: id, createdAt: updatedAt, updatedAt }) as unknown as Item;

const items = [
  mk("a", "note", "tr", "2026-11-01T00:00:00Z"),
  mk("b", "note", "gold", "2026-11-20T00:00:00Z"),
  mk("c", "file", "lon", "2026-11-24T00:00:00Z"),
  mk("d", "credential", "cx", "2026-11-10T00:00:00Z"),
  mk("e", "image", "lon", "2026-11-05T00:00:00Z"),
  mk("f", "note", null, "2026-11-25T00:00:00Z"),
];

describe("folderSummary", () => {
  it("counts everything nested under a folder, by kind, newest first", () => {
    const s = folderSummary(folders, items, "tr");
    expect(s.total).toBe(5);
    expect(s.kinds).toEqual([
      { bucket: "notes", count: 2 },
      { bucket: "files", count: 2 },
      { bucket: "logins", count: 1 },
    ]);
    expect(s.subs.map((f) => f.name)).toEqual(["Coinexx Broker Logins", "Gold Strategies"]);
    expect(s.latest?.id).toBe("c");
    expect(s.updatedAt).toBe("2026-11-24T00:00:00Z");
  });
  it("falls back to the folder's creation for an empty folder", () => {
    const s = folderSummary(folders, items, "empty");
    expect(s.total).toBe(0);
    expect(s.latest).toBeNull();
    expect(s.updatedAt).toBe("2026-09-01T00:00:00Z");
  });
});

describe("subtreeIds", () => {
  it("walks every level and survives a cycle", () => {
    const loop = [...folders, { id: "x", name: "x", parentId: "y" }, { id: "y", name: "y", parentId: "x" }] as unknown as Folder[];
    expect([...subtreeIds(folders, "tr")].sort()).toEqual(["cx", "gold", "lon", "tr"]);
    expect([...subtreeIds(loop, "x")].sort()).toEqual(["x", "y"]);
  });
});

describe("libraryStats", () => {
  it("reports items, folders and the deepest nesting", () => {
    expect(libraryStats(folders, items)).toEqual({ items: 6, folders: 5, depth: 3 });
  });
});

describe("relTime", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  it("reads like a person", () => {
    expect(relTime("2026-11-25T11:42:00Z", now)).toBe("18 min ago");
    expect(relTime("2026-11-25T09:00:00Z", now)).toBe("3 h ago");
    expect(relTime("2026-11-24T10:00:00Z", now)).toBe("yesterday");
    expect(relTime("2026-11-21T12:00:00Z", now)).toBe("4 days ago");
    expect(relTime(null, now)).toBe("");
  });
});
