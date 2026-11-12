import { describe, expect, it } from "vitest";
import {
  buildTypeKey,
  calibrationFactor,
  computeVerdict,
  estimateAccuracy,
  estimateResale,
  fmtHours,
  fmtMoney,
  fmtRate,
  materialsTotal,
  percentile,
  profitPerHour,
  profitPerHourSort,
  recostMaterials,
  scaleQuantity,
} from "@/lib/buildflip-2/calc";
import type { Comp, Dimension, Material, Project } from "@/lib/buildflip-2/types";

const prov = (over: Partial<Material["provenance"]> = {}) => ({
  source: "Home Depot",
  url: "https://example.com/x",
  checkedAt: "2026-11-10T00:00:00.000Z",
  confidence: "high" as const,
  ...over,
});

const mat = (over: Partial<Material> = {}): Material => {
  const base: Material = {
    id: "m1",
    name: "2x4x8 pine stud",
    category: "lumber",
    aisle: "Lumber",
    quantity: 4,
    baseQuantity: 4,
    unit: "board",
    unitPrice: 5,
    lineTotal: 20,
    provenance: prov(),
    scaling: "linear",
    driver: "width",
    ...over,
  };
  // A fixture that sets `quantity` means "this plan was costed at N", so the
  // base follows it unless a test is deliberately pulling them apart.
  if (over.quantity !== undefined && over.baseQuantity === undefined) {
    base.baseQuantity = over.quantity;
  }
  return base;
};

const dim = (over: Partial<Dimension> = {}): Dimension => ({
  key: "width",
  label: "Width",
  value: 48,
  unit: "in",
  min: 12,
  max: 120,
  step: 1,
  baseline: 48,
  ...over,
});

const project = (over: Partial<Project> = {}): Project => ({
  id: "p1",
  ownerId: "u1",
  title: "Large custom picture frame",
  summary: "A 48-inch oak gallery frame",
  prompt: "big oak picture frame",
  sourceUrl: null,
  sourceRead: null,
  referenceImages: [],
  stage: "priced",
  dimensions: [dim()],
  materials: [mat()],
  steps: [],
  tools: [],
  safety: [],
  skillLevel: "intermediate",
  estimatedHours: 4,
  hourlyTarget: 25,
  resale: null,
  askingPrice: null,
  receipts: [],
  shopping: [],
  share: null,
  buildType: "picture-frame",
  calibration: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...over,
});

const comp = (price: number, sold = true, over: Partial<Comp> = {}): Comp => ({
  id: `c${price}`,
  title: `Frame ${price}`,
  price,
  sold,
  soldAt: "2026-10-01",
  marketplace: "eBay",
  url: "https://ebay.com/x",
  provenance: prov({ source: "eBay (sold)" }),
  ...over,
});

/* ------------------------------------------------------------------ quantity */

