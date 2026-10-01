// ---------------------------------------------------------------------------
// Personal Finance — Plaid's JSON, in our shapes.
//
// Pure functions over plain objects, so the whole mapping is tested against
// committed fixtures with no network. This is the file most likely to be
// subtly wrong, and three of its rules are load-bearing:
//
// 1. THE SIGN PASSES THROUGH UNTOUCHED. Plaid is already positive-when-money-
//    leaves, which is precisely why our types adopted that convention. A mapper
//    that "helpfully" flipped signs would invert every spend figure.
//
// 2. pending_transaction_id SURVIVES. Drop it and `fold` cannot do its job, so
//    every ordinary card purchase becomes a double charge.
//
// 3. A CARD WITH NO LIABILITIES RECORD KEEPS dates_source "typed". Plaid's
//    liabilities coverage is US-first; outside it, the honest answer is that we
//    do not know, not a guess dressed as a bank fact.
// ---------------------------------------------------------------------------

import { addDays, diffDays } from "../../dates";
import { normalizeMerchant } from "../../merchant";
import type { Day } from "../../types";
import type { ProviderAccount, ProviderCardTerms, ProviderTxn, TxnPage } from "../types";

/** The subset of Plaid's account object we read. */
export interface PlaidAccount {
  account_id: string;
  name?: string | null;
  official_name?: string | null;
  mask?: string | null;
  type?: string | null;
  subtype?: string | null;
  balances?: {
    current?: number | null;
    available?: number | null;
    limit?: number | null;
    iso_currency_code?: string | null;
    unofficial_currency_code?: string | null;
  } | null;
}

export interface PlaidTxn {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  authorized_date?: string | null;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
  merchant_name?: string | null;
  name?: string | null;
  pending?: boolean | null;
  pending_transaction_id?: string | null;
  personal_finance_category?: { primary?: string | null; detailed?: string | null } | null;
}

export interface PlaidCredit {
  account_id: string;
  aprs?: { apr_percentage?: number | null; apr_type?: string | null }[] | null;
  is_overdue?: boolean | null;
  last_statement_issue_date?: string | null;
  last_statement_balance?: number | null;
  minimum_payment_amount?: number | null;
  next_payment_due_date?: string | null;
}

/** Account types this feature models. Loans and investments are out of scope. */
const SUPPORTED: Record<string, "depository" | "credit"> = {
  depository: "depository",
  credit: "credit",
};

const FALLBACK_CURRENCY = "USD";

function currencyOf(
  iso?: string | null,
  unofficial?: string | null,
  fallback = FALLBACK_CURRENCY,
): string {
  return iso ?? unofficial ?? fallback;
}

export function mapAccount(a: PlaidAccount): ProviderAccount | null {
  const type = SUPPORTED[a.type ?? ""];
  // Drop rather than coerce: a loan mapped as a credit card would be shown a
  // statement cycle it does not have.
  if (!type) return null;

  const b = a.balances ?? {};
  return {
    providerAccountId: a.account_id,
    name: a.name ?? a.official_name ?? "Account",
    mask: a.mask ?? null,
    type,
    currency: currencyOf(b.iso_currency_code, b.unofficial_currency_code),
    // Credit cards are "card spending"; current accounts are opt-in.
    countInSpend: type === "credit",
    balanceCurrent: b.current ?? null,
    creditLimit: type === "credit" ? (b.limit ?? null) : null,
    // Nothing below is known until /liabilities/get says so.
    datesSource: "typed",
    statementNextClosingEstimated: false,
  };
}

export function mapAccounts(accounts: PlaidAccount[]): ProviderAccount[] {
  return accounts.map(mapAccount).filter((a): a is ProviderAccount => a !== null);
}

