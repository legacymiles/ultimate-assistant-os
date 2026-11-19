import { describe, expect, it } from "vitest";
import {
  ALL_DIM_IDS,
  RECENCY_ZERO_DAYS,
  blend,
  dimOf,
  dimValues,
  dimsOf,
  formatMetric,
  isEvidence,
  scoreMetric,
} from "./dimensions";
import type { DimInput, MetricScale } from "./dimensions";
import { CATEGORIES } from "./leaderboard";

const input = (p: Partial<DimInput> = {}): DimInput => ({
  category: "tts",
  ageDays: 0,
  openSource: false,
  runsLocally: false,
  access: "paid",
  bench: null,
  ...p,
});

const valueOf = (vals: ReturnType<typeof dimValues>, id: string) => vals.find((v) => v.dim.id === id);

// ----- the catalogue --------------------------------------------------------

describe("the dimension catalogue", () => {
  it("gives every category its own dimensions", () => {
    for (const c of CATEGORIES) {
      const dims = dimsOf(c.id);
      expect(dims.length, `${c.id} has no dimensions`).toBeGreaterThanOrEqual(6);
      expect(dims.length, `${c.id} has too many to read on one row`).toBeLessThanOrEqual(10);
    }
  });

  it("weights each category out of 100", () => {
    for (const c of CATEGORIES) {
      const total = dimsOf(c.id).reduce((n, d) => n + d.weight, 0);
      expect(total, `${c.id} weights sum to ${total}`).toBe(100);
    }
  });

  it("uses each dimension once per category, and names it the same way everywhere", () => {
    const labels = new Map<string, string>();
    for (const c of CATEGORIES) {
      const ids = dimsOf(c.id).map((d) => d.id);
      expect(new Set(ids).size, `${c.id} repeats a dimension`).toBe(ids.length);
      for (const d of dimsOf(c.id)) {
        expect(ALL_DIM_IDS).toContain(d.id);
        expect(d.code.length, `${d.id} code is too long for a column`).toBeLessThanOrEqual(4);
        expect(d.hint.length, `${d.id} has no hint`).toBeGreaterThan(10);
      }
    }
    // A label may be sharpened per category (Length → Song length), but two
    // categories must never give the same id two unrelated names. `bench` is
    // the exception by design: every category names its own leaderboard.
    for (const c of CATEGORIES) {
      for (const d of dimsOf(c.id)) {
        if (d.id === "bench") continue;
        const seen = labels.get(d.id);
        if (seen && seen !== d.label) {
          expect(
            d.label.toLowerCase().includes(seen.toLowerCase()) || seen.toLowerCase().includes(d.label.toLowerCase()),
            `${d.id} is "${seen}" in one category and "${d.label}" in another`,
          ).toBe(true);
        } else labels.set(d.id, d.label);
      }
    }
  });

  it("gives every category a public-score dimension, so an arena always counts", () => {
    for (const c of CATEGORIES) {
      expect(dimsOf(c.id).some((d) => d.source === "bench"), `${c.id} ignores its public score`).toBe(true);
    }
  });

  it("has nothing to say about a category it doesn't know", () => {
    expect(dimsOf("spreadsheets")).toEqual([]);
    expect(dimOf("tts", "nonsense")).toBeUndefined();
    expect(dimOf("tts", "emotion")?.label).toBe("Emotion");
  });
});

// ----- the scales -----------------------------------------------------------

