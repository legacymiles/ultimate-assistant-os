import { describe, expect, it } from "vitest";
import type { Folder, RecallData } from "./types";
import { folderDeleteImpact, wouldCycle } from "./store";

const FOLDERS = [
  { id: "f_fx", name: "trading fx", parentId: null },
  { id: "f_vps", name: "vps 2026", parentId: "f_fx" },
] as unknown as Folder[];

describe("wouldCycle", () => {
  it("allows moving a folder to the top level", () => {
    expect(wouldCycle(FOLDERS, "f_vps", null)).toBe(false);
  });

  it("refuses moving a folder into its own descendant", () => {
    expect(wouldCycle(FOLDERS, "f_fx", "f_vps")).toBe(true);
  });

  it("refuses moving a folder into itself", () => {
    expect(wouldCycle(FOLDERS, "f_fx", "f_fx")).toBe(true);
  });
});

describe("folderDeleteImpact", () => {
  const data = {
    folders: [
      ...FOLDERS,
      { id: "f_logs", name: "logs", parentId: "f_vps" },
      { id: "f_other", name: "other", parentId: null },
    ],
    items: [
      { id: "i1", folderId: "f_fx" },
      { id: "i2", folderId: "f_logs" },
      { id: "i3", folderId: "f_other" },
      { id: "i4", folderId: null },
    ],
  } as unknown as RecallData;

  it("counts every nested subfolder and the items inside them", () => {
    expect(folderDeleteImpact(data, "f_fx")).toEqual({ subfolders: 2, items: 2 });
  });

  it("leaves sibling folders and unfiled items out", () => {
    expect(folderDeleteImpact(data, "f_other")).toEqual({ subfolders: 0, items: 1 });
  });
});
