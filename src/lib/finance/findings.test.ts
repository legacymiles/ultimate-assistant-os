import { describe, expect, it } from "vitest";
import { findings } from "./findings";
import { defaultSettings } from "./types";
import type { Account, Bill, Matched, Txn } from "./types";

const TODAY = "2026-09-30";

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

function txn(over: Partial<Txn> = {}): Txn {
  return {
    id: "t1",
    accountId: "a1",
    date: "2026-09-12",
    amount: 9.99,
    currency: "GBP",
    merchantRaw: "SPOTIFY AB",
    merchantNorm: "spotify",
    pending: false,
    pendingTxnId: null,
    removedAt: null,
    category: null,
    ...over,
  };
}

function card(over: Partial<Account> = {}): Account {
  return {
    id: "a1",
    name: "Amex Gold",
    mask: "4421",
    type: "credit",
    currency: "GBP",
    countInSpend: true,
    balanceCurrent: 420,
    nextDueDate: "2026-10-05",
    statementNextClosing: "2026-10-28",
    minimumPayment: 25,
    lastStatementBalance: 410,
    isOverdue: false,
    datesSource: "bank",
    ...over,
  };
}

const ctx = (over: Partial<Parameters<typeof findings>[0]> = {}) => ({
  matched: [] as Matched[],
  unmatchedTxns: [] as Txn[],
  bills: [bill()],
  accounts: [card()],
  settings: defaultSettings(),
  today: TODAY,
  ...over,
});

const kinds = (fs: ReturnType<typeof findings>) => fs.map((f) => f.kind);

describe("duplicate-charge", () => {
  it("fires for two equal charges to one payee a day apart", () => {
    const out = findings(
      ctx({
        unmatchedTxns: [
          txn({ id: "t1", date: "2026-09-12" }),
          txn({ id: "t2", date: "2026-09-13" }),
        ],
      }),
    );
    const dup = out.find((f) => f.kind === "duplicate-charge");
    expect(dup).toBeDefined();
    expect(dup?.txnIds.sort()).toEqual(["t1", "t2"]);
    expect(dup?.severity).toBe("urgent");
  });

  it("names the evidence in `why`", () => {
    const out = findings(
      ctx({ unmatchedTxns: [txn({ id: "t1" }), txn({ id: "t2", date: "2026-09-13" })] }),
    );
    const dup = out.find((f) => f.kind === "duplicate-charge");
    expect(dup?.why).toContain("9.99");
    expect(dup?.why).toContain("spotify");
  });

  it("does not fire outside the window", () => {
    const out = findings(
      ctx({ unmatchedTxns: [txn({ id: "t1" }), txn({ id: "t2", date: "2026-09-20" })] }),
    );
    expect(kinds(out)).not.toContain("duplicate-charge");
  });

  it("does not fire for different amounts", () => {
    const out = findings(
      ctx({
        unmatchedTxns: [txn({ id: "t1" }), txn({ id: "t2", date: "2026-09-13", amount: 4.99 })],
      }),
    );
    expect(kinds(out)).not.toContain("duplicate-charge");
  });

  it("does not fire for different payees", () => {
    const out = findings(
      ctx({
        unmatchedTxns: [
          txn({ id: "t1" }),
          txn({ id: "t2", date: "2026-09-13", merchantNorm: "netflix" }),
        ],
      }),
    );
    expect(kinds(out)).not.toContain("duplicate-charge");
  });

  it("does not fire below the minimum amount", () => {
    const out = findings(
      ctx({
        unmatchedTxns: [
          txn({ id: "t1", amount: 0.5 }),
          txn({ id: "t2", date: "2026-09-13", amount: 0.5 }),
        ],
      }),
    );
    expect(kinds(out)).not.toContain("duplicate-charge");
  });

  it("does not fire for a payee on the multi-charge allowlist", () => {
    const settings = { ...defaultSettings(), multiChargePayees: ["spotify"] };
    const out = findings(
      ctx({
        settings,
        unmatchedTxns: [txn({ id: "t1" }), txn({ id: "t2", date: "2026-09-13" })],
      }),
    );
    expect(kinds(out)).not.toContain("duplicate-charge");
  });

  it("does not fire across two different accounts", () => {
    const out = findings(
      ctx({
        unmatchedTxns: [
          txn({ id: "t1" }),
          txn({ id: "t2", date: "2026-09-13", accountId: "a2" }),
        ],
      }),
    );
    expect(kinds(out)).not.toContain("duplicate-charge");
  });

  it("reports three equal charges as one finding naming all three", () => {
    const out = findings(
      ctx({
        unmatchedTxns: [
          txn({ id: "t1", date: "2026-09-12" }),
          txn({ id: "t2", date: "2026-09-12" }),
          txn({ id: "t3", date: "2026-09-13" }),
        ],
      }),
    );
    const dups = out.filter((f) => f.kind === "duplicate-charge");
    expect(dups).toHaveLength(1);
    expect(dups[0].txnIds).toHaveLength(3);
  });

  it("also fires when the duplicates are a bill paid twice", () => {
    // One charge matched the bill; the second is an unmatched twin of it.
    const matched: Matched[] = [
      {
        occurrence: {
          billId: "b1",
          due: "2026-09-12",
          amountExpected: 9.99,
          currency: "GBP",
          accountId: "a1",
        },
        txn: txn({ id: "t1" }),
      },
    ];
    const out = findings(
      ctx({ matched, unmatchedTxns: [txn({ id: "t2", date: "2026-09-13" })] }),
    );
    const dup = out.find((f) => f.kind === "duplicate-charge");
    expect(dup?.txnIds.sort()).toEqual(["t1", "t2"]);
  });
});