describe("scoreMetric", () => {
  const lower: MetricScale = { unit: "% word error", good: 1, bad: 12, lowerIsBetter: true };
  const higher: MetricScale = { unit: "tokens/s", good: 250, bad: 15 };
  const price: MetricScale = { unit: "$/image", good: 0.003, bad: 0.25, log: true, lowerIsBetter: true };

  it("puts good at 100 and bad at 0, whichever direction it runs", () => {
    expect(scoreMetric(1, lower)).toBe(100);
    expect(scoreMetric(12, lower)).toBe(0);
    expect(scoreMetric(250, higher)).toBe(100);
    expect(scoreMetric(15, higher)).toBe(0);
  });

  it("interpolates between them and clamps past the ends", () => {
    expect(scoreMetric(6.5, lower)).toBe(50);
    expect(scoreMetric(0.2, lower)).toBe(100);
    expect(scoreMetric(40, lower)).toBe(0);
    expect(scoreMetric(400, higher)).toBe(100);
  });

  it("spreads a price by orders of magnitude, not evenly", () => {
    // Halfway in log terms between $0.003 and $0.25 is ~$0.027, which a
    // linear scale would have called 90-ish.
    expect(scoreMetric(0.027, price)).toBeCloseTo(50, 0);
    expect(scoreMetric(0.03, price)).toBeLessThan(55);
    expect(scoreMetric(0.03, price)).toBeGreaterThan(45);
  });

  it("reads free as the best end of a scale that cannot take log(0)", () => {
    expect(scoreMetric(0, price)).toBe(100);
    expect(scoreMetric(0, { unit: "s", good: 60, bad: 4, log: true })).toBe(0);
  });

  it("refuses anything that isn't a number", () => {
    expect(scoreMetric(Number.NaN, lower)).toBeNull();
    expect(scoreMetric(Infinity, lower)).toBeNull();
  });
});

// ----- where a number comes from --------------------------------------------

describe("dimValues", () => {
  it("prefers a measurement, then a rating, then a derivation", () => {
    const measured = dimValues(input({ ratings: { cost: 4 }, metrics: { cost: 10 }, access: "free" }));
    expect(valueOf(measured, "cost")).toMatchObject({ from: "metric", raw: 10 });

    const rated = dimValues(input({ ratings: { cost: 4 }, access: "free" }));
    expect(valueOf(rated, "cost")).toMatchObject({ from: "rated", value: 40 });

    const derived = dimValues(input({ access: "free" }));
    expect(valueOf(derived, "cost")).toMatchObject({ from: "auto", value: 90 });
  });

  it("leaves a dimension empty rather than guessing it", () => {
    const vals = dimValues(input());
    expect(valueOf(vals, "naturalness")).toMatchObject({ value: null, from: null });
    expect(valueOf(vals, "bench")).toMatchObject({ value: null, from: null });
  });

  it("reads the public score into the bench dimension", () => {
    expect(valueOf(dimValues(input({ bench: 73 })), "bench")).toMatchObject({ value: 73, from: "bench" });
  });

  it("lets the overall rating stand in for the curator dimension", () => {
    expect(valueOf(dimValues(input({ myRating: 7 })), "curator")).toMatchObject({ value: 70, from: "rated" });
    // A rating typed into the column itself wins over the overall one.
    expect(valueOf(dimValues(input({ myRating: 7, ratings: { curator: 9 } })), "curator")).toMatchObject({ value: 90 });
  });

  it("decays age to nothing over eighteen months", () => {
    expect(valueOf(dimValues(input({ ageDays: 0 })), "recency")?.value).toBe(100);
    expect(valueOf(dimValues(input({ ageDays: RECENCY_ZERO_DAYS / 2 })), "recency")?.value).toBe(50);
    expect(valueOf(dimValues(input({ ageDays: RECENCY_ZERO_DAYS * 3 })), "recency")?.value).toBe(0);
    expect(valueOf(dimValues(input({ ageDays: null })), "recency")).toMatchObject({ value: null });
  });

  it("scores openness by what you can actually do with the weights", () => {
    const open = (p: Partial<DimInput>) => valueOf(dimValues(input({ category: "stt", ...p })), "openness")?.value;
    expect(open({ openSource: true, runsLocally: true })).toBe(100);
    expect(open({ openSource: true })).toBe(85);
    expect(open({ runsLocally: true })).toBe(50);
    expect(open({})).toBe(10);
  });

  it("has nothing to work out for an unknown category", () => {
    expect(dimValues(input({ category: "spreadsheets" }))).toEqual([]);
  });
});

