import { describe, it, expect } from "vitest";
import { overlayAppEdits, recentEditsDigest, editsBySlug, APP_EDITS } from "./appEdits";
import type { AppEditEntry, Project } from "../types";

const edit = (id: string, slug: string, date: string, title = id): AppEditEntry =>
  ({ id, slug, date, title, detail: "", group: "supporting" });
const project = (over: Partial<Project>): Project => ({
  id: "p1", name: "X", one_liner: "", overview: "", created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z", features: [], versions: [], knowledge: [], ...over,
});
const catalog = [
  { slug: "cook-connect", title: "Cook Connect", tag: "Cook together", overview: "o" },
  { slug: "jarvis", title: "Jarvis", tag: "", overview: "" },
];

describe("app edits in the timeline", () => {
  it("never leaves the timeline empty: every app shows up even with nothing saved", () => {
    const out = overlayAppEdits([], [edit("a:cook-connect", "cook-connect", "2026-10-19")], catalog);
    expect(out.map((p) => p.id).sort()).toEqual(["catalog:cook-connect", "catalog:jarvis"]);
    const cc = out.find((p) => p.id === "catalog:cook-connect")!;
    expect(cc.virtual).toBe(true);
    expect(cc.edits).toHaveLength(1);
    expect(cc.activity_at?.startsWith("2026-10-19")).toBe(true);
  });

  it("attaches edits to a saved project, matched by slug or by name", () => {
    const saved = [project({ id: "s1", name: "cook connect" })];
    const out = overlayAppEdits(saved, [edit("a", "cook-connect", "2026-10-19"), edit("b", "cook-connect", "2026-10-01")], catalog);
    const cc = out.find((p) => p.id === "s1")!;
    expect(cc.edits?.map((e) => e.id)).toEqual(["a", "b"]); // newest first
    expect(cc.catalog_slug).toBe("cook-connect");
    expect(out.some((p) => p.id === "catalog:cook-connect")).toBe(false);
  });

  it("orders by the latest app edit, not by when a project was first seeded", () => {
    const seeded = project({ id: "s1", name: "Jarvis", created_at: "2026-10-20T09:00:00Z", updated_at: "2026-10-20T09:00:00Z" });
    const hand = project({ id: "s2", name: "Cook Connect", created_at: "2026-07-01T00:00:00Z", updated_at: "2026-10-21T00:00:00Z" });
    const out = overlayAppEdits([seeded, hand], [edit("a", "jarvis", "2026-09-01"), edit("b", "cook-connect", "2026-08-01")], catalog);
    expect(out.find((p) => p.id === "s1")!.activity_at!.startsWith("2026-09-01")).toBe(true);
    expect(out[0].id).toBe("s2"); // edited by hand after the last app edit
  });

  it("puts the most recently edited app at the top", () => {
    const out = overlayAppEdits([], [edit("a", "jarvis", "2026-10-20"), edit("b", "cook-connect", "2026-09-01")], catalog);
    expect(out[0].id).toBe("catalog:jarvis");
  });

  it("writes a digest Jarvis can learn from, one line per change", () => {
    const d = recentEditsDigest([
      edit("x:jarvis", "jarvis", "2026-10-20", "Renege rule"),
      edit("x:cook-connect", "jarvis", "2026-10-20", "Renege rule"),
      edit("y", "cook-connect", "2026-10-19", "Trump steal"),
    ], 10, { jarvis: "Jarvis", "cook-connect": "Cook Connect" });
    expect(d.split("\n")).toEqual(["- 2026-10-20 · Jarvis: Renege rule", "- 2026-10-19 · Cook Connect: Trump steal"]);
  });

  it("ships a real log from git, newest first, with unique ids", () => {
    expect(APP_EDITS.length).toBeGreaterThan(100);
    expect(new Set(APP_EDITS.map((e) => e.id)).size).toBe(APP_EDITS.length);
    expect(editsBySlug(APP_EDITS).get("cook-connect")?.length).toBeGreaterThan(0);
  });
});
