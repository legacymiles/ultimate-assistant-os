// ---------------------------------------------------------------------------
// Personal Finance — stage 3, tying charges to the bills they paid.
//
// Best-first rather than first-fit: every candidate pairing is scored by how
// far the charge landed from the due date, and the closest pairings are taken
// first. First-fit would give a 12 October charge to the 12 September
// occurrence simply because it was encountered earlier, inventing both a late
// payment and a missed one.
//
// A charge may pay at most one occurrence. `matchedTxnIds` is the set the
// spend report subtracts to get "excluding bills", which is why it is returned
// here rather than recomputed later.
// ---------------------------------------------------------------------------

import { diffDays } from "./dates";
import { matchesAny } from "./merchant";
import { withinTolerance } from "./money";
import type { Bill, Matched, Occurrence, Txn } from "./types";

/** How many days before the due date a charge may land and still count. */
const EARLY_WINDOW = 5;

export interface MatchResult {
  matched: Matched[];
  unmatchedTxns: Txn[];
  matchedTxnIds: Set<string>;
}

interface Candidate {
  oi: number;
  ti: number;
  distance: number;
}

export function matchOccurrences(
  occurrences: Occurrence[],
  txns: Txn[],
  bills: Bill[],
): MatchResult {
  const byId = new Map(bills.map((b) => [b.id, b]));
  const candidates: Candidate[] = [];

  occurrences.forEach((o, oi) => {
    const bill = byId.get(o.billId);
    if (!bill) return;
    txns.forEach((t, ti) => {
      // A refund is money in; it never pays a bill.
      if (t.amount <= 0) return;
      if (o.accountId && t.accountId !== o.accountId) return;
      if (t.currency !== o.currency) return;
      if (!matchesAny(t.merchantNorm, bill.matchers)) return;
      if (
        !withinTolerance(
          t.amount,
          o.amountExpected,
          bill.amountTolerance,
          bill.amountTolerancePct,
        )
      ) {
        return;
      }
      const offset = diffDays(o.due, t.date);
      if (offset < -EARLY_WINDOW || offset > bill.graceDays) return;
      candidates.push({ oi, ti, distance: Math.abs(offset) });
    });
  });

  candidates.sort((a, b) => a.distance - b.distance || a.oi - b.oi || a.ti - b.ti);

  const takenOcc = new Set<number>();
  const takenTxn = new Set<number>();
  const pairs = new Map<number, number>();
  for (const c of candidates) {
    if (takenOcc.has(c.oi) || takenTxn.has(c.ti)) continue;
    takenOcc.add(c.oi);
    takenTxn.add(c.ti);
    pairs.set(c.oi, c.ti);
  }

  const matched: Matched[] = occurrences.map((o, oi) => {
    const ti = pairs.get(oi);
    return { occurrence: o, txn: ti === undefined ? null : txns[ti] };
  });

  const matchedTxnIds = new Set<string>();
  for (const ti of takenTxn) matchedTxnIds.add(txns[ti].id);

  return {
    matched,
    unmatchedTxns: txns.filter((_, ti) => !takenTxn.has(ti)),
    matchedTxnIds,
  };
}
