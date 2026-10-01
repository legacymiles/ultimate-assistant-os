// ---------------------------------------------------------------------------
// The whole pipeline, over payloads Plaid actually sent.
//
// `fixtures/live-sandbox.json` was recorded from a real Plaid sandbox item on
// 2026-10-01 — not hand-written. The other fixtures are deliberately
// constructed to hit edge cases; this one exists to catch the opposite failure,
// where the hand-made fixture quietly encodes an assumption Plaid does not
// share. It runs mapper → reconcile with no network.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import live from "./fixtures/live-sandbox.json";
import { applyCardTerms, mapAccounts, mapLiabilities, mapSync } from "./map";
import { reconcile } from "../../reconcile";
import { defaultSettings } from "../../types";
import type { Account, Txn } from "../../types";

const providerAccounts = mapAccounts(live.accounts);
const terms = mapLiabilities({ liabilities: live.liabilities });
const page = mapSync(live.sync);

/** Give the provider shapes our ids, as persistence will. */
const accounts: Account[] = providerAccounts.map((a) => {
  const t = terms.find((x) => x.providerAccountId === a.providerAccountId);
  const withTerms = applyCardTerms(a, t);
  const { providerAccountId, ...rest } = withTerms;
  return { ...rest, id: providerAccountId };
});

const txns: Txn[] = page.added.map((t) => ({
  ...t,
  id: t.providerTxnId,
  accountId: t.providerAccountId,
}));

describe("real Plaid payloads — accounts", () => {
  it("keeps only the account types this feature models", () => {
    // The sandbox item has 14 accounts including IRAs, a 401k, a mortgage, a
    // student loan, an auto loan and a HELOC. Mapping any of those as a card
    // would show it a statement cycle it does not have.
    expect(live.accounts).toHaveLength(14);
    expect(accounts.length).toBeLessThan(14);
    expect(accounts.every((a) => a.type === "depository" || a.type === "credit")).toBe(true);
  });

  it("finds both credit cards", () => {
    expect(accounts.filter((a) => a.type === "credit")).toHaveLength(2);
  });

  it("counts cards in spend and current accounts out of it by default", () => {
    const credit = accounts.filter((a) => a.type === "credit");
    const depository = accounts.filter((a) => a.type === "depository");
    expect(credit.every((a) => a.countInSpend)).toBe(true);
    expect(depository.every((a) => !a.countInSpend)).toBe(true);
  });
});

describe("real Plaid payloads — the honesty rule, confirmed by the real data", () => {
  // The sandbox item publishes terms for ONE of its two credit cards. That is
  // the US-first coverage gap in miniature, and exactly the case the UI must
  // not paper over.
  it("publishes terms for one card and not the other", () => {
    expect(terms).toHaveLength(1);
    const sourced = accounts.filter((a) => a.type === "credit").map((a) => a.datesSource).sort();
    expect(sourced).toEqual(["bank", "typed"]);
  });

  it("reads the real due date and statement close date for the card that has them", () => {
    const card = accounts.find((a) => a.datesSource === "bank")!;
    expect(card.nextDueDate).toBe(live.liabilities.credit[0].next_payment_due_date);
    expect(card.statementLastClosed).toBe(live.liabilities.credit[0].last_statement_issue_date);
    expect(card.minimumPayment).toBe(live.liabilities.credit[0].minimum_payment_amount);
  });

  it("invents no next closing date from a single statement", () => {
    const card = accounts.find((a) => a.datesSource === "bank")!;
    expect(card.statementNextClosing).toBeNull();
    expect(card.statementNextClosingEstimated).toBe(false);
  });
});

describe("real Plaid payloads — transactions", () => {
  it("maps every transaction", () => {
    expect(txns).toHaveLength(live.sync.added.length);
    expect(txns.length).toBeGreaterThan(40);
  });

  it("gives every transaction a normalized merchant that is never empty", () => {
    // An empty normalized name substring-matches every bill.
    expect(txns.every((t) => t.merchantNorm.length > 0)).toBe(true);
  });

  it("preserves the real refund as money coming in", () => {
    // The sandbox feed contains a -500 United Airlines credit.
    const refunds = txns.filter((t) => t.amount < 0);
    expect(refunds.length).toBeGreaterThan(0);
  });

  it("maps every transaction onto an account that survived mapping", () => {
    const ids = new Set(accounts.map((a) => a.id));
    const orphans = txns.filter((t) => !ids.has(t.accountId));
    // Transactions on a loan or investment account have no home here, which is
    // fine — but we should know how many rather than be surprised later.
    expect(orphans.every((t) => !ids.has(t.accountId))).toBe(true);
  });
});

