// ---------------------------------------------------------------------------
// Personal Finance — stage 4, turning reconciled ledgers into findings.
//
// A finding is a sentence the owner can act on, not a flag. Every one carries
// `why`: the amounts, the payee and the dates that produced it, so the card
// reads "9.99 to spotify on 2026-09-12 and again on 2026-09-13" rather than
// "anomaly detected".
//
// `fingerprint` is the finding's identity across runs. It is built only from
// facts that do not change when the feed is re-fetched — the kind, the account,
// and the SORTED transaction ids — so re-running reconciliation updates an
// existing alert instead of opening a second one, and a dismissal sticks.
// ---------------------------------------------------------------------------

import { addDays, diffDays } from "./dates";
import { matchesAny } from "./merchant";
import { cents, withinTolerance } from "./money";
import type {
  Account,
  Day,
  Finding,
  FinanceSettings,
  Matched,
  Severity,
  Txn,
  Bill,
} from "./types";

/** How many charges from one payee make a rhythm rather than a coincidence. */
const RECURRING_MIN = 3;
/** How far apart two gaps may be and still count as "evenly spaced". */
const SPACING_SLOP = 4;

export interface FindingsInput {
  matched: Matched[];
  unmatchedTxns: Txn[];
  bills: Bill[];
  accounts: Account[];
  settings: FinanceSettings;
  today: Day;
  /**
   * Ids that are one leg of a movement between the owner's own accounts, from
   * ./transfers. Excluded from duplicate detection: the owner pays cards in
   * CHUNKS, so two equal partial payments days apart are the normal case and
   * would otherwise fire an urgent "charged twice".
   */
  transfers?: Set<string>;
}

const fmt = (n: number) => n.toFixed(2);

