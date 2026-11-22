// ---------------------------------------------------------------------------
// Bills — reading the list.
//
// Pure functions over the two sources (typed here, read from Profiles) so the
// tab, the month grid and the tests all see the same bills in the same order.
//
// Recurrence is NOT re-implemented here: a bill is handed to the finance
// engine's occurrences(), which already knows that "the 31st" means the 28th
// in February and that stepping must never compound a clamp. One bill model,
// one place that expands it.
// ---------------------------------------------------------------------------

import { diffDays } from "@/lib/finance/dates";
import { occurrences } from "@/lib/finance/occurrences";
import type { Bill as FinanceBill } from "@/lib/finance/types";
import { paidKey, type Bill, type BillOverride, type DueBill, type Day, type SortMode } from "./types";

/** "all" = everything · "none" = bills in no profile · otherwise a profile id. */
export type OwnerFilter = "all" | "none" | (string & {});

/**
 * The owner's corrections, laid over what Profiles says. Profiles stays the
 * truth for the name and the amount; the due day and "not actually a bill"
 * are the two things it usually cannot know.
 */
export function applyOverride(bill: Bill, override: BillOverride | undefined): Bill | null {
  if (!override) return bill;
  if (override.dropped) return null;
  return {
    ...bill,
    cadence: override.cadence ?? bill.cadence,
    dayOfMonth: override.dayOfMonth !== undefined ? override.dayOfMonth : bill.dayOfMonth,
    amount: override.amount ?? bill.amount,
    paused: override.paused ?? bill.paused,
    dayGuessed: override.dayOfMonth !== undefined ? undefined : bill.dayGuessed,
  };
}

/** Everything Jarvis knows about, from both sources, as one list. */
export function allBills(
  typed: Bill[],
  fromProfiles: Bill[],
  overrides: Record<string, BillOverride> = {},
): Bill[] {
  const out: Bill[] = [];
  for (const b of fromProfiles) {
    const next = applyOverride(b, overrides[b.id]);
    if (next) out.push(next);
  }
  for (const b of typed) {
    const next = applyOverride(b, overrides[b.id]);
    if (next) out.push(next);
  }
  return out;
}

/** The shape the finance engine expands. The reconciliation fields are unused. */
function toFinanceBill(b: Bill): FinanceBill {
  return {
    id: b.id,
    name: b.name,
    matchers: [b.name],
    amountExpected: b.amount,
    amountTolerance: 1,
    amountTolerancePct: 5,
    currency: b.currency,
    accountId: null,
    autopay: b.autopay,
    cadence: b.cadence,
    dayOfMonth: b.dayOfMonth,
    weekday: b.weekday,
    monthOfYear: b.monthOfYear,
    firstDue: b.firstDue,
    endDate: b.endDate,
    graceDays: 3,
    reminders: [],
    paused: b.paused,
    origin: b.source === "typed" ? "typed" : "detected",
  };
}

/** Every time a bill falls due between `from` and `to`, paid marks attached. */
export function dueBills(
  bills: Bill[],
  from: Day,
  to: Day,
  paid: Record<string, string>,
  today: Day,
): DueBill[] {
  const out: DueBill[] = [];
  for (const bill of bills) {
    for (const o of occurrences(toFinanceBill(bill), from, to)) {
      const at = paid[paidKey(bill.id, o.due)];
      out.push({
        bill,
        due: o.due,
        amount: o.amountExpected,
        paid: Boolean(at),
        paidAt: at,
        overdue: !at && o.due < today,
        dueIn: diffDays(today, o.due),
      });
    }
  }
  return sortDueBills(out, "due");
}

/**
 * By date is the default and the reason the tab reads right: the 1st of the
 * month comes first because that is where it falls, not because of a rule.
 * Same-day bills break the tie on amount, biggest first.
 */
export function sortDueBills(list: DueBill[], mode: SortMode): DueBill[] {
  const next = list.slice();
  if (mode === "amount") {
    next.sort((a, b) => b.amount - a.amount || a.due.localeCompare(b.due) || a.bill.name.localeCompare(b.bill.name));
  } else if (mode === "name") {
    next.sort((a, b) => a.bill.name.localeCompare(b.bill.name) || a.due.localeCompare(b.due));
  } else {
    next.sort((a, b) => a.due.localeCompare(b.due) || b.amount - a.amount || a.bill.name.localeCompare(b.bill.name));
  }
  return next;
}

export function filterByOwner<T extends { bill: Bill }>(list: T[], owner: OwnerFilter): T[] {
  if (owner === "all") return list;
  if (owner === "none") return list.filter((d) => !d.bill.ownerId);
  return list.filter((d) => d.bill.ownerId === owner);
}

/** Unpaid only, for the "what is still owed" switch. */
export function filterUnpaid(list: DueBill[], unpaidOnly: boolean): DueBill[] {
  return unpaidOnly ? list.filter((d) => !d.paid) : list;
}

export function billsByDay(list: DueBill[]): Map<Day, DueBill[]> {
  const map = new Map<Day, DueBill[]>();
  for (const d of list) {
    const at = map.get(d.due) ?? [];
    at.push(d);
    map.set(d.due, at);
  }
  for (const at of map.values()) at.sort((a, b) => b.amount - a.amount);
  return map;
}

export interface Totals {
  count: number;
  /** Everything due in the window. */
  total: number;
  paid: number;
  left: number;
  overdue: number;
  overdueCount: number;
}

export function totalsOf(list: DueBill[]): Totals {
  let total = 0;
  let paid = 0;
  let overdue = 0;
  let overdueCount = 0;
  for (const d of list) {
    total += d.amount;
    if (d.paid) paid += d.amount;
    if (d.overdue) {
      overdue += d.amount;
      overdueCount += 1;
    }
  }
  return {
    count: list.length,
    total: round(total),
    paid: round(paid),
    left: round(total - paid),
    overdue: round(overdue),
    overdueCount,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * "$39.00" — the one place money is turned into words. Always two decimals:
 * a bill is an exact figure, and "$39" next to "$39.99" reads as a rounding.
 */
export function money(n: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

/** "$1,400" — for a calendar day, where there is no room for the cents. */
export function moneyShort(n: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    }).format(n);
  } catch {
    return `$${Math.round(n)}`;
  }
}

/** "due in 3 days", "due today", "9 days late" — never a bare date. */
export function whenLabel(d: DueBill): string {
  if (d.paid) return "paid";
  if (d.dueIn === 0) return "due today";
  if (d.dueIn === 1) return "due tomorrow";
  if (d.dueIn > 1) return `due in ${d.dueIn} days`;
  if (d.dueIn === -1) return "1 day late";
  return `${Math.abs(d.dueIn)} days late`;
}
