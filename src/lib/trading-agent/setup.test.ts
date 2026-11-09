import { describe as it_, expect, it } from "vitest";
import {
  describe as describeSetup,
  expectancy,
  flawsIn,
  numbersFor,
  precisionOf,
  type Account,
  type Setup,
} from "./setup";

const long: Setup = {
  instrument: "EURUSD",
  direction: "long",
  entry: 1.085,
  stop: 1.08,
  target: 1.1,
  timeframe: "4h",
  thesis: "Reclaimed the range low.",
};

const short: Setup = { ...long, direction: "short", entry: 1.085, stop: 1.09, target: 1.07 };
const account: Account = { size: 10_000, riskPct: 1 };

it_("the arithmetic", () => {
  it("measures risk and reward per unit off the prices", () => {
    const n = numbersFor(long, account)!;
    expect(n.riskPerUnit).toBeCloseTo(0.005, 10);
    expect(n.rewardPerUnit).toBeCloseTo(0.015, 10);
  });

  it("works out the ratio", () => {
    expect(numbersFor(long, account)!.rr).toBeCloseTo(3, 10);
  });

  it("works out what has to be true — the breakeven win rate", () => {
    // A 3:1 pays for itself at 25%. This is the number the whole module exists
    // to put next to the thesis.
    expect(numbersFor(long, account)!.breakevenWinRate).toBeCloseTo(0.25, 10);
    const even = numbersFor({ ...long, target: 1.09 }, account)!;
    expect(even.rr).toBeCloseTo(1, 10);
    expect(even.breakevenWinRate).toBeCloseTo(0.5, 10);
  });

  it("sizes the position so exactly the risked amount sits behind the stop", () => {
    const n = numbersFor(long, account)!;
    expect(n.riskAmount).toBeCloseTo(100, 10);
    expect(n.units * n.riskPerUnit).toBeCloseTo(n.riskAmount, 8);
    expect(n.rewardAmount).toBeCloseTo(300, 8);
  });

  it("measures a short off the same prices, mirrored", () => {
    const n = numbersFor(short, account)!;
    expect(n.riskPerUnit).toBeCloseTo(0.005, 10);
    expect(n.rewardPerUnit).toBeCloseTo(0.015, 10);
    expect(n.rr).toBeCloseTo(3, 10);
  });

  it("scales with the risk share, not with the account alone", () => {
    const a = numbersFor(long, { size: 10_000, riskPct: 2 })!;
    const b = numbersFor(long, { size: 20_000, riskPct: 1 })!;
    expect(a.riskAmount).toBeCloseTo(b.riskAmount, 10);
    expect(a.units).toBeCloseTo(b.units, 8);
  });
});

