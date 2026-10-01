# Personal Finance — Engines Implementation Plan (1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure reconciliation and spend engines, their date/money helpers, and the database schema for the Personal Finance folder — everything that decides *what is true*, with no network, no UI and no API keys.

**Architecture:** Two ledgers (declared bills, observed transactions) reconciled by a four-stage pipeline: `fold` → `occurrences` → `match` → `findings`. Every stage is a pure function over plain data so it is unit-testable without a database. The spend report is a second read over the same `matched` output, which is why "card spending excluding bills" costs almost nothing. Schema lands last in this plan, once the types it stores are settled.

**Tech Stack:** TypeScript, vitest (`npx vitest run <path>`), Supabase/Postgres for the schema. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-30-personal-finance-design.md` — §4 (data model), §6 (reconciliation), §13 (spend).

**Plans that follow this one:** 2 — Plaid provider, sync and webhook. 3 — the folder surface and the time rail. 4 — calendar layer, Updates source, cron and email. 5 — the MCP server.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/finance/types.ts` | Every shared type and the two enums-as-unions. No logic. |
| `src/lib/finance/dates.ts` | Local `"YYYY-MM-DD"` string arithmetic. No `Date` crosses a module boundary. |
| `src/lib/finance/dates.test.ts` | Month-end clamping, cadence steps, week starts. |
| `src/lib/finance/money.ts` | Integer-cent comparison helpers, so money is never compared as a float. |
| `src/lib/finance/money.test.ts` | The float traps. |
| `src/lib/finance/merchant.ts` | Merchant-name normalization and matcher testing. |
| `src/lib/finance/merchant.test.ts` | Real statement-descriptor shapes. |
| `src/lib/finance/fold.ts` | Stage 1 — collapse pending/posted pairs and drop removed rows. |
| `src/lib/finance/fold.test.ts` | The false-duplicate defence. |
| `src/lib/finance/occurrences.ts` | Stage 2 — expand a bill's cadence into due dates. |
| `src/lib/finance/occurrences.test.ts` | Month ends, every cadence, windows. |
| `src/lib/finance/match.ts` | Stage 3 — tie transactions to occurrences. |
| `src/lib/finance/match.test.ts` | Tolerance edges, date windows, one-txn-one-occurrence. |
| `src/lib/finance/findings.ts` | Stage 4 — the six alert kinds and their fingerprints. |
| `src/lib/finance/findings.test.ts` | Every kind, plus the things that must NOT alert. |
| `src/lib/finance/spend.ts` | §13 — daily and weekly card spend excluding bills and transfers. |
| `src/lib/finance/spend.test.ts` | The exclusions, which are the whole feature. |
| `src/lib/finance/reconcile.ts` | The thin composition of stages 1–4. The only file later plans import. |
| `src/lib/finance/reconcile.test.ts` | One end-to-end pass over a realistic fixture. |
| `supabase/migrations/20260930000000_jarvis_finance.sql` | Six tables, owner-only RLS, additive and idempotent. |

Files are split by pipeline stage rather than by layer, so each is small enough to hold in context and each test file names exactly one stage. `reconcile.ts` exists so later plans import one door, not five.

---

## Task 1: Types

**Files:**
- Create: `src/lib/finance/types.ts`

- [ ] **Step 1: Write the types file**

```ts
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
  /** Does this account's spending count toward the §13 figures? */
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors mentioning `src/lib/finance/types.ts`. (Other pre-existing errors in the repo are not this task's concern; grep the output for `finance`.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/finance/types.ts
git commit -m "Finance: the shared types, and the two conventions that are load-bearing"
```

---

## Task 2: Date arithmetic on local day strings

**Files:**
- Create: `src/lib/finance/dates.ts`
- Test: `src/lib/finance/dates.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { addDays, addMonths, dayOfWeek, diffDays, lastDayOfMonth, monthEndSafe, startOfWeek, todayKey } from "./dates";

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });
  it("crosses a year boundary", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("goes backwards", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("handles a leap year", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("addMonths", () => {
  it("keeps the day when the target month is long enough", () => {
    expect(addMonths("2026-01-15", 1)).toBe("2026-02-15");
  });
  // The trap: naive date maths turns 31 Jan + 1 month into 3 March.
  it("clamps to the last day of a short month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
  it("clamps to 29 February in a leap year", () => {
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });
  it("crosses a year", () => {
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
  });
});

describe("lastDayOfMonth", () => {
  it("knows February in a common year", () => {
    expect(lastDayOfMonth(2026, 2)).toBe(28);
  });
  it("knows February in a leap year", () => {
    expect(lastDayOfMonth(2028, 2)).toBe(29);
  });
  it("knows a 30-day month", () => {
    expect(lastDayOfMonth(2026, 4)).toBe(30);
  });
});

describe("monthEndSafe", () => {
  // A bill due "on the 31st" must fall on the last day of a short month.
  it("clamps day 31 in February", () => {
    expect(monthEndSafe(2026, 2, 31)).toBe("2026-02-28");
  });
  it("leaves a valid day alone", () => {
    expect(monthEndSafe(2026, 2, 12)).toBe("2026-02-12");
  });
});

describe("diffDays", () => {
  it("counts forward", () => {
    expect(diffDays("2026-09-01", "2026-09-30")).toBe(29);
  });
  it("counts backward as negative", () => {
    expect(diffDays("2026-09-30", "2026-09-01")).toBe(-29);
  });
  // Across a DST boundary, a naive millisecond division gives 30.958… and
  // floors to 30. These are calendar days, so the answer is 31.
  it("is immune to DST", () => {
    expect(diffDays("2026-10-01", "2026-11-01")).toBe(31);
  });
});

describe("dayOfWeek", () => {
  it("reports Sunday as 0", () => {
    expect(dayOfWeek("2026-09-27")).toBe(0);
  });
  it("reports Wednesday as 3", () => {
    expect(dayOfWeek("2026-09-30")).toBe(3);
  });
});

describe("startOfWeek", () => {
  it("walks back to Monday when the week starts on Monday", () => {
    expect(startOfWeek("2026-09-30", 1)).toBe("2026-09-28");
  });
  it("returns the day itself when it is already the start", () => {
    expect(startOfWeek("2026-09-28", 1)).toBe("2026-09-28");
  });
  it("walks back to Sunday when the week starts on Sunday", () => {
    expect(startOfWeek("2026-09-30", 0)).toBe("2026-09-27");
  });
});

describe("todayKey", () => {
  it("formats a local date, not a UTC one", () => {
    // 23:30 local on the 30th is still the 30th, which a toISOString would
    // report as the 1st for anyone east of UTC.
    expect(todayKey(new Date(2026, 8, 30, 23, 30))).toBe("2026-09-30");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/finance/dates.test.ts`
Expected: FAIL — "Failed to resolve import ./dates".

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/finance/dates.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/finance/dates.ts src/lib/finance/dates.test.ts
git commit -m "Finance: day-string arithmetic that survives month ends and DST"
```

---

## Task 3: Money comparison in integer cents

**Files:**
- Create: `src/lib/finance/money.ts`
- Test: `src/lib/finance/money.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { cents, sameAmount, sum, withinTolerance } from "./money";

describe("cents", () => {
  it("rounds to the nearest cent", () => {
    expect(cents(9.994)).toBe(999);
    expect(cents(9.995)).toBe(1000);
  });
  it("handles a float that is not exactly representable", () => {
    expect(cents(0.1 + 0.2)).toBe(30);
  });
});

describe("sameAmount", () => {
  // The duplicate detector turns on exact equality, and 0.1 + 0.2 !== 0.3.
  it("calls two floats equal when their cents match", () => {
    expect(sameAmount(0.1 + 0.2, 0.3)).toBe(true);
  });
  it("separates amounts a cent apart", () => {
    expect(sameAmount(9.99, 10.0)).toBe(false);
  });
});

describe("sum", () => {
  it("adds without float drift", () => {
    expect(sum([0.1, 0.2, 0.3])).toBe(0.6);
  });
  it("is zero for nothing", () => {
    expect(sum([])).toBe(0);
  });
  it("lets a refund reduce the total", () => {
    expect(sum([60, -60])).toBe(0);
  });
});