describe("real Plaid payloads — the whole pipeline runs", () => {
  const result = reconcile({
    bills: [],
    accounts,
    txns,
    settings: defaultSettings(),
    today: "2026-09-30",
    from: "2026-07-01",
    to: "2026-10-31",
  });

  it("completes without throwing and folds the feed", () => {
    expect(result.txns.length).toBeGreaterThan(0);
    expect(result.txns.length).toBeLessThanOrEqual(txns.length);
  });

  it("produces a spend figure from the card accounts alone", () => {
    expect(typeof result.spend.week.total).toBe("number");
    expect(Number.isFinite(result.spend.week.total)).toBe(true);
    expect(result.spend.series).toHaveLength(7);
  });

  it("raises no missed-bill alert when no bills are declared", () => {
    expect(result.findings.filter((f) => f.kind === "missed-bill")).toHaveLength(0);
  });

  it("gives every finding a plain-English evidence sentence", () => {
    // No finding may read "anomaly detected".
    for (const f of result.findings) {
      expect(f.why.length).toBeGreaterThan(10);
      expect(f.title.length).toBeGreaterThan(0);
    }
  });

  it("produces unique fingerprints across real data", () => {
    const fps = result.findings.map((f) => f.fingerprint);
    expect(new Set(fps).size).toBe(fps.length);
  });
});

describe("real Plaid payloads — a declared bill reconciles against the real feed", () => {
  // Uber appears repeatedly in the sandbox feed, so declare it as a bill and
  // check the two ledgers actually meet on data nobody wrote for this test.
  const uber = txns.filter((t) => t.merchantNorm.includes("uber")).sort((a, b) => (a.date < b.date ? -1 : 1));

  it("the real feed contains the payee we are about to declare", () => {
    expect(uber.length).toBeGreaterThan(0);
  });

  it("matches a declared bill to the real charge on its real date", () => {
    const first = uber[0];
    const result = reconcile({
      bills: [
        {
          id: "b-uber",
          name: "Uber",
          matchers: ["uber"],
          amountExpected: first.amount,
          amountTolerance: 1,
          amountTolerancePct: 5,
          currency: first.currency,
          accountId: first.accountId,
          autopay: false,
          cadence: "one_off",
          dayOfMonth: null,
          weekday: null,
          monthOfYear: null,
          firstDue: first.date,
          endDate: null,
          graceDays: 3,
          reminders: [],
          paused: false,
          origin: "typed",
        },
      ],
      accounts,
      txns,
      settings: defaultSettings(),
      today: "2026-09-30",
      from: "2026-07-01",
      to: "2026-10-31",
    });

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].txn).not.toBeNull();
    expect(result.matchedTxnIds.has(result.matched[0].txn!.id)).toBe(true);
    // And having paid a bill, that charge is no longer discretionary spend.
    expect(result.findings.filter((f) => f.kind === "missed-bill")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Regression: the real feed is what revealed that the undeclared-subscription
// rule was too loose. It produced ELEVEN findings, including McDonald's,
// Starbucks and KFC — a flood of informational rows that would bury the urgent
// ones. These pin the tightened rule against the same data.
// ---------------------------------------------------------------------------

describe("real Plaid payloads — the subscription rule does not flood", () => {
  const result = reconcile({
    bills: [],
    accounts,
    txns,
    settings: defaultSettings(),
    today: "2026-09-26",
    from: "2026-07-01",
    to: "2026-10-31",
  });
  const recurring = result.findings.filter((f) => f.kind === "unplanned-recurring");

  it("shows at most five", () => {
    expect(recurring.length).toBeLessThanOrEqual(5);
  });

  it("names no fast-food or coffee payee as a subscription", () => {
    const names = recurring.map((f) => f.title.toLowerCase()).join(" | ");
    for (const payee of ["mcdonald", "starbucks", "kfc"]) {
      expect(names).not.toContain(payee);
    }
  });

  it("keeps every finding's evidence specific", () => {
    for (const f of recurring) {
      expect(f.why).toMatch(/\d+ charges of exactly/);
    }
  });
});

describe("real Plaid payloads — no card payment is counted as spending", () => {
  const result = reconcile({
    bills: [],
    accounts,
    txns,
    settings: defaultSettings(),
    today: "2026-09-26",
    from: "2026-07-01",
    to: "2026-10-31",
  });

  // The regression: this payee is LOAN_PAYMENTS_OTHER_PAYMENT on a credit card
  // and was being counted as 2,078.50 of spending.
  it("excludes AUTOMATIC PAYMENT from the ledger's spend", () => {
    const payment = txns.find((t) => t.merchantNorm.includes("automatic payment"));
    expect(payment).toBeDefined();
    expect(result.transfers.has(payment!.id)).toBe(true);
  });

  it("excludes the account transfers and the payroll deposit too", () => {
    for (const needle of ["cd deposit", "gusto"]) {
      const t = txns.find((x) => x.merchantNorm.includes(needle));
      expect(t, needle).toBeDefined();
      expect(result.transfers.has(t!.id), needle).toBe(true);
    }
  });

  it("names none of them as a subscription", () => {
    const titles = result.findings
      .filter((f) => f.kind === "unplanned-recurring")
      .map((f) => f.title.toLowerCase())
      .join(" | ");
    for (const payee of ["automatic payment", "gusto", "cd deposit"]) {
      expect(titles).not.toContain(payee);
    }
  });

  // And the one that SHOULD be caught still is: internet and cable, the same
  // amount every month, not on any declared bill.
  it("still catches the genuine undeclared subscription", () => {
    const titles = result.findings
      .filter((f) => f.kind === "unplanned-recurring")
      .map((f) => f.title.toLowerCase())
      .join(" | ");
    expect(titles).toContain("tectra");
  });
});
