import { describe, expect, it } from "vitest";
import {
  GAP_NAMED,
  benchPart,
  NO_FILTERS,
  categoryFromLabel,
  filterModels,
  findExisting,
  hiddenReason,
  justDropped,
  openStanding,
  rankAll,
  releasedLabel,
  scoreOf,
  topRanked,
  topRowsWithGaps,
} from "./leaderboard";
import type { Model } from "./leaderboard";

const NOW = new Date("2026-11-08T12:00:00").getTime();

/** A percent score, which is used as-is, so a test's numbers are its scores. */
const pct = (value: number) => ({ value, kind: "percent" as const, label: "Bench", source: "Somewhere" });

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

describe("benchPart", () => {
  it("reads Elo as distance from the category leader, 4 Elo per point", () => {
    const leaders = new Map([["tts", 1200]]);
    expect(benchPart(model({ id: "a", publicScore: { value: 1200, kind: "elo", label: "", source: "" } }), leaders)).toBe(100);
    expect(benchPart(model({ id: "b", publicScore: { value: 1160, kind: "elo", label: "", source: "" } }), leaders)).toBe(90);
  });

  it("scores a lone Elo entry as its category's leader instead of dividing by zero", () => {
    const m = model({ id: "solo", publicScore: { value: 1010, kind: "elo", label: "", source: "" } });
    expect(benchPart(m, new Map())).toBe(100);
  });

  it("uses a percent as it is, and has nothing to say without a score", () => {
    expect(benchPart(model({ id: "p", publicScore: pct(61) }), new Map())).toBe(61);
    expect(benchPart(model({ id: "n" }), new Map())).toBeNull();
  });
});