describe("scaleQuantity", () => {
  it("leaves quantity alone when the dimension is at baseline", () => {
    expect(scaleQuantity(mat(), [dim()])).toBe(4);
  });

  it("scales discrete goods linearly and rounds UP — you cannot buy 3.2 boards", () => {
    // 48 -> 60 is 1.25x: 4 boards -> 5
    expect(scaleQuantity(mat(), [dim({ value: 60 })])).toBe(5);
    // 48 -> 55 is 1.1458x: 4 boards -> 4.58 -> 5
    expect(scaleQuantity(mat(), [dim({ value: 55 })])).toBe(5);
  });

  it("scales area goods by the square of the ratio", () => {
    const sheet = mat({ scaling: "area", quantity: 1, unit: "sheet" });
    // 2x width = 4x area -> 4 sheets
    expect(scaleQuantity(sheet, [dim({ value: 96 })])).toBe(4);
  });

  it("keeps one decimal for continuous units", () => {
    const trim = mat({ quantity: 10, unit: "ft" });
    expect(scaleQuantity(trim, [dim({ value: 72 })])).toBeCloseTo(15, 5);
  });

  it("never moves a fixed material", () => {
    const glue = mat({ scaling: "fixed", quantity: 1, unit: "tube" });
    expect(scaleQuantity(glue, [dim({ value: 120 })])).toBe(1);
  });

  it("never returns less than one whole discrete unit", () => {
    expect(scaleQuantity(mat({ quantity: 1 }), [dim({ value: 12 })])).toBe(1);
  });

  it("is safe when the driving dimension is missing or has no baseline", () => {
    expect(scaleQuantity(mat(), [])).toBe(4);
    expect(scaleQuantity(mat(), [dim({ baseline: 0 })])).toBe(4);
  });

  it("scales from the ORIGINAL quantity, so changes never compound", () => {
    // 4 boards at 48in. Size up to 96in → 8. The scaled value is persisted,
    // so the next call must still scale from 4, not from 8.
    const scaledUp = scaleQuantity(mat(), [dim({ value: 96 })]);
    expect(scaledUp).toBe(8);
    const persisted = mat({ quantity: scaledUp, baseQuantity: 4 });
    expect(scaleQuantity(persisted, [dim({ value: 96 })])).toBe(8);
  });

  it("returns exactly to the original when a dimension is put back", () => {
    const up = recostMaterials([mat()], [dim({ value: 72 })]);
    expect(up[0]!.quantity).toBe(6);
    const back = recostMaterials(up, [dim({ value: 48 })]);
    expect(back[0]!.quantity).toBe(4);
    expect(back[0]!.lineTotal).toBe(20);
  });

  it("does not ratchet across many changes", () => {
    let list = [mat()];
    for (const v of [60, 96, 72, 36, 48]) {
      list = recostMaterials(list, [dim({ value: v })]);
    }
    expect(list[0]!.quantity).toBe(4);
  });

  it("falls back to quantity when an older plan has no baseQuantity", () => {
    const legacy = { ...mat(), baseQuantity: undefined } as unknown as Material;
    expect(scaleQuantity(legacy, [dim({ value: 96 })])).toBe(8);
  });
});

describe("recostMaterials", () => {
  it("recomputes line totals from the new quantity", () => {
    const out = recostMaterials([mat()], [dim({ value: 96 })]);
    expect(out[0]!.quantity).toBe(8);
    expect(out[0]!.lineTotal).toBe(40);
  });

  it("totals exclude optional extras by default", () => {
    const list = [mat(), mat({ id: "m2", optional: true, quantity: 1, unitPrice: 99 })];
    expect(materialsTotal(list)).toBe(20);
    expect(materialsTotal(list, true)).toBe(119);
  });
});

/* --------------------------------------------------------------------- comps */

describe("percentile", () => {
  it("handles empty and single arrays", () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([7], 0.9)).toBe(7);
  });
  it("interpolates", () => {
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(percentile([0, 100, 200, 300, 400], 0.5)).toBe(200);
  });
});

describe("estimateResale", () => {
  const now = "2026-11-10T00:00:00.000Z";

  it("ignores asking prices entirely — they are not evidence", () => {
    const r = estimateResale([comp(400, false), comp(500, false)], now);
    expect(r.soldCount).toBe(0);
    expect(r.mid).toBe(0);
    expect(r.thin).toBe(true);
    expect(r.thinReason).toMatch(/asking price/i);
  });

  it("says so plainly when there is no market at all", () => {
    const r = estimateResale([], now);
    expect(r.confidence).toBe("low");
    expect(r.thinReason).toMatch(/not making one/i);
  });

  it("builds a low/mid/high band from completed sales only", () => {
    const comps = [100, 150, 200, 250, 300].map((p) => comp(p));
    comps.push(comp(9999, false)); // a wild asking price must not move the band
    const r = estimateResale(comps, now);
    expect(r.soldCount).toBe(5);
    expect(r.mid).toBe(200);
    expect(r.low).toBeLessThan(r.mid);
    expect(r.high).toBeLessThan(400);
  });

  it("flags a thin market under four sales", () => {
    expect(estimateResale([comp(100), comp(120), comp(140)], now).thin).toBe(true);
    expect(
      estimateResale([comp(100), comp(120), comp(140), comp(160)], now).thin,
    ).toBe(false);
  });

  it("only reaches high confidence with eight tight sales", () => {
    const tight = [200, 205, 210, 215, 220, 225, 230, 235].map((p) => comp(p));
    expect(estimateResale(tight, now).confidence).toBe("high");
    const wide = [50, 80, 120, 200, 400, 700, 1200, 2000].map((p) => comp(p));
    expect(estimateResale(wide, now).confidence).toBe("medium");
  });

  it("carries the demo flag through to provenance", () => {
    const r = estimateResale([comp(100)], now, "Demo catalog", true);
    expect(r.provenance.demo).toBe(true);
  });
});

