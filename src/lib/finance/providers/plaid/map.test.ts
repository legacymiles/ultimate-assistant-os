import { describe, expect, it } from "vitest";
import accountsFixture from "./fixtures/accounts.json";
import liabilitiesFixture from "./fixtures/liabilities.json";
import syncFixture from "./fixtures/sync.json";
import {
  applyCardTerms,
  cycleDaysFrom,
  mapAccounts,
  mapLiabilities,
  mapSync,
  mapTxn,
} from "./map";
import type { PlaidTxn } from "./map";
import { fold } from "../../fold";
import type { Txn } from "../../types";

const accounts = mapAccounts(accountsFixture.accounts);
const page = mapSync(syncFixture);
const terms = mapLiabilities(liabilitiesFixture);
const byId = (id: string) => accounts.find((a) => a.providerAccountId === id);

describe("mapAccounts", () => {
  it("maps the credit card and the current account", () => {
    expect(byId("cc-amex-001")?.type).toBe("credit");
    expect(byId("dep-checking-001")?.type).toBe("depository");
  });

  // A loan mapped as a credit card would be shown a statement cycle it has not got.
  it("drops an account type this feature does not model", () => {
    expect(byId("loan-student-001")).toBeUndefined();
    expect(accounts).toHaveLength(3);
  });

  it("counts a credit card in spend and a current account not", () => {
    expect(byId("cc-amex-001")?.countInSpend).toBe(true);
    expect(byId("dep-checking-001")?.countInSpend).toBe(false);
  });

  it("takes the credit limit only for credit accounts", () => {
    expect(byId("cc-amex-001")?.creditLimit).toBe(2000);
    expect(byId("dep-checking-001")?.creditLimit).toBeNull();
  });

  it("reads each account's own currency", () => {
    expect(byId("cc-amex-001")?.currency).toBe("USD");
    expect(byId("cc-visa-002")?.currency).toBe("GBP");
  });

  it("falls back to the official name when name is absent", () => {
    const mapped = mapAccounts([
      { account_id: "x", type: "credit", name: null, official_name: "Official Card" },
    ]);
    expect(mapped[0].name).toBe("Official Card");
  });

  it("starts every card's dates as typed, never as bank", () => {
    // Nothing is known until /liabilities/get says so.
    expect(byId("cc-amex-001")?.datesSource).toBe("typed");
  });
});