describe("missed-bill", () => {
  it("fires once the grace period has passed with no charge", () => {
    const matched: Matched[] = [
      {
        occurrence: {
          billId: "b1",
          due: "2026-09-12",
          amountExpected: 9.99,
          currency: "GBP",
          accountId: "a1",
        },
        txn: null,
      },
    ];
    const out = findings(ctx({ matched }));
    expect(kinds(out)).toContain("missed-bill");
  });

  it("does not fire while still inside the grace period", () => {
    const matched: Matched[] = [
      {
        occurrence: {
          billId: "b1",
          due: "2026-09-29",
          amountExpected: 9.99,
          currency: "GBP",
          accountId: "a1",
        },
        txn: null,
      },
    ];
    expect(kinds(findings(ctx({ matched })))).not.toContain("missed-bill");
  });

  it("does not fire for an occurrence still in the future", () => {
    const matched: Matched[] = [
      {
        occurrence: {
          billId: "b1",
          due: "2026-10-12",
          amountExpected: 9.99,
          currency: "GBP",
          accountId: "a1",
        },
        txn: null,
      },
    ];
    expect(kinds(findings(ctx({ matched })))).not.toContain("missed-bill");
  });

  it("does not fire when the bill was paid", () => {
    const matched: Matched[] = [
      {
        occurrence: {
          billId: "b1",
          due: "2026-09-12",
          amountExpected: 9.99,
          currency: "GBP",
          accountId: "a1",
        },
        txn: txn(),
      },
    ];
    expect(kinds(findings(ctx({ matched })))).not.toContain("missed-bill");
  });
});

describe("amount-changed", () => {
  const matchedAt = (amount: number): Matched[] => [
    {
      occurrence: {
        billId: "b1",
        due: "2026-09-12",
        amountExpected: 9.99,
        currency: "GBP",
        accountId: "a1",
      },
      txn: txn({ amount }),
    },
  ];

  it("warns when the charge went up beyond tolerance", () => {
    const f = findings(ctx({ matched: matchedAt(12.99) })).find(
      (x) => x.kind === "amount-changed",
    );
    expect(f?.severity).toBe("warn");
    expect(f?.why).toContain("12.99");
  });

  it("is only info when the charge went down", () => {
    const f = findings(ctx({ matched: matchedAt(6.99) })).find(
      (x) => x.kind === "amount-changed",
    );
    expect(f?.severity).toBe("info");
  });

  it("stays quiet inside tolerance", () => {
    expect(kinds(findings(ctx({ matched: matchedAt(10.5) })))).not.toContain("amount-changed");
  });
});

