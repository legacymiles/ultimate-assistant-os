// ---------------------------------------------------------------------------
// Personal Finance — pulling a connection up to date.
//
// Provider-agnostic: it drives any BankProvider through its pages and hands
// each one to a store. The store is an interface rather than Supabase so the
// ordering guarantee below can be tested without a database.
//
// THE GUARANTEE: the cursor advances only after the page it covers has been
// durably written. Saving the cursor first is the obvious shortcut and it loses
// transactions silently on any crash between the two — and a ledger with a hole
// in it does not fail loudly. It produces a false "missed bill" for the payment
// that vanished and a spend figure that is quietly too low, which is worse than
// an error, because nobody goes looking.
//
// A failure therefore leaves the cursor where it was and the next sync re-reads
// the page. Re-reading is safe: every write is an upsert keyed on the
// provider's own transaction id.
// ---------------------------------------------------------------------------

import { applyCardTerms } from "./plaid/map";
import type { BankProvider, Connection, ProviderAccount, ProviderCardTerms, ProviderTxn } from "./types";
import type { Day } from "../types";

export interface SyncStore {
  /** Upsert accounts; returns provider account id → our account id. */
  upsertAccounts(connectionId: string, accounts: ProviderAccount[]): Promise<Map<string, string>>;
  /** Upsert a page of transactions. Must be keyed on the provider's txn id. */
  upsertTxns(connectionId: string, txns: ProviderTxn[], accountIds: Map<string, string>): Promise<void>;
  /** Soft-delete: set removed_at. Never a hard delete — an alert may cite the row. */
  markRemoved(connectionId: string, providerTxnIds: string[]): Promise<void>;
  /** Persist the cursor. Called only after the page is written. */
  saveCursor(connectionId: string, cursor: string | null): Promise<void>;
  /** The statement close date already on file, for measuring the cycle. */
  previousStatementClosed(providerAccountId: string): Promise<Day | null>;
  /** Record the connection's state so the UI can explain a broken link. */
  setStatus(connectionId: string, status: string, detail: string): Promise<void>;
}

export interface SyncResult {
  accounts: number;
  added: number;
  modified: number;
  removed: number;
  pages: number;
  cardTermsApplied: number;
  /** True when a card came back with no terms, so its dates stay typed. */
  someCardsWithoutTerms: boolean;
}

/** Stop runaway paging if a provider never clears has_more. */
const MAX_PAGES = 50;

export async function syncConnection(
  provider: BankProvider,
  conn: Connection,
  store: SyncStore,
): Promise<SyncResult> {
  const result: SyncResult = {
    accounts: 0,
    added: 0,
    modified: 0,
    removed: 0,
    pages: 0,
    cardTermsApplied: 0,
    someCardsWithoutTerms: false,
  };

  let accounts = await provider.fetchAccounts(conn);

  // Card terms before the accounts are written, so the dates land in the same
  // upsert rather than in a second pass that could half-fail.
  if (provider.fetchCardTerms) {
    const terms = await provider.fetchCardTerms(conn);
    const byAccount = new Map<string, ProviderCardTerms>(
      terms.map((t) => [t.providerAccountId, t]),
    );
    const withTerms: ProviderAccount[] = [];
    for (const a of accounts) {
      if (a.type !== "credit") {
        withTerms.push(a);
        continue;
      }
      const t = byAccount.get(a.providerAccountId);
      if (!t) {
        // Ordinary outside Plaid's US-first liabilities coverage. The card
        // keeps typed dates and the panel says so.
        result.someCardsWithoutTerms = true;
        withTerms.push(a);
        continue;
      }
      const previous = await store.previousStatementClosed(a.providerAccountId);
      withTerms.push(applyCardTerms(a, t, previous));
      result.cardTermsApplied += 1;
    }
    accounts = withTerms;
  }

  const accountIds = await store.upsertAccounts(conn.id, accounts);
  result.accounts = accounts.length;

  let cursor = conn.cursor;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const got = await provider.fetchTransactions({ ...conn, cursor });

    // Write first...
    await store.upsertTxns(conn.id, [...got.added, ...got.modified], accountIds);
    if (got.removed.length > 0) await store.markRemoved(conn.id, got.removed);
    // ...and only then advance. See THE GUARANTEE above.
    await store.saveCursor(conn.id, got.cursor);

    cursor = got.cursor;
    result.added += got.added.length;
    result.modified += got.modified.length;
    result.removed += got.removed.length;
    result.pages += 1;

    if (!got.hasMore) break;
  }

  return result;
}
