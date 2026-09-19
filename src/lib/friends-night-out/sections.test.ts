import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SECTIONS, isSectionId, sectionLabel } from "./sections";

describe("sections", () => {
  it("has the five approved sections in order", () => {
    expect(SECTIONS.map((s) => s.label)).toEqual([
      "Parks and outside",
      "Fun",
      "Unique gems",
      "Kids",
      "Food",
    ]);
  });

  it("validates ids", () => {
    expect(isSectionId("gems")).toBe(true);
    expect(isSectionId("nightlife")).toBe(false);
    expect(isSectionId(3)).toBe(false);
  });

  it("labels ids", () => {
    expect(sectionLabel("parks")).toBe("Parks and outside");
  });

  it("matches the database check constraint", () => {
    const sql = readFileSync(
      path.resolve(__dirname, "../../../supabase/migrations/20260919000000_fno_social.sql"),
      "utf8",
    );
    const m = sql.match(/section\s+text not null check \(section in \(([^)]*)\)\)/);
    expect(m).not.toBeNull();
    const dbIds = m![1].split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(dbIds).toEqual(SECTIONS.map((s) => s.id));
  });
});