// ----- the blend ------------------------------------------------------------

describe("blend", () => {
  it("renormalises over the dimensions that have a number", () => {
    // bench 20 at 80, curator 8 at 60 — nothing else known.
    const vals = dimValues(input({ bench: 80, myRating: 6, ageDays: null, access: "paid" }));
    const b = blend(vals.filter((v) => ["bench", "curator"].includes(v.dim.id)));
    expect(b.total).toBe(Math.round(((80 * 20 + 60 * 8) / 28) * 10) / 10);
    expect(b.known).toBe(2);
  });

  it("weights a heavy dimension more than a light one", () => {
    const heavyGood = blend(dimValues(input({ bench: 100, myRating: 1 })));
    const lightGood = blend(dimValues(input({ bench: 10, myRating: 10 })));
    expect(heavyGood.total!).toBeGreaterThan(lightGood.total!);
  });

  it("counts a derived value for half, so a guess cannot outvote a measurement", () => {
    // The same cost, once guessed from "free" and once measured at the price
    // that scores the same 90. Identical cells, different pull on the score.
    const guessed = blend(dimValues(input({ bench: 40, access: "free" })));
    const measured = blend(dimValues(input({ bench: 40, access: "free", metrics: { cost: 3 } })));
    const costCell = valueOf(dimValues(input({ access: "free", bench: null })), "cost")!;
    expect(costCell).toMatchObject({ value: 90, from: "auto" });

    // Both have a cost of about 90 pulling against a bench of 40, so the one
    // that counts in full must land further from the bench.
    expect(measured.total!).toBeGreaterThan(guessed.total!);
  });

  it("still counts a derived dimension as known — the discount is on its vote, not on coverage", () => {
    const derived = blend(dimValues(input({ bench: 50, access: "free", ageDays: 10 })));
    // bench 20 + cost 10 + recency 6 of tts's 100.
    expect(derived.coverage).toBeCloseTo(0.36, 5);
    expect(derived.known).toBe(3);
  });

  it("reports how much of the category it actually knows", () => {
    const thin = blend(dimValues(input({ bench: 80, ageDays: null })));
    const full = blend(
      dimValues(
        input({
          bench: 80,
          myRating: 8,
          ratings: { naturalness: 9, emotion: 8, clarity: 9 },
          metrics: { accuracy: 2, speed: 20, cost: 10 },
        }),
      ),
    );
    expect(thin.coverage).toBeLessThan(full.coverage);
    expect(full.coverage).toBeCloseTo(1, 5);
    expect(full.known).toBe(full.of);
  });

  it("is not a score at all when nothing has been established", () => {
    const derived = blend(dimValues(input({ access: "free", openSource: true, ageDays: 3 })));
    expect(derived.judged).toBe(false);
    expect(derived.total).toBeNull();
    expect(derived.known).toBeGreaterThan(0);
  });

  it("has no opinion on an empty list", () => {
    expect(blend([])).toEqual({ total: null, judged: false, coverage: 0, known: 0, of: 0 });
  });

  it("knows which sources count as evidence", () => {
    expect([isEvidence("bench"), isEvidence("rated"), isEvidence("metric")]).toEqual([true, true, true]);
    expect([isEvidence("auto"), isEvidence(null)]).toEqual([false, false]);
  });
});

describe("formatMetric", () => {
  it("says a measurement the way a person would", () => {
    expect(formatMetric(0.015, { unit: "$/image", good: 0, bad: 1 })).toBe("$0.015 per image");
    expect(formatMetric(3.1, { unit: "% word error", good: 1, bad: 12 })).toBe("3.1% word error");
    expect(formatMetric(128000, { unit: "tokens", good: 1, bad: 2 })).toBe("128,000 tokens");
    expect(formatMetric(42.6, { unit: "× realtime", good: 1, bad: 2 })).toBe("42.6 × realtime");
  });
});
