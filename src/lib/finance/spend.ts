// ---------------------------------------------------------------------------
// Personal Finance — daily and weekly spend, excluding bills.
//
// The point of this view is the money the owner has discretion over, so three
// things are taken out: charges that paid a declared bill (that set already
// exists, from stage 3), charges on accounts the owner excluded, and transfers.
//
// TRANSFERS ARE THE RULE THAT DECIDES WHETHER THE NUMBER IS WORTH READING.
// Paying 400 off a credit card from a current account is not spending 400 — the
// purchases it covers were counted when they happened. Counted naively, any
// week a card is cleared roughly doubles. Categories catch most of it, but
// providers omit or mis-set them often enough that pair detection has to carry
// the rest: a debit on one of the owner's accounts and a matching credit on
// another, close in time, is one movement of the owner's own money.
//
// Refunds are NOT dropped; they net off, because that is what happened. The
// report carries `refunds` so a surprisingly cheap week can be explained rather
// than leaving the owner to wonder.
// ---------------------------------------------------------------------------

import { addDays, startOfWeek } from "./dates";
import { cents, fromCents, sum } from "./money";
import { transferIds } from "./transfers";
import type { Account, Day, FinanceSettings, Txn } from "./types";

/** How many payees the top-merchants list shows. */
const TOP_MERCHANTS = 8;

export interface SpendWindow {
  from: Day;
  to: Day;
  total: number;
  count: number;
  /** Of `total`, how much is still pending and may yet change. */
  pending: number;
  /** Money that came back in the window, as a positive number. */
  refunds: number;
  /** How many rows were dropped as transfers, so the exclusion is auditable. */
  excludedTransfers: number;
}

export interface SpendReport {
  today: SpendWindow;
  week: SpendWindow;
  previousWeek: SpendWindow;
  /** The last seven days, oldest first. */
  series: { day: Day; total: number }[];
  topMerchants: { merchant: string; total: number; count: number }[];
  currency: string | null;
}

export interface SpendInput {
  txns: Txn[];
  accounts: Account[];
  /** From stage 3. These paid a bill, so they are not discretionary spend. */
  matchedTxnIds: Set<string>;
  settings: FinanceSettings;
  today: Day;
  /** Overrides the week window. */
  window?: { from: Day; to: Day };
  /** Precomputed by reconcile, so the pairing runs once per pass. */
  transfers?: Set<string>;
}

function windowOf(txns: Txn[], from: Day, to: Day, excluded: number): SpendWindow {
  const inside = txns.filter((t) => t.date >= from && t.date <= to);
  const debits = inside.filter((t) => t.amount > 0);
  return {
    from,
    to,
    total: sum(inside.map((t) => t.amount)),
    count: debits.length,
    pending: sum(debits.filter((t) => t.pending).map((t) => t.amount)),
    refunds: sum(inside.filter((t) => t.amount < 0).map((t) => -t.amount)),
    excludedTransfers: excluded,
  };
}

export function spend(input: SpendInput): SpendReport {
  const { txns, accounts, matchedTxnIds, settings, today } = input;
  const counted = new Map(accounts.map((a) => [a.id, a.countInSpend]));

  const transfers = input.transfers ?? transferIds(txns, accounts);
  const eligible = txns.filter(
    (t) =>
      t.removedAt === null &&
      counted.get(t.accountId) === true &&
      !matchedTxnIds.has(t.id) &&
      !transfers.has(t.id),
  );
  const droppedIn = (from: Day, to: Day) =>
    txns.filter(
      (t) =>
        transfers.has(t.id) && counted.get(t.accountId) === true && t.date >= from && t.date <= to,
    ).length;

  const weekFrom = input.window?.from ?? startOfWeek(today, settings.weekStartsOn);
  const weekTo = input.window?.to ?? today;
  // Last week, only as far into it as we are into this one.
  const prevFrom = addDays(weekFrom, -7);
  const prevTo = addDays(weekTo, -7);

  const series: { day: Day; total: number }[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = addDays(today, -i);
    series.push({ day, total: sum(eligible.filter((t) => t.date === day).map((t) => t.amount)) });
  }

  const inWeek = eligible.filter((t) => t.date >= weekFrom && t.date <= weekTo);
  // Accumulated in cents, then converted once, so a long week does not drift.
  const merchants = new Map<string, { cents: number; count: number }>();
  for (const t of inWeek) {
    if (t.amount <= 0) continue;
    const m = merchants.get(t.merchantNorm) ?? { cents: 0, count: 0 };
    merchants.set(t.merchantNorm, { cents: m.cents + cents(t.amount), count: m.count + 1 });
  }

  const currencies = new Set(accounts.filter((a) => a.countInSpend).map((a) => a.currency));

  return {
    today: windowOf(eligible, today, today, droppedIn(today, today)),
    week: windowOf(eligible, weekFrom, weekTo, droppedIn(weekFrom, weekTo)),
    previousWeek: windowOf(eligible, prevFrom, prevTo, droppedIn(prevFrom, prevTo)),
    series,
    topMerchants: [...merchants.entries()]
      .map(([merchant, v]) => ({ merchant, total: fromCents(v.cents), count: v.count }))
      .sort((a, b) => b.total - a.total)
      .slice(0, TOP_MERCHANTS),
    currency: settings.currencyDisplay ?? (currencies.size === 1 ? [...currencies][0] : null),
  };
}
