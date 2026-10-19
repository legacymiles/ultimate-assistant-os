import { describe, expect, it } from "vitest";
import { addedLabel, addedWithin, sortSkills } from "./sort";
import type { Skill } from "./types";

const sk = (title: string, createdAt: string, extra: Partial<Skill> = {}): Skill => ({
  id: title,
  title,
  overview: "",
  body: "",
  source: "claude-code",
  slug: title,
  origin: "Personal",
  createdAt,
  updatedAt: createdAt,
  ...extra,
});

const list = [
  sk("Bravo", "2026-10-01T00:00:00Z"),
  sk("alpha", "2026-10-18T00:00:00Z"),
  sk("Charlie", "2026-01-05T00:00:00Z", { updatedAt: "2026-10-17T00:00:00Z" }),
  sk("NoDate", ""),
];
const titles = (l: Skill[]) => l.map((s) => s.title);

describe("sortSkills", () => {
  it("newest and oldest by date added, undated always last", () => {
    expect(titles(sortSkills(list, "newest"))).toEqual(["alpha", "Bravo", "Charlie", "NoDate"]);
    expect(titles(sortSkills(list, "oldest"))).toEqual(["Charlie", "Bravo", "alpha", "NoDate"]);
  });

  it("recently updated and A–Z", () => {
    expect(titles(sortSkills(list, "updated"))[0]).toBe("alpha");
    expect(titles(sortSkills(list, "updated"))[1]).toBe("Charlie");
    expect(titles(sortSkills(list, "az"))).toEqual(["alpha", "Bravo", "Charlie", "NoDate"]);
  });

  it("recommended keeps featured and hand-added first, newest of those on top", () => {
    const mixed = [
      sk("Plugin", "2026-10-18T00:00:00Z", { origin: "vercel" }),
      sk("Old manual", "2026-01-01T00:00:00Z", { source: "manual", origin: null }),
      sk("New manual", "2026-10-10T00:00:00Z", { source: "manual", origin: null }),
      sk("Featured", "2026-07-20T00:00:00Z", { source: "featured", origin: null }),
    ];
    expect(titles(sortSkills(mixed))).toEqual(["Featured", "New manual", "Old manual", "Plugin"]);
  });

  it("does not change the list it was given", () => {
    const copy = [...list];
    sortSkills(list, "az");
    expect(list).toEqual(copy);
  });
});

describe("addedWithin", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  it("filters by window and hides undated ones outside Any time", () => {
    expect(list.filter((s) => addedWithin(s, "7d", now)).map((s) => s.title)).toEqual(["alpha"]);
    expect(list.filter((s) => addedWithin(s, "30d", now)).map((s) => s.title)).toEqual(["Bravo", "alpha"]);
    expect(list.filter((s) => addedWithin(s, "year", now))).toHaveLength(3);
    expect(list.filter((s) => addedWithin(s, "any", now))).toHaveLength(4);
  });
});

describe("addedLabel", () => {
  const now = new Date(2026, 9, 18, 15).getTime();
  it("reads naturally and stays empty with no date", () => {
    expect(addedLabel(new Date(2026, 9, 18, 9).toISOString(), now)).toBe("Added today");
    expect(addedLabel(new Date(2026, 9, 17, 23).toISOString(), now)).toBe("Added yesterday");
    expect(addedLabel(new Date(2026, 9, 15).toISOString(), now)).toBe("Added 3 days ago");
    expect(addedLabel(new Date(2026, 8, 2).toISOString(), now)).toBe("Added Sep 2, 2026");
    expect(addedLabel("", now)).toBe("");
    expect(addedLabel("not a date", now)).toBe("");
  });
});
