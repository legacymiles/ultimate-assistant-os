// ---------------------------------------------------------------------------
// Personal Finance — one interface, several banks' worth of reality behind it.
//
// `capabilities` exists because the providers genuinely differ and the UI must
// say so rather than papering over it. Plaid publishes credit-card statement
// dates; UK/EU open banking publishes none. Plaid pushes webhooks; GoCardless
// must be polled, expires consent at 90 days, and some banks allow as few as
// four calls per account per day. A missing capability is shown to the owner,
// never hidden behind a guess.
//
// Note that `cardStatements` is a per-provider ceiling, not a promise about
// every account: Plaid's liabilities coverage is US-first, so an individual
// card can still come back without terms. That case is handled in the mapper by
// leaving `datesSource` as "typed", which the card panel then states plainly.
// ---------------------------------------------------------------------------

import type { Account, Day, Txn } from "../types";

export interface ProviderCapabilities {
  /** Can this provider publish a card's due date and statement closing date? */
  cardStatements: boolean;
  sync: "webhook" | "poll";
  /** Days a consent lasts before re-authentication. Null = no fixed expiry. */
  consentDays: number | null;
  /** Hard ceiling on syncs per account per day. Null = none worth modelling. */
  maxCallsPerDay: number | null;
  regions: string[];
}

/** An account as the provider describes it, before it is given our ids. */
export type ProviderAccount = Omit<Account, "id"> & { providerAccountId: string };

/** A transaction as the provider describes it, before it is given our ids. */
export type ProviderTxn = Omit<Txn, "id" | "accountId"> & {
  providerTxnId: string;
  providerAccountId: string;
};

/** The card fields that make the "no typing" promise, where published. */
export interface ProviderCardTerms {
  providerAccountId: string;
  lastStatementBalance: number | null;
  statementLastClosed: Day | null;
  nextDueDate: Day | null;
  minimumPayment: number | null;
  isOverdue: boolean;
  aprPurchase: number | null;
  creditLimit: number | null;
}

export interface TxnPage {
  added: ProviderTxn[];
  modified: ProviderTxn[];
  /** Provider ids to mark `removed_at` on. Never to delete — an alert may cite them. */
  removed: string[];
  cursor: string | null;
  hasMore: boolean;
}

export interface Connection {
  id: string;
  accessToken: string;
  cursor: string | null;
}

export interface BankProvider {
  id: "plaid" | "gocardless" | "manual";
  label: string;
  capabilities: ProviderCapabilities;
  /** Why this provider cannot be used right now, in words for the owner. */
  configured(): { ok: boolean; reason: string };
  fetchAccounts(conn: Connection): Promise<ProviderAccount[]>;
  fetchTransactions(conn: Connection): Promise<TxnPage>;
  /** Only present where capabilities.cardStatements is true. */
  fetchCardTerms?(conn: Connection): Promise<ProviderCardTerms[]>;
}
