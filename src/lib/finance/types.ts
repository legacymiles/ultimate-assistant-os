// ---------------------------------------------------------------------------
// Personal Finance — shared types.
//
// Two conventions run through every one of these, and both are load-bearing:
//
// 1. DATES ARE PLAIN "YYYY-MM-DD" STRINGS, never Date objects and never ISO
//    instants. A bill is due on a day, not at a moment; `new Date("2026-09-12")`
//    parses as UTC midnight and prints as the 11th anywhere west of UTC. The
//    calendar in src/lib/recall/calendar/types.ts made this decision first,
//    after the bug was paid for in std-safe. All arithmetic goes through
//    ./dates.
//
// 2. AMOUNTS ARE POSITIVE WHEN MONEY LEAVES. A purchase is +9.99, a refund is
//    -9.99. This matches Plaid's sign convention, so no adapter has to flip it,
//    and it makes "spend" a plain sum. Comparisons go through ./money, never
//    through === on floats.
// ---------------------------------------------------------------------------

/** A local calendar day, "YYYY-MM-DD". */
export type Day = string;

export type Provider = "plaid" | "gocardless" | "manual";

export type AccountType = "depository" | "credit";

/** Where a credit card's dates came from. The UI shows this, so it cannot lie. */
export type DatesSource = "bank" | "typed" | "inferred";

export type Cadence =
  | "weekly"
  | "fortnightly"
  | "monthly"
  | "quarterly"
  | "annual"
  | "one_off";

export type AlertKind =
  | "duplicate-charge"
  | "missed-bill"
  | "amount-changed"
  | "unplanned-recurring"
  | "card-due-soon"
  | "card-statement-closing";

export type AlertState = "open" | "acknowledged" | "dismissed" | "resolved";

export type Severity = "info" | "warn" | "urgent";

export interface Account {
  id: string;
  name: string;
  mask: string | null;
  type: AccountType;
  currency: string;
  /** Does this account's spending count toward the daily/weekly figures? */
  countInSpend: boolean;
  balanceCurrent: number | null;
  // ---- credit only -------------------------------------------------------
  creditLimit?: number | null;
  lastStatementBalance?: number | null;
  statementLastClosed?: Day | null;
  statementNextClosing?: Day | null;
  statementNextClosingEstimated?: boolean;
  nextDueDate?: Day | null;
  minimumPayment?: number | null;
  isOverdue?: boolean;
  cycleDays?: number | null;
  datesSource?: DatesSource;
}

export interface Bill {
  id: string;
  name: string;
  /** Substrings tested against a transaction's normalized merchant. */
  matchers: string[];
  amountExpected: number;
  /** Absolute tolerance. The effective tolerance is the larger of this and pct. */
  amountTolerance: number;
  amountTolerancePct: number;
  currency: string;
  accountId: string | null;
  autopay: boolean;
  cadence: Cadence;
  /** 1–31 for monthly/quarterly/annual. 31 means "last day of the month". */
  dayOfMonth: number | null;
  /** 0 = Sunday … 6 = Saturday, for weekly and fortnightly. */
  weekday: number | null;
  /** 1–12, for annual. */
  monthOfYear: number | null;
  firstDue: Day;
  endDate: Day | null;
  /** How late a payment may arrive before `missed-bill` fires. */
  graceDays: number;
  reminders: number[];
  paused: boolean;
  origin: "typed" | "detected";
}

export interface Txn {
  id: string;
  accountId: string;
  date: Day;
  /** Positive = money out. */
  amount: number;
  currency: string;
  merchantRaw: string;
  merchantNorm: string;
  pending: boolean;
  /** Set on a POSTED row, naming the pending row it replaced. */
  pendingTxnId: string | null;
  /** Set when a TRANSACTIONS_REMOVED webhook named this row. */
  removedAt: string | null;
  /** The provider's category, e.g. "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT". */
  category: string | null;
}

export interface Occurrence {
  billId: string;
  due: Day;
  amountExpected: number;
  currency: string;
  accountId: string | null;
}

export interface Matched {
  occurrence: Occurrence;
  txn: Txn | null;
}

export interface Finding {
  kind: AlertKind;
  /** Stable identity. Same happening, same fingerprint, so an upsert updates. */
  fingerprint: string;
  severity: Severity;
  title: string;
  /** The evidence sentence, naming amounts, payees and dates. */
  why: string;
  amount: number | null;
  currency: string;
  billId: string | null;
  accountId: string | null;
  txnIds: string[];
  /** The day the finding is about, for sorting. */
  at: Day;
}

export interface FinanceSettings {
  leadDays: number[];
  duplicateMinAmount: number;
  duplicateWindowDays: number;
  /** Normalized merchant names where several same-amount charges a day is normal. */
  multiChargePayees: string[];
  emailKinds: AlertKind[];
  quietHoursStart: number;
  quietHoursEnd: number;
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: number;
  currencyDisplay: string | null;
}

export function defaultSettings(): FinanceSettings {
  return {
    leadDays: [7, 3, 1],
    duplicateMinAmount: 1,
    duplicateWindowDays: 3,
    multiChargePayees: [],
    emailKinds: ["duplicate-charge", "missed-bill", "card-due-soon"],
    quietHoursStart: 22,
    quietHoursEnd: 7,
    weekStartsOn: 1,
    currencyDisplay: null,
  };
}
