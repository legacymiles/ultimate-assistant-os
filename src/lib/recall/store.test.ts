import { describe, expect, it } from "vitest";
import type { Folder } from "./types";
import { wouldCycle } from "./store";

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