describe("unplanned-recurring", () => {
  const monthly = (merchantNorm: string, amount: number) => [
    txn({ id: "r1", date: "2026-07-10", merchantNorm, amount }),
    txn({ id: "r2", date: "2026-08-10", merchantNorm, amount }),
    txn({ id: "r3", date: "2026-09-10", merchantNorm, amount }),
  ];

  it("fires for three evenly spaced charges with no bill", () => {
    const out = findings(ctx({ bills: [], unmatchedTxns: monthly("adobe", 19.99) }));
    expect(kinds(out)).toContain("unplanned-recurring");
  });

  it("does not fire for only two charges", () => {
    const out = findings(ctx({ bills: [], unmatchedTxns: monthly("adobe", 19.99).slice(0, 2) }));
    expect(kinds(out)).not.toContain("unplanned-recurring");
  });

  it("does not fire for irregularly spaced charges", () => {
    const out = findings(
      ctx({
        bills: [],
        unmatchedTxns: [
          txn({ id: "r1", date: "2026-07-10", merchantNorm: "adobe", amount: 19.99 }),
          txn({ id: "r2", date: "2026-07-21", merchantNorm: "adobe", amount: 19.99 }),
          txn({ id: "r3", date: "2026-09-10", merchantNorm: "adobe", amount: 19.99 }),
        ],
      }),
    );
    expect(kinds(out)).not.toContain("unplanned-recurring");
  });


  // Tightened after running the engine over a real Plaid feed, which produced
  // eleven of these including McDonald's, Starbucks and KFC. Three similar
  // charges a month apart describes lunch as well as it describes Netflix.
  it("does not fire when the amounts merely resemble each other", () => {
    const out = findings(
      ctx({
        bills: [],
        unmatchedTxns: [
          txn({ id: "c1", date: "2026-07-10", merchantNorm: "cafe", amount: 4.33 }),
          txn({ id: "c2", date: "2026-08-10", merchantNorm: "cafe", amount: 4.4 }),
          txn({ id: "c3", date: "2026-09-10", merchantNorm: "cafe", amount: 4.35 }),
        ],
      }),
    );
    expect(kinds(out)).not.toContain("unplanned-recurring");
  });

  it("fires when the amounts are identical to the cent", () => {
    const out = findings(ctx({ bills: [], unmatchedTxns: monthly("adobe", 19.99) }));
    expect(kinds(out)).toContain("unplanned-recurring");
  });

  it("ignores a repeating charge too small to be worth mentioning", () => {
    const out = findings(ctx({ bills: [], unmatchedTxns: monthly("newsstand", 1.5) }));
    expect(kinds(out)).not.toContain("unplanned-recurring");
  });

  it("ignores a food and drink payee however regular it looks", () => {
    const out = findings(
      ctx({
        bills: [],
        unmatchedTxns: monthly("mcdonald s", 12).map((t) => ({
          ...t,
          category: "FOOD_AND_DRINK_FAST_FOOD",
        })),
      }),
    );
    expect(kinds(out)).not.toContain("unplanned-recurring");
  });

  it("ignores transport and general retail too", () => {
    for (const category of ["TRANSPORTATION_TAXIS_AND_RIDE_SHARES", "GENERAL_MERCHANDISE_SUPERSTORES"]) {
      const out = findings(
        ctx({ bills: [], unmatchedTxns: monthly("somewhere", 30).map((t) => ({ ...t, category })) }),
      );
      expect(kinds(out)).not.toContain("unplanned-recurring");
    }
  });

  it("rejects spacing that wanders by more than a couple of days", () => {
    const out = findings(
      ctx({
        bills: [],
        unmatchedTxns: [
          txn({ id: "s1", date: "2026-07-10", merchantNorm: "adobe", amount: 19.99 }),
          txn({ id: "s2", date: "2026-08-10", merchantNorm: "adobe", amount: 19.99 }),
          txn({ id: "s3", date: "2026-09-14", merchantNorm: "adobe", amount: 19.99 }),
        ],
      }),
    );
    expect(kinds(out)).not.toContain("unplanned-recurring");
  });

  it("shows at most five, largest first, so the feed cannot flood", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      monthly(`service${i}`, 10 + i).map((t) => ({ ...t, id: `${t.id}-${i}` })),
    ).flat();
    const out = findings(ctx({ bills: [], unmatchedTxns: many }));
    const rec = out.filter((f) => f.kind === "unplanned-recurring");
    expect(rec).toHaveLength(5);
    // The 18.00 one must be in; the 10.00 one must not.
    expect(rec[0].amount).toBe(18);
    expect(rec.map((f) => f.amount)).not.toContain(10);
  });

  it("does not fire when a bill already covers the payee", () => {
    const out = findings(
      ctx({
        bills: [bill({ matchers: ["adobe"] })],
        unmatchedTxns: monthly("adobe", 19.99),
      }),
    );
    expect(kinds(out)).not.toContain("unplanned-recurring");
  });
});

