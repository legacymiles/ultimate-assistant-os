// ---------------------------------------------------------------------------
// Personal Finance — moving your own money is not an event.
//
// Paying a credit card, or shifting cash to savings, is one movement of the
// owner's money appearing as two rows. It is not spending, and it is not news.
// Two separate parts of this feature have to know that, which is why the
// detection lives here rather than inside either of them:
//
//   spend.ts     must exclude it, or any week a card is cleared roughly
//                doubles.
//   findings.ts  must exclude it, or PARTIAL card payments — two chunks of the
//                same amount a few days apart — fire an urgent "charged twice"
//                alert. The owner pays their cards in chunks, so that would be
//                most months.
//
// Two defences, because neither is sufficient alone. The category is right when
// the provider sets it and absent often enough that it cannot be relied on; the
// pair is right whenever both sides of the movement are in view, which fails
// when only one of the two accounts is connected.
// ---------------------------------------------------------------------------

import { diffDays } from "./dates";
import { sameAmount } from "./money";
import type { Account, Txn } from "./types";

/** Provider categories that mean "the owner's own money moved". */
export const TRANSFER_CATEGORIES = [
  "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
];

/** How far apart the two legs of one transfer may land. */
const PAIR_WINDOW_DAYS = 3;

/**
 * Ids of transactions that are one leg of a movement between the owner's own
 * accounts.
 *
 * The pairing compares the two LEGS against each other, never against a
 * statement balance — which is what makes it work for partial payments. Three
 * chunks of £200 are three pairs, each matched to its own counterpart.
 */
export function transferIds(txns: Txn[], accounts: Account[]): Set<string> {
  const own = new Set(accounts.map((a) => a.id));
  const ids = new Set<string>();

  for (const t of txns) {
    if (t.category && TRANSFER_CATEGORIES.includes(t.category)) ids.add(t.id);
  }

  // Pair an outflow on one own account against an inflow on another. Sorted by
  // date so the nearest counterpart is taken first and a run of equal-amount
  // payments pairs off in order rather than arbitrarily.
  const byDate = (a: Txn, b: Txn) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const outs = txns
    .filter((t) => t.amount > 0 && own.has(t.accountId) && !ids.has(t.id))
    .sort(byDate);
  const ins = txns
    .filter((t) => t.amount < 0 && own.has(t.accountId) && !ids.has(t.id))
    .sort(byDate);

  const usedIn = new Set<string>();
  for (const out of outs) {
    const leg = ins.find(
      (i) =>
        !usedIn.has(i.id) &&
        i.accountId !== out.accountId &&
        sameAmount(Math.abs(i.amount), out.amount) &&
        Math.abs(diffDays(out.date, i.date)) <= PAIR_WINDOW_DAYS,
    );
    if (leg) {
      usedIn.add(leg.id);
      ids.add(out.id);
      ids.add(leg.id);
    }
  }
  return ids;
}