describe("withinTolerance", () => {
  it("takes the absolute tolerance when it is larger", () => {
    // 5% of 10 is 0.50, so the absolute 1.00 wins.
    expect(withinTolerance(11, 10, 1, 5)).toBe(true);
  });
  it("takes the percentage when it is larger", () => {
    // 5% of 500 is 25, so 520 is inside it even though 1.00 is not.
    expect(withinTolerance(520, 500, 1, 5)).toBe(true);
  });
  it("is inclusive at the boundary", () => {
    expect(withinTolerance(11, 10, 1, 0)).toBe(true);
  });
  it("rejects a cent past the boundary", () => {
    expect(withinTolerance(11.01, 10, 1, 0)).toBe(false);
  });
  it("works below the expected amount too", () => {
    expect(withinTolerance(9, 10, 1, 0)).toBe(true);
    expect(withinTolerance(8.99, 10, 1, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/finance/money.test.ts`
Expected: FAIL — "Failed to resolve import ./money".

- [ ] **Step 3: Write the implementation**

```ts
// ---------------------------------------------------------------------------
// Personal Finance — money comparison.
//
// Amounts arrive as decimal numbers and must be compared exactly: the duplicate
// detector asks "are these two charges the same amount", and 0.1 + 0.2 === 0.3
// is false. Everything here converts to integer cents first. Nothing in this
// feature compares two amounts with === on floats.
//
// Note this is NOT the place for formatting. `money()` in src/lib/jarvis/
// updates.ts formats dollars only, and Finance holds accounts in several
// currencies, so display formatting belongs with the component that knows the
// row's currency.
// ---------------------------------------------------------------------------

/** A decimal amount as an integer number of cents. */
export function cents(n: number): number {
  return Math.round(n * 100);
}

export function fromCents(c: number): number {
  return c / 100;
}

export function sameAmount(a: number, b: number): boolean {
  return cents(a) === cents(b);
}

/** Sums in cents, so a long list of amounts does not drift. */
export function sum(amounts: number[]): number {
  return fromCents(amounts.reduce((total, n) => total + cents(n), 0));
}

/**
 * Is `actual` close enough to `expected`? The tolerance is the LARGER of the
 * absolute allowance and the percentage one, so a small bill gets a sensible
 * floor and a large one scales.
 */
export function withinTolerance(
  actual: number,
  expected: number,
  absolute: number,
  pct: number,
): boolean {
  const allowed = Math.max(cents(absolute), Math.round(cents(expected) * (pct / 100)));
  return Math.abs(cents(actual) - cents(expected)) <= allowed;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/finance/money.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/finance/money.ts src/lib/finance/money.test.ts
git commit -m "Finance: compare money in integer cents, never as floats"
```

---

## Task 4: Merchant normalization

**Files:**
- Create: `src/lib/finance/merchant.ts`
- Test: `src/lib/finance/merchant.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { matchesAny, normalizeMerchant } from "./merchant";

describe("normalizeMerchant", () => {
  it("lowercases and trims", () => {
    expect(normalizeMerchant("  SPOTIFY  ")).toBe("spotify");
  });
  it("strips a card-network prefix", () => {
    expect(normalizeMerchant("SQ *BLUE BOTTLE")).toBe("blue bottle");
    expect(normalizeMerchant("PAYPAL *STEAM GAMES")).toBe("steam games");
    expect(normalizeMerchant("POS DEBIT TESCO")).toBe("tesco");
  });
  it("strips a trailing store or reference number", () => {
    expect(normalizeMerchant("TESCO STORES 3614")).toBe("tesco stores");
    expect(normalizeMerchant("SHELL 00412783")).toBe("shell");
  });
  it("strips punctuation and collapses whitespace", () => {
    expect(normalizeMerchant("AMAZON.CO.UK*MK1AB2CD3")).toBe("amazon co uk");
  });
  it("keeps a bare name intact", () => {
    expect(normalizeMerchant("Netflix")).toBe("netflix");
  });
  // Two different Starbucks branches are the same payee for matching.
  it("brings two branches of one chain to the same name", () => {
    expect(normalizeMerchant("STARBUCKS 0471")).toBe(normalizeMerchant("STARBUCKS 9920"));
  });
  it("does not reduce a name to nothing", () => {
    // All-numeric descriptors exist; returning "" would match every bill.
    expect(normalizeMerchant("00412783")).toBe("00412783");
  });
});

describe("matchesAny", () => {
  it("matches a substring", () => {
    expect(matchesAny("spotify ab", ["spotify"])).toBe(true);
  });
  it("normalizes the matchers too, so a typed matcher with caps still works", () => {
    expect(matchesAny("spotify ab", ["Spotify"])).toBe(true);
  });
  it("does not match an unrelated payee", () => {
    expect(matchesAny("tesco stores", ["spotify"])).toBe(false);
  });
  it("is false for no matchers", () => {
    expect(matchesAny("spotify", [])).toBe(false);
  });
  it("ignores an empty matcher rather than matching everything", () => {
    expect(matchesAny("spotify", [""])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/finance/merchant.test.ts`
Expected: FAIL — "Failed to resolve import ./merchant".

- [ ] **Step 3: Write the implementation**

```ts
// ---------------------------------------------------------------------------
// Personal Finance — merchant normalization.
//
// Bank descriptors are not names: the same payee arrives as "SQ *BLUE BOTTLE",
// "TESCO STORES 3614" and "AMAZON.CO.UK*MK1AB2CD3". Matching a bill to a charge
// and spotting a duplicate both depend on two descriptors for the same payee
// reducing to the same string, and on two different payees NOT reducing to the
// same string.
//
// The one rule that matters more than the cleverness: never reduce a descriptor
// to the empty string. An empty normalized name substring-matches every bill,
// which would silently mark unrelated charges as paying a bill.
// ---------------------------------------------------------------------------

/** Prefixes that card networks and processors staple onto a descriptor. */
const PREFIXES = [
  "sq *",
  "sq*",
  "tst* ",
  "tst*",
  "paypal *",
  "paypal*",
  "pos debit ",
  "pos ",
  "card purchase ",
  "visa purchase ",
  "debit card purchase ",
];

export function normalizeMerchant(raw: string): string {
  let s = raw.toLowerCase().trim();

  for (const p of PREFIXES) {
    if (s.startsWith(p)) {
      s = s.slice(p.length);
      break;
    }
  }

  // Everything after a "*" on a processor descriptor is a reference, not a name.
  const star = s.indexOf("*");
  if (star > 0) s = s.slice(0, star);

  // Punctuation to spaces, then collapse.
  s = s.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

  // A trailing run of digits is a store or reference number.
  const stripped = s.replace(/\s+\d+$/, "").trim();
  // ...unless stripping leaves nothing, which happens for all-numeric
  // descriptors. An empty name matches every bill, so keep the original.
  return stripped.length > 0 ? stripped : s;
}

/** Does a normalized merchant contain any of these matchers? */
export function matchesAny(merchantNorm: string, matchers: string[]): boolean {
  return matchers.some((m) => {
    const needle = normalizeMerchant(m);
    // An empty matcher would match everything. Treat it as no matcher at all.
    return needle.length > 0 && merchantNorm.includes(needle);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/finance/merchant.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/finance/merchant.ts src/lib/finance/merchant.test.ts
git commit -m "Finance: normalize bank descriptors, and never to the empty string"
```

---

## Task 5: Stage 1 — fold pending into posted

**Files:**
- Create: `src/lib/finance/fold.ts`
- Test: `src/lib/finance/fold.test.ts`

This is the most important task in the plan. Plaid does not mutate a pending charge
into a posted one: it removes the pending row and adds a **new** row carrying
`pendingTxnId`. Without this fold, every ordinary card purchase appears twice and the
duplicate-charge alert fires constantly — the failure that makes the whole feature
untrustworthy.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { fold } from "./fold";
import type { Txn } from "./types";

function txn(over: Partial<Txn> = {}): Txn {
  return {
    id: "t1",
    accountId: "a1",
    date: "2026-09-12",
    amount: 9.99,
    currency: "GBP",
    merchantRaw: "SPOTIFY",
    merchantNorm: "spotify",
    pending: false,
    pendingTxnId: null,
    removedAt: null,
    category: null,
    ...over,
  };
}

describe("fold", () => {
  it("drops the pending row when its posted twin is present", () => {
    const pending = txn({ id: "pend-1", pending: true });
    const posted = txn({ id: "post-1", pendingTxnId: "pend-1" });
    const out = fold([pending, posted]);
    expect(out.map((t) => t.id)).toEqual(["post-1"]);
  });

  it("keeps a pending row whose posted twin has not arrived", () => {
    const pending = txn({ id: "pend-1", pending: true });
    expect(fold([pending]).map((t) => t.id)).toEqual(["pend-1"]);
  });

  it("drops a row a TRANSACTIONS_REMOVED webhook named", () => {
    const gone = txn({ id: "gone", removedAt: "2026-09-13T10:00:00Z" });
    const live = txn({ id: "live" });
    expect(fold([gone, live]).map((t) => t.id)).toEqual(["live"]);
  });

  it("folds a pair whose posted amount differs from the pending one", () => {
    // A restaurant tip or a fuel hold posts at a different amount. The link is
    // the id, never the amount, so the pair still folds.
    const pending = txn({ id: "pend-1", pending: true, amount: 50 });
    const posted = txn({ id: "post-1", pendingTxnId: "pend-1", amount: 58.5 });
    const out = fold([pending, posted]);
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(58.5);
  });

  it("folds several independent pairs at once", () => {
    const out = fold([
      txn({ id: "p1", pending: true }),
      txn({ id: "o1", pendingTxnId: "p1" }),
      txn({ id: "p2", pending: true, merchantNorm: "tesco" }),
      txn({ id: "o2", pendingTxnId: "p2", merchantNorm: "tesco" }),
    ]);
    expect(out.map((t) => t.id).sort()).toEqual(["o1", "o2"]);
  });

  it("leaves two genuinely separate charges alone", () => {
    const a = txn({ id: "a", date: "2026-09-12" });
    const b = txn({ id: "b", date: "2026-09-13" });
    expect(fold([a, b])).toHaveLength(2);
  });

  it("does not drop a posted row whose pending twin was already removed", () => {
    // The usual steady state: the pending row is gone from the feed entirely.
    const posted = txn({ id: "post-1", pendingTxnId: "pend-1" });
    expect(fold([posted]).map((t) => t.id)).toEqual(["post-1"]);
  });

  it("returns a new array and does not mutate the input", () => {
    const input = [txn({ id: "a" }), txn({ id: "b", removedAt: "x" })];
    const out = fold(input);
    expect(input).toHaveLength(2);
    expect(out).not.toBe(input);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/finance/fold.test.ts`
Expected: FAIL — "Failed to resolve import ./fold".

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/finance/fold.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/finance/fold.ts src/lib/finance/fold.test.ts
git commit -m "Finance: fold pending into posted, or every purchase looks like a double charge"
```

---

## Task 6: Stage 2 — expand a bill's cadence into due dates

**Files:**
- Create: `src/lib/finance/occurrences.ts`
- Test: `src/lib/finance/occurrences.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { occurrences } from "./occurrences";
import type { Bill } from "./types";

function bill(over: Partial<Bill> = {}): Bill {
  return {
    id: "b1",
    name: "Rent",
    matchers: ["landlord"],
    amountExpected: 1200,
    amountTolerance: 1,
    amountTolerancePct: 5,
    currency: "GBP",
    accountId: "a1",
    autopay: true,
    cadence: "monthly",
    dayOfMonth: 1,
    weekday: null,
    monthOfYear: null,
    firstDue: "2026-01-01",
    endDate: null,
    graceDays: 3,
    reminders: [],
    paused: false,
    origin: "typed",
    ...over,
  };
}

const dues = (b: Bill, from: string, to: string) =>
  occurrences(b, from, to).map((o) => o.due);

describe("occurrences — monthly", () => {
  it("lands on the nominated day each month", () => {
    expect(dues(bill({ dayOfMonth: 12 }), "2026-09-01", "2026-11-30")).toEqual([
      "2026-09-12",
      "2026-10-12",
      "2026-11-12",
    ]);
  });

  // The month-end trap: a bill "due on the 31st" has no 31st in February.
  it("clamps the 31st to the last day of a short month", () => {
    expect(dues(bill({ dayOfMonth: 31 }), "2026-01-01", "2026-04-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("clamps to 29 February in a leap year", () => {
    expect(dues(bill({ dayOfMonth: 30 }), "2028-02-01", "2028-02-29")).toEqual([
      "2028-02-29",
    ]);
  });

  it("excludes dates before the window", () => {
    expect(dues(bill({ dayOfMonth: 1 }), "2026-09-02", "2026-10-31")).toEqual([
      "2026-10-01",
    ]);
  });

  it("never produces a date before firstDue", () => {
    const b = bill({ dayOfMonth: 1, firstDue: "2026-10-01" });
    expect(dues(b, "2026-01-01", "2026-12-31")).toEqual([
      "2026-10-01",
      "2026-11-01",
      "2026-12-01",
    ]);
  });

  it("stops at endDate", () => {
    const b = bill({ dayOfMonth: 1, endDate: "2026-11-15" });
    expect(dues(b, "2026-09-01", "2026-12-31")).toEqual([
      "2026-09-01",
      "2026-10-01",
      "2026-11-01",
    ]);
  });
});

describe("occurrences — other cadences", () => {
  it("steps weekly from firstDue", () => {
    const b = bill({ cadence: "weekly", weekday: 1, firstDue: "2026-09-07" });
    expect(dues(b, "2026-09-01", "2026-09-30")).toEqual([
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
  });

  it("steps fortnightly from firstDue", () => {
    const b = bill({ cadence: "fortnightly", weekday: 1, firstDue: "2026-09-07" });
    expect(dues(b, "2026-09-01", "2026-10-31")).toEqual([
      "2026-09-07",
      "2026-09-21",
      "2026-10-05",
      "2026-10-19",
    ]);
  });

  it("steps quarterly", () => {
    const b = bill({ cadence: "quarterly", dayOfMonth: 15, firstDue: "2026-01-15" });
    expect(dues(b, "2026-01-01", "2026-12-31")).toEqual([
      "2026-01-15",
      "2026-04-15",
      "2026-07-15",
      "2026-10-15",
    ]);
  });

  it("steps annually", () => {
    const b = bill({
      cadence: "annual",
      dayOfMonth: 3,
      monthOfYear: 6,
      firstDue: "2026-06-03",
    });
    expect(dues(b, "2026-01-01", "2028-12-31")).toEqual([
      "2026-06-03",
      "2027-06-03",
      "2028-06-03",
    ]);
  });

  it("yields a one-off exactly once", () => {
    const b = bill({ cadence: "one_off", firstDue: "2026-09-20" });
    expect(dues(b, "2026-01-01", "2026-12-31")).toEqual(["2026-09-20"]);
  });

  it("yields nothing for a one-off outside the window", () => {
    const b = bill({ cadence: "one_off", firstDue: "2026-09-20" });
    expect(dues(b, "2026-10-01", "2026-12-31")).toEqual([]);
  });
});

describe("occurrences — guards", () => {
  it("yields nothing for a paused bill", () => {
    expect(dues(bill({ paused: true }), "2026-09-01", "2026-12-31")).toEqual([]);
  });

  it("carries the bill's amount, currency and account onto each occurrence", () => {
    const out = occurrences(bill({ dayOfMonth: 5 }), "2026-09-01", "2026-09-30");
    expect(out[0]).toEqual({
      billId: "b1",
      due: "2026-09-05",
      amountExpected: 1200,
      currency: "GBP",
      accountId: "a1",
    });
  });

  it("yields nothing when the window is inverted", () => {
    expect(dues(bill(), "2026-12-31", "2026-01-01")).toEqual([]);
  });

  // A long window on a weekly bill must not spin forever if a date fails to
  // advance. 10 years of weeks is the hard ceiling.
  it("terminates on a very long window", () => {
    const b = bill({ cadence: "weekly", firstDue: "2000-01-01" });
    expect(occurrences(b, "2000-01-01", "2030-01-01").length).toBeLessThan(2000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/finance/occurrences.test.ts`
Expected: FAIL — "Failed to resolve import ./occurrences".

- [ ] **Step 3: Write the implementation**

```ts
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
    // Walk forward to the window rather than emitting the whole history.
    while (d < from && !pastEnd(d) && out.length < MAX_OCCURRENCES) d = addDays(d, dayStep);
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
  let anchor = monthEndSafe(parts(bill.firstDue)[0], parts(bill.firstDue)[1], day);
  let step = 0;
  while (anchor < from && !pastEnd(anchor) && step < MAX_OCCURRENCES) {
    step += monthStep;
    const walked = addMonths(bill.firstDue, step);
    anchor = monthEndSafe(parts(walked)[0], parts(walked)[1], day);
  }
  while (!pastEnd(anchor) && out.length < MAX_OCCURRENCES) {
    if (inWindow(anchor)) emit(anchor);
    step += monthStep;
    const walked = addMonths(bill.firstDue, step);
    anchor = monthEndSafe(parts(walked)[0], parts(walked)[1], day);
  }
  return out;
}

/** Every bill's occurrences in one window, sorted by due date. */
export function allOccurrences(bills: Bill[], from: Day, to: Day): Occurrence[] {
  return bills
    .flatMap((b) => occurrences(b, from, to))
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/finance/occurrences.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/finance/occurrences.ts src/lib/finance/occurrences.test.ts
git commit -m "Finance: expand cadences without letting a February clamp compound"
```

---

## Task 7: Stage 3 — match transactions to occurrences

**Files:**
- Create: `src/lib/finance/match.ts`
- Test: `src/lib/finance/match.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { matchOccurrences } from "./match";
import type { Bill, Occurrence, Txn } from "./types";

function bill(over: Partial<Bill> = {}): Bill {
  return {
    id: "b1",
    name: "Spotify",
    matchers: ["spotify"],
    amountExpected: 9.99,
    amountTolerance: 1,
    amountTolerancePct: 5,
    currency: "GBP",
    accountId: "a1",
    autopay: true,
    cadence: "monthly",
    dayOfMonth: 12,
    weekday: null,
    monthOfYear: null,
    firstDue: "2026-01-12",
    endDate: null,
    graceDays: 3,
    reminders: [],
    paused: false,
    origin: "typed",
    ...over,
  };
}

function occ(over: Partial<Occurrence> = {}): Occurrence {
  return {
    billId: "b1",
    due: "2026-09-12",
    amountExpected: 9.99,
    currency: "GBP",
    accountId: "a1",
    ...over,
  };
}

function txn(over: Partial<Txn> = {}): Txn {
  return {
    id: "t1",
    accountId: "a1",
    date: "2026-09-12",
    amount: 9.99,
    currency: "GBP",
    merchantRaw: "SPOTIFY AB",
    merchantNorm: "spotify ab",
    pending: false,
    pendingTxnId: null,
    removedAt: null,
    category: null,
    ...over,
  };
}

describe("matchOccurrences", () => {
  it("matches a charge on the due date", () => {
    const r = matchOccurrences([occ()], [txn()], [bill()]);
    expect(r.matched[0].txn?.id).toBe("t1");
    expect(r.unmatchedTxns).toEqual([]);
  });

  it("matches a charge a few days late, inside the grace period", () => {
    const r = matchOccurrences([occ()], [txn({ date: "2026-09-15" })], [bill()]);
    expect(r.matched[0].txn?.id).toBe("t1");
  });

  it("does not match a charge past the grace period", () => {
    const r = matchOccurrences([occ()], [txn({ date: "2026-09-16" })], [bill()]);
    expect(r.matched[0].txn).toBeNull();
    expect(r.unmatchedTxns.map((t) => t.id)).toEqual(["t1"]);
  });

  it("matches a charge taken a few days early", () => {
    const r = matchOccurrences([occ()], [txn({ date: "2026-09-08" })], [bill()]);
    expect(r.matched[0].txn?.id).toBe("t1");
  });

  it("does not match a charge more than five days early", () => {
    const r = matchOccurrences([occ()], [txn({ date: "2026-09-06" })], [bill()]);
    expect(r.matched[0].txn).toBeNull();
  });

  it("does not match a different payee for the right amount", () => {
    const r = matchOccurrences([occ()], [txn({ merchantNorm: "netflix" })], [bill()]);
    expect(r.matched[0].txn).toBeNull();
  });

  it("does not match the right payee for a wildly wrong amount", () => {
    const r = matchOccurrences([occ()], [txn({ amount: 99.99 })], [bill()]);
    expect(r.matched[0].txn).toBeNull();
  });

  it("matches inside the tolerance", () => {
    // 5% of 9.99 is 0.50, so the absolute 1.00 applies: 10.99 is the edge.
    const r = matchOccurrences([occ()], [txn({ amount: 10.99 })], [bill()]);
    expect(r.matched[0].txn?.id).toBe("t1");
  });

  it("rejects a cent past the tolerance", () => {
    const r = matchOccurrences([occ()], [txn({ amount: 11.0 })], [bill()]);
    expect(r.matched[0].txn).toBeNull();
  });

  it("gives a transaction to the nearest occurrence, not the first", () => {
    const o1 = occ({ due: "2026-09-12" });
    const o2 = occ({ due: "2026-10-12" });
    const t = txn({ date: "2026-10-12" });
    const r = matchOccurrences([o1, o2], [t], [bill()]);
    expect(r.matched.find((m) => m.occurrence.due === "2026-10-12")?.txn?.id).toBe("t1");
    expect(r.matched.find((m) => m.occurrence.due === "2026-09-12")?.txn).toBeNull();
  });

  it("never gives one transaction to two occurrences", () => {
    const o1 = occ({ due: "2026-09-12" });
    const o2 = occ({ due: "2026-09-13" });
    const r = matchOccurrences([o1, o2], [txn()], [bill()]);
    expect(r.matched.filter((m) => m.txn !== null)).toHaveLength(1);
  });

  it("matches two charges to two occurrences", () => {
    const r = matchOccurrences(
      [occ({ due: "2026-09-12" }), occ({ due: "2026-10-12" })],
      [txn({ id: "t1", date: "2026-09-12" }), txn({ id: "t2", date: "2026-10-12" })],
      [bill()],
    );
    expect(r.matched.map((m) => m.txn?.id)).toEqual(["t1", "t2"]);
    expect(r.unmatchedTxns).toEqual([]);
  });

  it("ignores a charge on another account when the bill names one", () => {
    const r = matchOccurrences([occ()], [txn({ accountId: "a2" })], [bill()]);
    expect(r.matched[0].txn).toBeNull();
  });

  it("accepts any account when the bill names none", () => {
    const r = matchOccurrences(
      [occ({ accountId: null })],
      [txn({ accountId: "a2" })],
      [bill({ accountId: null })],
    );
    expect(r.matched[0].txn?.id).toBe("t1");
  });

  it("ignores a refund when matching a bill", () => {
    const r = matchOccurrences([occ()], [txn({ amount: -9.99 })], [bill()]);
    expect(r.matched[0].txn).toBeNull();
  });

  it("reports transactions that matched nothing", () => {
    const r = matchOccurrences([], [txn({ id: "x", merchantNorm: "tesco" })], [bill()]);
    expect(r.unmatchedTxns.map((t) => t.id)).toEqual(["x"]);
  });

  it("reports the ids of every matched transaction", () => {
    const r = matchOccurrences([occ()], [txn()], [bill()]);
    expect(r.matchedTxnIds.has("t1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/finance/match.test.ts`
Expected: FAIL — "Failed to resolve import ./match".

- [ ] **Step 3: Write the implementation**

```ts
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
      if (!withinTolerance(t.amount, o.amountExpected, bill.amountTolerance, bill.amountTolerancePct)) return;
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/finance/match.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/finance/match.ts src/lib/finance/match.test.ts
git commit -m "Finance: match charges to bills best-first, so October is not read as a late September"
```

---

## Task 8: Stage 4 — findings

**Files:**
- Create: `src/lib/finance/findings.ts`
- Test: `src/lib/finance/findings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { findings } from "./findings";
import { defaultSettings } from "./types";
import type { Account, Bill, Matched, Txn } from "./types";

const TODAY = "2026-09-30";

function bill(over: Partial<Bill> = {}): Bill {
  return {
    id: "b1",
    name: "Spotify",
    matchers: ["spotify"],
    amountExpected: 9.99,
    amountTolerance: 1,
    amountTolerancePct: 5,
    currency: "GBP",
    accountId: "a1",
    autopay: true,
    cadence: "monthly",
    dayOfMonth: 12,
    weekday: null,
    monthOfYear: null,
    firstDue: "2026-01-12",
    endDate: null,
    graceDays: 3,
    reminders: [],
    paused: false,
    origin: "typed",
    ...over,
  };
}

function txn(over: Partial<Txn> = {}): Txn {
  return {
    id: "t1",
    accountId: "a1",
    date: "2026-09-12",
    amount: 9.99,
    currency: "GBP",
    merchantRaw: "SPOTIFY AB",
    merchantNorm: "spotify",
    pending: false,
    pendingTxnId: null,
    removedAt: null,
    category: null,
    ...over,
  };
}

function card(over: Partial<Account> = {}): Account {
  return {
    id: "a1",
    name: "Amex Gold",
    mask: "4421",
    type: "credit",
    currency: "GBP",
    countInSpend: true,
    balanceCurrent: 420,
    nextDueDate: "2026-10-05",
    statementNextClosing: "2026-10-28",
    minimumPayment: 25,
    lastStatementBalance: 410,
    isOverdue: false,
    datesSource: "bank",
    ...over,
  };
}

const ctx = (over: Partial<Parameters<typeof findings>[0]> = {}) => ({
  matched: [] as Matched[],
  unmatchedTxns: [] as Txn[],
  bills: [bill()],
  accounts: [card()],
  settings: defaultSettings(),
  today: TODAY,
  ...over,
});

const kinds = (fs: ReturnType<typeof findings>) => fs.map((f) => f.kind);

describe("duplicate-charge", () => {
  it("fires for two equal charges to one payee a day apart", () => {
    const out = findings(
      ctx({
        unmatchedTxns: [
          txn({ id: "t1", date: "2026-09-12" }),
          txn({ id: "t2", date: "2026-09-13" }),
        ],
      }),
    );
    const dup = out.find((f) => f.kind === "duplicate-charge");
    expect(dup).toBeDefined();
    expect(dup?.txnIds.sort()).toEqual(["t1", "t2"]);
    expect(dup?.severity).toBe("urgent");
  });

  it("names the evidence in `why`", () => {
    const out = findings(
      ctx({ unmatchedTxns: [txn({ id: "t1" }), txn({ id: "t2", date: "2026-09-13" })] }),
    );
    const dup = out.find((f) => f.kind === "duplicate-charge");
    expect(dup?.why).toContain("9.99");
    expect(dup?.why).toContain("spotify");
  });

  it("does not fire outside the window", () => {
    const out = findings(
      ctx({ unmatchedTxns: [txn({ id: "t1" }), txn({ id: "t2", date: "2026-09-20" })] }),
    );
    expect(kinds(out)).not.toContain("duplicate-charge");
  });

  it("does not fire for different amounts", () => {
    const out = findings(
      ctx({
        unmatchedTxns: [txn({ id: "t1" }), txn({ id: "t2", date: "2026-09-13", amount: 4.99 })],
      }),
    );
    expect(kinds(out)).not.toContain("duplicate-charge");
  });

  it("does not fire for different payees", () => {
    const out = findings(
      ctx({
        unmatchedTxns: [
          txn({ id: "t1" }),
          txn({ id: "t2", date: "2026-09-13", merchantNorm: "netflix" }),
        ],
      }),
    );
    expect(kinds(out)).not.toContain("duplicate-charge");
  });

  it("does not fire below the minimum amount", () => {
    const out = findings(
      ctx({
        unmatchedTxns: [
          txn({ id: "t1", amount: 0.5 }),
          txn({ id: "t2", date: "2026-09-13", amount: 0.5 }),
        ],
      }),
    );
    expect(kinds(out)).not.toContain("duplicate-charge");
  });

  it("does not fire for a payee on the multi-charge allowlist", () => {
    const settings = { ...defaultSettings(), multiChargePayees: ["spotify"] };
    const out = findings(
      ctx({
        settings,
        unmatchedTxns: [txn({ id: "t1" }), txn({ id: "t2", date: "2026-09-13" })],
      }),
    );
    expect(kinds(out)).not.toContain("duplicate-charge");
  });

  it("does not fire across two different accounts", () => {
    const out = findings(
      ctx({
        unmatchedTxns: [
          txn({ id: "t1" }),
          txn({ id: "t2", date: "2026-09-13", accountId: "a2" }),
        ],
      }),
    );
    expect(kinds(out)).not.toContain("duplicate-charge");
  });

  it("reports three equal charges as one finding naming all three", () => {
    const out = findings(
      ctx({
        unmatchedTxns: [
          txn({ id: "t1", date: "2026-09-12" }),
          txn({ id: "t2", date: "2026-09-12" }),
          txn({ id: "t3", date: "2026-09-13" }),
        ],
      }),
    );
    const dups = out.filter((f) => f.kind === "duplicate-charge");
    expect(dups).toHaveLength(1);
    expect(dups[0].txnIds).toHaveLength(3);
  });

  it("also fires when the duplicates are a bill paid twice", () => {
    // One charge matched the bill; the second is an unmatched twin of it.
    const matched: Matched[] = [
      {
        occurrence: {
          billId: "b1",
          due: "2026-09-12",
          amountExpected: 9.99,
          currency: "GBP",
          accountId: "a1",
        },
        txn: txn({ id: "t1" }),
      },
    ];
    const out = findings(
      ctx({ matched, unmatchedTxns: [txn({ id: "t2", date: "2026-09-13" })] }),
    );
    const dup = out.find((f) => f.kind === "duplicate-charge");
    expect(dup?.txnIds.sort()).toEqual(["t1", "t2"]);
  });
});

describe("missed-bill", () => {
  it("fires once the grace period has passed with no charge", () => {
    const matched: Matched[] = [
      {
        occurrence: {
          billId: "b1",
          due: "2026-09-12",
          amountExpected: 9.99,
          currency: "GBP",
          accountId: "a1",
        },
        txn: null,
      },
    ];
    const out = findings(ctx({ matched }));
    expect(kinds(out)).toContain("missed-bill");
  });

  it("does not fire while still inside the grace period", () => {
    const matched: Matched[] = [
      {
        occurrence: {
          billId: "b1",
          due: "2026-09-29",
          amountExpected: 9.99,
          currency: "GBP",
          accountId: "a1",
        },
        txn: null,
      },
    ];
    expect(kinds(findings(ctx({ matched })))).not.toContain("missed-bill");
  });

  it("does not fire for an occurrence still in the future", () => {
    const matched: Matched[] = [
      {
        occurrence: {
          billId: "b1",
          due: "2026-10-12",
          amountExpected: 9.99,
          currency: "GBP",
          accountId: "a1",
        },
        txn: null,
      },
    ];
    expect(kinds(findings(ctx({ matched })))).not.toContain("missed-bill");
  });

  it("does not fire when the bill was paid", () => {
    const matched: Matched[] = [
      {
        occurrence: {
          billId: "b1",
          due: "2026-09-12",
          amountExpected: 9.99,
          currency: "GBP",
          accountId: "a1",
        },
        txn: txn(),
      },
    ];
    expect(kinds(findings(ctx({ matched })))).not.toContain("missed-bill");
  });
});

describe("amount-changed", () => {
  const matchedAt = (amount: number): Matched[] => [
    {
      occurrence: {
        billId: "b1",
        due: "2026-09-12",
        amountExpected: 9.99,
        currency: "GBP",
        accountId: "a1",
      },
      txn: txn({ amount }),
    },
  ];

  it("warns when the charge went up beyond tolerance", () => {
    const f = findings(ctx({ matched: matchedAt(12.99) })).find(
      (x) => x.kind === "amount-changed",
    );
    expect(f?.severity).toBe("warn");
    expect(f?.why).toContain("12.99");
  });

  it("is only info when the charge went down", () => {
    const f = findings(ctx({ matched: matchedAt(6.99) })).find(
      (x) => x.kind === "amount-changed",
    );
    expect(f?.severity).toBe("info");
  });

  it("stays quiet inside tolerance", () => {
    expect(kinds(findings(ctx({ matched: matchedAt(10.5) })))).not.toContain("amount-changed");
  });
});

describe("unplanned-recurring", () => {
  const monthly = (merchantNorm: string, amount: number) => [
    txn({ id: "r1", date: "2026-07-10", merchantNorm, amount }),
    txn({ id: "r2", date: "2026-08-10", merchantNorm, amount }),
    txn({ id: "r3", date: "2026-09-10", merchantNorm, amount }),
  ];

  it("fires for three evenly spaced charges with no bill", () => {
    const out = findings(ctx({ bills: [], unmatchedTxns: monthly("adobe", 19.99) }));
    expect(kinds(out)).toContain("unplanned-recurring");
  });

  it("does not fire for only two charges", () => {
    const out = findings(ctx({ bills: [], unmatchedTxns: monthly("adobe", 19.99).slice(0, 2) }));
    expect(kinds(out)).not.toContain("unplanned-recurring");
  });

  it("does not fire for irregularly spaced charges", () => {
    const out = findings(
      ctx({
        bills: [],
        unmatchedTxns: [
          txn({ id: "r1", date: "2026-07-10", merchantNorm: "adobe", amount: 19.99 }),
          txn({ id: "r2", date: "2026-07-21", merchantNorm: "adobe", amount: 19.99 }),
          txn({ id: "r3", date: "2026-09-10", merchantNorm: "adobe", amount: 19.99 }),
        ],
      }),
    );
    expect(kinds(out)).not.toContain("unplanned-recurring");
  });

  it("does not fire when a bill already covers the payee", () => {
    const out = findings(
      ctx({
        bills: [bill({ matchers: ["adobe"] })],
        unmatchedTxns: monthly("adobe", 19.99),
      }),
    );
    expect(kinds(out)).not.toContain("unplanned-recurring");
  });
});

describe("card dates", () => {
  it("warns that a payment is due inside the lead time", () => {
    const f = findings(ctx({ accounts: [card({ nextDueDate: "2026-10-05" })] })).find(
      (x) => x.kind === "card-due-soon",
    );
    expect(f).toBeDefined();
    expect(f?.severity).toBe("warn");
  });

  it("is urgent two days out", () => {
    const f = findings(ctx({ accounts: [card({ nextDueDate: "2026-10-02" })] })).find(
      (x) => x.kind === "card-due-soon",
    );
    expect(f?.severity).toBe("urgent");
  });

  it("is urgent when the card is already overdue", () => {
    const f = findings(
      ctx({ accounts: [card({ nextDueDate: "2026-10-06", isOverdue: true })] }),
    ).find((x) => x.kind === "card-due-soon");
    expect(f?.severity).toBe("urgent");
  });

  it("stays quiet well before the lead time", () => {
    const out = findings(ctx({ accounts: [card({ nextDueDate: "2026-11-20" })] }));
    expect(kinds(out)).not.toContain("card-due-soon");
  });

  it("says so when the dates were typed rather than fetched", () => {
    const f = findings(
      ctx({ accounts: [card({ nextDueDate: "2026-10-05", datesSource: "typed" })] }),
    ).find((x) => x.kind === "card-due-soon");
    expect(f?.why).toContain("typed");
  });

  it("reports a statement closing inside the lead time as info", () => {
    const f = findings(
      ctx({ accounts: [card({ statementNextClosing: "2026-10-03", nextDueDate: null })] }),
    ).find((x) => x.kind === "card-statement-closing");
    expect(f?.severity).toBe("info");
  });

  it("ignores a depository account", () => {
    const out = findings(
      ctx({ accounts: [card({ type: "depository", nextDueDate: "2026-10-01" })] }),
    );
    expect(kinds(out)).not.toContain("card-due-soon");
  });
});

describe("fingerprints", () => {
  it("are stable across two identical runs", () => {
    const input = ctx({
      unmatchedTxns: [txn({ id: "t1" }), txn({ id: "t2", date: "2026-09-13" })],
    });
    const a = findings(input).map((f) => f.fingerprint);
    const b = findings(input).map((f) => f.fingerprint);
    expect(a).toEqual(b);
  });

  it("do not depend on the order transactions arrive in", () => {
    const t1 = txn({ id: "t1" });
    const t2 = txn({ id: "t2", date: "2026-09-13" });
    const a = findings(ctx({ unmatchedTxns: [t1, t2] })).map((f) => f.fingerprint);
    const b = findings(ctx({ unmatchedTxns: [t2, t1] })).map((f) => f.fingerprint);
    expect(a).toEqual(b);
  });

  it("are unique within one run", () => {
    const out = findings(
      ctx({
        unmatchedTxns: [
          txn({ id: "t1" }),
          txn({ id: "t2", date: "2026-09-13" }),
          txn({ id: "t3", date: "2026-09-12", merchantNorm: "netflix", amount: 15.99 }),
          txn({ id: "t4", date: "2026-09-13", merchantNorm: "netflix", amount: 15.99 }),
        ],
      }),
    );
    const fps = out.map((f) => f.fingerprint);
    expect(new Set(fps).size).toBe(fps.length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/finance/findings.test.ts`
Expected: FAIL — "Failed to resolve import ./findings".

- [ ] **Step 3: Write the implementation**

```ts
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
import { cents, sameAmount, withinTolerance } from "./money";
import type { Account, Bill, Day, Finding, Matched, Severity, Txn } from "./types";
import type { FinanceSettings } from "./types";

export interface FindingsInput {
  matched: Matched[];
  unmatchedTxns: Txn[];
  bills: Bill[];
  accounts: Account[];
  settings: FinanceSettings;
  today: Day;
}

/** Charges this far apart, or closer, can be the same charge billed twice. */
const RECURRING_MIN = 3;
/** How far apart two gaps may be and still count as "evenly spaced". */
const SPACING_SLOP = 4;

const fmt = (n: number) => n.toFixed(2);

export function findings(input: FindingsInput): Finding[] {
  const { matched, unmatchedTxns, bills, accounts, settings, today } = input;
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
      a.datesSource === "bank"
        ? ""
        : ` This date was ${a.datesSource === "typed" ? "typed" : "inferred"}, not published by your bank.`;

    if (a.nextDueDate) {
      const days = diffDays(today, a.nextDueDate);
      if (days >= 0 && days <= leadDays) {
        const severity: Severity = a.isOverdue || days <= 2 ? "urgent" : "warn";
        const min = a.minimumPayment === null || a.minimumPayment === undefined
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
```

Note the unused import guard: `sameAmount` is **not** imported above — grouping uses
`cents()` directly. If your editor auto-adds it, remove it; an unused import fails lint.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/finance/findings.test.ts`
Expected: PASS, 31 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/finance/findings.ts src/lib/finance/findings.test.ts
git commit -m "Finance: findings that name their evidence, with fingerprints that survive a re-sync"
```

---

## Task 9: The spend report

**Files:**
- Create: `src/lib/finance/spend.ts`
- Test: `src/lib/finance/spend.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { spend } from "./spend";
import { defaultSettings } from "./types";
import type { Account, Txn } from "./types";

function txn(over: Partial<Txn> = {}): Txn {
  return {
    id: "t1",
    accountId: "card",
    date: "2026-09-30",
    amount: 20,
    currency: "GBP",
    merchantRaw: "TESCO",
    merchantNorm: "tesco",
    pending: false,
    pendingTxnId: null,
    removedAt: null,
    category: null,
    ...over,
  };
}

const CARD: Account = {
  id: "card",
  name: "Amex",
  mask: "4421",
  type: "credit",
  currency: "GBP",
  countInSpend: true,
  balanceCurrent: 0,
};

const CURRENT: Account = {
  id: "bank",
  name: "Monzo",
  mask: "1234",
  type: "depository",
  currency: "GBP",
  countInSpend: false,
  balanceCurrent: 0,
};

const base = {
  accounts: [CARD, CURRENT],
  matchedTxnIds: new Set<string>(),
  settings: defaultSettings(),
  today: "2026-09-30",
};

describe("spend — what counts", () => {
  it("counts a card purchase", () => {
    const r = spend({ ...base, txns: [txn()] });
    expect(r.today.total).toBe(20);
    expect(r.today.count).toBe(1);
  });

  it("excludes a transaction that paid a declared bill", () => {
    const r = spend({ ...base, txns: [txn({ id: "bill-txn" })], matchedTxnIds: new Set(["bill-txn"]) });
    expect(r.today.total).toBe(0);
  });

  it("excludes an account with countInSpend false", () => {
    const r = spend({ ...base, txns: [txn({ accountId: "bank" })] });
    expect(r.today.total).toBe(0);
  });

  it("lets a refund reduce the total", () => {
    const r = spend({ ...base, txns: [txn({ id: "a", amount: 60 }), txn({ id: "b", amount: -60 })] });
    expect(r.today.total).toBe(0);
    expect(r.today.refunds).toBe(60);
  });

  it("includes pending charges but reports their share", () => {
    const r = spend({
      ...base,
      txns: [txn({ id: "a", amount: 20 }), txn({ id: "b", amount: 30, pending: true })],
    });
    expect(r.today.total).toBe(50);
    expect(r.today.pending).toBe(30);
  });
});

describe("spend — transfers and card payments", () => {
  it("excludes a credit-card payment by category", () => {
    const r = spend({
      ...base,
      txns: [txn({ id: "pay", amount: 400, category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" })],
    });
    expect(r.today.total).toBe(0);
    expect(r.today.excludedTransfers).toBe(1);
  });

  it("excludes a transfer by category", () => {
    const r = spend({ ...base, txns: [txn({ id: "x", amount: 100, category: "TRANSFER_OUT" })] });
    expect(r.today.total).toBe(0);
  });

  // The important one: categories are missing often enough that pair detection
  // has to carry it. A card cleared mid-window must not double the figure.
  it("excludes a card payment with no category, by pairing the two legs", () => {
    const paidFrom = { ...CURRENT, countInSpend: true };
    const r = spend({
      ...base,
      accounts: [CARD, paidFrom],
      txns: [
        txn({ id: "out", accountId: "bank", amount: 400, merchantNorm: "amex payment" }),
        txn({ id: "in", accountId: "card", amount: -400, merchantNorm: "payment received" }),
      ],
    });
    expect(r.today.total).toBe(0);
    expect(r.today.excludedTransfers).toBe(2);
  });

  it("pairs the legs when they land a couple of days apart", () => {
    const paidFrom = { ...CURRENT, countInSpend: true };
    const r = spend({
      ...base,
      accounts: [CARD, paidFrom],
      txns: [
        txn({ id: "out", accountId: "bank", amount: 400, date: "2026-09-28" }),
        txn({ id: "in", accountId: "card", amount: -400, date: "2026-09-30" }),
      ],
      window: { from: "2026-09-28", to: "2026-09-30" },
    });
    expect(r.window.total).toBe(0);
  });

  it("does not pair two unrelated charges of the same amount on one account", () => {
    const r = spend({
      ...base,
      txns: [
        txn({ id: "a", amount: 40, merchantNorm: "tesco" }),
        txn({ id: "b", amount: 40, merchantNorm: "shell" }),
      ],
    });
    expect(r.today.total).toBe(80);
    expect(r.today.excludedTransfers).toBe(0);
  });
});

describe("spend — the two windows", () => {
  const week = [
    txn({ id: "m", date: "2026-09-28", amount: 10 }),
    txn({ id: "t", date: "2026-09-29", amount: 20 }),
    txn({ id: "w", date: "2026-09-30", amount: 30 }),
    // Last week, same elapsed position (Mon–Wed).
    txn({ id: "lm", date: "2026-09-21", amount: 100 }),
    txn({ id: "lt", date: "2026-09-22", amount: 100 }),
    txn({ id: "lw", date: "2026-09-23", amount: 100 }),
    // Last week, AFTER the elapsed point — must not count in the comparison.
    txn({ id: "lf", date: "2026-09-25", amount: 500 }),
  ];

  it("totals this week from the configured week start", () => {
    const r = spend({ ...base, txns: week });
    expect(r.week.total).toBe(60);
    expect(r.week.from).toBe("2026-09-28");
  });

  // Comparing a Wednesday against a complete previous week makes every week
  // look cheap until Sunday.
  it("compares against the previous week only as far as the same weekday", () => {
    const r = spend({ ...base, txns: week });
    expect(r.previousWeek.total).toBe(300);
    expect(r.previousWeek.to).toBe("2026-09-23");
  });

  it("honours a Sunday week start", () => {
    const settings = { ...defaultSettings(), weekStartsOn: 0 };
    const r = spend({ ...base, settings, txns: week });
    expect(r.week.from).toBe("2026-09-27");
  });

  it("reports a seven-day series in local days", () => {
    const r = spend({ ...base, txns: week });
    expect(r.series).toHaveLength(7);
    expect(r.series[r.series.length - 1]).toEqual({ day: "2026-09-30", total: 30 });
    expect(r.series[0].day).toBe("2026-09-24");
  });

  it("ranks the top merchants in the week", () => {
    const r = spend({
      ...base,
      txns: [
        txn({ id: "a", date: "2026-09-28", amount: 10, merchantNorm: "tesco" }),
        txn({ id: "b", date: "2026-09-29", amount: 40, merchantNorm: "shell" }),
        txn({ id: "c", date: "2026-09-30", amount: 5, merchantNorm: "tesco" }),
      ],
    });
    expect(r.topMerchants[0]).toEqual({ merchant: "shell", total: 40, count: 1 });
    expect(r.topMerchants[1]).toEqual({ merchant: "tesco", total: 15, count: 2 });
  });

  it("is all zeros with no transactions", () => {
    const r = spend({ ...base, txns: [] });
    expect(r.today.total).toBe(0);
    expect(r.week.total).toBe(0);
    expect(r.series.every((p) => p.total === 0)).toBe(true);
    expect(r.topMerchants).toEqual([]);
  });

  it("ignores a transaction outside every window", () => {
    const r = spend({ ...base, txns: [txn({ id: "old", date: "2026-01-01", amount: 999 })] });
    expect(r.week.total).toBe(0);
    expect(r.series.every((p) => p.total === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/finance/spend.test.ts`
Expected: FAIL — "Failed to resolve import ./spend".

- [ ] **Step 3: Write the implementation**

```ts
// ---------------------------------------------------------------------------
// Personal Finance — daily and weekly spend, excluding bills.
//
// The point of this view is the money the owner has discretion over, so three
// things are taken out: charges that paid a declared bill (that set already
// exists, from stage 3), charges on accounts the owner excluded, and transfers.
//
// TRANSFERS ARE THE RULE THAT DECIDES WHETHER THE NUMBER IS WORTH READING.
// Paying 400 off a credit card from a current account is not spending 400 — the
// purchases it covers were counted when they happened. Counted naively, any
// week a card is cleared roughly doubles. Categories catch most of it, but
// providers omit or mis-set them often enough that pair detection has to carry
// the rest: a debit on one of the owner's accounts and a matching credit on
// another, close in time, is one movement of the owner's own money.
//
// Refunds are NOT dropped; they net off, because that is what happened. The
// report carries `refunds` so a surprisingly cheap week can be explained rather
// than leaving the owner to wonder.
// ---------------------------------------------------------------------------

import { addDays, diffDays, startOfWeek } from "./dates";
import { cents, sameAmount, sum } from "./money";
import type { Account, Day, FinanceSettings, Txn } from "./types";

/** Categories that are a movement of the owner's own money, not spending. */
const TRANSFER_CATEGORIES = [
  "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
];

/** How far apart the two legs of one transfer may land. */
const PAIR_WINDOW_DAYS = 3;

export interface SpendWindow {
  from: Day;
  to: Day;
  total: number;
  count: number;
  /** Of `total`, how much is still pending and may yet change. */
  pending: number;
  /** Money that came back in the window, as a positive number. */
  refunds: number;
  /** How many rows were dropped as transfers, so the exclusion is auditable. */
  excludedTransfers: number;
}

export interface SpendReport {
  today: SpendWindow;
  week: SpendWindow;
  previousWeek: SpendWindow;
  /** The last seven days, oldest first. */
  series: { day: Day; total: number }[];
  topMerchants: { merchant: string; total: number; count: number }[];
  currency: string | null;
}

export interface SpendInput {
  txns: Txn[];
  accounts: Account[];
  /** From stage 3. These paid a bill, so they are not discretionary spend. */
  matchedTxnIds: Set<string>;
  settings: FinanceSettings;
  today: Day;
  /** Overrides the week window, for the series and for tests. */
  window?: { from: Day; to: Day };
}

/** Ids of transactions that are one leg of a transfer between own accounts. */
function transferIds(txns: Txn[], accounts: Account[]): Set<string> {
  const own = new Set(accounts.map((a) => a.id));
  const ids = new Set<string>();

  for (const t of txns) {
    if (t.category && TRANSFER_CATEGORIES.includes(t.category)) ids.add(t.id);
  }

  // Pair an outflow on one own account against an inflow on another.
  const outs = txns.filter((t) => t.amount > 0 && own.has(t.accountId) && !ids.has(t.id));
  const ins = txns.filter((t) => t.amount < 0 && own.has(t.accountId) && !ids.has(t.id));
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

function windowOf(txns: Txn[], from: Day, to: Day, excluded: number): SpendWindow {
  const inside = txns.filter((t) => t.date >= from && t.date <= to);
  const debits = inside.filter((t) => t.amount > 0);
  return {
    from,
    to,
    total: sum(inside.map((t) => t.amount)),
    count: debits.length,
    pending: sum(debits.filter((t) => t.pending).map((t) => t.amount)),
    refunds: sum(inside.filter((t) => t.amount < 0).map((t) => -t.amount)),
    excludedTransfers: excluded,
  };
}

export function spend(input: SpendInput): SpendReport {
  const { txns, accounts, matchedTxnIds, settings, today } = input;
  const counted = new Map(accounts.map((a) => [a.id, a.countInSpend]));

  const transfers = transferIds(txns, accounts);
  const eligible = txns.filter(
    (t) =>
      t.removedAt === null &&
      counted.get(t.accountId) === true &&
      !matchedTxnIds.has(t.id) &&
      !transfers.has(t.id),
  );
  const droppedIn = (from: Day, to: Day) =>
    txns.filter(
      (t) =>
        transfers.has(t.id) &&
        counted.get(t.accountId) === true &&
        t.date >= from &&
        t.date <= to,
    ).length;

  const weekFrom = input.window?.from ?? startOfWeek(today, settings.weekStartsOn);
  const weekTo = input.window?.to ?? today;
  // Last week, only as far into it as we are into this one.
  const prevFrom = addDays(weekFrom, -7);
  const prevTo = addDays(weekTo, -7);

  const series: { day: Day; total: number }[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = addDays(today, -i);
    series.push({ day, total: sum(eligible.filter((t) => t.date === day).map((t) => t.amount)) });
  }

  const inWeek = eligible.filter((t) => t.date >= weekFrom && t.date <= weekTo);
  const merchants = new Map<string, { total: number; count: number }>();
  for (const t of inWeek) {
    if (t.amount <= 0) continue;
    const m = merchants.get(t.merchantNorm) ?? { total: 0, count: 0 };
    merchants.set(t.merchantNorm, {
      total: m.total + cents(t.amount) / 100,
      count: m.count + 1,
    });
  }

  const currencies = new Set(accounts.filter((a) => a.countInSpend).map((a) => a.currency));

  return {
    today: windowOf(eligible, today, today, droppedIn(today, today)),
    week: windowOf(eligible, weekFrom, weekTo, droppedIn(weekFrom, weekTo)),
    previousWeek: windowOf(eligible, prevFrom, prevTo, droppedIn(prevFrom, prevTo)),
    series,
    topMerchants: [...merchants.entries()]
      .map(([merchant, v]) => ({ merchant, total: v.total, count: v.count }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8),
    currency:
      settings.currencyDisplay ?? (currencies.size === 1 ? [...currencies][0] : null),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/finance/spend.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/finance/spend.ts src/lib/finance/spend.test.ts
git commit -m "Finance: spend excluding bills, and the transfer rule that stops it double-counting"
```

---

## Task 10: Compose the pipeline

**Files:**
- Create: `src/lib/finance/reconcile.ts`
- Test: `src/lib/finance/reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { reconcile } from "./reconcile";
import { defaultSettings } from "./types";
import type { Account, Bill, Txn } from "./types";

const CARD: Account = {
  id: "card",
  name: "Amex Gold",
  mask: "4421",
  type: "credit",
  currency: "GBP",
  countInSpend: true,
  balanceCurrent: 310,
  nextDueDate: "2026-10-04",
  lastStatementBalance: 310,
  minimumPayment: 25,
  statementLastClosed: "2026-09-07",
  datesSource: "bank",
};

const SPOTIFY: Bill = {
  id: "b-spotify",
  name: "Spotify",
  matchers: ["spotify"],
  amountExpected: 9.99,
  amountTolerance: 1,
  amountTolerancePct: 5,
  currency: "GBP",
  accountId: "card",
  autopay: true,
  cadence: "monthly",
  dayOfMonth: 12,
  weekday: null,
  monthOfYear: null,
  firstDue: "2026-01-12",
  endDate: null,
  graceDays: 3,
  reminders: [1440],
  paused: false,
  origin: "typed",
};

function txn(over: Partial<Txn>): Txn {
  return {
    id: "x",
    accountId: "card",
    date: "2026-09-12",
    amount: 9.99,
    currency: "GBP",
    merchantRaw: "SPOTIFY",
    merchantNorm: "spotify",
    pending: false,
    pendingTxnId: null,
    removedAt: null,
    category: null,
    ...over,
  };
}

describe("reconcile", () => {
  const input = {
    bills: [SPOTIFY],
    accounts: [CARD],
    settings: defaultSettings(),
    today: "2026-09-30",
    from: "2026-09-01",
    to: "2026-10-31",
  };

  it("pays a bill cleanly and raises nothing but the card date", () => {
    const r = reconcile({ ...input, txns: [txn({ id: "t1" })] });
    expect(r.findings.map((f) => f.kind)).toEqual(["card-due-soon"]);
    expect(r.matchedTxnIds.has("t1")).toBe(true);
  });

  // The whole point of folding first: this pair is ONE charge, not two.
  it("does not call a pending/posted pair a duplicate", () => {
    const r = reconcile({
      ...input,
      txns: [
        txn({ id: "pend", pending: true }),
        txn({ id: "post", pendingTxnId: "pend" }),
      ],
    });
    expect(r.findings.map((f) => f.kind)).not.toContain("duplicate-charge");
    expect(r.txns.map((t) => t.id)).toEqual(["post"]);
  });

  it("catches a bill that was genuinely charged twice", () => {
    const r = reconcile({
      ...input,
      txns: [txn({ id: "t1" }), txn({ id: "t2", date: "2026-09-13" })],
    });
    const dup = r.findings.find((f) => f.kind === "duplicate-charge");
    expect(dup?.txnIds.sort()).toEqual(["t1", "t2"]);
  });

  it("reports a bill that never arrived", () => {
    const r = reconcile({ ...input, txns: [] });
    expect(r.findings.map((f) => f.kind)).toContain("missed-bill");
  });

  it("produces a spend report that excludes the bill", () => {
    const r = reconcile({
      ...input,
      txns: [txn({ id: "t1" }), txn({ id: "food", date: "2026-09-30", amount: 24, merchantNorm: "tesco" })],
    });
    expect(r.spend.today.total).toBe(24);
    expect(r.spend.week.total).toBe(24);
  });

  it("works with no bills, no accounts and no transactions", () => {
    const r = reconcile({ ...input, bills: [], accounts: [], txns: [] });
    expect(r.findings).toEqual([]);
    expect(r.spend.week.total).toBe(0);
    expect(r.occurrences).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/finance/reconcile.test.ts`
Expected: FAIL — "Failed to resolve import ./reconcile".

- [ ] **Step 3: Write the implementation**

```ts
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
import type { Account, Bill, Day, Finding, FinanceSettings, Matched, Occurrence, Txn } from "./types";
import type { SpendReport } from "./spend";

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
  findings: Finding[];
  spend: SpendReport;
}

export function reconcile(input: ReconcileInput): Reconciled {
  const txns = fold(input.txns);
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
    findings: findings({
      matched,
      unmatchedTxns,
      bills: input.bills,
      accounts: input.accounts,
      settings: input.settings,
      today: input.today,
    }),
    spend: spend({
      txns,
      accounts: input.accounts,
      matchedTxnIds,
      settings: input.settings,
      today: input.today,
    }),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/finance/reconcile.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole finance suite**

Run: `npx vitest run src/lib/finance`
Expected: PASS, 10 files, ~150 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/finance/reconcile.ts src/lib/finance/reconcile.test.ts
git commit -m "Finance: compose the pipeline, fold first"
```

---

## Task 11: The schema

**Files:**
- Create: `supabase/migrations/20260930000000_jarvis_finance.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- Jarvis — Personal Finance.
--
-- Two ledgers and one reconciliation: `finance_bills` is what the owner says
-- should happen, `finance_txns` is what the bank reports did happen, and every
-- alert is a mismatch between them. See
-- docs/superpowers/specs/2026-09-30-personal-finance-design.md.
--
-- Three decisions worth knowing before changing anything here:
--
-- 1. RLS IS OWNER-ONLY on every table, with no world-readable path, not even
--    for aggregates — the same reasoning as jarvis_memories. This holds bank
--    transactions.
--
-- 2. ACCESS TOKENS ARE ENCRYPTED BY THE APP, never stored raw, and no API route
--    returns one. The column holds AES-256-GCM ciphertext.
--
-- 3. finance_alerts_fingerprint_idx IS NOT A PARTIAL INDEX. A PostgREST upsert
--    cannot use a partial unique index — error 42P10, which is exactly what
--    broke the Jarvis memory sync. Resist adding a WHERE clause to it.
--
-- Additive and idempotent: safe to run twice.
-- ============================================================================

-- 1 of 6 --------------------------------------------------------------------
create table if not exists public.finance_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('plaid', 'gocardless', 'manual')),
  institution_id text,
  institution_name text not null default '',
  -- AES-256-GCM ciphertext. Never a raw token, never returned to a client.
  access_token_enc text,
  item_id text,
  sync_cursor text,
  status text not null default 'active'
    check (status in ('active', 'needs_reauth', 'error', 'revoked')),
  status_detail text not null default '',
  -- The EU 90-day consent clock. Null for providers without a fixed expiry.
  consent_expires_at timestamptz,
  last_synced_at timestamptz,
  -- Enforces a provider's per-day call ceiling (GoCardless allows as few as 4).
  sync_count_today smallint not null default 0,
  sync_count_day date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_connections_user_idx
  on public.finance_connections (user_id, provider);

-- 2 of 6 --------------------------------------------------------------------
create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid references public.finance_connections (id) on delete cascade,
  provider_account_id text,
  name text not null default '',
  official_name text,
  mask text,
  type text not null default 'depository' check (type in ('depository', 'credit')),
  subtype text,
  currency text not null default 'GBP',
  balance_current numeric(14, 2),
  balance_available numeric(14, 2),
  balances_as_of timestamptz,
  -- Does this account's spending count toward the daily/weekly figures?
  -- Credit cards yes, current accounts no, until the owner says otherwise.
  count_in_spend boolean not null default true,
  -- ---- credit only --------------------------------------------------------
  credit_limit numeric(14, 2),
  apr_purchase numeric(6, 3),
  last_statement_balance numeric(14, 2),
  statement_last_closed date,
  statement_next_closing date,
  statement_next_closing_estimated boolean not null default false,
  next_due_date date,
  minimum_payment numeric(14, 2),
  is_overdue boolean not null default false,
  cycle_days smallint,
  -- Where the dates above came from. The UI shows this, so it cannot lie.
  dates_source text not null default 'typed'
    check (dates_source in ('bank', 'typed', 'inferred')),
  dates_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_accounts_provider_idx
  on public.finance_accounts (connection_id, provider_account_id)
  where provider_account_id is not null;
create index if not exists finance_accounts_user_idx
  on public.finance_accounts (user_id, type);

-- 3 of 6 --------------------------------------------------------------------
create table if not exists public.finance_bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  payee text not null default '',
  merchant_matchers text[] not null default '{}',
  amount_expected numeric(14, 2) not null default 0,
  amount_tolerance numeric(14, 2) not null default 1.00,
  amount_tolerance_pct numeric(5, 2) not null default 5,
  currency text not null default 'GBP',
  account_id uuid references public.finance_accounts (id) on delete set null,
  autopay boolean not null default false,
  category text,
  cadence text not null default 'monthly'
    check (cadence in ('weekly', 'fortnightly', 'monthly', 'quarterly', 'annual', 'one_off')),
  -- 31 means "the last day of the month", so a short February behaves.
  day_of_month smallint check (day_of_month between 1 and 31),
  weekday smallint check (weekday between 0 and 6),
  month_of_year smallint check (month_of_year between 1 and 12),
  first_due date not null,
  end_date date,
  grace_days smallint not null default 3,
  -- Minutes before the due date, the same vocabulary as the Recall calendar.
  reminders int[] not null default '{1440}',
  paused boolean not null default false,
  origin text not null default 'typed' check (origin in ('typed', 'detected')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_bills_user_idx
  on public.finance_bills (user_id, paused, first_due);

-- 4 of 6 --------------------------------------------------------------------
create table if not exists public.finance_txns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.finance_accounts (id) on delete cascade,
  provider_txn_id text not null,
  date date not null,
  authorized_date date,
  -- Positive when money leaves, matching Plaid, so spend is a plain sum.
  amount numeric(14, 2) not null,
  currency text not null default 'GBP',
  merchant_raw text not null default '',
  merchant_norm text not null default '',
  category text,
  pending boolean not null default false,
  -- On a POSTED row, the pending row it replaced. Folding this pair is what
  -- stops an ordinary purchase being read as a double charge.
  pending_txn_id text,
  -- Soft delete, set by a TRANSACTIONS_REMOVED webhook. Hard-deleting would
  -- lose the fact a charge was once seen, which matters when an alert cites it.
  removed_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists finance_txns_provider_idx
  on public.finance_txns (account_id, provider_txn_id);
create index if not exists finance_txns_user_date_idx
  on public.finance_txns (user_id, date desc);
create index if not exists finance_txns_merchant_idx
  on public.finance_txns (user_id, merchant_norm);

-- 5 of 6 --------------------------------------------------------------------
create table if not exists public.finance_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'duplicate-charge', 'missed-bill', 'amount-changed',
    'unplanned-recurring', 'card-due-soon', 'card-statement-closing'
  )),
  -- Stable identity across reconciliation runs, so a dismissal sticks.
  fingerprint text not null,
  state text not null default 'open'
    check (state in ('open', 'acknowledged', 'dismissed', 'resolved')),
  severity text not null default 'warn' check (severity in ('info', 'warn', 'urgent')),
  title text not null,
  -- The evidence sentence: amounts, payee, dates.
  why text not null default '',
  amount numeric(14, 2),
  currency text not null default 'GBP',
  bill_id uuid references public.finance_bills (id) on delete set null,
  account_id uuid references public.finance_accounts (id) on delete set null,
  txn_ids text[] not null default '{}',
  noticed_at timestamptz not null default now(),
  decided_at timestamptz,
  note text not null default '',
  updated_at timestamptz not null default now()
);

-- NOT partial. A PostgREST upsert cannot use a partial unique index (42P10).
create unique index if not exists finance_alerts_fingerprint_idx
  on public.finance_alerts (user_id, fingerprint);
create index if not exists finance_alerts_open_idx
  on public.finance_alerts (user_id, state, noticed_at desc);

-- 6 of 6 --------------------------------------------------------------------
create table if not exists public.finance_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  lead_days int[] not null default '{7,3,1}',
  duplicate_min_amount numeric(14, 2) not null default 1.00,
  duplicate_window_days smallint not null default 3,
  -- Payees where several same-amount charges in a day are normal. Grows from
  -- the owner dismissing a real alert, not from a guessed seed list.
  multi_charge_payees text[] not null default '{}',
  email_kinds text[] not null default '{duplicate-charge,missed-bill,card-due-soon}',
  quiet_hours_start smallint not null default 22,
  quiet_hours_end smallint not null default 7,
  -- 0 = Sunday, 1 = Monday.
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
  alert_email text,
  -- Null means "show each account in its own currency". Nothing is converted.
  currency_display text,
  updated_at timestamptz not null default now()
);

-- RLS -----------------------------------------------------------------------
alter table public.finance_connections enable row level security;
alter table public.finance_accounts enable row level security;
alter table public.finance_bills enable row level security;
alter table public.finance_txns enable row level security;
alter table public.finance_alerts enable row level security;
alter table public.finance_settings enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'finance_connections', 'finance_accounts', 'finance_bills',
    'finance_txns', 'finance_alerts', 'finance_settings'
  ]
  loop
    execute format(
      'drop policy if exists %I on public.%I', t || '_owner', t
    );
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_owner', t
    );
  end loop;
end $$;
```

- [ ] **Step 2: Check the SQL parses**

This repo has no local Postgres, so the check is a read-through against the three
documented traps rather than an execution:

1. `finance_alerts_fingerprint_idx` has **no** `WHERE` clause. Confirm by eye.
2. No `extensions.`-qualified type names (the Jarvis memory migration was rejected for one).
3. Every table has `enable row level security` and exactly one owner policy.

Run: `grep -c "enable row level security" supabase/migrations/20260930000000_jarvis_finance.sql`
Expected: `6`

Run: `grep -n "fingerprint_idx" -A2 supabase/migrations/20260930000000_jarvis_finance.sql`
Expected: two lines, the second ending `(user_id, fingerprint);` with no `where`.

- [ ] **Step 3: Copy the SQL to the clipboard for the owner**

The owner runs migrations by hand in the Supabase SQL editor. Make that one paste:

```bash
powershell -NoProfile -Command "Get-Content -Raw 'supabase/migrations/20260930000000_jarvis_finance.sql' | Set-Clipboard"
```

Then tell them: the SQL is on the clipboard, paste it into the Supabase SQL editor for
project `kiiwaiwrfslqankcsnkf` and run it. Do not claim the tables exist until they
confirm it ran.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260930000000_jarvis_finance.sql
git commit -m "Finance: the schema, owner-only, with the 42P10 trap noted where it bites"
```

---

## Self-Review

**1. Spec coverage.** §4's six tables → Task 11. §6's four stages → Tasks 5–8, composed in
Task 10. §13's spend rules → Task 9. §11's `reconcile.test.ts`, `spend.test.ts` and the
money/date edge cases → Tasks 2, 3, 9, 10. Not in this plan, by design, and each carried by a
named later plan: §5 providers (plan 2), §7 card-date inference (plan 2), §3 the surface and
§13's panes (plan 3), §8 calendar and §9 delivery (plan 4), §14 MCP (plan 5). §10's
encryption helper belongs with the provider that uses it, in plan 2.

**2. Placeholder scan.** No TBD, TODO or "handle edge cases". Every step shows its code and
its command.

**3. Type consistency.** `Txn.pendingTxnId` is spelled that way in types, fold, the tests and
the SQL (`pending_txn_id`). `matchedTxnIds` is returned by `matchOccurrences` and consumed by
`spend` and `reconcile` under the same name. `findings` takes `FindingsInput` with exactly the
fields `reconcile` passes. `occurrences(bill, from, to)` and `allOccurrences(bills, from, to)`
keep the same argument order. `SpendWindow.excludedTransfers` is the name used in both the
test and the implementation.

One deliberate note left in Task 8: `sameAmount` must **not** be imported in `findings.ts` —
grouping uses `cents()`. It *is* imported in `spend.ts`, where pair detection needs it.
