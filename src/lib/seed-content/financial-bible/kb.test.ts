import { describe, expect, it } from "vitest";
import type { Project } from "../../types";
import { CHEAT_SHEETS, COURSES, LENDERS, LESSONS, MISTAKES, TIPS } from "./index";
import { FINANCIAL_BIBLE_SLUG, fundingKnowledge, topUpFundingKnowledge } from "./timeline";
import { search } from "../../bible/funding/search";

describe("funding knowledge base", () => {
  it("indexes every lesson in all four courses", () => {
    for (const [id, c] of Object.entries(COURSES)) {
      const ns = LESSONS.filter((l) => l.course === id).map((l) => l.n);
      expect(ns.length).toBe(c.lessons);
      expect(new Set(ns).size).toBe(c.lessons);
    }
  });

  it("has unique lender ids and a source on every fact", () => {
    expect(new Set(LENDERS.map((l) => l.id)).size).toBe(LENDERS.length);
    for (const x of [...LENDERS, ...TIPS, ...MISTAKES, ...CHEAT_SHEETS]) expect(x.src.length).toBeGreaterThan(0);
  });

  it("finds things across kinds with one search", () => {
    expect(search("5/24")[0]?.id).toBe("chase");
    expect(search("statement date").some((h) => h.id === "statement-date")).toBe(true);
    expect(search("navy federal").some((h) => h.kind === "lender")).toBe(true);
    expect(search("")).toEqual([]);
  });
});

describe("Projects Timeline top-up", () => {
  const project = (knowledge: Project["knowledge"] = []): Project => ({
    id: "p1",
    catalog_slug: FINANCIAL_BIBLE_SLUG,
    name: "Financial Bible",
    one_liner: "",
    overview: "",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    features: [],
    versions: [],
    knowledge,
  });

  it("adds every entry once and is idempotent", () => {
    const ps = [project()];
    expect(topUpFundingKnowledge(ps)).toBe(true);
    const n = ps[0].knowledge.length;
    expect(n).toBe(fundingKnowledge("p1").length);
    expect(topUpFundingKnowledge(ps)).toBe(false);
    expect(ps[0].knowledge.length).toBe(n);
  });

  it("never touches the owner's own entries or other projects", () => {
    const mine = { id: "k1", project_id: "p1", kind: "note" as const, title: "My note", content: "keep", created_at: "x" };
    const other = { ...project(), id: "p2", catalog_slug: "dump-finder" };
    const ps = [project([mine]), other];
    topUpFundingKnowledge(ps);
    expect(ps[0].knowledge[0]).toEqual(mine);
    expect(ps[1].knowledge).toEqual([]);
  });
});