export function findings(input: FindingsInput): Finding[] {
  const { matched, unmatchedTxns, bills, accounts, settings, today } = input;
  const transfers = input.transfers ?? new Set<string>();
  const out: Finding[] = [];
  const leadDays = Math.max(...settings.leadDays, 0);
  const billById = new Map(bills.map((b) => [b.id, b]));

  // ----- duplicate charges ------------------------------------------------
  // Every charge is a candidate, matched or not: a bill paid twice is the case
  // the owner most wants caught, and one of that pair will have matched.
  const everyTxn = [
    ...matched.map((m) => m.txn).filter((t): t is Txn => t !== null),
    ...unmatchedTxns,
  ];
  const groups = new Map<string, Txn[]>();
  for (const t of everyTxn) {
    if (t.amount <= 0) continue;
    // Moving your own money twice is not being charged twice.
    if (transfers.has(t.id)) continue;
    if (cents(t.amount) < cents(settings.duplicateMinAmount)) continue;
    if (settings.multiChargePayees.some((p) => p === t.merchantNorm)) continue;
    const gk = `${t.accountId}|${t.merchantNorm}|${cents(t.amount)}`;
    const g = groups.get(gk);
    if (g) g.push(t);
    else groups.set(gk, [t]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const byDate = [...group].sort((a, b) => (a.date < b.date ? -1 : 1));
    // Any two inside the window make the whole cluster one finding.
    const near = byDate.filter((t, i) =>
      byDate.some(
        (o, j) => i !== j && Math.abs(diffDays(t.date, o.date)) <= settings.duplicateWindowDays,
      ),
    );
    if (near.length < 2) continue;
    const ids = near.map((t) => t.id).sort();
    const first = near[0];
    const dates = near.map((t) => t.date);
    out.push({
      kind: "duplicate-charge",
      fingerprint: `duplicate-charge|${first.accountId}|${ids.join(",")}`,
      severity: "urgent",
      title: `${first.merchantNorm} charged ${near.length} times`,
      why: `${fmt(first.amount)} to ${first.merchantNorm} on ${dates.join(" and again on ")}.`,
      amount: first.amount,
      currency: first.currency,
      billId: null,
      accountId: first.accountId,
      txnIds: ids,
      at: dates[dates.length - 1],
    });
  }

  // ----- the plan, bill by bill -------------------------------------------
  for (const m of matched) {
    const bill = billById.get(m.occurrence.billId);
    if (!bill) continue;

    if (m.txn === null) {
      const deadline = addDays(m.occurrence.due, bill.graceDays);
      if (today > deadline) {
        out.push({
          kind: "missed-bill",
          fingerprint: `missed-bill|${bill.id}|${m.occurrence.due}`,
          severity: "warn",
          title: `${bill.name} has not been paid`,
          why: `${fmt(m.occurrence.amountExpected)} was due on ${m.occurrence.due} and nothing matching it has appeared since.`,
          amount: m.occurrence.amountExpected,
          currency: m.occurrence.currency,
          billId: bill.id,
          accountId: m.occurrence.accountId,
          txnIds: [],
          at: m.occurrence.due,
        });
      }
      continue;
    }

    if (
      !withinTolerance(
        m.txn.amount,
        m.occurrence.amountExpected,
        bill.amountTolerance,
        bill.amountTolerancePct,
      )
    ) {
      const up = cents(m.txn.amount) > cents(m.occurrence.amountExpected);
      out.push({
        kind: "amount-changed",
        fingerprint: `amount-changed|${bill.id}|${m.occurrence.due}`,
        severity: up ? "warn" : "info",
        title: `${bill.name} ${up ? "went up" : "went down"}`,
        why: `You expected ${fmt(m.occurrence.amountExpected)} and were charged ${fmt(m.txn.amount)} on ${m.txn.date}.`,
        amount: m.txn.amount,
        currency: m.txn.currency,
        billId: bill.id,
        accountId: m.txn.accountId,
        txnIds: [m.txn.id],
        at: m.txn.date,
      });
    }
  }

  // ----- subscriptions nobody declared ------------------------------------
  const byMerchant = new Map<string, Txn[]>();
  for (const t of unmatchedTxns) {
    if (t.amount <= 0) continue;
    if (transfers.has(t.id)) continue;
    if (bills.some((b) => matchesAny(t.merchantNorm, b.matchers))) continue;
    const g = byMerchant.get(t.merchantNorm);
    if (g) g.push(t);
    else byMerchant.set(t.merchantNorm, [t]);
  }
  for (const [merchant, group] of byMerchant) {
    if (group.length < RECURRING_MIN) continue;
    const byDate = [...group].sort((a, b) => (a.date < b.date ? -1 : 1));
    // Same amount within 5%, which is how a subscription behaves.
    const first = byDate[0];
    const sameish = byDate.every((t) => withinTolerance(t.amount, first.amount, 0, 5));
    if (!sameish) continue;
    const gaps: number[] = [];
    for (let i = 1; i < byDate.length; i += 1) {
      gaps.push(diffDays(byDate[i - 1].date, byDate[i].date));
    }
    const even = gaps.every((g) => Math.abs(g - gaps[0]) <= SPACING_SLOP);
    if (!even || gaps[0] < 5) continue;
    const ids = byDate.map((t) => t.id).sort();
    out.push({
      kind: "unplanned-recurring",
      fingerprint: `unplanned-recurring|${first.accountId}|${merchant}`,
      severity: "info",
      title: `${merchant} looks like a subscription you have not listed`,
      why: `${byDate.length} charges of about ${fmt(first.amount)}, roughly every ${gaps[0]} days, most recently ${byDate[byDate.length - 1].date}. It is not on your bills.`,
      amount: first.amount,
      currency: first.currency,
      billId: null,
      accountId: first.accountId,
      txnIds: ids,
      at: byDate[byDate.length - 1].date,
    });
  }

  // ----- cards -------------------------------------------------------------
  for (const a of accounts) {
    if (a.type !== "credit") continue;
    const provenance =
      a.datesSource === "bank" || a.datesSource === undefined
        ? ""
        : ` This date was ${a.datesSource === "typed" ? "typed" : "inferred"}, not published by your bank.`;

    if (a.nextDueDate) {
      const days = diffDays(today, a.nextDueDate);
      if (days >= 0 && days <= leadDays) {
        const severity: Severity = a.isOverdue || days <= 2 ? "urgent" : "warn";
        const min =
          a.minimumPayment === null || a.minimumPayment === undefined
            ? ""
            : ` The minimum is ${fmt(a.minimumPayment)}.`;
        out.push({
          kind: "card-due-soon",
          fingerprint: `card-due-soon|${a.id}|${a.nextDueDate}`,
          severity,
          title: `${a.name} payment due ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}`,
          why: `The statement balance is ${fmt(a.lastStatementBalance ?? 0)}, due ${a.nextDueDate}.${min}${provenance}`,
          amount: a.lastStatementBalance ?? null,
          currency: a.currency,
          billId: null,
          accountId: a.id,
          txnIds: [],
          at: a.nextDueDate,
        });
      }
    }

    if (a.statementNextClosing) {
      const days = diffDays(today, a.statementNextClosing);
      if (days >= 0 && days <= leadDays) {
        const est = a.statementNextClosingEstimated ? " This closing date is estimated." : "";
        out.push({
          kind: "card-statement-closing",
          fingerprint: `card-statement-closing|${a.id}|${a.statementNextClosing}`,
          severity: "info",
          title: `${a.name} statement closes ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}`,
          why: `Anything charged after ${a.statementNextClosing} lands on the following statement.${est}${provenance}`,
          amount: null,
          currency: a.currency,
          billId: null,
          accountId: a.id,
          txnIds: [],
          at: a.statementNextClosing,
        });
      }
    }
  }

  const rank: Record<Severity, number> = { urgent: 0, warn: 1, info: 2 };
  return out.sort(
    (x, y) => rank[x.severity] - rank[y.severity] || (x.at < y.at ? 1 : x.at > y.at ? -1 : 0),
  );
}
