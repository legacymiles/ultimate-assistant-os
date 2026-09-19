import { describe, expect, it } from "vitest";
import { RUBRIC, heuristicStars, parseRatings } from "./rubric";

describe("RUBRIC", () => {
  it("carries the owner's own examples", () => {
    for (const s of ["waterfall", "rock climbing", "amusement park", "cat cafe", "soda machine", "arcade"]) {
      expect(RUBRIC.toLowerCase()).toContain(s);
    }
  });
});

describe("parseRatings", () => {
  const keys = new Set(["p1", "p2", "p3"]);

  it("reads a JSON reply, fenced or not", () => {
    const reply =
      '```json\n{"ratings":[{"key":"p1","section":"parks","stars":5,"reason":"Three waterfalls","hook":"A gorge with three falls."}]}\n```';
    const out = parseRatings(reply, keys);
    expect(out.get("p1")).toEqual({
      section: "parks",
      stars: 5,
      reason: "Three waterfalls",
      hook: "A gorge with three falls.",
    });
  });

  it("drops unknown keys, bad sections and out-of-range stars", () => {
    const reply = JSON.stringify({
      ratings: [
        { key: "zzz", section: "fun", stars: 3 },
        { key: "p1", section: "nightlife", stars: 3 },
        { key: "p2", section: "fun", stars: 9 },
        { key: "p3", section: "gems", stars: 4.4, reason: "x".repeat(400) },
      ],
    });
    const out = parseRatings(reply, keys);
    expect([...out.keys()]).toEqual(["p3"]);
    expect(out.get("p3")!.stars).toBe(4);
    expect(out.get("p3")!.reason!.length).toBeLessThanOrEqual(200);
  });

  it("returns an empty map for garbage", () => {
    expect(parseRatings("sorry, I can't", keys).size).toBe(0);
  });
});

describe("heuristicStars", () => {
  it("maps rarity 0-100 onto 2-5 stars", () => {
    expect(heuristicStars(10)).toBe(2);
    expect(heuristicStars(40)).toBe(3);
    expect(heuristicStars(65)).toBe(4);
    expect(heuristicStars(90)).toBe(5);
  });
});
