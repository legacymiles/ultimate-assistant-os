import { describe, expect, it } from "vitest";

import { applyFilter, coerceTags, guessTags, heatOf, NO_FILTER, shortCount } from "./filters";
import type { Clip } from "./types";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function clip(id: string, extra: Partial<Clip> = {}): Clip {
  return { id, tab: "dances", url: `https://x.com/${id}`, platform: "web", title: id, author: "", play: { kind: "none" }, addedAt: daysAgo(0), ...extra };
}

describe("heatOf", () => {
  it("calls a fresh, fast clip trending", () => {
    expect(heatOf({ views: 2_000_000, postedAt: daysAgo(5) }, NOW)).toBe("trending");
  });
  it("calls a young clip with steady views rising", () => {
    expect(heatOf({ views: 60_000, postedAt: daysAgo(10) }, NOW)).toBe("rising");
  });
  it("calls an old big one a classic, and a big undated one popular", () => {
    expect(heatOf({ views: 5_000_000, postedAt: daysAgo(900) }, NOW)).toBe("classic");
    expect(heatOf({ views: 5_000_000 }, NOW)).toBe("popular");
  });
  it("says nothing without numbers", () => {
    expect(heatOf(undefined, NOW)).toBeNull();
    expect(heatOf({ views: 300, postedAt: daysAgo(400) }, NOW)).toBeNull();
  });
});

describe("applyFilter", () => {
  const clips = [
    clip("a", { tags: { moods: ["Funny"], categories: ["Trend"] }, stats: { views: 100, postedAt: daysAgo(200) } }),
    clip("b", { tags: { moods: ["Hype"], categories: ["Afro"] }, stats: { views: 3_000_000, postedAt: daysAgo(3) } }),
    clip("c"),
  ];
  it("keeps newest-first order with no filter", () => {
    expect(applyFilter(clips, NO_FILTER, NOW).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
  it("filters by mood, category and heat together", () => {
    expect(applyFilter(clips, { ...NO_FILTER, moods: ["Hype", "Funny"] }, NOW).map((c) => c.id)).toEqual(["a", "b"]);
    expect(applyFilter(clips, { ...NO_FILTER, moods: ["Hype", "Funny"], categories: ["Trend"] }, NOW).map((c) => c.id)).toEqual(["a"]);
    expect(applyFilter(clips, { ...NO_FILTER, heats: ["trending"] }, NOW).map((c) => c.id)).toEqual(["b"]);
  });
  it("sorts hottest first, unknown last", () => {
    expect(applyFilter(clips, { ...NO_FILTER, sort: "hottest" }, NOW).map((c) => c.id)).toEqual(["b", "a", "c"]);
  });
});

describe("tags", () => {
  it("keeps only offered labels for the tab", () => {
    expect(coerceTags({ moods: ["funny", "nope", "Hype", "Sad"], categories: ["boxing", "Afro"] }, "dances")).toEqual({ moods: ["Funny", "Hype"], categories: ["Afro"] });
  });
  it("keeps every hand-picked tag", () => {
    expect(coerceTags({ moods: ["Funny", "Hype", "Sad"], categories: [], byHand: true }, "dances").moods).toHaveLength(3);
  });
  it("guesses from words when no AI is set up", () => {
    expect(guessTags("crazy KO knockout 🔥 ufc", "fights")).toEqual({ moods: ["Hype"], categories: ["MMA", "Knockout"] });
    expect(guessTags("Drake new song", "audio", true).categories[0]).toBe("Song");
  });
  it("shortens counts", () => {
    expect(shortCount(1_234_567)).toBe("1.2M");
    expect(shortCount(950)).toBe("950");
    expect(shortCount(null)).toBe("");
  });
});
