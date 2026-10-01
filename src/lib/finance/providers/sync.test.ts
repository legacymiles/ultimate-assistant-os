import { describe, expect, it, vi } from "vitest";
import { syncConnection } from "./sync";
import type { SyncStore } from "./sync";
import type { BankProvider, Connection, ProviderAccount, ProviderCardTerms, TxnPage } from "./types";

const CONN: Connection = { id: "conn-1", accessToken: "tok", cursor: null };

function account(over: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    providerAccountId: "cc-1",
    name: "Amex",
    mask: "4421",
    type: "credit",
    currency: "USD",
    countInSpend: true,
    balanceCurrent: 100,
    datesSource: "typed",
    statementNextClosingEstimated: false,
    ...over,
  };
}

function txnPage(over: Partial<TxnPage> = {}): TxnPage {
  return { added: [], modified: [], removed: [], cursor: "c1", hasMore: false, ...over };
}

function txn(id: string) {
  return {
    providerTxnId: id,
    providerAccountId: "cc-1",
    date: "2026-09-30",
    amount: 10,
    currency: "USD",
    merchantRaw: "TESCO",
    merchantNorm: "tesco",
    pending: false,
    pendingTxnId: null,
    removedAt: null,
    category: null,
  };
}

/** A store that records the ORDER of every call, which is what matters here. */
function makeStore(over: Partial<SyncStore> = {}) {
  const calls: string[] = [];
  const store: SyncStore = {
    upsertAccounts: vi.fn(async () => {
      calls.push("upsertAccounts");
      return new Map([["cc-1", "our-1"]]);
    }),
    upsertTxns: vi.fn(async () => {
      calls.push("upsertTxns");
    }),
    markRemoved: vi.fn(async () => {
      calls.push("markRemoved");
    }),
    saveCursor: vi.fn(async () => {
      calls.push("saveCursor");
    }),
    previousStatementClosed: vi.fn(async () => {
      calls.push("previousStatementClosed");
      return null;
    }),
    setStatus: vi.fn(async () => {
      calls.push("setStatus");
    }),
    ...over,
  };
  return { store, calls };
}

function makeProvider(over: Partial<BankProvider> = {}): BankProvider {
  return {
    id: "plaid",
    label: "Plaid",
    capabilities: {
      cardStatements: true,
      sync: "webhook",
      consentDays: null,
      maxCallsPerDay: null,
      regions: ["US"],
    },
    configured: () => ({ ok: true, reason: "" }),
    fetchAccounts: async () => [account()],
    fetchTransactions: async () => txnPage(),
    ...over,
  };
}

describe("syncConnection — the ordering guarantee", () => {
  // Saving the cursor before the write loses transactions silently on a crash,
  // and a ledger with a hole produces a false "missed bill" rather than an error.
  it("writes the page before advancing the cursor", async () => {
    const { store, calls } = makeStore();
    await syncConnection(
      makeProvider({ fetchTransactions: async () => txnPage({ added: [txn("t1")] }) }),
      CONN,
      store,
    );
    expect(calls.indexOf("upsertTxns")).toBeLessThan(calls.indexOf("saveCursor"));
  });

  it("marks removals before advancing the cursor too", async () => {
    const { store, calls } = makeStore();
    await syncConnection(
      makeProvider({ fetchTransactions: async () => txnPage({ removed: ["gone-1"] }) }),
      CONN,
      store,
    );
    expect(calls.indexOf("markRemoved")).toBeLessThan(calls.indexOf("saveCursor"));
  });

  it("leaves the cursor alone when the write fails", async () => {
    const saveCursor = vi.fn(async () => {});
    const { store } = makeStore({
      upsertTxns: vi.fn(async () => {
        throw new Error("database is down");
      }),
      saveCursor,
    });
    await expect(
      syncConnection(
        makeProvider({ fetchTransactions: async () => txnPage({ added: [txn("t1")] }) }),
        CONN,
        store,
      ),
    ).rejects.toThrow("database is down");
    // The next sync must re-read this page rather than skip it.
    expect(saveCursor).not.toHaveBeenCalled();
  });
});

