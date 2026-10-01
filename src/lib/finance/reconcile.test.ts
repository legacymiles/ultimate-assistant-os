import { describe, expect, it } from "vitest";
import { reconcile } from "./reconcile";
import { defaultSettings } from "./types";
import type { Account, Bill, Txn } from "./types";

const CARD: Account = {
  id: "card",
  name: "Amex Gold",
  mask: "4421",
  type: "credit",
  currency: "GBP",
  countInSpend: true,
  balanceCurrent: 310,
  nextDueDate: "2026-10-04",
  lastStatementBalance: 310,
  minimumPayment: 25,
  statementLastClosed: "2026-09-07",
  datesSource: "bank",
};

const SPOTIFY: Bill = {
  id: "b-spotify",
  name: "Spotify",
  matchers: ["spotify"],
  amountExpected: 9.99,
  amountTolerance: 1,
  amountTolerancePct: 5,
  currency: "GBP",
  accountId: "card",
  autopay: true,
  cadence: "monthly",
  dayOfMonth: 12,
  weekday: null,
  monthOfYear: null,
  firstDue: "2026-01-12",
  endDate: null,
  graceDays: 3,
  reminders: [1440],
  paused: false,
  origin: "typed",
};

function txn(over: Partial<Txn>): Txn {
  return {
    id: "x",
    accountId: "card",
    date: "2026-09-12",
    amount: 9.99,
    currency: "GBP",
    merchantRaw: "SPOTIFY",
    merchantNorm: "spotify",
    pending: false,
    pendingTxnId: null,
    removedAt: null,
    category: null,
    ...over,
  };
}

describe("reconcile", () => {
  const input = {
    bills: [SPOTIFY],
    accounts: [CARD],
    settings: defaultSettings(),
    today: "2026-09-30",
    from: "2026-09-01",
    to: "2026-10-31",
  };

  it("pays a bill cleanly and raises nothing but the card date", () => {
    const r = reconcile({ ...input, txns: [txn({ id: "t1" })] });
    expect(r.findings.map((f) => f.kind)).toEqual(["card-due-soon"]);
    expect(r.matchedTxnIds.has("t1")).toBe(true);
  });

  // The whole point of folding first: this pair is ONE charge, not two.
  it("does not call a pending/posted pair a duplicate", () => {
    const r = reconcile({
      ...input,
      txns: [txn({ id: "pend", pending: true }), txn({ id: "post", pendingTxnId: "pend" })],
    });
    expect(r.findings.map((f) => f.kind)).not.toContain("duplicate-charge");
    expect(r.txns.map((t) => t.id)).toEqual(["post"]);
  });

  it("catches a bill that was genuinely charged twice", () => {
    const r = reconcile({
      ...input,
      txns: [txn({ id: "t1" }), txn({ id: "t2", date: "2026-09-13" })],
    });
    const dup = r.findings.find((f) => f.kind === "duplicate-charge");
    expect(dup?.txnIds.sort()).toEqual(["t1", "t2"]);
  });

  it("reports a bill that never arrived", () => {
    const r = reconcile({ ...input, txns: [] });
    expect(r.findings.map((f) => f.kind)).toContain("missed-bill");
  });

  it("produces a spend report that excludes the bill", () => {
    const r = reconcile({
      ...input,
      txns: [
        txn({ id: "t1" }),
        txn({ id: "food", date: "2026-09-30", amount: 24, merchantNorm: "tesco" }),
      ],
    });
    expect(r.spend.today.total).toBe(24);
    expect(r.spend.week.total).toBe(24);
  });

  it("works with no bills, no accounts and no transactions", () => {
    const r = reconcile({ ...input, bills: [], accounts: [], txns: [] });
    expect(r.findings).toEqual([]);
    expect(r.spend.week.total).toBe(0);
    expect(r.occurrences).toEqual([]);
  });
});