export function mapTxn(t: PlaidTxn): ProviderTxn {
  // merchant_name is frequently null; `name` is the raw statement descriptor.
  const raw = t.merchant_name ?? t.name ?? "";
  return {
    providerTxnId: t.transaction_id,
    providerAccountId: t.account_id,
    date: t.date,
    // Untouched. See rule 1 above.
    amount: t.amount,
    currency: currencyOf(t.iso_currency_code, t.unofficial_currency_code),
    merchantRaw: raw,
    merchantNorm: normalizeMerchant(raw),
    pending: t.pending === true,
    // See rule 2. Without this, fold cannot collapse the pair.
    pendingTxnId: t.pending_transaction_id ?? null,
    removedAt: null,
    // The transfer rule reads this, so the detailed value is what we keep.
    category: t.personal_finance_category?.detailed ?? null,
  };
}

export interface PlaidSyncResponse {
  added?: PlaidTxn[];
  modified?: PlaidTxn[];
  removed?: { transaction_id: string }[];
  next_cursor?: string | null;
  has_more?: boolean;
}

export function mapSync(res: PlaidSyncResponse): TxnPage {
  return {
    added: (res.added ?? []).map(mapTxn),
    modified: (res.modified ?? []).map(mapTxn),
    removed: (res.removed ?? []).map((r) => r.transaction_id),
    cursor: res.next_cursor ?? null,
    hasMore: res.has_more === true,
  };
}

export function mapCardTerms(credit: PlaidCredit): ProviderCardTerms {
  const purchase = (credit.aprs ?? []).find((a) => a.apr_type === "purchase_apr");
  return {
    providerAccountId: credit.account_id,
    lastStatementBalance: credit.last_statement_balance ?? null,
    statementLastClosed: credit.last_statement_issue_date ?? null,
    nextDueDate: credit.next_payment_due_date ?? null,
    minimumPayment: credit.minimum_payment_amount ?? null,
    isOverdue: credit.is_overdue === true,
    aprPurchase: purchase?.apr_percentage ?? null,
    creditLimit: null,
  };
}

export function mapLiabilities(res: { liabilities?: { credit?: PlaidCredit[] | null } | null }): ProviderCardTerms[] {
  return (res.liabilities?.credit ?? []).map(mapCardTerms);
}

/**
 * The cycle length, measured rather than assumed.
 *
 * Nobody — not Plaid, not any bank API — publishes the NEXT statement closing
 * date. It can only be derived from how long the last cycles actually ran, so
 * this returns null until there is evidence, and the caller marks anything
 * built from it as estimated.
 */
export function cycleDaysFrom(previousClosed: Day | null, latestClosed: Day | null): number | null {
  if (!previousClosed || !latestClosed) return null;
  const gap = diffDays(previousClosed, latestClosed);
  // A real statement cycle is roughly a month. Anything outside this is a
  // re-issued statement or a data glitch, not a cycle.
  if (gap < 20 || gap > 40) return null;
  return gap;
}

/** Apply fetched card terms onto a mapped account. */
export function applyCardTerms(
  account: ProviderAccount,
  terms: ProviderCardTerms | undefined,
  previousStatementClosed: Day | null = null,
): ProviderAccount {
  // See rule 3: no record means we do not know, and the UI says so.
  if (!terms) return account;

  const cycleDays = cycleDaysFrom(previousStatementClosed, terms.statementLastClosed);
  const nextClosing =
    terms.statementLastClosed && cycleDays
      ? addDays(terms.statementLastClosed, cycleDays)
      : null;

  return {
    ...account,
    lastStatementBalance: terms.lastStatementBalance,
    statementLastClosed: terms.statementLastClosed,
    statementNextClosing: nextClosing,
    statementNextClosingEstimated: nextClosing !== null,
    nextDueDate: terms.nextDueDate,
    minimumPayment: terms.minimumPayment,
    isOverdue: terms.isOverdue,
    cycleDays,
    creditLimit: terms.creditLimit ?? account.creditLimit ?? null,
    datesSource: "bank",
  };
}
