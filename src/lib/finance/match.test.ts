import { describe, expect, it } from "vitest";
import { matchOccurrences } from "./match";
import type { Bill, Occurrence, Txn } from "./types";

function bill(over: Partial<Bill> = {}): Bill {
  return {
    id: "b1",
    name: "Spotify",
    matchers: ["spotify"],
    amountExpected: 9.99,
    amountTolerance: 1,
    amountTolerancePct: 5,
    currency: "GBP",
    accountId: "a1",
    autopay: true,
    cadence: "monthly",
    dayOfMonth: 12,
    weekday: null,
    monthOfYear: null,
    firstDue: "2026-01-12",
    endDate: null,
    graceDays: 3,
    reminders: [],
    paused: false,
    origin: "typed",
    ...over,
  };
}

function occ(over: Partial<Occurrence> = {}): Occurrence {
  return {
    billId: "b1",
    due: "2026-09-12",
    amountExpected: 9.99,
    currency: "GBP",
    accountId: "a1",
    ...over,
  };
}

function txn(over: Partial<Txn> = {}): Txn {
  return {
    id: "t1",
    accountId: "a1",
    date: "2026-09-12",
    amount: 9.99,
    currency: "GBP",
    merchantRaw: "SPOTIFY AB",
    merchantNorm: "spotify ab",
    pending: false,
    pendingTxnId: null,
    removedAt: null,
    category: null,
    ...over,
  };
}

describe("matchOccurrences", () => {
  it("matches a charge on the due date", () => {
    const r = matchOccurrences([occ()], [txn()], [bill()]);
    expect(r.matched[0].txn?.id).toBe("t1");
    expect(r.unmatchedTxns).toEqual([]);
  });

  it("matches a charge a few days late, inside the grace period", () => {
    const r = matchOccurrences([occ()], [txn({ date: "2026-09-15" })], [bill()]);
    expect(r.matched[0].txn?.id).toBe("t1");
  });

  it("does not match a charge past the grace period", () => {
    const r = matchOccurrences([occ()], [txn({ date: "2026-09-16" })], [bill()]);
    expect(r.matched[0].txn).toBeNull();
    expect(r.unmatchedTxns.map((t) => t.id)).toEqual(["t1"]);
  });

  it("matches a charge taken a few days early", () => {
    const r = matchOccurrences([occ()], [txn({ date: "2026-09-08" })], [bill()]);
    expect(r.matched[0].txn?.id).toBe("t1");
  });

  it("does not match a charge more than five days early", () => {
    const r = matchOccurrences([occ()], [txn({ date: "2026-09-06" })], [bill()]);
    expect(r.matched[0].txn).toBeNull();
  });

  it("does not match a different payee for the right amount", () => {
    const r = matchOccurrences([occ()], [txn({ merchantNorm: "netflix" })], [bill()]);
    expect(r.matched[0].txn).toBeNull();
  });

  it("does not match the right payee for a wildly wrong amount", () => {
    const r = matchOccurrences([occ()], [txn({ amount: 99.99 })], [bill()]);
    expect(r.matched[0].txn).toBeNull();
  });

  it("matches inside the tolerance", () => {
    // 5% of 9.99 is 0.50, so the absolute 1.00 applies: 10.99 is the edge.
    const r = matchOccurrences([occ()], [txn({ amount: 10.99 })], [bill()]);
    expect(r.matched[0].txn?.id).toBe("t1");
  });

  it("rejects a cent past the tolerance", () => {
    const r = matchOccurrences([occ()], [txn({ amount: 11.0 })], [bill()]);
    expect(r.matched[0].txn).toBeNull();
  });

  it("gives a transaction to the nearest occurrence, not the first", () => {
    const o1 = occ({ due: "2026-09-12" });
    const o2 = occ({ due: "2026-10-12" });
    const t = txn({ date: "2026-10-12" });
    const r = matchOccurrences([o1, o2], [t], [bill()]);
    expect(r.matched.find((m) => m.occurrence.due === "2026-10-12")?.txn?.id).toBe("t1");
    expect(r.matched.find((m) => m.occurrence.due === "2026-09-12")?.txn).toBeNull();
  });

  it("never gives one transaction to two occurrences", () => {
    const o1 = occ({ due: "2026-09-12" });
    const o2 = occ({ due: "2026-09-13" });
    const r = matchOccurrences([o1, o2], [txn()], [bill()]);
    expect(r.matched.filter((m) => m.txn !== null)).toHaveLength(1);
  });

  it("matches two charges to two occurrences", () => {
    const r = matchOccurrences(
      [occ({ due: "2026-09-12" }), occ({ due: "2026-10-12" })],
      [txn({ id: "t1", date: "2026-09-12" }), txn({ id: "t2", date: "2026-10-12" })],
      [bill()],
    );
    expect(r.matched.map((m) => m.txn?.id)).toEqual(["t1", "t2"]);
    expect(r.unmatchedTxns).toEqual([]);
  });

  it("ignores a charge on another account when the bill names one", () => {
    const r = matchOccurrences([occ()], [txn({ accountId: "a2" })], [bill()]);
    expect(r.matched[0].txn).toBeNull();
  });

  it("accepts any account when the bill names none", () => {
    const r = matchOccurrences(
      [occ({ accountId: null })],
      [txn({ accountId: "a2" })],
      [bill({ accountId: null })],
    );
    expect(r.matched[0].txn?.id).toBe("t1");
  });

  it("ignores a refund when matching a bill", () => {
    const r = matchOccurrences([occ()], [txn({ amount: -9.99 })], [bill()]);
    expect(r.matched[0].txn).toBeNull();
  });

  it("reports transactions that matched nothing", () => {
    const r = matchOccurrences([], [txn({ id: "x", merchantNorm: "tesco" })], [bill()]);
    expect(r.unmatchedTxns.map((t) => t.id)).toEqual(["x"]);
  });

  it("reports the ids of every matched transaction", () => {
    const r = matchOccurrences([occ()], [txn()], [bill()]);
    expect(r.matchedTxnIds.has("t1")).toBe(true);
  });
});