describe("mapTxn", () => {
  const txnById = (id: string) => page.added.find((t) => t.providerTxnId === id);

  // Rule 1. Flipping signs here would invert every spend figure in the app.
  it("passes the sign through untouched", () => {
    expect(txnById("txn-posted-001")?.amount).toBe(58.5);
    expect(txnById("txn-refund-004")?.amount).toBe(-24.99);
  });

  // Rule 2. Without this link, fold cannot collapse the pair.
  it("keeps pending_transaction_id", () => {
    expect(txnById("txn-posted-001")?.pendingTxnId).toBe("txn-pending-001");
    expect(txnById("txn-pending-001")?.pendingTxnId).toBeNull();
    expect(txnById("txn-pending-001")?.pending).toBe(true);
  });

  it("falls back from merchant_name to name", () => {
    expect(txnById("txn-noname-002")?.merchantRaw).toBe("SQ *BLUE BOTTLE COFFEE");
    expect(txnById("txn-noname-002")?.merchantNorm).toBe("blue bottle coffee");
  });

  it("normalizes the merchant for matching", () => {
    expect(txnById("txn-posted-001")?.merchantNorm).toBe("bistro rouge");
  });

  it("falls back to the unofficial currency code", () => {
    expect(txnById("txn-refund-004")?.currency).toBe("XBT");
  });

  it("keeps the detailed category, which the transfer rule reads", () => {
    expect(txnById("txn-cardpay-003")?.category).toBe("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
  });

  it("tolerates a missing category", () => {
    expect(txnById("txn-noname-002")?.category).toBeNull();
  });

  it("never marks a freshly mapped row as removed", () => {
    expect(page.added.every((t) => t.removedAt === null)).toBe(true);
  });

  it("defaults pending to false when absent", () => {
    const t: PlaidTxn = { transaction_id: "a", account_id: "b", amount: 1, date: "2026-01-01" };
    expect(mapTxn(t).pending).toBe(false);
  });
});

describe("mapSync", () => {
  it("carries the cursor and the has_more flag", () => {
    expect(page.cursor).toBe("cursor-page-2");
    expect(page.hasMore).toBe(true);
  });

  it("reduces removed entries to bare ids", () => {
    expect(page.removed).toEqual(["txn-gone-009"]);
  });

  it("maps modified rows too", () => {
    expect(page.modified[0].providerTxnId).toBe("txn-noname-002");
    expect(page.modified[0].amount).toBe(13.4);
  });

  it("tolerates an empty response", () => {
    const empty = mapSync({});
    expect(empty.added).toEqual([]);
    expect(empty.hasMore).toBe(false);
    expect(empty.cursor).toBeNull();
  });
});

// The point of the whole mapper: what it produces must survive stage 1.
describe("the mapped feed folds correctly", () => {
  it("collapses the pending/posted pair into the posted row", () => {
    const txns: Txn[] = page.added.map((t) => ({
      ...t,
      id: t.providerTxnId,
      accountId: t.providerAccountId,
    }));
    const folded = fold(txns);
    expect(folded.map((t) => t.id)).not.toContain("txn-pending-001");
    expect(folded.map((t) => t.id)).toContain("txn-posted-001");
    // And the posted amount is the one that actually landed, tip included.
    expect(folded.find((t) => t.id === "txn-posted-001")?.amount).toBe(58.5);
  });
});

describe("mapLiabilities", () => {
  it("reads every field the no-typing promise depends on", () => {
    expect(terms[0]).toEqual({
      providerAccountId: "cc-amex-001",
      lastStatementBalance: 410,
      statementLastClosed: "2026-09-07",
      nextDueDate: "2026-10-04",
      minimumPayment: 25,
      isOverdue: false,
      aprPurchase: 27.95,
      creditLimit: null,
    });
  });

  it("picks the purchase APR rather than the first one listed", () => {
    // balance_transfer_apr is first in the fixture.
    expect(terms[0].aprPurchase).toBe(27.95);
  });

  it("returns nothing when the item has no liabilities", () => {
    expect(mapLiabilities({})).toEqual([]);
    expect(mapLiabilities({ liabilities: { credit: null } })).toEqual([]);
  });
});

describe("cycleDaysFrom", () => {
  it("measures a normal cycle", () => {
    expect(cycleDaysFrom("2026-08-07", "2026-09-07")).toBe(31);
  });
  it("is null without a previous statement", () => {
    expect(cycleDaysFrom(null, "2026-09-07")).toBeNull();
  });
  it("rejects a gap too short to be a cycle", () => {
    expect(cycleDaysFrom("2026-09-01", "2026-09-07")).toBeNull();
  });
  it("rejects a gap too long to be a cycle", () => {
    expect(cycleDaysFrom("2026-06-07", "2026-09-07")).toBeNull();
  });
});

describe("applyCardTerms", () => {
  const amex = byId("cc-amex-001")!;

  it("sets the bank-published dates and marks them as from the bank", () => {
    const out = applyCardTerms(amex, terms[0]);
    expect(out.nextDueDate).toBe("2026-10-04");
    expect(out.statementLastClosed).toBe("2026-09-07");
    expect(out.minimumPayment).toBe(25);
    expect(out.datesSource).toBe("bank");
  });

  // Rule 3. Plaid's liabilities coverage is US-first; a UK card gets no record.
  it("leaves a card with no record on typed dates", () => {
    const visa = byId("cc-visa-002")!;
    const out = applyCardTerms(visa, undefined);
    expect(out.datesSource).toBe("typed");
    expect(out.nextDueDate).toBeUndefined();
  });

  it("produces no next closing date without a measured cycle", () => {
    // Nobody publishes it, so with one statement there is nothing to derive.
    const out = applyCardTerms(amex, terms[0], null);
    expect(out.statementNextClosing).toBeNull();
    expect(out.statementNextClosingEstimated).toBe(false);
  });

  it("derives the next closing date once a cycle is measurable, and flags it estimated", () => {
    const out = applyCardTerms(amex, terms[0], "2026-08-07");
    expect(out.cycleDays).toBe(31);
    expect(out.statementNextClosing).toBe("2026-10-08");
    expect(out.statementNextClosingEstimated).toBe(true);
  });
});
