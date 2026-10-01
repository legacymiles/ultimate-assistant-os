import { describe, expect, it } from "vitest";
import { spend } from "./spend";
import { defaultSettings } from "./types";
import type { Account, Txn } from "./types";

function txn(over: Partial<Txn> = {}): Txn {
  return {
    id: "t1",
    accountId: "card",
    date: "2026-09-30",
    amount: 20,
    currency: "GBP",
    merchantRaw: "TESCO",
    merchantNorm: "tesco",
    pending: false,
    pendingTxnId: null,
    removedAt: null,
    category: null,
    ...over,
  };
}

const CARD: Account = {
  id: "card",
  name: "Amex",
  mask: "4421",
  type: "credit",
  currency: "GBP",
  countInSpend: true,
  balanceCurrent: 0,
};

const CURRENT: Account = {
  id: "bank",
  name: "Monzo",
  mask: "1234",
  type: "depository",
  currency: "GBP",
  countInSpend: false,
  balanceCurrent: 0,
};

const base = {
  accounts: [CARD, CURRENT],
  matchedTxnIds: new Set<string>(),
  settings: defaultSettings(),
  today: "2026-09-30",
};

describe("spend — what counts", () => {
  it("counts a card purchase", () => {
    const r = spend({ ...base, txns: [txn()] });
    expect(r.today.total).toBe(20);
    expect(r.today.count).toBe(1);
  });

  it("excludes a transaction that paid a declared bill", () => {
    const r = spend({
      ...base,
      txns: [txn({ id: "bill-txn" })],
      matchedTxnIds: new Set(["bill-txn"]),
    });
    expect(r.today.total).toBe(0);
  });

  it("excludes an account with countInSpend false", () => {
    const r = spend({ ...base, txns: [txn({ accountId: "bank" })] });
    expect(r.today.total).toBe(0);
  });

  it("lets a refund reduce the total", () => {
    const r = spend({
      ...base,
      txns: [txn({ id: "a", amount: 60 }), txn({ id: "b", amount: -60 })],
    });
    expect(r.today.total).toBe(0);
    expect(r.today.refunds).toBe(60);
  });

  it("includes pending charges but reports their share", () => {
    const r = spend({
      ...base,
      txns: [txn({ id: "a", amount: 20 }), txn({ id: "b", amount: 30, pending: true })],
    });
    expect(r.today.total).toBe(50);
    expect(r.today.pending).toBe(30);
  });
});

