import { describe, expect, it } from "vitest";
import {
  addBackfill,
  addEvents,
  byMostUsed,
  callNames,
  cleanUsage,
  filterByUsage,
  lastUsedLabel,
  usageFor,
  usageKey,
  type UsageData,
} from "./usage";
import type { Skill } from "./types";

const NOW = Date.parse("2026-10-22T12:00:00Z");

const sk = (title: string, slug: string | null = title): Skill => ({
  id: title,
  title,
  overview: "",
  body: "",
  source: "claude-code",
  slug,
  origin: "Personal",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
});

describe("usageKey", () => {
  it("normalises call names", () => {
    expect(usageKey("/Felix ")).toBe("felix");
    expect(usageKey("superpowers:brainstorming")).toBe("superpowers:brainstorming");
    expect(usageKey("studio:kids-story")).toBe("studio:kids-story");
  });
  it("rejects junk", () => {
    expect(usageKey("")).toBe("");
    expect(usageKey("rm -rf /")).toBe("");
    expect(usageKey("x".repeat(200))).toBe("");
    expect(usageKey(null)).toBe("");
  });
});

describe("addEvents", () => {
  it("counts calls per skill and per source", () => {
    const d = cleanUsage({});
    const n = addEvents(
      d,
      [
        { skill: "felix", source: "claude-code", at: "2026-10-20T00:00:00Z" },
        { skill: "Felix", source: "connector", at: "2026-10-21T00:00:00Z" },
        { skill: "scholar", source: "claude-code" },
      ],
      NOW,
    );
    expect(n).toBe(3);
    expect(d.skills.felix.count).toBe(2);
    expect(d.skills.felix.by).toEqual({ "claude-code": 1, connector: 1 });
    expect(d.skills.felix.first).toBe("2026-10-20T00:00:00.000Z");
    expect(d.skills.felix.last).toBe("2026-10-21T00:00:00.000Z");
    expect(d.skills.scholar.last).toBe(new Date(NOW).toISOString());
  });

  it("never counts the same call id twice", () => {
    const d = cleanUsage({});
    addEvents(d, [{ skill: "felix", source: "claude-code", id: "toolu_1" }], NOW);
    expect(addEvents(d, [{ skill: "felix", source: "claude-code", id: "toolu_1" }], NOW)).toBe(0);
    expect(d.skills.felix.count).toBe(1);
  });

  it("drops bad sources and names, and future clocks become now", () => {
    const d = cleanUsage({});
    // @ts-expect-error — bad source on purpose
    expect(addEvents(d, [{ skill: "felix", source: "hacker" }, { skill: "a b", source: "jarvis" }], NOW)).toBe(0);
    addEvents(d, [{ skill: "felix", source: "jarvis", at: "2099-01-01T00:00:00Z" }], NOW);
    expect(d.skills.felix.last).toBe(new Date(NOW).toISOString());
  });
});

describe("addBackfill", () => {
  it("adds a machine's history once", () => {
    const d = cleanUsage({});
    addEvents(d, [{ skill: "felix", source: "connector", at: "2026-10-21T00:00:00Z" }], NOW);
    const r = addBackfill(d, "HONEY-PC", { felix: { count: 9, first: "2026-09-01T00:00:00Z", last: "2026-10-01T00:00:00Z" } }, NOW);
    expect(r).toEqual({ added: 9, already: false });
    expect(d.skills.felix.count).toBe(10);
    expect(d.skills.felix.by["claude-code"]).toBe(9);
    expect(d.skills.felix.first).toBe("2026-09-01T00:00:00.000Z");
    expect(d.skills.felix.last).toBe("2026-10-21T00:00:00.000Z");
    expect(addBackfill(d, "honey-pc", { felix: { count: 9 } }, NOW)).toEqual({ added: 0, already: true });
    expect(d.skills.felix.count).toBe(10);
  });
});

describe("reading it back", () => {
  const data: UsageData = cleanUsage({
    skills: {
      felix: { count: 12, first: "2026-10-01", last: "2026-10-20T00:00:00Z", by: { "claude-code": 12 } },
      "superpowers:brainstorming": { count: 3, first: "2026-10-01", last: "2026-10-21T00:00:00Z", by: {} },
      "studio:kids-story": { count: 3, first: "2026-10-01", last: "2026-10-10T00:00:00Z", by: { jarvis: 3 } },
      "scroll-world": { count: 1, first: "2026-10-01", last: "2026-10-01T00:00:00Z", by: {} },
    },
  });
  const felix = sk("felix");
  const brain = sk("brainstorming", "superpowers:brainstorming");
  const kids = sk("Kids Story", "studio:kids-story");
  const scroll = sk("scroll-world", "github:scroll-world");
  const never = sk("never-called");
  const all = [never, kids, scroll, felix, brain];

  it("finds a skill by slug, plugin name or title", () => {
    expect(callNames(brain)).toEqual(["superpowers:brainstorming", "brainstorming"]);
    expect(usageFor(felix, data)?.count).toBe(12);
    expect(usageFor(brain, data)?.count).toBe(3);
    expect(usageFor(kids, data)?.count).toBe(3);
    expect(usageFor(scroll, data)?.count).toBe(1);
    expect(usageFor(never, data)).toBeNull();
    expect(usageFor(felix, null)).toBeNull();
  });

  it("sorts most used first, ties by most recent", () => {
    expect(byMostUsed(all, data).map((s) => s.title)).toEqual(["felix", "brainstorming", "Kids Story", "scroll-world", "never-called"]);
  });

  it("filters used, never used and top 10", () => {
    expect(filterByUsage(all, "unused", data).map((s) => s.title)).toEqual(["never-called"]);
    expect(filterByUsage(all, "used", data)).toHaveLength(4);
    expect(filterByUsage(all, "top", data)[0].title).toBe("felix");
    expect(filterByUsage(all, "any", data)).toBe(all);
    // No data yet: everything counts as never used.
    expect(filterByUsage(all, "unused", null)).toHaveLength(5);
  });

  it("labels the last call", () => {
    expect(lastUsedLabel("2026-10-22T08:00:00Z", NOW)).toBe("used today");
    expect(lastUsedLabel("2026-10-21T08:00:00Z", NOW)).toBe("used yesterday");
    expect(lastUsedLabel("2026-10-12T08:00:00Z", NOW)).toBe("used 10 days ago");
  });
});
