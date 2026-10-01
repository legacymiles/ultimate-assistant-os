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

// ---------------------------------------------------------------------------
// Partial card payments. The owner clears cards in CHUNKS, not in full, so two
// equal payments days apart are the normal case — not a double charge, and not
// spending. Both exclusions are driven by one transfer set computed in
// reconcile, which is why they are tested here rather than in either module.
// ---------------------------------------------------------------------------

const CURRENT: Account = {
  id: "bank",
  name: "Monzo",
  mask: "1234",
  type: "depository",
  currency: "GBP",
  countInSpend: true,
  balanceCurrent: 1500,
};

describe("reconcile — partial card payments", () => {
  const input = {
    bills: [],
    accounts: [CARD, CURRENT],
    settings: defaultSettings(),
    today: "2026-09-30",
    from: "2026-09-01",
    to: "2026-10-31",
  };

  /** One chunk: money out of the current account, in against the card. */
  const chunk = (n: string, date: string, amount: number): Txn[] => [
    txn({
      id: `out-${n}`,
      accountId: "bank",
      date,
      amount,
      merchantNorm: "amex payment",
      category: null,
    }),
    txn({
      id: `in-${n}`,
      accountId: "card",
      date,
      amount: -amount,
      merchantNorm: "payment received",
      category: null,
    }),
  ];

  it("does not call two equal partial payments a duplicate charge", () => {
    const r = reconcile({
      ...input,
      txns: [...chunk("a", "2026-09-03", 200), ...chunk("b", "2026-09-06", 200)],
    });
    expect(r.findings.map((f) => f.kind)).not.toContain("duplicate-charge");
  });

  it("does not count either payment as spending", () => {
    const r = reconcile({
      ...input,
      txns: [
        ...chunk("a", "2026-09-28", 200),
        ...chunk("b", "2026-09-30", 200),
        txn({ id: "food", date: "2026-09-30", amount: 24, merchantNorm: "tesco" }),
      ],
    });
    expect(r.spend.week.total).toBe(24);
    expect(r.spend.week.excludedTransfers).toBe(4);
  });

  it("pairs three chunks in order rather than arbitrarily", () => {
    const r = reconcile({
      ...input,
      txns: [
        ...chunk("a", "2026-09-10", 150),
        ...chunk("b", "2026-09-20", 150),
        ...chunk("c", "2026-09-29", 150),
      ],
    });
    expect(r.transfers.size).toBe(6);
    expect(r.findings.map((f) => f.kind)).not.toContain("duplicate-charge");
  });

  it("does not read a run of partial payments as an undeclared subscription", () => {
    // Three evenly-spaced equal amounts is exactly the unplanned-recurring
    // shape, so transfers have to be excluded there too.
    const r = reconcile({
      ...input,
      txns: [
        ...chunk("a", "2026-07-10", 150),
        ...chunk("b", "2026-08-10", 150),
        ...chunk("c", "2026-09-10", 150),
      ],
    });
    expect(r.findings.map((f) => f.kind)).not.toContain("unplanned-recurring");
  });

  it("still catches a genuine double charge on the card itself", () => {
    // The exclusion must not have blunted the detector it was protecting.
    const r = reconcile({
      ...input,
      txns: [
        ...chunk("a", "2026-09-03", 200),
        txn({ id: "d1", date: "2026-09-12", amount: 42.5, merchantNorm: "argos" }),
        txn({ id: "d2", date: "2026-09-13", amount: 42.5, merchantNorm: "argos" }),
      ],
    });
    const dup = r.findings.find((f) => f.kind === "duplicate-charge");
    expect(dup?.txnIds.sort()).toEqual(["d1", "d2"]);
  });
});