describe("card dates", () => {
  it("warns that a payment is due inside the lead time", () => {
    const f = findings(ctx({ accounts: [card({ nextDueDate: "2026-10-05" })] })).find(
      (x) => x.kind === "card-due-soon",
    );
    expect(f).toBeDefined();
    expect(f?.severity).toBe("warn");
  });

  it("is urgent two days out", () => {
    const f = findings(ctx({ accounts: [card({ nextDueDate: "2026-10-02" })] })).find(
      (x) => x.kind === "card-due-soon",
    );
    expect(f?.severity).toBe("urgent");
  });

  it("is urgent when the card is already overdue", () => {
    const f = findings(
      ctx({ accounts: [card({ nextDueDate: "2026-10-06", isOverdue: true })] }),
    ).find((x) => x.kind === "card-due-soon");
    expect(f?.severity).toBe("urgent");
  });

  it("stays quiet well before the lead time", () => {
    const out = findings(ctx({ accounts: [card({ nextDueDate: "2026-11-20" })] }));
    expect(kinds(out)).not.toContain("card-due-soon");
  });

  it("says so when the dates were typed rather than fetched", () => {
    const f = findings(
      ctx({ accounts: [card({ nextDueDate: "2026-10-05", datesSource: "typed" })] }),
    ).find((x) => x.kind === "card-due-soon");
    expect(f?.why).toContain("typed");
  });

  it("reports a statement closing inside the lead time as info", () => {
    const f = findings(
      ctx({ accounts: [card({ statementNextClosing: "2026-10-03", nextDueDate: null })] }),
    ).find((x) => x.kind === "card-statement-closing");
    expect(f?.severity).toBe("info");
  });

  it("ignores a depository account", () => {
    const out = findings(
      ctx({ accounts: [card({ type: "depository", nextDueDate: "2026-10-01" })] }),
    );
    expect(kinds(out)).not.toContain("card-due-soon");
  });
});

describe("fingerprints", () => {
  it("are stable across two identical runs", () => {
    const input = ctx({
      unmatchedTxns: [txn({ id: "t1" }), txn({ id: "t2", date: "2026-09-13" })],
    });
    const a = findings(input).map((f) => f.fingerprint);
    const b = findings(input).map((f) => f.fingerprint);
    expect(a).toEqual(b);
  });

  it("do not depend on the order transactions arrive in", () => {
    const t1 = txn({ id: "t1" });
    const t2 = txn({ id: "t2", date: "2026-09-13" });
    const a = findings(ctx({ unmatchedTxns: [t1, t2] })).map((f) => f.fingerprint);
    const b = findings(ctx({ unmatchedTxns: [t2, t1] })).map((f) => f.fingerprint);
    expect(a).toEqual(b);
  });

  it("are unique within one run", () => {
    const out = findings(
      ctx({
        unmatchedTxns: [
          txn({ id: "t1" }),
          txn({ id: "t2", date: "2026-09-13" }),
          txn({ id: "t3", date: "2026-09-12", merchantNorm: "netflix", amount: 15.99 }),
          txn({ id: "t4", date: "2026-09-13", merchantNorm: "netflix", amount: 15.99 }),
        ],
      }),
    );
    const fps = out.map((f) => f.fingerprint);
    expect(new Set(fps).size).toBe(fps.length);
  });
});