it_("setups that contradict themselves", () => {
  it("catches a long whose stop is above entry", () => {
    const flaws = flawsIn({ ...long, stop: 1.09 }, account);
    expect(flaws.some((f) => f.blocking && /that is a short's stop/.test(f.message))).toBe(true);
  });

  it("catches a short whose stop is below entry", () => {
    const flaws = flawsIn({ ...short, stop: 1.08 }, account);
    expect(flaws.some((f) => f.blocking && /that is a long's stop/.test(f.message))).toBe(true);
  });

  it("catches a target on the wrong side of entry", () => {
    expect(flawsIn({ ...long, target: 1.07 }, account).some((f) => f.blocking)).toBe(true);
    expect(flawsIn({ ...short, target: 1.1 }, account).some((f) => f.blocking)).toBe(true);
  });

  it("catches a stop at entry, where there is nothing to size against", () => {
    const flaws = flawsIn({ ...long, stop: 1.085 }, account);
    expect(flaws.some((f) => f.blocking && /no risk to size against/.test(f.message))).toBe(true);
  });

  it("catches a target at entry", () => {
    expect(flawsIn({ ...long, target: 1.085 }, account).some((f) => f.blocking)).toBe(true);
  });

  it("refuses a non-numeric price rather than computing NaN", () => {
    const flaws = flawsIn({ ...long, entry: Number.NaN }, account);
    expect(flaws[0].blocking).toBe(true);
    expect(flaws[0].message).toBe("Entry is not a number.");
  });

  it("refuses an account that cannot be sized from", () => {
    expect(flawsIn(long, { size: 0, riskPct: 1 }).some((f) => f.blocking)).toBe(true);
    expect(flawsIn(long, { size: 10_000, riskPct: 0 }).some((f) => f.blocking)).toBe(true);
    expect(flawsIn(long, { size: 10_000, riskPct: -1 }).some((f) => f.blocking)).toBe(true);
  });

  it("puts blocking flaws first, so showing only the first one shows the one that matters", () => {
    const flaws = flawsIn({ ...long, stop: 1.09 }, { size: 10_000, riskPct: 5 });
    expect(flaws[0].blocking).toBe(true);
  });
});

it_("numbersFor on a broken setup", () => {
  it("returns null rather than a zero that reads as an answer", () => {
    expect(numbersFor({ ...long, stop: 1.085 }, account)).toBeNull();
    expect(numbersFor({ ...long, direction: "short" }, account)).toBeNull();
    expect(numbersFor(long, { size: -1, riskPct: 1 })).toBeNull();
  });

  it("still computes when the only flaws are worth saying rather than blocking", () => {
    const n = numbersFor(long, { size: 10_000, riskPct: 8 });
    expect(n).not.toBeNull();
    expect(flawsIn(long, { size: 10_000, riskPct: 8 }).every((f) => !f.blocking)).toBe(true);
  });
});

it_("flaws that are worth saying out loud", () => {
  it("names the win rate a sub-1:1 target needs", () => {
    // 0.005 risk, 0.0025 reward — a 0.5:1, which needs two thirds of these to win.
    const flaws = flawsIn({ ...long, target: 1.0875 }, account);
    expect(flaws.some((f) => !f.blocking && /67% of the time/.test(f.message))).toBe(true);
  });

  it("counts how many losses in a row an oversized risk would take", () => {
    const flaws = flawsIn(long, { size: 10_000, riskPct: 10 });
    expect(flaws.some((f) => /10 consecutive losses/.test(f.message))).toBe(true);
  });

  it("says nothing about a 1% risk on a 3:1, because there is nothing to say", () => {
    expect(flawsIn(long, account)).toEqual([]);
  });

  it("questions a target far enough out that filling is the real issue", () => {
    const flaws = flawsIn({ ...long, target: 1.15 }, account);
    expect(flaws.some((f) => /whether it ever fills/.test(f.message))).toBe(true);
  });
});

it_("expectancy", () => {
  const n = numbersFor(long, account)!;

  it("is zero at exactly the breakeven win rate", () => {
    expect(expectancy(n, n.breakevenWinRate)).toBeCloseTo(0, 8);
  });

  it("is the full reward at certainty and the full risk at never", () => {
    expect(expectancy(n, 1)).toBeCloseTo(n.rewardAmount, 8);
    expect(expectancy(n, 0)).toBeCloseTo(-n.riskAmount, 8);
  });

  it("clamps a win rate given outside 0–1 rather than extrapolating", () => {
    expect(expectancy(n, 1.4)).toBeCloseTo(n.rewardAmount, 8);
    expect(expectancy(n, -3)).toBeCloseTo(-n.riskAmount, 8);
  });
});

it_("precisionOf", () => {
  it("takes the most precise of the three prices", () => {
    expect(precisionOf({ ...long, entry: 1.08512, stop: 1.08, target: 1.1 })).toBe(5);
  });

  it("is zero for whole numbers", () => {
    expect(precisionOf({ ...long, entry: 18000, stop: 17800, target: 18600 })).toBe(0);
  });
});

it_("describe", () => {
  it("states the setup and what has to be true in one line", () => {
    const n = numbersFor(long, account);
    const line = describeSetup(long, n);
    expect(line).toContain("EURUSD long on the 4h");
    expect(line).toContain("3:1");
    expect(line).toContain("breakeven win rate 25%");
  });

  it("says so when the numbers do not compute", () => {
    expect(describeSetup(long, null)).toContain("the numbers do not compute");
  });
});
