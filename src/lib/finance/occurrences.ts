// ---------------------------------------------------------------------------
// Personal Finance — stage 2, expanding a bill into the days it falls due.
//
// Cadence is stored as parts (monthly + day 14, annual + June + day 3) rather
// than a cron string, so the form can round-trip it and so month ends can be
// handled honestly: a bill due "on the 31st" is due on the last day of
// February, not the 3rd of March.
//
// Monthly-family cadences step from an anchor month so the clamp never
// compounds — stepping 31 Jan → 28 Feb → 28 Mar would quietly move a bill off
// its day forever. Day-family cadences step from `firstDue`, because a weekly
// bill's rhythm is a day count.
// ---------------------------------------------------------------------------

import { addDays, addMonths, monthEndSafe, parts } from "./dates";
import type { Bill, Day, Occurrence } from "./types";

/** Months between steps for the cadences anchored to a day of the month. */
const MONTH_STEP: Partial<Record<Bill["cadence"], number>> = {
  monthly: 1,
  quarterly: 3,
  annual: 12,
};

/** Days between steps for the cadences anchored to a day count. */
const DAY_STEP: Partial<Record<Bill["cadence"], number>> = {
  weekly: 7,
  fortnightly: 14,
};

/** Hard ceiling, so a malformed bill cannot spin. */
const MAX_OCCURRENCES = 1200;

export function occurrences(bill: Bill, from: Day, to: Day): Occurrence[] {
  if (bill.paused || from > to) return [];

  const out: Occurrence[] = [];
  const emit = (due: Day) => {
    out.push({
      billId: bill.id,
      due,
      amountExpected: bill.amountExpected,
      currency: bill.currency,
      accountId: bill.accountId,
    });
  };

  const inWindow = (d: Day) =>
    d >= from && d <= to && d >= bill.firstDue && (!bill.endDate || d <= bill.endDate);
  const pastEnd = (d: Day) => d > to || (bill.endDate !== null && d > bill.endDate);

  if (bill.cadence === "one_off") {
    if (inWindow(bill.firstDue)) emit(bill.firstDue);
    return out;
  }

  const dayStep = DAY_STEP[bill.cadence];
  if (dayStep) {
    let d = bill.firstDue;
    let guard = 0;
    // Walk forward to the window rather than emitting the whole history.
    while (d < from && !pastEnd(d) && guard < MAX_OCCURRENCES) {
      d = addDays(d, dayStep);
      guard += 1;
    }
    while (!pastEnd(d) && out.length < MAX_OCCURRENCES) {
      if (inWindow(d)) emit(d);
      d = addDays(d, dayStep);
    }
    return out;
  }

  const monthStep = MONTH_STEP[bill.cadence] ?? 1;
  const day = bill.dayOfMonth ?? parts(bill.firstDue)[2];
  // Anchor on firstDue's month and step whole months from it, so each date is
  // computed fresh from the anchor and a February clamp never compounds.
  const at = (step: number): Day => {
    const walked = addMonths(bill.firstDue, step);
    const [wy, wm] = parts(walked);
    return monthEndSafe(wy, wm, day);
  };

  let step = 0;
  let anchor = at(0);
  let guard = 0;
  while (anchor < from && !pastEnd(anchor) && guard < MAX_OCCURRENCES) {
    step += monthStep;
    anchor = at(step);
    guard += 1;
  }
  while (!pastEnd(anchor) && out.length < MAX_OCCURRENCES) {
    if (inWindow(anchor)) emit(anchor);
    step += monthStep;
    anchor = at(step);
  }
  return out;
}

/** Every bill's occurrences in one window, sorted by due date. */
export function allOccurrences(bills: Bill[], from: Day, to: Day): Occurrence[] {
  return bills
    .flatMap((b) => occurrences(b, from, to))
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
}