describe("scoreOf", () => {
  const leaders = new Map<string, number>();
  // Released on the day the clock says, so recency is exactly 100 and the
  // arithmetic below can be checked by hand.
  const today = { releasedAt: "2026-11-08" };

  it("blends the category's dimensions, renormalised over the ones that are known", () => {
    // tts: bench 20 and curator 8 are established, cost 10 and recency 6 are
    // only derived and so count half — (60×20 + 80×8 + 30×5 + 100×3) / 36.
    const m = model({ id: "a", ...today, myRating: 8, publicScore: pct(60) });
    const s = scoreOf(m, leaders, NOW);
    expect(s.total).toBe(63.6);
    expect({ publicPart: s.publicPart, ownerPart: s.ownerPart }).toEqual({ publicPart: 60, ownerPart: 80 });
    expect(s.known).toBe(4);
    expect(s.of).toBe(9);
  });

  it("counts a per-dimension rating, and lets a measurement outrank it", () => {
    const rated = scoreOf(model({ id: "b", ...today, ratings: { accuracy: 5 } }), leaders, NOW);
    expect(rated.dims.find((d) => d.dim.id === "accuracy")).toMatchObject({ value: 50, from: "rated" });

    // 2% word error is near the good end of tts accuracy (1% scores 100).
    const measured = scoreOf(
      model({ id: "c", ...today, ratings: { accuracy: 5 }, metrics: { accuracy: 2 } }),
      leaders,
      NOW,
    );
    expect(measured.dims.find((d) => d.dim.id === "accuracy")).toMatchObject({ from: "metric", raw: 2 });
    expect(measured.total!).toBeGreaterThan(rated.total!);
  });

  it("will not rank a model on derivations alone", () => {
    // New, open and free is not evidence of being good at anything.
    const s = scoreOf(model({ id: "d", ...today, openSource: true, access: "free" }), leaders, NOW);
    expect(s.judged).toBe(false);
    expect(s.total).toBeNull();
    // The cells still carry what IS known, so the row isn't blank.
    expect(s.dims.find((d) => d.dim.id === "recency")).toMatchObject({ value: 100, from: "auto" });
  });

  it("scores an older model lower than the same model released today", () => {
    const now = scoreOf(model({ id: "e", ...today, myRating: 8 }), leaders, NOW);
    const old = scoreOf(model({ id: "f", releasedAt: "2024-01-01", myRating: 8 }), leaders, NOW);
    expect(now.total!).toBeGreaterThan(old.total!);
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

// ----- what a filter is hiding -----------------------------------------------

describe("the holes a filter leaves", () => {
  // One category: five closed models and two open ones, interleaved by score.
  const board = [
    model({ id: "c1", name: "Closed One", publicScore: pct(95) }),
    model({ id: "c2", name: "Closed Two", publicScore: pct(90) }),
    model({ id: "o1", name: "Open One", openSource: true, publicScore: pct(84) }),
    model({ id: "c3", name: "Closed Three", publicScore: pct(80) }),
    model({ id: "o2", name: "Open Two", openSource: true, publicScore: pct(70) }),
    model({ id: "u1", name: "Unranked Open", openSource: true }),
  ];
  const ranks = rankAll(board);
  const shownModels = filterModels(board, { ...NO_FILTERS, openSource: true }, NOW);
  const shown = topRanked(shownModels, ranks);
  const all = topRanked(board, ranks);

  it("puts the hidden models back in their own places", () => {
    const rows = topRowsWithGaps(shown, all);
    expect(
      rows.map((r) => (r.kind === "model" ? `#${r.r.rank ?? "-"} ${r.r.model.name}` : `gap:${r.rows.map((x) => x.model.name).join("+")}`)),
    ).toEqual([
      "gap:Closed One+Closed Two",
      "#3 Open One",
      "gap:Closed Three",
      "#5 Open Two",
      "#- Unranked Open",
    ]);
  });

  it("stops at the last shown model — past it there is no hole", () => {
    const onlyTop = topRanked(filterModels(board, { ...NO_FILTERS, query: "Open One" }, NOW), ranks);
    const rows = topRowsWithGaps(onlyTop, all);
    expect(rows.at(-1)).toMatchObject({ kind: "model" });
    expect(rows.filter((r) => r.kind === "gap")).toHaveLength(1);
  });

  it("names a few and counts the rest", () => {
    const many = [
      ...Array.from({ length: 6 }, (_, i) => model({ id: `x${i}`, name: `Closed ${i}`, publicScore: pct(99 - i) })),
      model({ id: "open", name: "The Open One", openSource: true, publicScore: pct(50) }),
    ];
    const r = rankAll(many);
    const rows = topRowsWithGaps(topRanked(filterModels(many, { ...NO_FILTERS, openSource: true }, NOW), r), topRanked(many, r));
    const gap = rows.find((x) => x.kind === "gap")!;
    expect(gap.rows).toHaveLength(GAP_NAMED);
    expect(gap.more).toBe(3);
  });

  it("has nothing to put back when no filter is on", () => {
    expect(topRowsWithGaps(all, all).every((r) => r.kind === "model")).toBe(true);
  });

  it("says why each one is missing, in the reader's words", () => {
    const f = { ...NO_FILTERS, openSource: true };
    expect(hiddenReason(model({ id: "a" }), f, NOW)).toBe("closed");
    expect(hiddenReason(model({ id: "b" }), { ...NO_FILTERS, runsLocally: true }, NOW)).toBe("cloud only");
    expect(hiddenReason(model({ id: "c", access: "paid" }), { ...NO_FILTERS, free: true }, NOW)).toBe("paid");
    expect(hiddenReason(model({ id: "d", releasedAt: "2020-01-01" }), { ...NO_FILTERS, released: "30" }, NOW)).toBe("older");
    expect(hiddenReason(model({ id: "e" }), { ...NO_FILTERS, query: "zzz" }, NOW)).toBe("filtered out");
  });
});

describe("openStanding", () => {
  const board = [
    model({ id: "c1", name: "Closed One", publicScore: pct(95) }),
    model({ id: "o1", name: "Open One", openSource: true, publicScore: pct(84) }),
    model({ id: "o2", name: "Open Two", openSource: true, publicScore: pct(70) }),
  ];

  it("measures the best open model against the category leader", () => {
    const ranks = rankAll(board);
    const s = openStanding(board, ranks)!;
    expect(s).toMatchObject({ rank: 2, name: "Open One", of: 3, leaderName: "Closed One" });
    // The gap is the real distance between the two scores, whatever the
    // dimensions blended out to.
    expect(s.behind).toBe(Math.round((s.leaderTotal - s.total) * 10) / 10);
    expect(s.behind).toBeGreaterThan(0);
  });

  it("reports a lead of nothing when the open model is the leader", () => {
    const led = [model({ id: "o", name: "Open", openSource: true, publicScore: pct(90) }), model({ id: "c", publicScore: pct(80) })];
    expect(openStanding(led, rankAll(led))).toMatchObject({ rank: 1, behind: 0, leaderName: "Open" });
  });

  it("is nothing to say when no open model is ranked", () => {
    const closed = [model({ id: "c", publicScore: pct(90) }), model({ id: "o", openSource: true })];
    expect(openStanding(closed, rankAll(closed))).toBeNull();
    expect(openStanding([], new Map())).toBeNull();
  });
});