describe("syncConnection — paging", () => {
  it("follows has_more and saves a cursor per page", async () => {
    const pages = [
      txnPage({ added: [txn("t1")], cursor: "c1", hasMore: true }),
      txnPage({ added: [txn("t2")], cursor: "c2", hasMore: false }),
    ];
    let i = 0;
    const { store } = makeStore();
    const r = await syncConnection(
      makeProvider({ fetchTransactions: async () => pages[i++] }),
      CONN,
      store,
    );
    expect(r.pages).toBe(2);
    expect(r.added).toBe(2);
    expect(store.saveCursor).toHaveBeenCalledTimes(2);
    expect(store.saveCursor).toHaveBeenLastCalledWith("conn-1", "c2");
  });

  it("passes the new cursor into the next request", async () => {
    const seen: (string | null)[] = [];
    const pages = [
      txnPage({ cursor: "c1", hasMore: true }),
      txnPage({ cursor: "c2", hasMore: false }),
    ];
    let i = 0;
    const { store } = makeStore();
    await syncConnection(
      makeProvider({
        fetchTransactions: async (c) => {
          seen.push(c.cursor);
          return pages[i++];
        },
      }),
      CONN,
      store,
    );
    expect(seen).toEqual([null, "c1"]);
  });

  it("stops rather than paging forever if has_more never clears", async () => {
    const { store } = makeStore();
    const r = await syncConnection(
      makeProvider({ fetchTransactions: async () => txnPage({ hasMore: true }) }),
      CONN,
      store,
    );
    expect(r.pages).toBe(50);
  });
});

describe("syncConnection — card terms", () => {
  const terms: ProviderCardTerms = {
    providerAccountId: "cc-1",
    lastStatementBalance: 410,
    statementLastClosed: "2026-09-07",
    nextDueDate: "2026-10-04",
    minimumPayment: 25,
    isOverdue: false,
    aprPurchase: 27.95,
    creditLimit: 2000,
  };

  it("applies them and marks the dates as from the bank", async () => {
    const { store } = makeStore();
    const r = await syncConnection(
      makeProvider({ fetchCardTerms: async () => [terms] }),
      CONN,
      store,
    );
    expect(r.cardTermsApplied).toBe(1);
    const written = (store.upsertAccounts as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as ProviderAccount[];
    expect(written[0].datesSource).toBe("bank");
    expect(written[0].nextDueDate).toBe("2026-10-04");
  });

  it("uses the stored previous close date to measure the cycle", async () => {
    const { store } = makeStore({
      previousStatementClosed: vi.fn(async () => "2026-08-07"),
    });
    await syncConnection(makeProvider({ fetchCardTerms: async () => [terms] }), CONN, store);
    const written = (store.upsertAccounts as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as ProviderAccount[];
    expect(written[0].cycleDays).toBe(31);
    expect(written[0].statementNextClosingEstimated).toBe(true);
  });

  // The honest outcome outside Plaid's US-first liabilities coverage.
  it("reports a card that came back with no terms and leaves it typed", async () => {
    const { store } = makeStore();
    const r = await syncConnection(makeProvider({ fetchCardTerms: async () => [] }), CONN, store);
    expect(r.someCardsWithoutTerms).toBe(true);
    expect(r.cardTermsApplied).toBe(0);
    const written = (store.upsertAccounts as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as ProviderAccount[];
    expect(written[0].datesSource).toBe("typed");
  });

  it("does not look for terms on a current account", async () => {
    const { store } = makeStore();
    const r = await syncConnection(
      makeProvider({
        fetchAccounts: async () => [account({ type: "depository", countInSpend: false })],
        fetchCardTerms: async () => [],
      }),
      CONN,
      store,
    );
    expect(r.someCardsWithoutTerms).toBe(false);
    expect(store.previousStatementClosed).not.toHaveBeenCalled();
  });

  it("works with a provider that cannot publish card terms at all", async () => {
    const { store } = makeStore();
    const noTerms = makeProvider();
    delete (noTerms as { fetchCardTerms?: unknown }).fetchCardTerms;
    const r = await syncConnection(noTerms, CONN, store);
    expect(r.cardTermsApplied).toBe(0);
    expect(r.accounts).toBe(1);
  });
});