describe("spend — transfers and card payments", () => {
  it("excludes a credit-card payment by category", () => {
    const r = spend({
      ...base,
      txns: [txn({ id: "pay", amount: 400, category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" })],
    });
    expect(r.today.total).toBe(0);
    expect(r.today.excludedTransfers).toBe(1);
  });

  it("excludes a transfer by category", () => {
    const r = spend({ ...base, txns: [txn({ id: "x", amount: 100, category: "TRANSFER_OUT" })] });
    expect(r.today.total).toBe(0);
  });

  // The important one: categories are missing often enough that pair detection
  // has to carry it. A card cleared mid-window must not double the figure.
  it("excludes a card payment with no category, by pairing the two legs", () => {
    const paidFrom = { ...CURRENT, countInSpend: true };
    const r = spend({
      ...base,
      accounts: [CARD, paidFrom],
      txns: [
        txn({ id: "out", accountId: "bank", amount: 400, merchantNorm: "amex payment" }),
        txn({ id: "in", accountId: "card", amount: -400, merchantNorm: "payment received" }),
      ],
    });
    expect(r.today.total).toBe(0);
    expect(r.today.excludedTransfers).toBe(2);
  });

  it("pairs the legs when they land a couple of days apart", () => {
    const paidFrom = { ...CURRENT, countInSpend: true };
    const r = spend({
      ...base,
      accounts: [CARD, paidFrom],
      txns: [
        txn({ id: "out", accountId: "bank", amount: 400, date: "2026-09-28" }),
        txn({ id: "in", accountId: "card", amount: -400, date: "2026-09-30" }),
      ],
      window: { from: "2026-09-28", to: "2026-09-30" },
    });
    expect(r.week.total).toBe(0);
  });

  it("does not pair two unrelated charges of the same amount on one account", () => {
    const r = spend({
      ...base,
      txns: [
        txn({ id: "a", amount: 40, merchantNorm: "tesco" }),
        txn({ id: "b", amount: 40, merchantNorm: "shell" }),
      ],
    });
    expect(r.today.total).toBe(80);
    expect(r.today.excludedTransfers).toBe(0);
  });
});

describe("spend — the two windows", () => {
  const week = [
    txn({ id: "m", date: "2026-09-28", amount: 10 }),
    txn({ id: "t", date: "2026-09-29", amount: 20 }),
    txn({ id: "w", date: "2026-09-30", amount: 30 }),
    // Last week, same elapsed position (Mon–Wed).
    txn({ id: "lm", date: "2026-09-21", amount: 100 }),
    txn({ id: "lt", date: "2026-09-22", amount: 100 }),
    txn({ id: "lw", date: "2026-09-23", amount: 100 }),
    // Last week, AFTER the elapsed point — must not count in the comparison.
    txn({ id: "lf", date: "2026-09-25", amount: 500 }),
  ];

  it("totals this week from the configured week start", () => {
    const r = spend({ ...base, txns: week });
    expect(r.week.total).toBe(60);
    expect(r.week.from).toBe("2026-09-28");
  });

  // Comparing a Wednesday against a complete previous week makes every week
  // look cheap until Sunday.
  it("compares against the previous week only as far as the same weekday", () => {
    const r = spend({ ...base, txns: week });
    expect(r.previousWeek.total).toBe(300);
    expect(r.previousWeek.to).toBe("2026-09-23");
  });

  it("honours a Sunday week start", () => {
    const settings = { ...defaultSettings(), weekStartsOn: 0 };
    const r = spend({ ...base, settings, txns: week });
    expect(r.week.from).toBe("2026-09-27");
  });

  it("reports a seven-day series in local days", () => {
    const r = spend({ ...base, txns: week });
    expect(r.series).toHaveLength(7);
    expect(r.series[r.series.length - 1]).toEqual({ day: "2026-09-30", total: 30 });
    expect(r.series[0].day).toBe("2026-09-24");
  });

  it("ranks the top merchants in the week", () => {
    const r = spend({
      ...base,
      txns: [
        txn({ id: "a", date: "2026-09-28", amount: 10, merchantNorm: "tesco" }),
        txn({ id: "b", date: "2026-09-29", amount: 40, merchantNorm: "shell" }),
        txn({ id: "c", date: "2026-09-30", amount: 5, merchantNorm: "tesco" }),
      ],
    });
    expect(r.topMerchants[0]).toEqual({ merchant: "shell", total: 40, count: 1 });
    expect(r.topMerchants[1]).toEqual({ merchant: "tesco", total: 15, count: 2 });
  });

  it("is all zeros with no transactions", () => {
    const r = spend({ ...base, txns: [] });
    expect(r.today.total).toBe(0);
    expect(r.week.total).toBe(0);
    expect(r.series.every((p) => p.total === 0)).toBe(true);
    expect(r.topMerchants).toEqual([]);
  });

  it("ignores a transaction outside every window", () => {
    const r = spend({ ...base, txns: [txn({ id: "old", date: "2026-01-01", amount: 999 })] });
    expect(r.week.total).toBe(0);
    expect(r.series.every((p) => p.total === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Found by running the engine over a REAL Plaid sandbox feed. Plaid's
// categories are hierarchical, and matching the detailed string exactly missed
// its siblings — so a 2,078.50 credit-card payment labelled
// LOAN_PAYMENTS_OTHER_PAYMENT was counted as spending.
// ---------------------------------------------------------------------------
describe("spend — transfer categories match by prefix, not exact name", () => {
  it("excludes a card payment labelled LOAN_PAYMENTS_OTHER_PAYMENT", () => {
    const r = spend({
      ...base,
      txns: [txn({ id: "pay", amount: 2078.5, category: "LOAN_PAYMENTS_OTHER_PAYMENT" })],
    });
    expect(r.today.total).toBe(0);
    expect(r.today.excludedTransfers).toBe(1);
  });

  it("excludes TRANSFER_OUT_ACCOUNT_TRANSFER", () => {
    const r = spend({
      ...base,
      txns: [txn({ id: "x", amount: 1000, category: "TRANSFER_OUT_ACCOUNT_TRANSFER" })],
    });
    expect(r.today.total).toBe(0);
  });

  it("excludes TRANSFER_IN_DEPOSIT", () => {
    const r = spend({
      ...base,
      txns: [txn({ id: "x", amount: 5850, category: "TRANSFER_IN_DEPOSIT" })],
    });
    expect(r.today.total).toBe(0);
  });

  it("excludes a mortgage payment, which is not discretionary spending either", () => {
    const r = spend({
      ...base,
      txns: [txn({ id: "x", amount: 900, category: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" })],
    });
    expect(r.today.total).toBe(0);
  });

  // The filter must not swallow ordinary purchases that merely start similarly.
  it("still counts a real purchase", () => {
    const r = spend({
      ...base,
      txns: [txn({ id: "x", amount: 42, category: "GENERAL_MERCHANDISE_SUPERSTORES" })],
    });
    expect(r.today.total).toBe(42);
  });

  it("still counts a transaction with no category at all", () => {
    const r = spend({ ...base, txns: [txn({ id: "x", amount: 42, category: null })] });
    expect(r.today.total).toBe(42);
  });
});
