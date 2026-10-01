// ---------------------------------------------------------------------------
// Personal Finance — database rows ↔ domain types.
//
// Pure translation, no I/O, so it is unit tested. It exists as its own file
// because the two shapes genuinely differ (snake_case columns, numeric columns
// that PostgREST hands back as strings) and burying that in the query code is
// how a currency ends up compared against a string.
//
// The one rule worth stating: numerics come back from PostgREST as STRINGS.
// `"9.99" > 10` is false and `"9.99" + 1` is "9.991", so every money column
// goes through `num()` on the way in. Nothing downstream should ever see one.
// ---------------------------------------------------------------------------

import { normalizeMerchant } from "../merchant";
import { defaultSettings } from "../types";
import type { Account, Bill, FinanceSettings, Txn } from "../types";

type Row = Record<string, unknown>;

/** A numeric column, which PostgREST serialises as a string. */
function num(v: unknown, fallback: number): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** A nullable numeric column. */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = num(v, Number.NaN);
  return Number.isFinite(n) ? n : null;
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const bool = (v: unknown, fallback = false): boolean => (typeof v === "boolean" ? v : fallback);

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function numArray(v: unknown, fallback: number[]): number[] {
  if (!Array.isArray(v)) return fallback;
  const out = v.map((x) => num(x, Number.NaN)).filter((n) => Number.isFinite(n));
  return out.length > 0 ? out : fallback;
}

export function toAccount(r: Row): Account {
  const type = r.type === "credit" ? "credit" : "depository";
  return {
    id: str(r.id),
    name: str(r.name, "Account"),
    mask: strOrNull(r.mask),
    type,
    currency: str(r.currency, "USD"),
    countInSpend: bool(r.count_in_spend, type === "credit"),
    balanceCurrent: numOrNull(r.balance_current),
    creditLimit: numOrNull(r.credit_limit),
    lastStatementBalance: numOrNull(r.last_statement_balance),
    statementLastClosed: strOrNull(r.statement_last_closed),
    statementNextClosing: strOrNull(r.statement_next_closing),
    statementNextClosingEstimated: bool(r.statement_next_closing_estimated),
    nextDueDate: strOrNull(r.next_due_date),
    minimumPayment: numOrNull(r.minimum_payment),
    isOverdue: bool(r.is_overdue),
    cycleDays: numOrNull(r.cycle_days),
    datesSource:
      r.dates_source === "bank" ? "bank" : r.dates_source === "inferred" ? "inferred" : "typed",
  };
}

const CADENCES = new Set([
  "weekly",
  "fortnightly",
  "monthly",
  "quarterly",
  "annual",
  "one_off",
]);

export function toBill(r: Row): Bill {
  const cadence = CADENCES.has(String(r.cadence)) ? (r.cadence as Bill["cadence"]) : "monthly";
  return {
    id: str(r.id),
    name: str(r.name, "Bill"),
    matchers: strArray(r.merchant_matchers),
    amountExpected: num(r.amount_expected, 0),
    amountTolerance: num(r.amount_tolerance, 1),
    amountTolerancePct: num(r.amount_tolerance_pct, 5),
    currency: str(r.currency, "USD"),
    accountId: strOrNull(r.account_id),
    autopay: bool(r.autopay),
    cadence,
    dayOfMonth: numOrNull(r.day_of_month),
    weekday: numOrNull(r.weekday),
    monthOfYear: numOrNull(r.month_of_year),
    firstDue: str(r.first_due),
    endDate: strOrNull(r.end_date),
    graceDays: num(r.grace_days, 3),
    reminders: numArray(r.reminders, []),
    paused: bool(r.paused),
    origin: r.origin === "detected" ? "detected" : "typed",
  };
}

export function toTxn(r: Row): Txn {
  const raw = str(r.merchant_raw);
  return {
    id: str(r.id),
    accountId: str(r.account_id),
    date: str(r.date),
    amount: num(r.amount, 0),
    currency: str(r.currency, "USD"),
    merchantRaw: raw,
    // Recomputed rather than trusted: normalization has changed once already,
    // and a stale stored value would silently stop matching its bill.
    merchantNorm: str(r.merchant_norm) || normalizeMerchant(raw),
    pending: bool(r.pending),
    pendingTxnId: strOrNull(r.pending_txn_id),
    removedAt: strOrNull(r.removed_at),
    category: strOrNull(r.category),
  };
}

export function toSettings(r: Row | null | undefined): FinanceSettings {
  const d = defaultSettings();
  if (!r) return d;
  return {
    leadDays: numArray(r.lead_days, d.leadDays),
    duplicateMinAmount: num(r.duplicate_min_amount, d.duplicateMinAmount),
    duplicateWindowDays: num(r.duplicate_window_days, d.duplicateWindowDays),
    multiChargePayees: strArray(r.multi_charge_payees),
    emailKinds: strArray(r.email_kinds) as FinanceSettings["emailKinds"],
    quietHoursStart: num(r.quiet_hours_start, d.quietHoursStart),
    quietHoursEnd: num(r.quiet_hours_end, d.quietHoursEnd),
    recurringMinAmount: num(r.recurring_min_amount, d.recurringMinAmount),
    weekStartsOn: num(r.week_starts_on, d.weekStartsOn),
    currencyDisplay: strOrNull(r.currency_display),
  };
}

/** A bill going the other way, for the form's save. */
export function billToRow(b: Omit<Bill, "id">, userId: string): Row {
  return {
    user_id: userId,
    name: b.name,
    merchant_matchers: b.matchers,
    amount_expected: b.amountExpected,
    amount_tolerance: b.amountTolerance,
    amount_tolerance_pct: b.amountTolerancePct,
    currency: b.currency,
    account_id: b.accountId,
    autopay: b.autopay,
    cadence: b.cadence,
    day_of_month: b.dayOfMonth,
    weekday: b.weekday,
    month_of_year: b.monthOfYear,
    first_due: b.firstDue,
    end_date: b.endDate,
    grace_days: b.graceDays,
    reminders: b.reminders,
    paused: b.paused,
    origin: b.origin,
  };
}
