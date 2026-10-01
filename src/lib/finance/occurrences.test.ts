import { describe, expect, it } from "vitest";
import { occurrences } from "./occurrences";
import type { Bill } from "./types";

function bill(over: Partial<Bill> = {}): Bill {
  return {
    id: "b1",
    name: "Rent",
    matchers: ["landlord"],
    amountExpected: 1200,
    amountTolerance: 1,
    amountTolerancePct: 5,
    currency: "GBP",
    accountId: "a1",
    autopay: true,
    cadence: "monthly",
    dayOfMonth: 1,
    weekday: null,
    monthOfYear: null,
    firstDue: "2026-01-01",
    endDate: null,
    graceDays: 3,
    reminders: [],
    paused: false,
    origin: "typed",
    ...over,
  };
}

const dues = (b: Bill, from: string, to: string) =>
  occurrences(b, from, to).map((o) => o.due);

describe("occurrences — monthly", () => {
  it("lands on the nominated day each month", () => {
    expect(dues(bill({ dayOfMonth: 12 }), "2026-09-01", "2026-11-30")).toEqual([
      "2026-09-12",
      "2026-10-12",
      "2026-11-12",
    ]);
  });

  // The month-end trap: a bill "due on the 31st" has no 31st in February.
  it("clamps the 31st to the last day of a short month", () => {
    expect(dues(bill({ dayOfMonth: 31 }), "2026-01-01", "2026-04-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("clamps to 29 February in a leap year", () => {
    expect(dues(bill({ dayOfMonth: 30 }), "2028-02-01", "2028-02-29")).toEqual([
      "2028-02-29",
    ]);
  });

  it("excludes dates before the window", () => {
    expect(dues(bill({ dayOfMonth: 1 }), "2026-09-02", "2026-10-31")).toEqual([
      "2026-10-01",
    ]);
  });

  it("never produces a date before firstDue", () => {
    const b = bill({ dayOfMonth: 1, firstDue: "2026-10-01" });
    expect(dues(b, "2026-01-01", "2026-12-31")).toEqual([
      "2026-10-01",
      "2026-11-01",
      "2026-12-01",
    ]);
  });

  it("stops at endDate", () => {
    const b = bill({ dayOfMonth: 1, endDate: "2026-11-15" });
    expect(dues(b, "2026-09-01", "2026-12-31")).toEqual([
      "2026-09-01",
      "2026-10-01",
      "2026-11-01",
    ]);
  });
});

describe("occurrences — other cadences", () => {
  it("steps weekly from firstDue", () => {
    const b = bill({ cadence: "weekly", weekday: 1, firstDue: "2026-09-07" });
    expect(dues(b, "2026-09-01", "2026-09-30")).toEqual([
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
  });

  it("steps fortnightly from firstDue", () => {
    const b = bill({ cadence: "fortnightly", weekday: 1, firstDue: "2026-09-07" });
    expect(dues(b, "2026-09-01", "2026-10-31")).toEqual([
      "2026-09-07",
      "2026-09-21",
      "2026-10-05",
      "2026-10-19",
    ]);
  });

  it("steps quarterly", () => {
    const b = bill({ cadence: "quarterly", dayOfMonth: 15, firstDue: "2026-01-15" });
    expect(dues(b, "2026-01-01", "2026-12-31")).toEqual([
      "2026-01-15",
      "2026-04-15",
      "2026-07-15",
      "2026-10-15",
    ]);
  });

  it("steps annually", () => {
    const b = bill({
      cadence: "annual",
      dayOfMonth: 3,
      monthOfYear: 6,
      firstDue: "2026-06-03",
    });
    expect(dues(b, "2026-01-01", "2028-12-31")).toEqual([
      "2026-06-03",
      "2027-06-03",
      "2028-06-03",
    ]);
  });

  it("yields a one-off exactly once", () => {
    const b = bill({ cadence: "one_off", firstDue: "2026-09-20" });
    expect(dues(b, "2026-01-01", "2026-12-31")).toEqual(["2026-09-20"]);
  });

  it("yields nothing for a one-off outside the window", () => {
    const b = bill({ cadence: "one_off", firstDue: "2026-09-20" });
    expect(dues(b, "2026-10-01", "2026-12-31")).toEqual([]);
  });
});

describe("occurrences — guards", () => {
  it("yields nothing for a paused bill", () => {
    expect(dues(bill({ paused: true }), "2026-09-01", "2026-12-31")).toEqual([]);
  });

  it("carries the bill's amount, currency and account onto each occurrence", () => {
    const out = occurrences(bill({ dayOfMonth: 5 }), "2026-09-01", "2026-09-30");
    expect(out[0]).toEqual({
      billId: "b1",
      due: "2026-09-05",
      amountExpected: 1200,
      currency: "GBP",
      accountId: "a1",
    });
  });

  it("yields nothing when the window is inverted", () => {
    expect(dues(bill(), "2026-12-31", "2026-01-01")).toEqual([]);
  });

  // A long window on a weekly bill must not spin forever if a date fails to
  // advance. The hard ceiling keeps it bounded.
  it("terminates on a very long window", () => {
    const b = bill({ cadence: "weekly", firstDue: "2000-01-01" });
    expect(occurrences(b, "2000-01-01", "2030-01-01").length).toBeLessThan(2000);
  });
});
