import { describe, expect, it } from "vitest";
import {
  NO_FILTERS,
  categoryFromLabel,
  filterModels,
  findExisting,
  justDropped,
  rankAll,
  releasedLabel,
  scoreOf,
  topRanked,
} from "./leaderboard";
import type { Model } from "./leaderboard";

const NOW = new Date("2026-11-08T12:00:00").getTime();

function model(p: Partial<Model> & Pick<Model, "id">): Model {
  return {
    name: p.id,
    maker: "Lab",
    category: "tts",
    url: `https://example.com/${p.id}`,
    summary: "",
    releasedAt: "2026-01-01",
    addedAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    openSource: false,
    runsLocally: false,
    access: "paid",
    features: [],
    tags: [],
    ...p,
  };
}

describe("scoreOf", () => {
  it("reads Elo as distance from the category leader, 4 Elo per point", () => {
    const leaders = new Map([["tts", 1200]]);
    expect(scoreOf(model({ id: "a", publicScore: { value: 1200, kind: "elo", label: "", source: "" } }), leaders).total).toBe(100);
    expect(scoreOf(model({ id: "b", publicScore: { value: 1160, kind: "elo", label: "", source: "" } }), leaders).total).toBe(90);
  });

  it("blends 50/50 when both scores exist, and uses whichever exists otherwise", () => {
    const leaders = new Map<string, number>();
    const both = model({ id: "a", myRating: 8, publicScore: { value: 60, kind: "percent", label: "", source: "" } });
    expect(scoreOf(both, leaders)).toEqual({ total: 70, publicPart: 60, ownerPart: 80 });
    expect(scoreOf(model({ id: "b", myRating: 7 }), leaders).total).toBe(70);
    expect(scoreOf(model({ id: "c" }), leaders).total).toBeNull();
  });

  it("scores a lone Elo entry as its category's leader instead of dividing by zero", () => {
    const m = model({ id: "solo", publicScore: { value: 1010, kind: "elo", label: "", source: "" } });
    expect(scoreOf(m, new Map()).total).toBe(100);
  });
});

describe("rankAll", () => {
  const board = [
    model({ id: "closed-top", myRating: 9 }),
    model({ id: "open-mid", myRating: 7, openSource: true }),
    model({ id: "open-low", myRating: 5, openSource: true }),
    model({ id: "unrated", openSource: true }),
    model({ id: "other-cat", category: "music", myRating: 2 }),
  ];

  it("ranks within each category, leaving unscored models unranked", () => {
    const r = rankAll(board);
    expect(r.get("closed-top")?.rank).toBe(1);
    expect(r.get("open-low")?.rank).toBe(3);
    expect(r.get("unrated")?.rank).toBeUndefined();
    expect(r.get("other-cat")?.rank).toBe(1);
  });

  it("keeps true positions when a filter hides the leader", () => {
    const r = rankAll(board);
    const open = filterModels(board.filter((m) => m.category === "tts"), { ...NO_FILTERS, openSource: true }, NOW);
    expect(topRanked(open, r).map((x) => [x.model.id, x.rank])).toEqual([
      ["open-mid", 2],
      ["open-low", 3],
      ["unrated", undefined],
    ]);
  });

  it("breaks a score tie toward the newer release", () => {
    const r = rankAll([
      model({ id: "old", myRating: 8, releasedAt: "2025-01-01" }),
      model({ id: "new", myRating: 8, releasedAt: "2026-10-01" }),
    ]);
    expect(r.get("new")?.rank).toBe(1);
  });
});

describe("filters and lists", () => {
  const ms = [
    model({ id: "fresh", releasedAt: "2026-11-05", access: "free", runsLocally: true, openSource: true }),
    model({ id: "month", releasedAt: "2026-10-20", access: "freemium", features: ["Voice cloning"] }),
    model({ id: "old", releasedAt: "2025-03-01" }),
  ];

  it("filters by release window, free and local", () => {
    expect(filterModels(ms, { ...NO_FILTERS, released: "7" }, NOW).map((m) => m.id)).toEqual(["fresh"]);
    expect(filterModels(ms, { ...NO_FILTERS, released: "30" }, NOW).map((m) => m.id)).toEqual(["fresh", "month"]);
    expect(filterModels(ms, { ...NO_FILTERS, free: true }, NOW).map((m) => m.id)).toEqual(["fresh", "month"]);
    expect(filterModels(ms, { ...NO_FILTERS, runsLocally: true }, NOW).map((m) => m.id)).toEqual(["fresh"]);
  });

  it("searches features with every word required", () => {
    expect(filterModels(ms, { ...NO_FILTERS, query: "voice clon" }, NOW).map((m) => m.id)).toEqual(["month"]);
    expect(filterModels(ms, { ...NO_FILTERS, query: "voice zebra" }, NOW)).toEqual([]);
  });

  it("lists just-dropped newest first", () => {
    expect(justDropped(ms, rankAll(ms)).map((r) => r.model.id)).toEqual(["fresh", "month", "old"]);
  });

  it("labels release dates in plain words", () => {
    expect(releasedLabel("2026-11-08", NOW)).toBe("today");
    expect(releasedLabel("2026-11-05", NOW)).toBe("3 days ago");
    expect(releasedLabel("2026-10-01", NOW)).toBe("5 weeks ago");
    expect(releasedLabel("2025-03-01", NOW)).toBe("Mar 2025");
    expect(releasedLabel("nonsense", NOW)).toBe("date unknown");
  });
});

describe("findExisting", () => {
  const ms = [model({ id: "k", name: "Kokoro 82M", hfId: "hexgrad/Kokoro-82M", url: "https://huggingface.co/hexgrad/Kokoro-82M" })];
  it("matches by HF id, URL or name", () => {
    expect(findExisting(ms, { hfId: "HEXGRAD/kokoro-82m" })).toBeDefined();
    expect(findExisting(ms, { url: "https://www.huggingface.co/hexgrad/Kokoro-82M/" })).toBeDefined();
    expect(findExisting(ms, { name: "kokoro-82m" })).toBeDefined();
    expect(findExisting(ms, { name: "Kokoro 2" })).toBeUndefined();
  });
});

describe("categoryFromLabel", () => {
  it("maps labels and ids loosely", () => {
    expect(categoryFromLabel("Text-to-speech")).toBe("tts");
    expect(categoryFromLabel("image to video")).toBe("image-to-video");
    expect(categoryFromLabel("Realtime voice")).toBe("realtime-voice");
    expect(categoryFromLabel("Spreadsheets")).toBeNull();
  });
});
