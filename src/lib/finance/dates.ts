// ---------------------------------------------------------------------------
// Personal Finance — arithmetic on local day strings.
//
// Every date in this feature is a "YYYY-MM-DD" string standing for a calendar
// day in the viewer's own timezone. Date objects exist only inside these
// functions and never cross a module boundary, which is what keeps a bill due
// on the 1st from being reported as due on the 31st west of UTC.
//
// `diffDays` deliberately does not divide milliseconds: across a DST boundary
// a month is 30.96 days and floors to the wrong answer. It counts by UTC
// midnights built from the parts instead.
// ---------------------------------------------------------------------------

import type { Day } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-09-30" → [2026, 9, 30]. */
export function parts(day: Day): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
}

export function key(y: number, m: number, d: number): Day {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** A Date in local time → its day key. Never use toISOString for this. */
export function todayKey(now: Date = new Date()): Day {
  return key(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Days in a month. `month` is 1-based. */
export function lastDayOfMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month, 0).getDate();
}

/** The day `d` of a month, pulled back to the month's end when it overflows. */
export function monthEndSafe(year: number, month: number, d: number): Day {
  return key(year, month, Math.min(d, lastDayOfMonth(year, month)));
}

export function addDays(day: Day, n: number): Day {
  const [y, m, d] = parts(day);
  const t = new Date(y, m - 1, d + n);
  return key(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

/** Adds months, clamping the day to the target month's length. */
export function addMonths(day: Day, n: number): Day {
  const [y, m, d] = parts(day);
  const zero = y * 12 + (m - 1) + n;
  return monthEndSafe(Math.floor(zero / 12), (zero % 12) + 1, d);
}

/** Whole calendar days from `a` to `b`. Negative when `b` is earlier. */
export function diffDays(a: Day, b: Day): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(day: Day): number {
  const [y, m, d] = parts(day);
  return new Date(y, m - 1, d).getDay();
}

/** The first day of `day`'s week, where `startsOn` is 0 for Sunday. */
export function startOfWeek(day: Day, startsOn: number): Day {
  const back = (dayOfWeek(day) - startsOn + 7) % 7;
  return addDays(day, -back);
}

/** Inclusive on both ends. */
export function withinRange(day: Day, from: Day, to: Day): boolean {
  return day >= from && day <= to;
}
