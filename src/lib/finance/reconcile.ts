// ---------------------------------------------------------------------------
// Personal Finance — the pipeline, composed.
//
// Four stages in a fixed order, and the order is the design:
//
//   fold         collapse the feed to what actually happened
//   occurrences  expand the declared bills into the days they fall due
//   match        tie charges to occurrences
//   findings     read the leftovers on both sides as news
//
// `fold` is first because every later stage counts rows, and a pending charge
// beside its posted twin is one charge counted twice.
//
// This is the only module the app imports. Everything above it is an
// implementation detail, and everything below it is a pure function with its
// own tests.
// ---------------------------------------------------------------------------

import { findings } from "./findings";
import { fold } from "./fold";
import { matchOccurrences } from "./match";
import { allOccurrences } from "./occurrences";
import { spend } from "./spend";
import { transferIds } from "./transfers";
import type { SpendReport } from "./spend";
import type {
  Account,
  Bill,
  Day,
  Finding,
  FinanceSettings,
  Matched,
  Occurrence,
  Txn,
} from "./types";

export interface ReconcileInput {
  bills: Bill[];
  accounts: Account[];
  txns: Txn[];
  settings: FinanceSettings;
  today: Day;
  /** The window to expand bills across. */
  from: Day;
  to: Day;
}

export interface Reconciled {
  /** The folded feed — what the rest of the app should display. */
  txns: Txn[];
  occurrences: Occurrence[];
  matched: Matched[];
  matchedTxnIds: Set<string>;
  /** Ids excluded as movements between the owner's own accounts. */
  transfers: Set<string>;
  findings: Finding[];
  spend: SpendReport;
}

export function reconcile(input: ReconcileInput): Reconciled {
  const txns = fold(input.txns);
  // Computed once on the folded feed and handed to both consumers: spend must
  // not count a card payment, and findings must not call two PARTIAL card
  // payments a duplicate charge.
  const transfers = transferIds(txns, input.accounts);
  const occurrences = allOccurrences(input.bills, input.from, input.to);
  const { matched, unmatchedTxns, matchedTxnIds } = matchOccurrences(
    occurrences,
    txns,
    input.bills,
  );

  return {
    txns,
    occurrences,
    matched,
    matchedTxnIds,
    transfers,
    findings: findings({
      matched,
      unmatchedTxns,
      bills: input.bills,
      accounts: input.accounts,
      settings: input.settings,
      today: input.today,
      transfers,
    }),
    spend: spend({
      txns,
      accounts: input.accounts,
      matchedTxnIds,
      settings: input.settings,
      today: input.today,
      transfers,
    }),
  };
}