/* ------------------------------------------------------------------- verdict */

describe("computeVerdict", () => {
  const good = estimateResale(
    [320, 340, 360, 380, 400, 420, 440, 460].map((p) => comp(p)),
    "2026-11-10T00:00:00.000Z",
  );

  it("refuses to call a build with no sold market", () => {
    const v = computeVerdict(project({ resale: estimateResale([], "x") }));
    expect(v.call).toBe("skip");
    expect(v.headline).toMatch(/can't call this one/i);
  });

  it("says build when the hourly rate clears the target on a real market", () => {
    const v = computeVerdict(project({ resale: good, estimatedHours: 4 }));
    expect(v.salePrice).toBe(good.mid);
    expect(v.profit).toBe(good.mid - 20);
    expect(v.hourlyRate).toBeGreaterThan(25);
    expect(v.call).toBe("build");
  });

  it("says skip when the hours eat the profit", () => {
    const v = computeVerdict(project({ resale: good, estimatedHours: 80 }));
    expect(v.hourlyRate).toBeLessThan(15);
    expect(v.call).toBe("skip");
    expect(v.drivers[0]).toMatch(/hr/);
  });

  it("says skip, not maybe, when the profit is negative", () => {
    const v = computeVerdict(
      project({
        resale: good,
        materials: [mat({ quantity: 200, unitPrice: 5 })],
      }),
    );
    expect(v.profit).toBeLessThan(0);
    expect(v.call).toBe("skip");
    expect(v.headline).toMatch(/loses money/i);
  });

  it("downgrades a thin market from build to maybe", () => {
    const thin = estimateResale([comp(380), comp(400), comp(420)], "x");
    const v = computeVerdict(project({ resale: thin, estimatedHours: 4 }));
    expect(v.call).toBe("maybe");
    expect(v.headline).toMatch(/thin/i);
  });

  it("uses the midpoint of sold comps, never the high", () => {
    const v = computeVerdict(project({ resale: good }));
    expect(v.salePrice).toBeLessThan(good.high);
    expect(v.salePriceBasis).toBe("comps");
  });

  it("honours a dragged asking price and marks the basis", () => {
    const v = computeVerdict(project({ resale: good, askingPrice: 600 }));
    expect(v.salePrice).toBe(600);
    expect(v.salePriceBasis).toBe("asking");
  });

  it("switches to real receipts once most of the list is bought", () => {
    const v = computeVerdict(
      project({
        resale: good,
        receipts: [
          { id: "r1", materialId: "m1", label: "studs", amount: 31.5, paidAt: "2026-11-02" },
        ],
      }),
    );
    expect(v.costBasis).toBe("actual");
    expect(v.actualCost).toBe(31.5);
  });

  it("blends receipts and estimates while shopping is partial", () => {
    const p = project({
      resale: good,
      materials: [mat(), mat({ id: "m2", quantity: 2, unitPrice: 10, scaling: "fixed" })],
      receipts: [
        { id: "r1", materialId: "m1", label: "studs", amount: 25, paidAt: "2026-11-02" },
      ],
    });
    const v = computeVerdict(p);
    expect(v.costBasis).toBe("mixed");
    expect(v.actualCost).toBe(45); // 25 paid + 20 still to buy
  });

  it("never divides by zero hours", () => {
    const v = computeVerdict(project({ resale: good, estimatedHours: 0 }));
    expect(v.hourlyRate).toBeNull();
    expect(() => profitPerHour(project({ resale: good, estimatedHours: 0 }))).not.toThrow();
  });
});

/* ------------------------------------------------------------------ accuracy */

describe("estimateAccuracy", () => {
  it("returns null until a receipt exists — no 0% victory laps", () => {
    expect(estimateAccuracy(project())).toBeNull();
  });

  it("reports the signed delta against the estimate", () => {
    const acc = estimateAccuracy(
      project({
        receipts: [
          { id: "r1", materialId: "m1", label: "studs", amount: 23, paidAt: "2026-11-02" },
        ],
      }),
    )!;
    expect(acc.estimate).toBe(20);
    expect(acc.actual).toBe(23);
    expect(acc.delta).toBe(3);
    expect(acc.deltaPct).toBeCloseTo(0.15, 5);
    expect(acc.within15).toBe(true);
  });

  it("marks a miss outside 15%", () => {
    const acc = estimateAccuracy(
      project({
        receipts: [
          { id: "r1", materialId: "m1", label: "studs", amount: 40, paidAt: "2026-11-02" },
        ],
      }),
    )!;
    expect(acc.within15).toBe(false);
  });
});

describe("calibrationFactor", () => {
  it("refuses to calibrate on fewer than three builds", () => {
    expect(calibrationFactor([{ estimate: 100, actual: 120 }])).toBeNull();
    expect(
      calibrationFactor([
        { estimate: 100, actual: 120 },
        { estimate: 100, actual: 110 },
      ]),
    ).toBeNull();
  });

  it("uses the median ratio so one bad build cannot swing it", () => {
    const c = calibrationFactor([
      { estimate: 100, actual: 110 },
      { estimate: 100, actual: 112 },
      { estimate: 100, actual: 108 },
      { estimate: 100, actual: 400 }, // discarded: 4x
    ])!;
    expect(c.sampleSize).toBe(4);
    expect(c.factor).toBeCloseTo(1.11, 2);
  });

  it("clamps so calibration can never run away with an estimate", () => {
    const c = calibrationFactor([
      { estimate: 100, actual: 300 },
      { estimate: 100, actual: 320 },
      { estimate: 100, actual: 340 },
    ])!;
    expect(c.factor).toBe(1.35);
  });

  it("throws away nonsense samples", () => {
    expect(
      calibrationFactor([
        { estimate: 0, actual: 50 },
        { estimate: 100, actual: 0 },
        { estimate: 100, actual: 110 },
      ]),
    ).toBeNull();
  });
});

/* ---------------------------------------------------------------- build type */

describe("buildTypeKey", () => {
  it("pools the examples the owner named", () => {
    expect(buildTypeKey("Large custom picture frames")).toBe("picture-frame");
    expect(buildTypeKey("Custom hot tub boat")).toBe("hot-tub-boat");
    expect(buildTypeKey("DIY fireplace surround")).toBe("fireplace");
  });
  it("prefers the more specific bucket", () => {
    expect(buildTypeKey("cedar hot tub boat for the lake")).toBe("hot-tub-boat");
  });
  it("falls back to other rather than guessing", () => {
    expect(buildTypeKey("a thing I saw on the internet")).toBe("other");
  });
});

/* ------------------------------------------- regressions found in review */

describe("regressions", () => {
  const good = estimateResale(
    [320, 340, 360, 380, 400, 420, 440, 460].map((p) => comp(p)),
    "2026-11-10T00:00:00.000Z",
  );

  it("an unattributed receipt pays DOWN the remainder, it does not stack on it", () => {
    // 10 planned materials at $100 each. One lump receipt for $950 against
    // "something not on the list". The old code reported $1,950 of cost and
    // flipped a good build to 'Skip it'.
    const materials = Array.from({ length: 10 }, (_, i) =>
      mat({ id: `m${i}`, quantity: 1, unitPrice: 100, scaling: "fixed" }),
    );
    const p = project({
      resale: good,
      materials,
      receipts: [
        { id: "r1", materialId: null, label: "hardware store run", amount: 950, paidAt: "2026-11-02" },
      ],
    });
    const v = computeVerdict(p);
    expect(v.costBasis).toBe("mixed");
    expect(v.actualCost).toBe(1000); // 950 paid + 50 of the list still to buy
    expect(v.actualCost).toBeLessThan(1950);
  });

  it("a receipt against an OPTIONAL extra does not inflate coverage", () => {
    const p = project({
      resale: good,
      materials: [
        mat({ id: "m1", quantity: 1, unitPrice: 100, scaling: "fixed" }),
        mat({ id: "opt", optional: true, quantity: 1, unitPrice: 50, scaling: "fixed" }),
      ],
      receipts: [
        { id: "r1", materialId: "opt", label: "nice-to-have", amount: 50, paidAt: "2026-11-02" },
      ],
    });
    const acc = estimateAccuracy(p)!;
    expect(acc.coverage).toBe(0); // the one PLANNED item is still unbought
    expect(computeVerdict(p).costBasis).not.toBe("actual");
  });

  it("a plan with unpriced materials can never be a 'build it'", () => {
    const p = project({
      resale: good,
      estimatedHours: 2,
      materials: [
        mat({ id: "m1", quantity: 1, unitPrice: 20, scaling: "fixed" }),
        mat({ id: "m2", quantity: 1, unitPrice: 0, scaling: "fixed" }),
      ],
    });
    const v = computeVerdict(p);
    expect(v.unpricedCount).toBe(1);
    expect(v.call).not.toBe("build");
    expect(v.confidence).toBe("low");
    expect(v.headline).toMatch(/no price/i);
    expect(v.drivers.join(" ")).toMatch(/floor, not a total/i);
  });

  it("never produces an infinite hourly rate", () => {
    const v = computeVerdict(project({ resale: good, estimatedHours: 0 }));
    expect(v.hourlyRate).toBeNull();
    expect(v.call).not.toBe("build");
    expect(v.drivers.join(" ")).not.toMatch(/∞|Infinity/);
    expect(fmtRate(v.hourlyRate)).toBe("—");
    expect(fmtRate(null, "hours not set")).toBe("hours not set");
  });

  it("ranks a zero-hour plan last instead of first", () => {
    const noHours = project({ id: "a", resale: good, estimatedHours: 0 });
    const real = project({ id: "b", resale: good, estimatedHours: 4 });
    expect(profitPerHour(noHours)).toBeNull();
    expect(profitPerHourSort(noHours)).toBeLessThan(profitPerHourSort(real));
  });

  it("area goods scale with BOTH dimensions, not the square of one", () => {
    const dims = [
      dim({ key: "width", value: 48, baseline: 48 }),
      dim({ key: "height", value: 36, baseline: 36, min: 12, max: 144 }),
    ];
    const sheet = mat({
      scaling: "area",
      quantity: 2,
      unit: "sheet",
      driver: "width",
      driver2: "height",
    });
    // Doubling ONE side doubles the area.
    expect(
      scaleQuantity(sheet, [dims[0]!, { ...dims[1]!, value: 72 }]),
    ).toBe(4);
    // Doubling both quadruples it.
    expect(
      scaleQuantity(sheet, [
        { ...dims[0]!, value: 96 },
        { ...dims[1]!, value: 72 },
      ]),
    ).toBe(8);
    // The second slider is not dead.
    expect(scaleQuantity(sheet, dims)).toBe(2);
  });

  it("still squares a single driver when only one dimension is known", () => {
    const sheet = mat({ scaling: "area", quantity: 1, unit: "sheet", driver: "width" });
    expect(scaleQuantity(sheet, [dim({ value: 96 })])).toBe(4);
  });

  it("the live hourly target overrides the one stored on the plan", () => {
    const p = project({ resale: good, estimatedHours: 4, hourlyTarget: 25 });
    expect(computeVerdict(p).call).toBe("build");
    // Raise what your time is worth and the same plan stops clearing the bar.
    const strict = computeVerdict(p, 200);
    expect(strict.call).toBe("skip");
    expect(strict.drivers.join(" ")).toMatch(/\$200/);
  });
});

/* ----------------------------------------------------------------- formatters */

describe("formatters", () => {
  it("formats money with cents under a thousand and none above", () => {
    expect(fmtMoney(4.5)).toBe("$4.50");
    expect(fmtMoney(1240)).toBe("$1,240");
    expect(fmtMoney(-12.5)).toBe("-$12.50");
  });
  it("formats hours like a human says them", () => {
    expect(fmtHours(0.5)).toBe("30 min");
    expect(fmtHours(4)).toBe("4h");
    expect(fmtHours(4.25)).toBe("4h 15m");
  });
});
