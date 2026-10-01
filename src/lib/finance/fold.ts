// ---------------------------------------------------------------------------
// Personal Finance — stage 1, folding the transaction feed.
//
// This runs before every other stage, and it is the single defence against the
// false duplicate alert that would discredit the whole feature.
//
// Plaid does not model pending → posted as a state change. It REMOVES the
// pending transaction, sends TRANSACTIONS_REMOVED, and returns a NEW posted
// transaction whose pending_transaction_id names the row it replaced. A
// detector that does not know this reads every ordinary card purchase as being
// charged twice.
//
// The link is the id and never the amount: a restaurant tip or a fuel hold
// posts at a different figure than it authorised, and those pairs must still
// fold.
// ---------------------------------------------------------------------------

import type { Txn } from "./types";

/** The feed as it actually happened: no removed rows, no superseded pendings. */
export function fold(txns: Txn[]): Txn[] {
  const superseded = new Set<string>();
  for (const t of txns) {
    if (t.pendingTxnId) superseded.add(t.pendingTxnId);
  }
  return txns.filter((t) => t.removedAt === null && !superseded.has(t.id));
}
